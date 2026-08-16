# Luma

**What am I forgetting?**

Luma reads your email and surfaces the small number of unfinished things that
actually need you — deadlines, forms, renewals, payments, returns, replies you
owe, promises you made. You never create any of it by hand.

---

## Setup

Requires **Node.js 22+**. No database server needed — SQLite by default.

```bash
git clone <repo> && cd Luma
npm install
cp .env.example .env       # works as-is for local development
npm run db:migrate         # creates prisma/luma.db and applies migrations
npm run db:seed            # optional: a demo user with sample data
npm run dev                # http://localhost:3000
```

Or in one step:

```bash
npm run setup && npm run dev
```

Verify it came up:

```bash
curl -s localhost:3000/api/health | jq
```

`.env` is gitignored and no secrets are committed. Development runs with fixed
dev-only fallbacks for `SESSION_SECRET` and `ENCRYPTION_KEY`; **production
refuses to start without real ones** (min 32 chars — `openssl rand -base64 32`).

### Optional integrations

Neither is required to run the app. Without them the relevant feature reports
itself unavailable rather than crashing.

| Feature | Variables | Without it |
|---|---|---|
| AI extraction | `ANTHROPIC_API_KEY` | Ingestion and the API work; extraction returns `feature_unavailable` |
| Gmail | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Connect Gmail" is hidden; the sample inbox still works |

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Full test suite (offline — no API key or network) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (flat config) |
| `npm run check` | Typecheck + tests |
| `npm run db:migrate` | Create/apply migrations (development) |
| `npm run db:deploy` | Apply existing migrations (CI/production) |
| `npm run db:reset` | Drop and rebuild the database |
| `npm run db:seed` | Insert demo data (idempotent) |
| `npm run db:studio` | Prisma Studio |

---

## Architecture

```
src/
  config/          typed, schema-validated configuration (the only reader of process.env)
  lib/             errors, logging, crypto, db client, session, time
  server/
    http/          route wrapper: request ids, error translation, response envelope
    domain/        action & notification vocabularies + state machines
    providers/     mail providers behind one interface (Gmail, fixtures)
    ingest/        prefilter + idempotent ingestion
    ai/            the single LLM call, behind a swappable interface
    loops/         verification, dedupe, prioritization, persistence
    pipeline/      orchestration
  app/             Next.js routes and pages
prisma/
  schema.prisma    data model
  migrations/      versioned SQL
  seed.ts          demo data
```

### Configuration

`src/config/schema.ts` declares every environment variable in one Zod schema —
it is the single place to look up what Luma can be configured with. Nothing
else in the codebase reads `process.env` directly.

Loading is lazy and memoized. The rules:

- An **invalid** value is fatal in every environment. A malformed `APP_URL` is a
  bug wherever it happens.
- A **missing** secret is fatal only in production. Development gets an
  obviously-fake fallback so `npm run dev` works with no setup.

`describeConfig()` gives a redacted view for logs and diagnostics — secrets are
reported as present/absent, never by value.

### Errors

`src/lib/errors.ts` defines a typed hierarchy; each error carries its own HTTP
status and a stable machine-readable code.

| Error | Status | Code |
|---|---|---|
| `BadRequestError` | 400 | `bad_request` |
| `UnauthorizedError` | 401 | `unauthorized` |
| `ForbiddenError` | 403 | `forbidden` |
| `NotFoundError` | 404 | `not_found` |
| `ConflictError` | 409 | `conflict` |
| `ValidationError` | 422 | `validation_failed` |
| `RateLimitError` | 429 | `rate_limited` |
| `UpstreamError` | 502 | `upstream_error` |
| `ConfigError` | 503 | `feature_unavailable` |

Anything that is *not* an `AppError` is treated as a bug: logged in full,
returned as a generic 500. An internal message cannot leak by accident.

### API structure

Handlers throw typed errors and return plain data — they never build a response
or pick a status code:

```ts
export const POST = route("loops.status", async ({ params, body, requireUserId }) => {
  const userId = await requireUserId();          // throws UnauthorizedError
  const { status } = await body(bodySchema);     // throws ValidationError
  ...
  return { id, status };                          // wrapped in the envelope
});
```

Every JSON response uses one envelope:

```jsonc
{ "ok": true, "data": { ... } }
{ "ok": false, "error": { "code": "not_found", "message": "…", "requestId": "…" } }
```

Every response carries an `x-request-id` header, echoed from the request when
present, so a user's report ties to a log line.

### Logging

Structured JSON via `logger(scope)`, with `.child({ requestId })` for
per-request context and `.exception()` for stack traces. Credential-shaped keys
(`accessToken`, `refresh_token`, `clientSecret`, `apiKey`, …) are **masked
automatically at any depth** — the logger is the easiest place in a codebase to
leak a token by accident, so the safe thing is the default rather than a rule
people have to remember.

### Health check

`GET /api/health` → `200` when healthy, `503` when degraded.

```jsonc
{
  "status": "ok",
  "version": "0.1.0",
  "env": "development",
  "uptimeSeconds": 12,
  "checks": [
    { "name": "config",     "ok": true },
    { "name": "database",   "ok": true, "latencyMs": 1 },
    { "name": "migrations", "ok": true, "detail": "1 applied" }
  ],
  "features": { "ai": false, "google": false, "demoMode": true }
}
```

It checks migrations, not just connectivity: a database that answers `SELECT 1`
but has no schema will fail every real request. Unauthenticated, so it carries
no configuration values, and failure detail is withheld outside development.

---

## Data model

| Model | Purpose |
|---|---|
| `User` | Identity. |
| `ConnectedAccount` | A provider connection with encrypted tokens and the verbatim granted scopes. |
| `SyncState` | Per-account incremental-sync bookmark. |
| `SourceItem` | A normalized ingested item (email today; calendar events later, same table). |
| `OpenLoop` | The product's unit of value. |
| `OpenLoopEvidence` | Verified verbatim quotes linking a loop to its sources. |
| `Action` | A *proposal* to do something, with an approval lifecycle and audit trail. |
| `Notification` | A proactive nudge, with delivery state. |
| `AiRun` | One row per model call: model, prompt version, tokens, latency, raw output. |

Five constraints carry most of the weight, and each is directly tested:

| Constraint | What it guarantees |
|---|---|
| `SourceItem @@unique([accountId, externalId])` | Ingestion cannot duplicate a message |
| `OpenLoop @@unique([userId, dedupeKey])` | The user is never shown the same loop twice |
| `Action.idempotencyKey @unique` | An action cannot execute twice |
| `Notification @@unique([userId, dedupeKey])` | The user is never notified twice about the same thing |
| `onDelete: Cascade` from `User` | Deleting a user really removes their data |

Deletion behaviour is deliberate rather than uniform: notifications about a
deleted loop are deleted with it, but **actions survive with `loopId` nulled** —
an executed action is a record of something that happened and must not vanish.

SQLite has no enums, so status columns are strings backed by the unions in
`src/server/domain/`. Those modules also hold the state machines (`canTransition`,
`canExecute`), which is what makes them testable.

### Migrations

Versioned SQL under `prisma/migrations/`, applied with `prisma migrate`. The
test harness runs `migrate deploy` rather than `db push`, so tests exercise the
same DDL production will run — a broken migration fails the suite instead of
shipping.

---

## Tests

132 tests, all offline — no API key, no network, no Google account.

| File | Covers |
|---|---|
| `tests/config.test.ts` | Defaults, feature gating, production secret enforcement, redaction |
| `tests/errors.test.ts` | Status/code mapping, internal-detail containment, log redaction |
| `tests/schema.test.ts` | Uniqueness, defaults, cascade behaviour, user deletion |
| `tests/domain.test.ts` | Action/notification state machines, approval gate, dedupe keys |
| `tests/pipeline.test.ts` | End-to-end against a real migrated database, model stubbed |
| `tests/prefilter.test.ts` | Bulk detection, and `noreply@` obligations surviving it |
| `tests/verify.test.ts` | Quote matching, fabricated-evidence rejection, due-date demotion |
| `tests/priority.test.ts` | Scoring, bucketing, ordering |
| `tests/dedupe.test.ts` | Stemming, dedupe keys, similarity, in-batch collapsing |
| `tests/batching.test.ts` | Thread packing and its limits |
| `tests/parse.test.ts` | MIME/HTML parsing, quoted-reply stripping, schema validation |

`tests/helpers/db.ts` gives each test file its own migrated SQLite database.

---

## Security posture

- Gmail scope is **read-only**. Luma cannot send, reply, delete, or modify mail.
  Granted scopes are stored verbatim and shown on the settings page.
- Provider tokens are encrypted at rest (AES-256-GCM).
- Session cookie is HMAC-signed, `httpOnly`, `sameSite=lax`, and holds only a
  user id.
- OAuth `state` is verified against a short-lived cookie.
- **No autonomous outbound actions.** `Action.canExecute()` requires an
  `approvedAt` timestamp for anything with an effect outside Luma — even if the
  `requiresApproval` flag says otherwise, so a bug that flips the flag cannot
  become a bug that sends email.
- The demo route signs a user in without OAuth, so it is disabled in production
  unless `ENABLE_DEMO_MODE` is explicitly set.

---

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — pipeline stages and design decisions
- [docs/ROADMAP.md](docs/ROADMAP.md) — what comes next
