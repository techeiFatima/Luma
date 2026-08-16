# Roadmap

The build order is Gmail → Calendar → notifications → approved actions. Each
phase has to leave the product working, so the notes below are mostly about
where the seams already are.

## Phase 1 — Gmail → Open Loops → dashboard ✅

Shipped in this repository.

Gmail ingestion, deterministic prefiltering, LLM extraction with structured
output, evidence verification, duplicate prevention, deterministic
prioritization, dashboard and detail views, AI observability, and a sample
inbox that exercises the whole pipeline without any external account.

## Phase 2 — Google Calendar

**Goal:** better prioritization and better appointment-prep loops, using what
the user's week actually looks like.

What is already in place:

- `SourceDocument.kind` exists and is `"email"` today. Calendar events become
  `kind = "calendar_event"` in the same table, so extraction, evidence linking,
  and the detail view work unchanged.
- `ConnectedAccount.provider` already distinguishes providers, and
  `googleScopes` in `src/lib/env.ts` is where a `calendar.readonly` scope is
  added — deliberately separate from the Gmail scope so the permission stays an
  explicit, separate grant.
- The `MailProvider` interface generalizes to a `SourceProvider`; the shape
  (`fetch → NormalizedMessage[] + cursor`) already fits events.

What has to be built:

- A calendar provider and an event → `SourceDocument` normalizer.
- Prioritization needs a new deterministic input: an item due the day before a
  packed day should surface earlier. `scoreLoop` takes a plain input object, so
  this is a new field and a new term, not a rewrite.
- The `appointment_prep` category already exists but is thin without calendar
  context — an appointment on the calendar plus a "bring this form" email is the
  case worth getting right.

**Risk to watch:** calendar events are not obligations. A meeting on the
calendar is not an open loop; the *unfinished preparation* for it is. The
prompt's "what does not count" section needs a calendar-specific clause, and the
fixtures need calendar cases that should produce nothing.

## Phase 3 — Notifications

**Goal:** tell the user before it's too late, without becoming noise.

What is already in place:

- `priorityScore` / `priorityBucket` are computed deterministically and
  recomputed as time passes, which is exactly the signal a notifier needs.
- `firstSeenAt` / `lastSeenAt` / `status` make "have we already told them about
  this?" answerable.

What has to be built:

- A notification decision function — deterministic, and tested the way
  `priority.ts` is. The rule is not "score above N"; it is "this crossed a
  threshold it hadn't before, and we haven't already said so."
- A `NotificationEvent` table, so an item is never sent twice and delivery is
  auditable.
- Delivery (email or web push) and per-user quiet hours and frequency caps.

**Risk to watch:** notification is where a precision failure becomes actively
harmful — a wrong dashboard row is ignorable, a wrong 8am alert is not. The
confidence bar for notifying should be higher than the bar for displaying, and
should be its own constant rather than reusing `MIN_CONFIDENCE`.

## Phase 4 — Approved actions

**Goal:** let the user resolve a loop without leaving Luma — and never act on
its own.

Candidate actions: draft a reply, create a reminder, create a calendar event.

What is already in place:

- Gmail scope is read-only today. Any action that sends mail requires a **new,
  separate scope grant**, presented on its own rather than bundled into the
  initial connect.
- `LoopActions` already distinguishes Luma-local status changes from anything
  outward-facing, and the UI says so.

What has to be built:

- A proposal/approval model: `ActionProposal` with an explicit
  `pending → approved → executed` lifecycle, the full payload stored and shown
  to the user before approval, and an audit row for every execution.
- Actions must be **idempotent on execution** — approving twice, or a retry
  after a network failure, must not send two emails.
- The action UI has to show exactly what will happen, to whom, with what
  content, before the user approves.

**Non-negotiable:** no action executes without a specific user approval of that
specific proposal. Not a blanket setting, not an "always allow this type"
toggle. The MVP's rule — *never allow autonomous consequential actions* —
survives into this phase; approval is what makes an action non-autonomous, and
the approval has to be per-action to mean anything.

## Cross-cutting, not phase-gated

These get worse the longer they wait:

- **Extraction quality measurement.** A labelled set of messages with expected
  loops, and precision/recall reported per prompt version. `AiRun.promptVersion`
  and `rawOutput` are already recorded for exactly this. Without it, "precision
  over quantity" is an intention rather than a measurement.
- **Cost tracking per user.** Token counts are already on `AiRun`; the
  aggregation is not built.
- **Incremental Gmail sync.** `SyncState.cursor` stores the `historyId` but the
  provider still does a bounded date-range fetch. Using the history API would
  cut sync cost significantly on large mailboxes.
- **Postgres.** SQLite is right for phase 1 and wrong for concurrent users.
  Isolated to `src/lib/db.ts` and the schema's provider.
