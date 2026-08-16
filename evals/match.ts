import type { EvalEmail, ExpectedLoop } from "./types";

/**
 * Aligning predicted Open Loops to expected ones.
 *
 * This is the load-bearing piece of the evaluation: get it wrong and every
 * metric downstream is confidently wrong. Three decisions matter.
 *
 *  1. Matching uses ONLY the expected loop's keywords against the predicted
 *     title + summary. Category is deliberately excluded, so category accuracy
 *     can be measured independently of whether the obligation was found.
 *  2. A pair is only eligible if the predicted loop cites the email the
 *     expected loop belongs to. Without that, a loop from one email could be
 *     credited against a similar obligation in another.
 *  3. Assignment is greedy on descending score and strictly 1:1, so a single
 *     predicted loop can never satisfy two expected ones (which would hide a
 *     real miss on multi-obligation emails).
 */

/** Fraction of an expected loop's keywords that must appear to call it a match. */
export const MATCH_THRESHOLD = 0.4;

export interface PredictedLoop {
  /** Stable id for reporting — the persisted loop id, or a synthetic one. */
  id: string;
  title: string;
  summary: string;
  category: string;
  dueAt: Date | null;
  dueAtBasis: string;
  confidence: number;
  /** Eval email ids this loop cites through its evidence. */
  citedEmailIds: string[];
  /** Quotes as stored, already verified by the pipeline. */
  quotes: string[];
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fraction of `keywords` present in `haystack`, 0..1. */
export function keywordScore(keywords: string[], haystack: string): number {
  if (keywords.length === 0) return 0;
  const text = normalize(haystack);
  let hits = 0;
  for (const keyword of keywords) {
    if (text.includes(normalize(keyword))) hits += 1;
  }
  return hits / keywords.length;
}

export interface ExpectedRef {
  email: EvalEmail;
  expected: ExpectedLoop;
  /** Unique across the dataset: "<emailId>::<key>". */
  ref: string;
}

export interface MatchPair {
  expected: ExpectedRef;
  predicted: PredictedLoop;
  score: number;
}

export interface MatchResult {
  matched: MatchPair[];
  /** Expected loops nothing was matched to — recall failures. */
  missed: ExpectedRef[];
  /** Predicted loops matching nothing expected — precision failures. */
  spurious: PredictedLoop[];
}

export function flattenExpected(emails: EvalEmail[]): ExpectedRef[] {
  return emails.flatMap((email) =>
    email.expected.map((expected) => ({
      email,
      expected,
      ref: `${email.id}::${expected.key}`,
    })),
  );
}

export function matchLoops(
  expectedRefs: ExpectedRef[],
  predictions: PredictedLoop[],
): MatchResult {
  const pairs: MatchPair[] = [];

  for (const expected of expectedRefs) {
    for (const predicted of predictions) {
      // A prediction can only satisfy an expectation from an email it cites.
      if (!predicted.citedEmailIds.includes(expected.email.id)) continue;
      const score = keywordScore(
        expected.expected.match,
        `${predicted.title} ${predicted.summary}`,
      );
      if (score >= MATCH_THRESHOLD) pairs.push({ expected, predicted, score });
    }
  }

  // Greedy, highest-confidence assignments first, strictly one-to-one.
  pairs.sort((a, b) => b.score - a.score || a.expected.ref.localeCompare(b.expected.ref));

  const usedExpected = new Set<string>();
  const usedPredicted = new Set<string>();
  const matched: MatchPair[] = [];

  for (const pair of pairs) {
    if (usedExpected.has(pair.expected.ref) || usedPredicted.has(pair.predicted.id)) continue;
    usedExpected.add(pair.expected.ref);
    usedPredicted.add(pair.predicted.id);
    matched.push(pair);
  }

  return {
    matched,
    missed: expectedRefs.filter((expected) => !usedExpected.has(expected.ref)),
    spurious: predictions.filter((predicted) => !usedPredicted.has(predicted.id)),
  };
}
