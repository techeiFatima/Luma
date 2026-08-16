import type { LoopCategory } from "@/server/loops/taxonomy";

/**
 * Evaluation dataset types.
 *
 * The dataset is ground truth, so it has to be written to be *checkable*, not
 * just plausible. Two things make that work:
 *
 *  - `expected` is the complete list of Open Loops a correct system would
 *    produce for this email. An empty array is a real expected answer, not a
 *    missing annotation — most of the noise buckets expect exactly that.
 *  - `match` keywords are how a predicted loop is aligned to an expected one.
 *    They must be distinctive enough to identify the obligation but not so
 *    specific that a correct answer phrased differently fails to match. See
 *    evals/match.ts for how they are used.
 */

export const EVAL_BUCKETS = [
  "deadline",
  "follow_up",
  "commitment",
  "appointment",
  "form",
  "renewal",
  "payment",
  "return",
  "newsletter",
  "marketing",
  "automated",
  "personal",
  "ambiguous",
  "multi_obligation",
  "hallucination_bait",
] as const;

export type EvalBucket = (typeof EVAL_BUCKETS)[number];

/** Buckets where the correct answer is "no open loops at all". */
export const NEGATIVE_BUCKETS: readonly EvalBucket[] = [
  "newsletter",
  "marketing",
  "personal",
];

export interface ExpectedLoop {
  /** Stable identifier for this obligation, unique within the email. */
  key: string;
  category: LoopCategory;
  /**
   * Words that must appear in the predicted title+summary for it to be
   * considered the same obligation. Matching requires MATCH_THRESHOLD of them.
   */
  match: string[];
  /** ISO date (YYYY-MM-DD) the system should land on, or null for no date. */
  dueDate: string | null;
  /**
   * "explicit" when the email states the date outright, "inferred" when a
   * correct system would have to derive it, "none" when there is no date.
   */
  dueDateBasis: "explicit" | "inferred" | "none";
  /**
   * A phrase that genuinely appears in the body. Evidence quoting this email
   * should overlap it; used to sanity-check evidence relevance, not identity.
   */
  evidenceHint?: string;
}

export interface EvalEmail {
  id: string;
  threadId?: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  /** How long before "now" this arrived. Keeps relative dates coherent. */
  daysAgo: number;
  body: string;
  headers?: Record<string, string>;
  labels?: string[];

  bucket: EvalBucket;
  /** The complete correct answer. Empty array = no loops expected. */
  expected: ExpectedLoop[];
  /** Why this is the expected answer — read this before disputing a failure. */
  rationale: string;
  /**
   * True when the deterministic prefilter is *expected* to drop this before
   * the model ever sees it. Lets us separate prefilter behaviour from model
   * behaviour in the report.
   */
  expectPrefiltered?: boolean;
}

/**
 * The dataset is written against a fixed "today" so that stated dates like
 * "March 14" have an unambiguous correct answer. The runner shifts message
 * timestamps relative to this and tells the model this is today's date.
 */
export const EVAL_TODAY = new Date("2026-03-01T12:00:00.000Z");
