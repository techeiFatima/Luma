import type { NormalizedMessage } from "../providers/types";

/**
 * Deterministic prefilter that runs *before* the model.
 *
 * Two reasons this is plain code rather than an LLM call:
 *  - Cost. Most of an inbox is bulk mail; sending it to a model is waste.
 *  - Precision. Marketing copy is full of urgency language ("act now, offer
 *    ends Friday") that reads exactly like a deadline. Excluding it up front
 *    removes a whole class of false-positive Open Loops.
 */

export interface PrefilterResult {
  isBulk: boolean;
  /** Why it was classified this way — surfaced in logs, not to the user. */
  reason: string | null;
}

const BULK_HEADERS = [
  "list-unsubscribe",
  "list-id",
  "list-post",
  "x-campaign-id",
  "x-mailchimp-id",
];

const BULK_SENDER_PATTERNS = [
  /^(no-?reply|donotreply|do-not-reply)@/i,
  /^(news|newsletter|digest|updates?|marketing|deals|offers|promo)@/i,
  /^(mailer|bounce|notifications?)@/i,
];

/**
 * Senders that look automated but routinely carry real obligations. These
 * override the sender-pattern rule — a licensing board emailing from
 * `noreply@` is exactly the kind of thing the product exists to catch.
 */
const OBLIGATION_SENDER_HINTS = [
  /\.gov$/i,
  /\b(billing|invoice|payments?|statements?|renewals?)@/i,
  /\b(support|service|orders?|claims?)@/i,
];

const MARKETING_SUBJECT_PATTERNS = [
  /\b\d{1,3}%\s*off\b/i,
  /\bflash sale\b/i,
  /\blimited time offer\b/i,
  /\bshop now\b/i,
  /\bblack friday\b/i,
  /\bdon'?t miss out\b/i,
  /\bwebinar\b/i,
  /\bnewsletter\b/i,
  /\bweekly digest\b/i,
];

function hasBulkHeader(headers: Record<string, string>): string | null {
  for (const key of BULK_HEADERS) {
    if (headers[key]) return `header:${key}`;
  }
  const precedence = headers["precedence"]?.toLowerCase();
  if (precedence === "bulk" || precedence === "list" || precedence === "junk") {
    return "header:precedence";
  }
  const autoSubmitted = headers["auto-submitted"]?.toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return "header:auto-submitted";
  return null;
}

export function classifyMessage(message: NormalizedMessage): PrefilterResult {
  const headerReason = hasBulkHeader(message.headers);
  if (headerReason) return { isBulk: true, reason: headerReason };

  if (message.labels.includes("CATEGORY_PROMOTIONS")) {
    return { isBulk: true, reason: "label:promotions" };
  }
  if (message.labels.includes("CATEGORY_SOCIAL")) {
    return { isBulk: true, reason: "label:social" };
  }

  const subject = message.subject ?? "";
  for (const pattern of MARKETING_SUBJECT_PATTERNS) {
    if (pattern.test(subject)) return { isBulk: true, reason: "subject:marketing" };
  }

  const from = message.fromEmail ?? "";
  const looksAutomated = BULK_SENDER_PATTERNS.some((pattern) => pattern.test(from));
  const looksObligatory = OBLIGATION_SENDER_HINTS.some((pattern) => pattern.test(from));
  if (looksAutomated && !looksObligatory) {
    return { isBulk: true, reason: "sender:automated" };
  }

  // Nothing to extract from an essentially empty message.
  if (message.bodyText.trim().length < 40) {
    return { isBulk: true, reason: "body:too-short" };
  }

  return { isBulk: false, reason: null };
}
