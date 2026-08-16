import { formatRate, type EvalMetrics } from "./metrics";
import type { MatchResult } from "./match";
import type { ExpectedLoop } from "./types";

/**
 * Renders the evaluation as text.
 *
 * Aggregates come first because they are what people quote, but the failures
 * are the point of the exercise, so they are printed in full rather than
 * summarised. Nothing here decides whether the numbers are "good" — that
 * judgement needs a product owner, not a formatter.
 */

interface ReportInput {
  meta: {
    model: string;
    effort: string;
    promptVersion: string | null;
    emailsEvaluated: number;
    wallClockMs: number;
    apiCalls: number;
    failedBatches: number;
  };
  cost: {
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number | null;
    costPerEmailUsd: number | null;
  };
  metrics: EvalMetrics;
  match: MatchResult;
  raw: { candidatesProposed: number };
  prefilter: {
    id: string;
    bucket: string;
    expectPrefiltered: boolean;
    wasPrefiltered: boolean;
  }[];
  emails: {
    id: string;
    bucket: string;
    subject: string;
    expected: ExpectedLoop[];
    rationale: string;
  }[];
}

function money(value: number | null): string {
  if (value === null) return "unknown (no published price for this model)";
  return value < 0.01 ? `$${value.toFixed(5)}` : `$${value.toFixed(4)}`;
}

export function renderReport(input: ReportInput): string {
  const { meta, cost, metrics, match } = input;
  const emailById = new Map(input.emails.map((email) => [email.id, email]));
  const lines: string[] = [];

  lines.push("=".repeat(78));
  lines.push("LUMA EXTRACTION EVALUATION");
  lines.push("=".repeat(78));
  lines.push(`model            ${meta.model}`);
  lines.push(`effort           ${meta.effort}`);
  lines.push(`prompt version   ${meta.promptVersion ?? "unknown"}`);
  lines.push(`emails           ${meta.emailsEvaluated}`);
  lines.push(`api calls        ${meta.apiCalls} (${meta.failedBatches} failed)`);
  lines.push(`wall clock       ${(meta.wallClockMs / 1000).toFixed(1)}s`);
  lines.push("");

  lines.push("-".repeat(78));
  lines.push("HEADLINE METRICS");
  lines.push("-".repeat(78));
  lines.push(`precision                    ${formatRate(metrics.precision)}`);
  lines.push(`recall                       ${formatRate(metrics.recall)}`);
  lines.push(`F1                           ${metrics.f1 === null ? "n/a" : metrics.f1.toFixed(3)}`);
  lines.push(`false-positive rate          ${formatRate(metrics.falsePositiveRate)}`);
  lines.push(`  of which: noise emails     ${formatRate(metrics.noiseEmailFalsePositiveRate)}`);
  lines.push(`category accuracy            ${formatRate(metrics.categoryAccuracy)}`);
  lines.push(`deadline accuracy (exact)    ${formatRate(metrics.deadlineAccuracyExact)}`);
  lines.push(`deadline accuracy (±2d inf.) ${formatRate(metrics.deadlineAccuracyTolerant)}`);
  lines.push(`deadline basis accuracy      ${formatRate(metrics.deadlineBasisAccuracy)}`);
  lines.push(`fabricated deadlines         ${formatRate(metrics.fabricatedDeadlineRate)}`);
  lines.push(`evidence accuracy            ${formatRate(metrics.evidenceAccuracy)}`);
  lines.push(`duplicate rate               ${formatRate(metrics.duplicateRate)}`);
  lines.push("");

  lines.push("-".repeat(78));
  lines.push("COST");
  lines.push("-".repeat(78));
  lines.push(`input tokens     ${cost.inputTokens.toLocaleString()}`);
  lines.push(`output tokens    ${cost.outputTokens.toLocaleString()}`);
  lines.push(`total            ${money(cost.totalCostUsd)}`);
  lines.push(`per email        ${money(cost.costPerEmailUsd)}`);
  lines.push(
    `per 1,000 emails ${cost.costPerEmailUsd === null ? "unknown" : money(cost.costPerEmailUsd * 1000)}`,
  );
  lines.push("");

  lines.push("-".repeat(78));
  lines.push(`FUNNEL  (${input.raw.candidatesProposed} proposed by the model)`);
  lines.push("-".repeat(78));
  lines.push(`model proposed               ${input.raw.candidatesProposed}`);
  lines.push(`survived verification+dedupe ${metrics.counts.predictedLoops}`);
  lines.push(`  correct (true positives)   ${metrics.counts.truePositives}`);
  lines.push(`  wrong   (false positives)  ${metrics.counts.falsePositives}`);
  lines.push(`missed  (false negatives)    ${metrics.counts.falseNegatives}`);
  lines.push("");

  // --- Prefilter -----------------------------------------------------------
  // The prefilter runs before the model, so anything it drops is a loop the
  // model never had a chance to find. That makes it a hard ceiling on recall,
  // and it has to be reported separately or model quality gets blamed for it.
  const dropped = input.prefilter.filter((row) => row.wasPrefiltered);
  const wrongDrops = dropped
    .map((row) => ({ row, email: emailById.get(row.id) }))
    .filter((entry) => (entry.email?.expected.length ?? 0) > 0);
  const lostLoops = wrongDrops.reduce(
    (sum, entry) => sum + (entry.email?.expected.length ?? 0),
    0,
  );
  const totalExpected = metrics.counts.expectedLoops;

  lines.push("-".repeat(78));
  lines.push("PREFILTER  (runs before the model — a hard ceiling on recall)");
  lines.push("-".repeat(78));
  lines.push(`dropped before the model     ${dropped.length}/${input.prefilter.length}`);
  lines.push(`  correctly (expected none)  ${dropped.length - wrongDrops.length}`);
  lines.push(`  WRONGLY (had obligations)  ${wrongDrops.length} emails / ${lostLoops} loops`);
  lines.push(
    `recall ceiling                ${totalExpected === 0 ? "n/a" : `${(((totalExpected - lostLoops) / totalExpected) * 100).toFixed(1)}% (${totalExpected - lostLoops}/${totalExpected})`}`,
  );
  for (const entry of wrongDrops) {
    lines.push(
      `  LOST ${entry.row.id.padEnd(8)} ${entry.row.bucket.padEnd(18)} ${entry.email?.expected.length} loop(s)  ${entry.email?.subject.slice(0, 44)}`,
    );
  }
  lines.push("");

  // --- Failures ------------------------------------------------------------
  lines.push("=".repeat(78));
  lines.push(`MISSED OBLIGATIONS — ${match.missed.length} (recall failures)`);
  lines.push("=".repeat(78));
  for (const miss of match.missed) {
    const email = emailById.get(miss.email.id);
    lines.push(`[${miss.ref}]  bucket=${email?.bucket ?? "?"}`);
    lines.push(`  subject:  ${email?.subject ?? ""}`);
    lines.push(`  expected: ${miss.expected.category} · due ${miss.expected.dueDate ?? "none"}`);
    lines.push(`  keywords: ${miss.expected.match.join(", ")}`);
    lines.push(`  why:      ${email?.rationale ?? ""}`);
    lines.push("");
  }

  lines.push("=".repeat(78));
  lines.push(`SPURIOUS LOOPS — ${match.spurious.length} (precision failures)`);
  lines.push("=".repeat(78));
  for (const loop of match.spurious) {
    const cited = loop.citedEmailIds.map((id) => emailById.get(id));
    lines.push(`[${loop.citedEmailIds.join(",")}]  bucket=${cited[0]?.bucket ?? "?"}`);
    lines.push(`  produced: "${loop.title}" (${loop.category}, conf ${loop.confidence.toFixed(2)})`);
    lines.push(`  summary:  ${loop.summary}`);
    lines.push(`  due:      ${loop.dueAt ? loop.dueAt.toISOString().slice(0, 10) : "none"} (${loop.dueAtBasis})`);
    lines.push(`  quote:    ${loop.quotes[0] ? `"${loop.quotes[0].slice(0, 100)}"` : "(none)"}`);
    lines.push(`  expected: ${cited[0]?.expected.length === 0 ? "NOTHING from this email" : "a different obligation"}`);
    lines.push(`  why:      ${cited[0]?.rationale ?? ""}`);
    lines.push("");
  }

  const dateFailures = metrics.details.deadlines.filter((d) => !d.tolerant);
  lines.push("=".repeat(78));
  lines.push(`DEADLINE ERRORS — ${dateFailures.length}`);
  lines.push("=".repeat(78));
  for (const failure of dateFailures) {
    const kind =
      failure.expectedDate === null
        ? "FABRICATED"
        : failure.actualDate === null
          ? "DROPPED"
          : "WRONG DATE";
    lines.push(
      `[${failure.ref}]  ${kind}: expected ${failure.expectedDate ?? "no date"} (${failure.expectedBasis}), got ${failure.actualDate ?? "no date"} (${failure.actualBasis})`,
    );
  }
  lines.push("");

  const evidenceFailures = metrics.details.evidence.filter((e) => !e.verbatim);
  if (evidenceFailures.length > 0) {
    lines.push("=".repeat(78));
    lines.push(`EVIDENCE FAILURES — ${evidenceFailures.length} (quote not found in any cited source)`);
    lines.push("=".repeat(78));
    for (const failure of evidenceFailures) {
      lines.push(`  loop ${failure.loopId}: "${failure.quote.slice(0, 120)}"`);
    }
    lines.push("");
  }

  if (metrics.details.duplicatePairs.length > 0) {
    lines.push("=".repeat(78));
    lines.push(`DUPLICATES — ${metrics.details.duplicatePairs.length} pair(s)`);
    lines.push("=".repeat(78));
    for (const pair of metrics.details.duplicatePairs) {
      lines.push(`  ${pair.score.toFixed(2)}  "${pair.a.title}"  ~  "${pair.b.title}"`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
