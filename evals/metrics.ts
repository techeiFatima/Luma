import { similarity } from "@/server/loops/dedupe";
import { NEGATIVE_BUCKETS, type EvalEmail } from "./types";
import type { MatchResult, PredictedLoop } from "./match";
import { normalize } from "./match";

/**
 * Metric computation.
 *
 * Every rate here is reported with its raw numerator and denominator, because
 * a percentage with an unstated denominator is how evaluations mislead. A
 * denominator of zero yields `null`, never a fake 0% or 100%.
 */

export interface Rate {
  value: number | null;
  numerator: number;
  denominator: number;
}

function rate(numerator: number, denominator: number): Rate {
  return { value: denominator === 0 ? null : numerator / denominator, numerator, denominator };
}

/** Inferred dates are derived, so small disagreements are not real errors. */
export const INFERRED_DATE_TOLERANCE_DAYS = 2;

function isoDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function daysApart(a: string, b: string): number {
  return Math.abs(
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

export interface DeadlineOutcome {
  ref: string;
  expectedDate: string | null;
  actualDate: string | null;
  expectedBasis: string;
  actualBasis: string;
  exact: boolean;
  tolerant: boolean;
  basisCorrect: boolean;
}

export interface EvidenceOutcome {
  loopId: string;
  quote: string;
  emailId: string | null;
  verbatim: boolean;
}

export interface EvalMetrics {
  counts: {
    emails: number;
    expectedLoops: number;
    predictedLoops: number;
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
  };
  precision: Rate;
  recall: Rate;
  f1: number | null;
  /** 1 - precision: share of surfaced loops that were wrong. */
  falsePositiveRate: Rate;
  /**
   * The product-meaningful one: emails whose correct answer was "nothing" that
   * nonetheless produced a loop.
   */
  noiseEmailFalsePositiveRate: Rate;
  categoryAccuracy: Rate;
  deadlineAccuracyExact: Rate;
  deadlineAccuracyTolerant: Rate;
  deadlineBasisAccuracy: Rate;
  /** Fabricated deadlines: expected no date, system produced one. */
  fabricatedDeadlineRate: Rate;
  evidenceAccuracy: Rate;
  duplicateRate: Rate;
  details: {
    deadlines: DeadlineOutcome[];
    evidence: EvidenceOutcome[];
    duplicatePairs: { a: PredictedLoop; b: PredictedLoop; score: number }[];
  };
}

/** Two predicted loops this similar are treated as the same obligation. */
export const DUPLICATE_THRESHOLD = 0.6;

export function computeMetrics(
  emails: EvalEmail[],
  predictions: PredictedLoop[],
  match: MatchResult,
  /** Source text per eval email id, for checking quotes are genuinely verbatim. */
  sourceText: Map<string, string>,
): EvalMetrics {
  const truePositives = match.matched.length;
  const falsePositives = match.spurious.length;
  const falseNegatives = match.missed.length;
  const expectedLoops = emails.reduce((sum, email) => sum + email.expected.length, 0);

  const precision = rate(truePositives, truePositives + falsePositives);
  const recall = rate(truePositives, truePositives + falseNegatives);
  const f1 =
    precision.value !== null && recall.value !== null && precision.value + recall.value > 0
      ? (2 * precision.value * recall.value) / (precision.value + recall.value)
      : null;

  // --- Noise-email false positives ----------------------------------------
  const noiseEmails = emails.filter(
    (email) => email.expected.length === 0 && NEGATIVE_BUCKETS.includes(email.bucket),
  );
  const noiseIds = new Set(noiseEmails.map((email) => email.id));
  const noiseEmailsWithLoops = new Set(
    predictions
      .flatMap((prediction) => prediction.citedEmailIds)
      .filter((id) => noiseIds.has(id)),
  );

  // --- Category -----------------------------------------------------------
  const categoryCorrect = match.matched.filter(
    (pair) => pair.predicted.category === pair.expected.expected.category,
  ).length;

  // --- Deadlines ----------------------------------------------------------
  const deadlines: DeadlineOutcome[] = match.matched.map((pair) => {
    const expectedDate = pair.expected.expected.dueDate;
    const actualDate = isoDate(pair.predicted.dueAt);
    const exact = expectedDate === actualDate;
    const tolerant =
      exact ||
      (expectedDate !== null &&
        actualDate !== null &&
        pair.expected.expected.dueDateBasis === "inferred" &&
        daysApart(expectedDate, actualDate) <= INFERRED_DATE_TOLERANCE_DAYS);
    return {
      ref: pair.expected.ref,
      expectedDate,
      actualDate,
      expectedBasis: pair.expected.expected.dueDateBasis,
      actualBasis: pair.predicted.dueAtBasis,
      exact,
      tolerant,
      basisCorrect: pair.expected.expected.dueDateBasis === pair.predicted.dueAtBasis,
    };
  });

  const fabricated = deadlines.filter((d) => d.expectedDate === null && d.actualDate !== null);
  const expectedNoDate = deadlines.filter((d) => d.expectedDate === null);

  // --- Evidence -----------------------------------------------------------
  // Checks the stored quote is genuinely a substring of a cited email. After
  // verification this should be 100%; anything less is a verification bug.
  const evidence: EvidenceOutcome[] = [];
  for (const prediction of predictions) {
    for (const quote of prediction.quotes) {
      const emailId =
        prediction.citedEmailIds.find((id) => {
          const text = sourceText.get(id);
          return text ? normalize(text).includes(normalize(quote)) : false;
        }) ?? null;
      evidence.push({
        loopId: prediction.id,
        quote,
        emailId,
        verbatim: emailId !== null,
      });
    }
  }

  // --- Duplicates ---------------------------------------------------------
  const duplicatePairs: { a: PredictedLoop; b: PredictedLoop; score: number }[] = [];
  for (let i = 0; i < predictions.length; i++) {
    for (let j = i + 1; j < predictions.length; j++) {
      const a = predictions[i]!;
      const b = predictions[j]!;
      const score = similarity(a.title, b.title);
      if (score >= DUPLICATE_THRESHOLD && a.category === b.category) {
        duplicatePairs.push({ a, b, score });
      }
    }
  }

  return {
    counts: {
      emails: emails.length,
      expectedLoops,
      predictedLoops: predictions.length,
      truePositives,
      falsePositives,
      falseNegatives,
    },
    precision,
    recall,
    f1,
    falsePositiveRate: rate(falsePositives, truePositives + falsePositives),
    noiseEmailFalsePositiveRate: rate(noiseEmailsWithLoops.size, noiseEmails.length),
    categoryAccuracy: rate(categoryCorrect, truePositives),
    deadlineAccuracyExact: rate(deadlines.filter((d) => d.exact).length, deadlines.length),
    deadlineAccuracyTolerant: rate(deadlines.filter((d) => d.tolerant).length, deadlines.length),
    deadlineBasisAccuracy: rate(deadlines.filter((d) => d.basisCorrect).length, deadlines.length),
    fabricatedDeadlineRate: rate(fabricated.length, expectedNoDate.length),
    evidenceAccuracy: rate(evidence.filter((e) => e.verbatim).length, evidence.length),
    duplicateRate: rate(duplicatePairs.length, predictions.length),
    details: { deadlines, evidence, duplicatePairs },
  };
}

export function formatRate(value: Rate): string {
  if (value.value === null) return `n/a (0/${value.denominator})`;
  return `${(value.value * 100).toFixed(1)}% (${value.numerator}/${value.denominator})`;
}
