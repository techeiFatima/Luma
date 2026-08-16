/**
 * Runs the full pipeline against the sample inbox and prints what came out.
 *
 *   ANTHROPIC_API_KEY=... npm run demo
 *
 * Useful for checking extraction quality without clicking through the UI —
 * it prints the rejection breakdown too, so you can see what the deterministic
 * guards threw away and why.
 */
import { encryptSecret } from "../src/lib/crypto";
import { prisma } from "../src/lib/db";
import { getConfig } from "../src/config";
import { formatRelativeDue } from "../src/lib/time";
import { FixtureMailProvider } from "../src/server/providers/fixtures/provider";
import { listOpenLoops } from "../src/server/loops/queries";
import { runPipeline } from "../src/server/pipeline/run";

const DEMO_EMAIL = "demo@example.com";

async function main() {
  if (!getConfig().ai.enabled) {
    console.error("ANTHROPIC_API_KEY is not set — extraction cannot run.");
    process.exit(1);
  }

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

  console.log(`Running pipeline with ${getConfig().ai.model}…\n`);
  const summary = await runPipeline({
    userId: user.id,
    accountId: account.id,
    provider: new FixtureMailProvider(DEMO_EMAIL),
  });

  console.log("Pipeline summary");
  console.log("  messages fetched      ", summary.ingest.fetched);
  console.log("  filtered as bulk      ", summary.ingest.bulkFiltered);
  console.log("  sent to the model     ", summary.sourceItemsExtracted);
  console.log("  candidates proposed   ", summary.candidatesProposed);
  console.log("  candidates accepted   ", summary.candidatesAccepted);
  console.log("  rejected              ", JSON.stringify(summary.rejections));
  console.log("  loops created/updated ", `${summary.loopsCreated}/${summary.loopsUpdated}`);
  if (summary.batchFailures > 0) {
    console.log("  batch failures        ", summary.batchFailures);
  }

  const { items, total } = await listOpenLoops(user.id);
  console.log(`\nOpen loops (${items.length} of ${total} shown)\n`);
  for (const loop of items) {
    console.log(`  [${String(loop.priorityScore).padStart(3)}] ${loop.title}`);
    console.log(`        ${loop.summary}`);
    console.log(
      `        ${formatRelativeDue(loop.dueAt)} · ${loop.category} · ${loop.consequence} consequence · ${Math.round(loop.confidence * 100)}% confident · ${loop.evidenceCount} source(s)`,
    );
    console.log("");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
