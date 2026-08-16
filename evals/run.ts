/**
 * Runs the real extraction pipeline against the evaluation dataset and reports
 * how well it did.
 *
 *   ANTHROPIC_API_KEY=sk-... npm run eval
 *
 * This drives the production code path end to end — same prefilter, same
 * prompt, same model, same batching, same verification, dedupe, and scoring.
 * Nothing here is a reimplementation, so what it measures is the product.
 *
 * Options (env):
 *   EVAL_LIMIT=20     only the first N emails (smoke test)
 *   EVAL_OUT=path     where to write the JSON artifact
 *   LUMA_MODEL        the model under test
 *   LUMA_EFFORT       reasoning effort
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getConfig, resetConfigCache } from "@/config";
import { prisma } from "@/lib/db";
import {
  AnthropicLoopExtractor,
  type ExtractionBatchResult,
  type ExtractionDocument,
  type LoopExtractor,
} from "@/server/ai/extract";
import { runPipeline } from "@/server/pipeline/run";

import { EVAL_EMAILS } from "./dataset";
import { flattenExpected, matchLoops, type PredictedLoop } from "./match";
import { computeMetrics } from "./metrics";
import { EvalMailProvider } from "./provider";
import { RecordingExtractor } from "./recording";
import { renderReport } from "./report";
import { EVAL_TODAY } from "./types";

/**
 * Published list prices per million tokens. Kept here rather than derived so
 * the cost figure in a report is auditable against a number you can check.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

function priceFor(model: string): { input: number; output: number } | null {
  const exact = PRICING[model];
  if (exact) return exact;
  const prefix = Object.keys(PRICING).find((key) => model.startsWith(key));
  return prefix ? PRICING[prefix]! : null;
}

/**
 * A stand-in extractor used only by `npm run eval:dry`.
 *
 * It proves the harness end to end — provider, prefilter, ingestion, batching,
 * verification, dedupe, persistence, matching, metrics, report — without
 * spending a token. It returns one deliberately mediocre candidate per batch,
 * so the numbers it produces are meaningless and the report says so in capitals.
 */
class DryRunExtractor implements LoopExtractor {
  readonly name = "dry-run";

  async extract(
    _userId: string,
    documents: ExtractionDocument[],
  ): Promise<ExtractionBatchResult[]> {
    const first = documents[0];
    if (!first) return [];
    const quote = first.bodyText.split("\n").find((line) => line.trim().length > 20)?.trim() ?? "";
    return [
      {
        sourceItemIds: documents.map((document) => document.sourceId),
        candidates: quote
          ? [
              {
                title: "Placeholder obligation from dry run",
                summary: "Dry-run stand-in. Not a real extraction.",
                category: "other" as const,
                requires_user_action: true,
                confidence: 0.8,
                consequence: "medium" as const,
                due_date: null,
                due_date_basis: "none" as const,
                due_date_evidence: null,
                counterparty_name: null,
                counterparty_email: null,
                amount_minor: null,
                amount_currency: null,
                evidence: [{ source_id: first.sourceId, quote }],
                inference_notes: "dry run",
              },
            ]
          : [],
        failure: null,
      },
    ];
  }
}

async function main() {
  const dryRun = process.env.EVAL_DRY_RUN === "1";

  // A throwaway database, so the run starts from a clean slate every time and
  // never touches development data. This has to happen before the first
  // getConfig() call, because configuration is memoized on first read.
  const dbPath = path.join(os.tmpdir(), `luma-eval-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbPath}`;
  resetConfigCache();

  const config = getConfig();
  if (!dryRun && !config.ai.enabled) {
    console.error(
      [
        "ANTHROPIC_API_KEY is not set — this evaluation runs against the live model and cannot proceed.",
        "",
        "  ANTHROPIC_API_KEY=sk-ant-... npm run eval",
        "",
        "Nothing is estimated or simulated: without a key there are no numbers to report.",
      ].join("\n"),
    );
    process.exit(2);
  }

  const limit = process.env.EVAL_LIMIT ? Number(process.env.EVAL_LIMIT) : undefined;
  const emails = limit ? EVAL_EMAILS.slice(0, limit) : EVAL_EMAILS;

  execFileSync("npx", ["prisma", "migrate", "deploy", "--schema=prisma/schema.prisma"], {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "pipe",
  });

  const user = await prisma.user.create({ data: { email: `eval-${Date.now()}@example.test` } });
  const account = await prisma.connectedAccount.create({
    data: {
      userId: user.id,
      provider: "fixtures",
      providerAccountId: "eval@example.com",
      accessToken: "unused",
      scopes: "eval:read",
    },
  });

  const extractor = new RecordingExtractor(
    dryRun ? new DryRunExtractor() : new AnthropicLoopExtractor(),
  );

  console.error(
    dryRun
      ? `DRY RUN: ${emails.length} emails through a stub extractor — no model, no real numbers.`
      : `Running ${emails.length} emails through ${config.ai.model} (effort=${config.ai.effort})…`,
  );
  const startedAt = Date.now();

  const summary = await runPipeline({
    userId: user.id,
    accountId: account.id,
    provider: new EvalMailProvider(emails),
    extractor,
    now: EVAL_TODAY,
  });

  const wallClockMs = Date.now() - startedAt;

  // --- Collect what the pipeline actually produced -------------------------
  const loops = await prisma.openLoop.findMany({
    where: { userId: user.id },
    include: { evidence: { include: { sourceItem: { select: { externalId: true } } } } },
  });

  const predictions: PredictedLoop[] = loops.map((loop) => ({
    id: loop.id,
    title: loop.title,
    summary: loop.summary,
    category: loop.category,
    dueAt: loop.dueAt,
    dueAtBasis: loop.dueAtBasis,
    confidence: loop.confidence,
    citedEmailIds: [
      ...new Set(loop.evidence.map((item) => item.sourceItem.externalId)),
    ],
    quotes: loop.evidence.map((item) => item.quote),
  }));

  const refs = flattenExpected(emails);
  const match = matchLoops(refs, predictions);
  const sourceText = new Map(
    emails.map((email) => [email.id, `${email.subject}\n${email.body}`]),
  );
  const metrics = computeMetrics(emails, predictions, match, sourceText);

  // --- Cost, from the tokens the API actually reported ---------------------
  const runs = await prisma.aiRun.findMany({ where: { userId: user.id } });
  const inputTokens = runs.reduce((sum, run) => sum + (run.inputTokens ?? 0), 0);
  const outputTokens = runs.reduce((sum, run) => sum + (run.outputTokens ?? 0), 0);
  const modelUsed = runs.find((run) => run.model !== "unknown")?.model ?? config.ai.model;
  const price = priceFor(modelUsed);
  const totalCostUsd = price
    ? (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output
    : null;

  // --- Prefilter behaviour -------------------------------------------------
  const items = await prisma.sourceItem.findMany({
    where: { userId: user.id },
    select: { externalId: true, isBulk: true, processedAt: true },
  });
  const prefilterByEmail = new Map(items.map((item) => [item.externalId, item]));

  const report = {
    meta: {
      model: modelUsed,
      configuredModel: config.ai.model,
      effort: config.ai.effort,
      promptVersion: runs[0]?.promptVersion ?? null,
      emailsEvaluated: emails.length,
      evaluatedAt: new Date().toISOString(),
      wallClockMs,
      apiCalls: runs.length,
      failedBatches: extractor.failedBatchCount,
    },
    pipeline: summary,
    cost: {
      inputTokens,
      outputTokens,
      totalCostUsd,
      costPerEmailUsd: totalCostUsd === null ? null : totalCostUsd / emails.length,
      pricingUsed: price,
      note: "List prices; excludes any prompt-cache discount. Tokens are as reported by the API.",
    },
    metrics,
    match,
    raw: {
      candidatesProposed: extractor.rawCandidateCount,
      batches: extractor.batches,
    },
    prefilter: emails.map((email) => ({
      id: email.id,
      bucket: email.bucket,
      expectPrefiltered: email.expectPrefiltered ?? false,
      wasPrefiltered: prefilterByEmail.get(email.id)?.isBulk ?? false,
    })),
    emails: emails.map((email) => ({
      id: email.id,
      bucket: email.bucket,
      subject: email.subject,
      expected: email.expected,
      rationale: email.rationale,
    })),
  };

  const outPath = process.env.EVAL_OUT ?? path.join("evals", "results", `eval-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  if (dryRun) {
    console.log("!".repeat(78));
    console.log("DRY RUN — the model was NOT called. Every metric below is meaningless.");
    console.log("It exists only to prove the harness runs. Use `npm run eval` for real numbers.");
    console.log("!".repeat(78));
  }
  console.log(renderReport(report));
  console.error(`\nFull results written to ${outPath}`);

  await prisma.$disconnect();
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
