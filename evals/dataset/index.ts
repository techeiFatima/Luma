import type { EvalEmail } from "../types";
import { HARD_EMAILS } from "./hard";
import { NOISE_EMAILS } from "./noise";
import { OBLIGATION_EMAILS } from "./obligations";
import { TRANSACTION_EMAILS } from "./transactions";

export const EVAL_EMAILS: EvalEmail[] = [
  ...OBLIGATION_EMAILS,
  ...TRANSACTION_EMAILS,
  ...NOISE_EMAILS,
  ...HARD_EMAILS,
];

export function datasetStats() {
  const byBucket = new Map<string, { emails: number; expectedLoops: number }>();
  for (const email of EVAL_EMAILS) {
    const entry = byBucket.get(email.bucket) ?? { emails: 0, expectedLoops: 0 };
    entry.emails += 1;
    entry.expectedLoops += email.expected.length;
    byBucket.set(email.bucket, entry);
  }
  return {
    totalEmails: EVAL_EMAILS.length,
    totalExpectedLoops: EVAL_EMAILS.reduce((sum, email) => sum + email.expected.length, 0),
    emailsExpectingNothing: EVAL_EMAILS.filter((email) => email.expected.length === 0).length,
    byBucket: Object.fromEntries(byBucket),
  };
}
