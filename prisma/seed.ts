/**
 * Development seed.
 *
 * Creates a signed-in-able demo user with one connected (fixture) account and
 * a set of representative open loops, so a fresh clone has something real to
 * look at before any Gmail or AI work runs.
 *
 * The loops themselves come from `src/server/demo/sample.ts`, which is also
 * what the demo endpoint installs — one definition, so what someone sees after
 * `npm run db:seed` and what they see after clicking through the demo cannot
 * drift apart.
 *
 * Idempotent: safe to run repeatedly.
 *
 *   npm run db:seed
 */
import { encryptSecret } from "../src/lib/crypto";
import { prisma } from "../src/lib/db";
import { DEMO_EMAIL, installSampleLoops } from "../src/server/demo/sample";
import { buildNotificationDedupeKey } from "../src/server/domain/notifications";

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

  const now = new Date();
  const installed = await installSampleLoops(user.id, account.id, now);

  // Anchor the sample action and notification to a loop that definitely has a
  // deadline, so both illustrate the states they are meant to illustrate.
  const anchor = await prisma.openLoop.findUniqueOrThrow({
    where: { userId_dedupeKey: { userId: user.id, dedupeKey: "sample-loop-renewal" } },
  });

  // A proposed action, unapproved — the state everything starts in.
  await prisma.action.upsert({
    where: { idempotencyKey: "seed-action-reminder" },
    create: {
      userId: user.id,
      loopId: anchor.id,
      type: "create_reminder",
      status: "proposed",
      summary: "Remind me about the licence renewal the day before it is due.",
      payload: JSON.stringify({ remindAt: new Date(now.getTime() + 2 * DAY_MS).toISOString() }),
      idempotencyKey: "seed-action-reminder",
    },
    update: {},
  });

  const dedupeKey = buildNotificationDedupeKey({
    loopId: anchor.id,
    trigger: "due_soon",
    channel: "in_app",
  });
  await prisma.notification.upsert({
    where: { userId_dedupeKey: { userId: user.id, dedupeKey } },
    create: {
      userId: user.id,
      loopId: anchor.id,
      channel: "in_app",
      status: "pending",
      title: "Licence renewal due in 3 days",
      body: "The renewal form and the $180 fee are still outstanding.",
      dedupeKey,
    },
    update: {},
  });

  console.log(`Seeded demo user ${user.email}`);
  console.log(`  1 connected account (fixtures), ${installed.loops} open loops with evidence`);
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
