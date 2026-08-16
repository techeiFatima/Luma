import { describe, expect, it } from "vitest";
import { EVAL_EMAILS, datasetStats } from "@evals/dataset";
import { flattenExpected, keywordScore, matchLoops, type PredictedLoop } from "@evals/match";
import { computeMetrics } from "@evals/metrics";
import { EVAL_BUCKETS, NEGATIVE_BUCKETS, type EvalEmail } from "@evals/types";
import { isLoopCategory } from "@/server/loops/taxonomy";

/**
 * Tests for the evaluation harness itself.
 *
 * An untested metrics implementation produces numbers that look authoritative
 * and are wrong, which is worse than no evaluation at all. These pin the
 * matching semantics and check the arithmetic against hand-computed cases.
 */

function predicted(overrides: Partial<PredictedLoop> = {}): PredictedLoop {
  return {
    id: "p1",
    title: "Renew professional licence",
    summary: "The renewal form and fee are outstanding.",
    category: "renewal",
    dueAt: new Date("2026-03-31T23:59:59Z"),
    dueAtBasis: "explicit",
    confidence: 0.9,
    citedEmailIds: ["rn-03"],
    quotes: ["submit the renewal form"],
    ...overrides,
  };
}

describe("dataset integrity", () => {
  it("has at least 100 emails covering every required bucket", () => {
    expect(EVAL_EMAILS.length).toBeGreaterThanOrEqual(100);
    const buckets = new Set(EVAL_EMAILS.map((email) => email.bucket));
    for (const bucket of EVAL_BUCKETS) expect(buckets).toContain(bucket);
  });

  it("has unique email ids and unique expected keys within each email", () => {
    const ids = EVAL_EMAILS.map((email) => email.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const email of EVAL_EMAILS) {
      const keys = email.expected.map((expected) => expected.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("only uses categories the application actually knows", () => {
    for (const email of EVAL_EMAILS) {
      for (const expected of email.expected) {
        expect(isLoopCategory(expected.category)).toBe(true);
      }
    }
  });

  it("annotates every email with a rationale", () => {
    for (const email of EVAL_EMAILS) {
      expect(email.rationale.length).toBeGreaterThan(20);
    }
  });

  it("keeps dates and bases internally consistent", () => {
    for (const email of EVAL_EMAILS) {
      for (const expected of email.expected) {
        if (expected.dueDate === null) {
          expect(expected.dueDateBasis).toBe("none");
        } else {
          expect(expected.dueDateBasis).not.toBe("none");
          expect(expected.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    }
  });

  it("quotes evidence hints that genuinely appear in the body", () => {
    // If a hint is not in the body, the annotation is wrong, not the model.
    const failures: string[] = [];
    for (const email of EVAL_EMAILS) {
      for (const expected of email.expected) {
        if (!expected.evidenceHint) continue;
        const haystack = `${email.subject}\n${email.body}`.replace(/\s+/g, " ").toLowerCase();
        if (!haystack.includes(expected.evidenceHint.replace(/\s+/g, " ").toLowerCase())) {
          failures.push(`${email.id}::${expected.key} — "${expected.evidenceHint}"`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps negative buckets genuinely negative", () => {
    for (const email of EVAL_EMAILS) {
      if (NEGATIVE_BUCKETS.includes(email.bucket)) {
        expect(email.expected).toEqual([]);
      }
    }
  });

  it("expects nothing from every hallucination-bait email", () => {
    const bait = EVAL_EMAILS.filter((email) => email.bucket === "hallucination_bait");
    expect(bait.length).toBeGreaterThanOrEqual(9);
    for (const email of bait) expect(email.expected).toEqual([]);
  });

  it("has a meaningful share of emails expecting nothing", () => {
    const stats = datasetStats();
    // A dataset that is mostly positives cannot measure false positives.
    expect(stats.emailsExpectingNothing / stats.totalEmails).toBeGreaterThan(0.3);
  });

  it("gives multi-obligation emails more than one expected loop", () => {
    const multi = EVAL_EMAILS.filter((email) => email.bucket === "multi_obligation");
    for (const email of multi) expect(email.expected.length).toBeGreaterThan(1);
  });
});

describe("keywordScore", () => {
  it("is the fraction of keywords present", () => {
    expect(keywordScore(["renew", "licence"], "Renew your licence today")).toBe(1);
    expect(keywordScore(["renew", "licence"], "Renew your passport")).toBe(0.5);
    expect(keywordScore(["renew"], "Nothing relevant")).toBe(0);
  });

  it("ignores punctuation and case", () => {
    expect(keywordScore(["w-9"], "Return the W-9!")).toBe(1);
  });
});

describe("matchLoops", () => {
  const emails = EVAL_EMAILS.filter((email) => email.id === "rn-03");
  const refs = flattenExpected(emails);

  it("matches a prediction that cites the right email and shares keywords", () => {
    const result = matchLoops(refs, [predicted()]);
    expect(result.matched).toHaveLength(1);
    expect(result.missed).toHaveLength(0);
    expect(result.spurious).toHaveLength(0);
  });

  it("does not credit a prediction that cites a different email", () => {
    const result = matchLoops(refs, [predicted({ citedEmailIds: ["nl-01"] })]);
    expect(result.matched).toHaveLength(0);
    expect(result.missed).toHaveLength(1);
    expect(result.spurious).toHaveLength(1);
  });

  it("does not credit an unrelated obligation from the right email", () => {
    const result = matchLoops(refs, [
      predicted({ title: "Book a haircut", summary: "Call the salon." }),
    ]);
    expect(result.matched).toHaveLength(0);
  });

  it("ignores category when matching, so category errors stay visible", () => {
    const result = matchLoops(refs, [predicted({ category: "payment" })]);
    expect(result.matched).toHaveLength(1);
  });

  it("never lets one prediction satisfy two expected loops", () => {
    // mo-01 has three distinct obligations; a single vague loop must not
    // silently cover all of them.
    const multi = EVAL_EMAILS.filter((email) => email.id === "mo-01");
    const multiRefs = flattenExpected(multi);
    const vague = predicted({
      id: "vague",
      title: "Tenancy: sign agreement, pay rent deposit, send insurance proof",
      summary: "Several things are outstanding before move-in.",
      citedEmailIds: ["mo-01"],
    });
    const result = matchLoops(multiRefs, [vague]);
    expect(result.matched).toHaveLength(1);
    expect(result.missed).toHaveLength(2);
  });

  it("assigns the better-scoring pair first", () => {
    const multi = EVAL_EMAILS.filter((email) => email.id === "mo-05");
    const multiRefs = flattenExpected(multi);
    const paper = predicted({
      id: "paper",
      title: "Submit camera-ready paper",
      summary: "The camera-ready paper is due.",
      citedEmailIds: ["mo-05"],
    });
    const registration = predicted({
      id: "reg",
      title: "Complete speaker registration",
      summary: "Register as a speaker.",
      citedEmailIds: ["mo-05"],
    });
    const result = matchLoops(multiRefs, [paper, registration]);
    expect(result.matched).toHaveLength(2);
    expect(result.missed).toHaveLength(0);
  });
});

describe("computeMetrics", () => {
  function scenario(emails: EvalEmail[], predictions: PredictedLoop[]) {
    const refs = flattenExpected(emails);
    const match = matchLoops(refs, predictions);
    const sources = new Map(
      emails.map((email) => [email.id, `${email.subject}\n${email.body}`]),
    );
    return computeMetrics(emails, predictions, match, sources);
  }

  const positive = EVAL_EMAILS.filter((email) => email.id === "rn-03");
  const negative = EVAL_EMAILS.filter((email) => email.id === "nl-01");

  it("reports a perfect run correctly", () => {
    const metrics = scenario(positive, [predicted()]);
    expect(metrics.precision.value).toBe(1);
    expect(metrics.recall.value).toBe(1);
    expect(metrics.f1).toBe(1);
    expect(metrics.falsePositiveRate.value).toBe(0);
    expect(metrics.categoryAccuracy.value).toBe(1);
    expect(metrics.deadlineAccuracyExact.value).toBe(1);
  });

  it("reports a total miss correctly", () => {
    const metrics = scenario(positive, []);
    expect(metrics.recall.value).toBe(0);
    // No predictions at all means precision is undefined, not 0 or 100.
    expect(metrics.precision.value).toBeNull();
    expect(metrics.counts.falseNegatives).toBe(1);
  });

  it("counts a loop extracted from a newsletter as a noise false positive", () => {
    const metrics = scenario(negative, [
      predicted({ id: "spam", citedEmailIds: ["nl-01"], title: "Read the dispatch" }),
    ]);
    expect(metrics.counts.falsePositives).toBe(1);
    expect(metrics.precision.value).toBe(0);
    expect(metrics.noiseEmailFalsePositiveRate.value).toBe(1);
  });

  it("computes precision and recall over a mixed run by hand", () => {
    // 2 expected (rn-03, dl-01), 3 predicted: 1 correct, 1 wrong-email, 1 noise.
    const emails = EVAL_EMAILS.filter((email) => ["rn-03", "dl-01", "nl-01"].includes(email.id));
    const metrics = scenario(emails, [
      predicted({ id: "ok" }),
      predicted({ id: "junk1", citedEmailIds: ["nl-01"], title: "Read stories" }),
      predicted({ id: "junk2", citedEmailIds: ["dl-01"], title: "Unrelated thing" }),
    ]);
    expect(metrics.counts.truePositives).toBe(1);
    expect(metrics.counts.falsePositives).toBe(2);
    expect(metrics.counts.falseNegatives).toBe(1);
    expect(metrics.precision.value).toBeCloseTo(1 / 3);
    expect(metrics.recall.value).toBeCloseTo(1 / 2);
    expect(metrics.f1).toBeCloseTo(0.4);
  });

  it("flags a fabricated deadline", () => {
    // fu-02 expects no date; predicting one is the failure mode that matters.
    const emails = EVAL_EMAILS.filter((email) => email.id === "fu-02");
    const metrics = scenario(emails, [
      predicted({
        id: "fab",
        title: "Pay invoice 2291",
        summary: "Invoice 2291 payment is outstanding.",
        category: "payment",
        citedEmailIds: ["fu-02"],
        dueAt: new Date("2026-03-05T00:00:00Z"),
        quotes: [],
      }),
    ]);
    expect(metrics.counts.truePositives).toBe(1);
    expect(metrics.fabricatedDeadlineRate.value).toBe(1);
    expect(metrics.deadlineAccuracyExact.value).toBe(0);
  });

  it("allows small drift on inferred dates but not on explicit ones", () => {
    // fu-01 expects 2026-03-04, inferred.
    const emails = EVAL_EMAILS.filter((email) => email.id === "fu-01");
    const near = scenario(emails, [
      predicted({
        id: "near",
        title: "Send Q2 headcount numbers",
        summary: "Tomas needs the Q2 budget numbers.",
        category: "follow_up",
        citedEmailIds: ["fu-01"],
        dueAt: new Date("2026-03-05T00:00:00Z"),
        quotes: [],
      }),
    ]);
    expect(near.deadlineAccuracyExact.value).toBe(0);
    expect(near.deadlineAccuracyTolerant.value).toBe(1);

    // rn-03 expects 2026-03-31, explicit — no tolerance.
    const off = scenario(positive, [predicted({ dueAt: new Date("2026-03-30T00:00:00Z") })]);
    expect(off.deadlineAccuracyTolerant.value).toBe(0);
  });

  it("detects a quote that is not in the source", () => {
    const metrics = scenario(positive, [
      predicted({ quotes: ["we have cancelled your licence entirely"] }),
    ]);
    expect(metrics.evidenceAccuracy.value).toBe(0);
  });

  it("accepts a quote that differs only in whitespace", () => {
    const metrics = scenario(positive, [
      predicted({ quotes: ["submit the renewal form   with the $180 fee"] }),
    ]);
    expect(metrics.evidenceAccuracy.value).toBe(1);
  });

  it("detects duplicate predictions of the same obligation", () => {
    const metrics = scenario(positive, [
      predicted({ id: "a" }),
      predicted({ id: "b", title: "Renew the professional licence" }),
    ]);
    expect(metrics.details.duplicatePairs.length).toBe(1);
    expect(metrics.duplicateRate.value).toBeCloseTo(0.5);
  });

  it("returns null rather than a fake number when a denominator is zero", () => {
    const metrics = scenario(negative, []);
    expect(metrics.precision.value).toBeNull();
    expect(metrics.categoryAccuracy.value).toBeNull();
    expect(metrics.deadlineAccuracyExact.value).toBeNull();
  });
});
