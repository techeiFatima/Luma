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

  console.log(`Seeded demo user ${user.email}`);
  console.log("  1 connected account (fixtures), 1 source item, 1 open loop");
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
