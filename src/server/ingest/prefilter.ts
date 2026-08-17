import type { NormalizedMessage } from "../providers/types";

/**
 * Deterministic prefilter that runs *before* the model.
 *
 * Two reasons this is plain code rather than an LLM call:
 *  - Cost. Most of an inbox is bulk mail; sending it to a model is waste.
 *  - Precision. Marketing copy is full of urgency language ("act now, offer
 *    ends Friday") that reads exactly like a deadline. Excluding it up front
 *    removes a whole class of false-positive Open Loops.
 *
 * The filter is deliberately asymmetric about its own mistakes. Dropping a
 * newsletter costs a fraction of a cent. Dropping a real obligation means the
 * product silently fails at the one thing it exists to do, with nothing
 * downstream able to recover it — verification and scoring only ever see what
 * survives this file. So a signal has to be strong to discard a message on its
 * own; weak signals only count in agreement.
 *
 * This is why sender shape alone is not disqualifying. An earlier version
 * treated any `noreply@` address as bulk, which read plausibly and was wrong:
 * background checks, certificate expiries, library due dates, and password
 * resets all arrive from exactly those addresses. It discarded 7 of 79 known
 * obligations before the model was ever asked.
 */

export interface PrefilterResult {
  isBulk: boolean;
  /** Why it was classified this way — surfaced in logs, not to the user. */
  reason: string | null;
}

/** Headers only bulk senders set. Any one of these is conclusive. */
const BULK_HEADERS = [
  "list-unsubscribe",
  "list-id",
  "list-post",
  "x-campaign-id",
  "x-mailchimp-id",
];

/**
 * Local-parts that describe the *content* as promotional. Unlike `noreply@`,
 * which says only that replies aren't read, nobody sends a bill from
 * `deals@` — these name what the mail is.
 */
const MARKETING_SENDER_PATTERNS = [
  /^(news|newsletter|digest|marketing|deals|offers|promo|promotions)@/i,
  /^(campaign|broadcast|blast)@/i,
];

/**
 * Senders that merely don't accept replies. On its own this says nothing about
 * whether the message carries an obligation, so it is only a weak signal.
 */
const NO_REPLY_SENDER_PATTERNS = [
  /^(no-?reply|donotreply|do-not-reply)@/i,
  /^(mailer|bounce|notifications?|automated|system)@/i,
];

const MARKETING_SUBJECT_PATTERNS = [
  /\b\d{1,3}%\s*off\b/i,
  /\bflash sale\b/i,
  /\blimited time offer\b/i,
  /\bshop now\b/i,
  /\bblack friday\b/i,
  /\bcyber monday\b/i,
  /\bdon'?t miss out\b/i,
  /\bwebinar\b/i,
  /\bnewsletter\b/i,
  /\b(weekly|monthly|daily) (digest|roundup|recap)\b/i,
  /\bunsubscribe\b/i,
];

/**
 * Language that marks a message as informational even when it looks
 * transactional. A weak signal: "no action" can appear inside a message that
 * also asks for something.
 */
const NO_ACTION_PATTERNS = [
  /\bno action (is )?(required|needed)\b/i,
  /\bthis is (just )?a (confirmation|receipt|notification)\b/i,
  /\bfor your records\b/i,
];

/**
 * Below this a message cannot carry a traceable obligation — there is nothing
 * to quote as evidence. Deliberately low: "Sure, I'll send it Friday." is 26
 * characters and is exactly the kind of commitment people forget.
 */
const MIN_BODY_CHARS = 15;

function strongBulkSignal(message: NormalizedMessage): string | null {
  for (const key of BULK_HEADERS) {
    if (message.headers[key]) return `header:${key}`;
  }

  const precedence = message.headers["precedence"]?.toLowerCase();
  if (precedence === "bulk" || precedence === "list" || precedence === "junk") {
    return "header:precedence";
  }

  if (message.labels.includes("CATEGORY_PROMOTIONS")) return "label:promotions";
  if (message.labels.includes("CATEGORY_SOCIAL")) return "label:social";

  const from = message.fromEmail ?? "";
  if (MARKETING_SENDER_PATTERNS.some((pattern) => pattern.test(from))) {
    return "sender:marketing";
  }

  const subject = message.subject ?? "";
  if (MARKETING_SUBJECT_PATTERNS.some((pattern) => pattern.test(subject))) {
    return "subject:marketing";
  }

  return null;
}

/**
 * Signals that suggest bulk but are individually unreliable. Two agreeing is
 * treated as conclusive; one alone is not.
 */
function weakBulkSignals(message: NormalizedMessage): string[] {
  const signals: string[] = [];

  const from = message.fromEmail ?? "";
  if (NO_REPLY_SENDER_PATTERNS.some((pattern) => pattern.test(from))) {
    signals.push("sender:no-reply");
  }

  // Auto-generated mail is often transactional and genuinely important (a
  // receipt, a due-date notice), so this cannot stand alone.
  const autoSubmitted = message.headers["auto-submitted"]?.toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") signals.push("header:auto-submitted");

  const body = message.bodyText;
  if (NO_ACTION_PATTERNS.some((pattern) => pattern.test(body))) {
    signals.push("body:no-action-required");
  }

  // Mail addressed to nobody in particular is more likely to be a broadcast.
  if (message.toEmails.length === 0) signals.push("recipients:none");

  return signals;
}

export function classifyMessage(message: NormalizedMessage): PrefilterResult {
  // A message the user sent is a record of what they promised. Short replies
  // are where commitments hide, so these bypass the filter entirely.
  if (message.labels.includes("SENT")) {
    return { isBulk: false, reason: null };
  }

  if (message.bodyText.trim().length < MIN_BODY_CHARS) {
    return { isBulk: true, reason: "body:too-short" };
  }

  const strong = strongBulkSignal(message);
  if (strong) return { isBulk: true, reason: strong };

  const weak = weakBulkSignals(message);
  if (weak.length >= 2) {
    return { isBulk: true, reason: `weak:${weak.join("+")}` };
  }

  return { isBulk: false, reason: null };
}
