# Luma

**What am I forgetting?**

Luma reads your email and surfaces the small number of unfinished things that
actually need you — deadlines, forms, renewals, payments, returns, replies you
owe, promises you made. You never create any of it by hand.

This repository is **phase 1 of the MVP**: Gmail ingestion → AI extraction →
Open Loop creation → prioritization → dashboard.

---

## Quick start

```bash
npm install
cp .env.example .env        # add your ANTHROPIC_API_KEY
npm run db:push             # creates prisma/luma.db
npm run dev                 # http://localhost:3000
```

Open the app and click **Try it with a sample inbox**. That runs the real
pipeline against a built-in set of 14 messages — half genuine obligations, half
the noise a real inbox is full of. No Google account needed.

To connect a real mailbox, add `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (see
`.env.example` for the redirect URI) and click **Connect Gmail**.

```bash
npm test          # 76 tests, no API key or network needed
npm run typecheck
npm run build
npm run demo      # run the pipeline from the CLI and print what it found
```

---

## How it works

```
Gmail ──▶ ingest ──▶ prefilter ──▶ EXTRACT ──▶ verify ──▶ dedupe ──▶ persist ──▶ score ──▶ dashboard
                     (rules)       (LLM)       (rules)    (rules)               (rules)
```

Exactly one stage is a model call. Everything before it decides what is worth
spending a model on; everything after it decides what the model is allowed to
turn into application state.

| Stage | Where | What it does |
|---|---|---|
| **Ingest** | `src/server/ingest/pipeline.ts` | Stores messages as `SourceDocument`. Idempotent on `(account, externalId)`; unchanged content is skipped entirely. |
| **Prefilter** | `src/server/ingest/prefilter.ts` | Drops bulk mail before it costs a token. Marketing copy is full of fake urgency ("offer ends Friday"), so excluding it removes a whole class of false positives. |
| **Extract** | `src/server/ai/` | The only LLM call. Structured outputs constrain the model to a fixed schema; every call is logged to `AiRun`. |
| **Verify** | `src/server/loops/verify.ts` | Checks every evidence quote against the source. Unsupported claims are discarded. |
| **Dedupe** | `src/server/loops/dedupe.ts` | Stable hash key plus similarity matching, so the same obligation never appears twice. |
| **Score** | `src/server/loops/priority.ts` | Deterministic prioritization. The model never decides ordering. |

### Why precision is enforced in code, not in the prompt

The prompt asks the model not to fabricate. `verify.ts` is what makes that true:

- **Every quote is checked against the source.** The model must cite verbatim
  text; whitespace and smart quotes are normalized (email wraps lines), but
  paraphrase fails. A loop with no surviving evidence is thrown away.
- **A due date is only a fact if its quote verifies.** If the model claims a
  date was stated but the supporting quote isn't in the email, the date is kept
  but demoted to *estimated* — and the UI labels it that way.
- **Unparseable dates are dropped, not guessed.** Only `YYYY-MM-DD` and full ISO
  timestamps are accepted. "Next Friday" becomes no date at all.
- **Loops the user doesn't own are rejected**, as are low-confidence ones.

Every rejection is counted and returned in the pipeline summary, so a
degradation in extraction quality is visible rather than silent.

### Facts vs. inference

`OpenLoop` stores them in separate fields, and the detail page renders them
under separate headings — *"What the source says"* and *"What Luma worked out"* —
with the model's own note on which is which. A date the source stated is
labelled *stated in the email*; anything derived is labelled *estimated by Luma*.

### Traceability

Every loop links to the `SourceDocument`s it came from, with the verified quote.
The detail page shows the sender, date, subject, and exact excerpt behind every
claim.

---

## What Luma is allowed to do

- Gmail scope is **read-only** (`gmail.readonly`). It cannot send, reply,
  delete, or modify mail. The granted scopes are listed verbatim on the
  settings page.
- Marking a loop done or dismissed is a **Luma-local** change and never touches
  the mailbox.
- **There are no autonomous outbound actions.** Draft-email, create-reminder,
  and create-calendar-event are deliberately not in this phase; when they land
  they will each require explicit per-action approval.
- OAuth tokens are encrypted at rest (AES-256-GCM, `src/lib/crypto.ts`).
- Message bodies are truncated at ingestion and quoted reply chains stripped, so
  less content is stored and sent than arrives.

---

## Observability

Every model call writes an `AiRun` row: model, prompt version, status, token
counts, latency, the raw structured output, and how many candidates were
proposed. The settings page renders the last several runs. `PROMPT_VERSION` in
`src/server/ai/prompt.ts` is bumped whenever the prompt changes, so a shift in
quality can be traced to a revision.

The dashboard also shows how the list was built — messages read, filtered as
bulk, analyzed, loops found. If analysis didn't finish, it says so instead of
showing an empty list as though nothing were outstanding.

---

## Replaceable parts

The two components most likely to change are behind interfaces:

- **`MailProvider`** (`src/server/providers/types.ts`) — Gmail and the fixture
  inbox implement it. Nothing downstream knows about Gmail's API. Calendar and
  other providers slot in here.
- **`LoopExtractor`** (`src/server/ai/extract.ts`) — the model call sits behind
  this. `tests/pipeline.test.ts` swaps in a stub to test the whole pipeline with
  known model output, including deliberately wrong output.

The model id is `LUMA_MODEL` and reasoning depth is `LUMA_EFFORT`; neither
requires a code change.

---

## Tests

76 tests, all offline — no API key, no network, no Google account.

| File | Covers |
|---|---|
| `tests/prefilter.test.ts` | Bulk detection, and that `noreply@` senders with real obligations survive it |
| `tests/verify.test.ts` | Quote matching, fabricated-evidence rejection, due-date demotion |
| `tests/priority.test.ts` | Scoring, bucketing, ordering |
| `tests/dedupe.test.ts` | Stemming, dedupe keys, similarity, in-batch collapsing |
| `tests/batching.test.ts` | Thread packing and the limits that bound it |
| `tests/parse.test.ts` | MIME/HTML parsing, quoted-reply stripping, schema validation |
| `tests/pipeline.test.ts` | End-to-end against a real database with a stubbed model |

---

## Roadmap

Phase 1 (this repo) is complete and working. See [docs/ROADMAP.md](docs/ROADMAP.md)
for phases 2–4 (Calendar, notifications, approved actions) and how the current
design accommodates each.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — data model, pipeline stages, design decisions
- [docs/ROADMAP.md](docs/ROADMAP.md) — what comes next and why the seams are where they are
