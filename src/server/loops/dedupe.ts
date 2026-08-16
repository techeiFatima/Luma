import { contentHash } from "@/lib/crypto";
import type { VerifiedLoop } from "./verify";

/**
 * Duplicate prevention.
 *
 * Two mechanisms, because they catch different failures:
 *
 *  - `dedupeKey` is a stable hash over (category, counterparty domain, title
 *    stem). It is a unique constraint in the database, so re-running a sync
 *    updates the existing loop instead of creating a second one. This handles
 *    the common case: the same obligation re-extracted from a re-synced thread.
 *
 *  - `findSimilar` catches near-duplicates that hash differently — the same
 *    renewal described by two senders, or a reminder email that restates an
 *    earlier one in different words.
 */

const STOP_WORDS = new Set([
  "a", "an", "and", "the", "to", "for", "of", "on", "in", "by", "your", "you",
  "with", "at", "from", "is", "are", "be", "this", "that", "it", "as", "or",
  "please", "kindly", "need", "needs", "needed", "must",
]);

/** Suffixes stripped in order, longest first. */
const PLURAL_SUFFIXES = ["ies", "es", "s"];
const DERIVATIONAL_SUFFIXES = ["ments", "ment", "ations", "ation", "ions", "ion", "ings", "ing", "al", "ed"];

const MIN_STEM_LENGTH = 4;

/**
 * A crude stemmer, not a linguistic one.
 *
 * It exists so "renew", "renewal", and "renewals" collapse to one token —
 * without that, the same obligation described in two tenses produces two
 * separate Open Loops, which is exactly the duplication the product must avoid.
 * The length guard keeps it from mangling short words ("payment" stays put
 * rather than becoming "pay").
 */
export function stem(word: string): string {
  let result = word;

  for (const suffix of PLURAL_SUFFIXES) {
    if (result.endsWith(suffix) && result.length - suffix.length >= MIN_STEM_LENGTH) {
      result = suffix === "ies" ? `${result.slice(0, -3)}y` : result.slice(0, -suffix.length);
      break;
    }
  }

  for (const suffix of DERIVATIONAL_SUFFIXES) {
    if (result.endsWith(suffix) && result.length - suffix.length >= MIN_STEM_LENGTH) {
      result = result.slice(0, -suffix.length);
      break;
    }
  }

  // Collapses "license" / "licensing" onto a shared stem.
  if (result.endsWith("e") && result.length - 1 >= MIN_STEM_LENGTH) {
    result = result.slice(0, -1);
  }

  return result;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
    .map(stem);
}

/** Distinctive words from a title, sorted so word order doesn't change the key. */
export function titleStem(title: string): string {
  return [...new Set(tokenize(title))].sort().slice(0, 6).join("-");
}

export function counterpartyDomain(email: string | null): string {
  if (!email) return "";
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

export function buildDedupeKey(loop: {
  category: string;
  counterpartyEmail: string | null;
  title: string;
}): string {
  return contentHash(loop.category, counterpartyDomain(loop.counterpartyEmail), titleStem(loop.title));
}

/** Jaccard overlap of the two token sets. */
export function similarity(a: string, b: string): number {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export interface ExistingLoopSummary {
  id: string;
  title: string;
  category: string;
  counterpartyEmail: string | null;
  dueAt: Date | null;
  status: string;
}

/** Titles this close are treated as the same obligation. */
export const SIMILARITY_THRESHOLD = 0.6;

/**
 * Finds an existing loop that is plausibly the same obligation. Requires the
 * same category, so a payment and a renewal for the same vendor stay distinct
 * even when they share wording.
 */
export function findSimilar(
  loop: VerifiedLoop,
  existing: ExistingLoopSummary[],
): ExistingLoopSummary | null {
  let best: { candidate: ExistingLoopSummary; score: number } | null = null;

  for (const candidate of existing) {
    if (candidate.status === "dismissed" || candidate.status === "done") continue;
    if (candidate.category !== loop.category) continue;

    const score = similarity(loop.title, candidate.title);
    if (score < SIMILARITY_THRESHOLD) continue;

    // A shared counterparty domain is strong corroboration; require either that
    // or a very high title overlap.
    const sameDomain =
      counterpartyDomain(loop.counterpartyEmail) !== "" &&
      counterpartyDomain(loop.counterpartyEmail) === counterpartyDomain(candidate.counterpartyEmail);
    if (!sameDomain && score < 0.8) continue;

    if (!best || score > best.score) best = { candidate, score };
  }

  return best?.candidate ?? null;
}

/** Collapses duplicates within a single extraction run before persistence. */
export function dedupeWithinBatch(loops: VerifiedLoop[]): VerifiedLoop[] {
  const kept: VerifiedLoop[] = [];

  for (const loop of loops) {
    const existingIndex = kept.findIndex(
      (candidate) =>
        candidate.category === loop.category &&
        similarity(candidate.title, loop.title) >= SIMILARITY_THRESHOLD,
    );

    if (existingIndex === -1) {
      kept.push(loop);
      continue;
    }

    // Keep the more confident version, but merge evidence from both so the
    // detail view still shows every message that supports the loop.
    const existing = kept[existingIndex];
    if (!existing) continue;
    const winner = loop.confidence > existing.confidence ? loop : existing;
    const loser = winner === loop ? existing : loop;
    const seen = new Set(winner.evidence.map((item) => `${item.sourceItemId}::${item.quote}`));
    const merged = [...winner.evidence];
    for (const item of loser.evidence) {
      const key = `${item.sourceItemId}::${item.quote}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
    kept[existingIndex] = { ...winner, evidence: merged };
  }

  return kept;
}
