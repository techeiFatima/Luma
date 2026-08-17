/**
 * Development seed.
 *
 * Creates a signed-in-able demo user with one connected (fixture) account and
 * a couple of representative open loops, so a fresh clone has something to look
 * at before any Gmail or AI work runs.
 *
 * Idempotent: safe to run repeatedly.
 *
 *   npm run db:seed
 */
import { encryptSecret } from "../src/lib/crypto";
import { prisma } from "../src/lib/db";
import { buildNotificationDedupeKey } from "../src/server/domain/notifications";

const DEMO_EMAIL = "demo@example.com";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Representative loops for the demo dashboard.
 *
 * Chosen to span the states the UI has to distinguish: a stated deadline
 * versus one the model inferred, a loop with money attached versus one
 * without, and a commitment with no date at all. Every `quote` appears
 * verbatim in its `bodyText` — the same rule verification enforces on real
 * extractions, so the seed can't demonstrate something the product would
 * reject.
 */
const SAMPLE_LOOPS = [
  {
    externalId: "seed-002",
    dedupeKey: "seed-loop-passport",
    subject: "Your passport renewal application — documents still needed",
    fromName: "Passport Services",
    fromEmail: "no-reply@passports.example.gov",
    receivedDaysAgo: 2,
    bodyText:
      "We received your application but cannot proceed without your supporting documents. Upload your proof of citizenship by April 2, 2026 or the application will be closed.",
    quote: "Upload your proof of citizenship by April 2, 2026",
    title: "Upload passport supporting documents",
    summary: "The application is on hold until proof of citizenship is uploaded.",
    category: "form",
    dueInDays: 5,
    dueAtBasis: "explicit",
    dueAtEvidence: "Upload your proof of citizenship by April 2, 2026",
    amountMinor: null,
    confidence: 0.91,
    consequence: "high",
    inferenceNotes: "The email states the date outright.",
    priorityScore: 78,
    priorityBucket: "now",
  },
  {
    externalId: "seed-003",
    dedupeKey: "seed-loop-invoice",
    subject: "Invoice 4471 from Brightpath Studio",
    fromName: "Brightpath Studio",
    fromEmail: "billing@brightpath.example.com",
    receivedDaysAgo: 4,
    bodyText:
      "Please find invoice 4471 attached for $1,250.00, covering March design work. Payment is due within 30 days of the invoice date.",
    quote: "Payment is due within 30 days of the invoice date",
    title: "Pay Brightpath invoice 4471",
    summary: "$1,250 for March design work is outstanding.",
    category: "payment",
    dueInDays: 11,
    dueAtBasis: "inferred",
    dueAtEvidence: null,
    amountMinor: 125_000,
    confidence: 0.82,
    consequence: "medium",
    inferenceNotes:
      "No calendar date was given. The due date is calculated from the invoice date plus the stated 30 day term.",
    priorityScore: 61,
    priorityBucket: "soon",
  },
  {
    externalId: "seed-004",
    dedupeKey: "seed-loop-dentist",
    subject: "Appointment confirmed — Ridgeline Dental, April 8",
    fromName: "Ridgeline Dental",
    fromEmail: "appointments@ridgelinedental.example.com",
    receivedDaysAgo: 6,
    bodyText:
      "Your appointment is confirmed for April 8 at 9:30am. New patients must complete the medical history form before the visit — bring your insurance card with you.",
    quote: "New patients must complete the medical history form before the visit",
    title: "Complete dental forms before April 8 visit",
    summary: "The medical history form and insurance card are needed before the appointment.",
    category: "appointment_prep",
    dueInDays: 11,
    dueAtBasis: "explicit",
    dueAtEvidence: "Your appointment is confirmed for April 8 at 9:30am",
    amountMinor: null,
    confidence: 0.87,
    consequence: "medium",
    inferenceNotes: "The appointment date is stated; the preparation is required before it.",
    priorityScore: 54,
    priorityBucket: "soon",
  },
  {
    externalId: "seed-005",
    dedupeKey: "seed-loop-reference",
    subject: "Re: quick favour",
    fromName: "Priya Raman",
    fromEmail: "priya.raman@example.com",
    receivedDaysAgo: 3,
    bodyText:
      "No rush at all, but I'd really appreciate it whenever you get a chance. You mentioned you'd send over a reference letter for my grad school application.",
    quote: "You mentioned you'd send over a reference letter",
    title: "Send Priya a reference letter",
    summary: "You said you would write a reference letter for a grad school application.",
    category: "commitment",
    dueInDays: null,
    dueAtBasis: "none",
    dueAtEvidence: null,
    amountMinor: null,
    confidence: 0.79,
    consequence: "medium",
    inferenceNotes:
      "No date was given and none was assumed. The sender explicitly said there is no rush.",
    priorityScore: 33,
    priorityBucket: "later",
  },
] as const;

async function main() {
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: { email: DEMO_EMAIL, name: "Demo" },
    update: {},
  });

  const account = await prisma.connectedAccount.upsert({
    where: {
      userId_provider_providerAccountId: {
        userId: user.id,
        provider: "fixtures",
        providerAccountId: DEMO_EMAIL,
      },
    },
    create: {
      userId: user.id,
      provider: "fixtures",
      providerAccountId: DEMO_EMAIL,
      accessToken: encryptSecret("sample-inbox"),
      scopes: "sample-inbox:read",
    },
    update: {},
  });

  const now = Date.now();

  const sourceItem = await prisma.sourceItem.upsert({
    where: { accountId_externalId: { accountId: account.id, externalId: "seed-001" } },
    create: {
      userId: user.id,
      accountId: account.id,
      provider: "fixtures",
      kind: "email",
      externalId: "seed-001",
      threadExternalId: "seed-thread-001",
      subject: "Action required: renew your professional license by March 14",
      fromName: "State Licensing Board",
      fromEmail: "noreply@licensing.example.gov",
      toEmails: JSON.stringify([DEMO_EMAIL]),
      sentAt: new Date(now - 6 * DAY_MS),
      bodyText:
        "Your license expires on March 14, 2026. Complete the online renewal form and pay the $180 fee before that date.",
      contentHash: "seed-hash-001",
      processedAt: new Date(now - 6 * DAY_MS),
    },
    update: {},
  });

  const loop = await prisma.openLoop.upsert({
    where: { userId_dedupeKey: { userId: user.id, dedupeKey: "seed-loop-renewal" } },
    create: {
      userId: user.id,
      title: "Renew professional license",
      summary: "The renewal form and the $180 fee are still outstanding.",
      category: "renewal",
      status: "open",
      dueAt: new Date(now + 3 * DAY_MS),
      dueAtBasis: "explicit",
      dueAtEvidence: "pay the $180 fee before that date",
      counterpartyName: "State Licensing Board",
      counterpartyEmail: "noreply@licensing.example.gov",
      amountMinor: 18_000,
      amountCurrency: "USD",
      confidence: 0.93,
      consequence: "high",
      inferenceNotes: "The email states the date and the fee directly.",
      priorityScore: 84,
      priorityBucket: "now",
      dedupeKey: "seed-loop-renewal",
    },
    update: {},
  });

  await prisma.openLoopEvidence.upsert({
    where: {
      loopId_sourceItemId_quote: {
        loopId: loop.id,
        sourceItemId: sourceItem.id,
        quote: "Complete the online renewal form",
      },
    },
    create: {
      loopId: loop.id,
      sourceItemId: sourceItem.id,
      quote: "Complete the online renewal form",
    },
    update: {},
  });

  // A proposed action, unapproved — the state everything starts in.
  await prisma.action.upsert({
    where: { idempotencyKey: "seed-action-reminder" },
    create: {
      userId: user.id,
      loopId: loop.id,
      type: "create_reminder",
      status: "proposed",
      summary: "Remind me about the licence renewal two days before it is due.",
      payload: JSON.stringify({ remindAt: new Date(now + 1 * DAY_MS).toISOString() }),
      idempotencyKey: "seed-action-reminder",
    },
    update: {},
  });

  const dedupeKey = buildNotificationDedupeKey({
    loopId: loop.id,
    trigger: "due_soon",
    channel: "in_app",
  });
  await prisma.notification.upsert({
    where: { userId_dedupeKey: { userId: user.id, dedupeKey } },
    create: {
      userId: user.id,
      loopId: loop.id,
      channel: "in_app",
      status: "pending",
      title: "Licence renewal due in 3 days",
      body: "The renewal form and the $180 fee are still outstanding.",
      scheduledFor: new Date(now + 1 * DAY_MS),
      dedupeKey,
    },
    update: {},
  });

  // A few more loops, so a fresh clone shows the thing that actually matters:
  // prioritization. With a single loop the dashboard looks correct but proves
  // nothing — you cannot see now/soon/later ordering, or a loop whose date the
  // model inferred sitting below one whose date was stated outright.
  for (const sample of SAMPLE_LOOPS) {
    const item = await prisma.sourceItem.upsert({
      where: { accountId_externalId: { accountId: account.id, externalId: sample.externalId } },
      create: {
        userId: user.id,
        accountId: account.id,
        provider: "fixtures",
        kind: "email",
        externalId: sample.externalId,
        threadExternalId: `${sample.externalId}-thread`,
        subject: sample.subject,
        fromName: sample.fromName,
        fromEmail: sample.fromEmail,
        toEmails: JSON.stringify([DEMO_EMAIL]),
        sentAt: new Date(now - sample.receivedDaysAgo * DAY_MS),
        bodyText: sample.bodyText,
        contentHash: `seed-hash-${sample.externalId}`,
        processedAt: new Date(now - sample.receivedDaysAgo * DAY_MS),
      },
      update: {},
    });

    const extra = await prisma.openLoop.upsert({
      where: { userId_dedupeKey: { userId: user.id, dedupeKey: sample.dedupeKey } },
      create: {
        userId: user.id,
        title: sample.title,
        summary: sample.summary,
        category: sample.category,
        status: "open",
        dueAt: sample.dueInDays === null ? null : new Date(now + sample.dueInDays * DAY_MS),
        dueAtBasis: sample.dueAtBasis,
        dueAtEvidence: sample.dueAtEvidence,
        counterpartyName: sample.fromName,
        counterpartyEmail: sample.fromEmail,
        amountMinor: sample.amountMinor,
        amountCurrency: sample.amountMinor === null ? null : "USD",
        confidence: sample.confidence,
        consequence: sample.consequence,
        inferenceNotes: sample.inferenceNotes,
        priorityScore: sample.priorityScore,
        priorityBucket: sample.priorityBucket,
        dedupeKey: sample.dedupeKey,
      },
      update: {},
    });

    await prisma.openLoopEvidence.upsert({
      where: {
        loopId_sourceItemId_quote: {
          loopId: extra.id,
          sourceItemId: item.id,
          quote: sample.quote,
        },
      },
      create: { loopId: extra.id, sourceItemId: item.id, quote: sample.quote },
      update: {},
    });
  }

  const loopCount = await prisma.openLoop.count({ where: { userId: user.id } });
  console.log(`Seeded demo user ${user.email}`);
  console.log(`  1 connected account (fixtures), ${loopCount} source items, ${loopCount} open loops`);
  console.log("  1 proposed action (unapproved), 1 pending notification");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
