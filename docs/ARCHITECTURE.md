# Architecture

## The shape of the system

```
                    ┌──────────────────────────────────────────┐
                    │  Deterministic application logic          │
  Gmail ──────────▶ │  ingest → prefilter                       │
  (MailProvider)    └──────────────────┬───────────────────────┘
                                       │  only non-bulk, unprocessed mail
                                       ▼
                    ┌──────────────────────────────────────────┐
                    │  LLM (LoopExtractor)                      │
                    │  structured output, schema-constrained    │
                    │  every call logged to AiRun               │
                    └──────────────────┬───────────────────────┘
                                       │  candidate loops
                                       ▼
                    ┌──────────────────────────────────────────┐
                    │  Deterministic application logic          │
                    │  verify → dedupe → persist → prioritize   │
                    └──────────────────┬───────────────────────┘
                                       ▼
                                   Dashboard
```

The model reads email. It does not decide what the user sees, in what order, or
whether something is real. That separation is the central design decision and
everything below follows from it.

## Data model

| Model | Purpose |
|---|---|
| `User` | Identity. |
| `ConnectedAccount` | A provider connection with encrypted tokens and the **verbatim granted scopes**. |
| `SyncState` | Per-account incremental-sync bookmark. |
| `SourceDocument` | A normalized ingested item. Unique on `(accountId, externalId)` — the idempotency key. |
| `OpenLoop` | The product's unit of value. Unique on `(userId, dedupeKey)`. |
| `OpenLoopEvidence` | Verified verbatim quotes linking a loop to its sources. |
| `AiRun` | One row per model call: model, prompt version, tokens, latency, raw output. |

Two constraints carry most of the weight:

- `@@unique([accountId, externalId])` on `SourceDocument` makes re-syncing free
  and safe. Combined with `contentHash`, an unchanged message is skipped without
  even a write.
- `@@unique([userId, dedupeKey])` on `OpenLoop` makes duplicate loops
  structurally impossible, not merely unlikely.

`SourceDocument` has a `kind` column already (`"email"`). Calendar events will
be `kind = "calendar_event"` in the same table, so extraction and evidence
linking work unchanged.

## Stage by stage

### 1. Ingest (`src/server/ingest/pipeline.ts`)

Pulls from a `MailProvider` and upserts `SourceDocument`s. Unchanged content is
left completely alone, including its `processedAt` stamp — so a re-sync never
pays to re-extract work already done. Changed content resets `processedAt` to
null, queuing it for re-analysis.

### 2. Prefilter (`src/server/ingest/prefilter.ts`)

Rules, not a model. Two reasons:

- **Cost.** Most of an inbox is bulk mail; sending it to a model is waste.
- **Precision.** Marketing copy is engineered to read like a deadline. Removing
  it up front eliminates a whole category of false positives that no prompt
  reliably suppresses.

The one subtlety is the carve-out: `noreply@licensing.example.gov` looks
automated but is exactly what the product exists to catch. `OBLIGATION_SENDER_HINTS`
overrides the automated-sender rule for `.gov`, billing, and support addresses.
This is directly tested.

### 3. Extract (`src/server/ai/`)

The only model call.

- **Structured outputs.** `extractionJsonSchema` constrains generation, so the
  response is JSON by construction rather than by parsing prose. It is then
  re-validated with Zod — structured outputs make malformed JSON very unlikely,
  but this feeds important application state and we don't trust the wire format
  blindly. An out-of-range confidence is clamped rather than failing the batch;
  an unknown category is rejected rather than coerced.
- **Thread-aware batching.** Threads are atomic (splitting one produces a
  duplicate loop per message), but whole threads are packed together up to a
  character budget. On the sample inbox this is 2 API calls instead of 12.
- **Observability.** Every call writes an `AiRun` — including failures and
  invalid output, with the raw text kept for replay.

### 4. Verify (`src/server/loops/verify.ts`)

Where "never fabricate" stops being a prompt instruction and becomes a
guarantee. See the README for the specific checks. The key design point: quote
matching normalizes whitespace and smart punctuation (because mail clients wrap
lines) but not word content, so it tolerates *formatting* differences and not
paraphrase.

### 5. Dedupe (`src/server/loops/dedupe.ts`)

Two mechanisms, because they catch different failures:

- `dedupeKey` — a hash over (category, counterparty domain, stemmed title).
  Backed by a unique constraint, so it holds even under concurrent writes.
- `findSimilar` — Jaccard overlap on stemmed tokens, for near-duplicates that
  hash differently (a reminder restating an earlier email in new words).

The stemmer is crude by design. It exists so "renew" / "renewal" / "renewals"
collapse to one token; a length guard stops it mangling short words.

### 6. Persist (`src/server/loops/persist.ts`)

Merges into an existing loop where one represents the same obligation. Two rules
matter:

- A loop the user marked done or dismissed is **never** resurrected by a later
  sync.
- A re-extraction only overwrites facts when it is at least as confident, so a
  weaker later pass cannot erase a good date.

### 7. Prioritize (`src/server/loops/priority.ts`)

Pure function of (category, due date, consequence, confidence, age):

```
base  = 0.45·urgency + 0.35·impact + 0.20·categoryWeight
score = 100 · base · (0.6 + 0.4·confidence)
```

Confidence *dampens* rather than gates, so a 0.6-confidence licence renewal
still outranks a certain-but-trivial reply. Dateless loops gain a small, capped
staleness boost as they age — an unanswered request does get more urgent — but
age can never outrank a real deadline.

Scores are recomputed on every sync and on dashboard load, because urgency is a
function of *now*.

## Gmail sync

Two modes, chosen by whether `SyncState.cursor` holds a usable `historyId`:

| | Full | Incremental |
|---|---|---|
| Call | `users.messages.list` with a dated `q` | `users.history.list` from the cursor |
| When | first sync, or the cursor aged out | every sync after the first |
| Cost | proportional to the window | proportional to what changed |

Gmail retains history for roughly a week, so an expired cursor is routine for
anyone who does not open the app for a while. It answers 404, and the provider
falls back to a full read rather than surfacing an error.

The watermark is read **before** listing. Taking it afterwards would skip
anything that arrived mid-sync; taking it first re-reads a few messages, which
costs nothing because ingestion is idempotent.

The cursor advances only after every message it covers is stored. A sync that
fails partway leaves the old cursor in place, so the next one picks the same
work back up instead of stepping over it. For the same reason, hydration
rethrows on a rate limit rather than returning a short result: a partial window
reported as complete would lose mail silently.

### Failure handling (`src/server/providers/gmail/retry.ts`)

Every Gmail failure is classified before anything decides what to do with it,
because the same status code means different things:

| Kind | Response |
|---|---|
| `rate_limit` — 429, or a 403 with a quota reason | retry with exponential backoff and full jitter, honouring `Retry-After` |
| `transient` — 5xx, dropped connections | same backoff |
| `revoked` — 401, `invalid_grant`, insufficient scope | stop; mark the account revoked and ask the user to reconnect |
| `permanent` — anything else | stop; the caller decides whether to skip or fail |

A 403 is the interesting case: it means *either* "slow down" *or* "you lost this
scope", and the two need opposite responses. The reason field separates them,
and an unlabelled 403 is treated as throttling — a retry costs seconds, whereas
wrongly declaring an account revoked pushes the user through consent again.

### Disconnection (`src/server/providers/gmail/account.ts`)

Revokes the grant at Google and clears the stored tokens. The local half always
runs: if Google is unreachable or the token was already dead, disconnecting
still succeeds, because leaving a user unable to disconnect because a third
party is down is the worse failure.

Ingested mail is kept by default — disconnecting stops future syncing, and
silently destroying someone's Open Loops because they unlinked an account would
be a surprise. Purging is an explicit opt-in, and it takes any loop that loses
its last citation with it: a claim this product cannot trace to a source is one
it will not show.

## Interfaces

`MailProvider` and `LoopExtractor` are the two seams. Both exist because those
are the parts most likely to be replaced — and because testing demands it: the
fixture provider makes the pipeline runnable without Google, and the stub
extractor lets `tests/pipeline.test.ts` assert what the deterministic stages do
with *known-bad* model output. That last part is not otherwise testable; you
cannot ask a real model to hallucinate a specific fake quote on demand.

## Trust and privacy

- Read-only Gmail scope; granted scopes stored verbatim and shown to the user.
- Tokens encrypted at rest (AES-256-GCM); secrets never logged.
- Bodies truncated and quoted reply chains stripped at ingestion, so less
  content is stored and sent than arrives.
- Session cookie is HMAC-signed, `httpOnly`, `sameSite=lax`, and holds only a
  user id.
- OAuth state parameter is verified against a short-lived cookie.
- Disconnecting revokes the grant at Google and erases the stored tokens; it
  does not merely set a flag.
- Production refuses to start a flow that needs `SESSION_SECRET` or
  `ENCRYPTION_KEY` without them, rather than silently using dev fallbacks.

## Deliberate limitations

- **SQLite.** One-command local setup. The only place the engine leaks is
  `src/lib/db.ts`; moving to Postgres is an adapter swap plus the schema
  provider.
- **Single account per sync.** `/api/sync` syncs the first connected account.
  Multi-account fan-out is a loop, not a redesign.
- **Polling, not push.** Syncs happen when the user asks or on a schedule.
  Gmail push notifications need a publicly reachable webhook, which a local-first
  MVP does not have. Sync itself is incremental: `SyncState.cursor` holds the
  `historyId` and `users.history.list` serves the delta, falling back to a dated
  query when the cursor ages out.
- **No server-side refusal fallbacks.** Refusals are handled explicitly and
  logged; for inbox extraction the risk is low enough that adding a beta
  dependency to core application state wasn't warranted.
