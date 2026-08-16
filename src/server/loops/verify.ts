import { parseModelDate } from "@/lib/time";
import type { CandidateLoop } from "../ai/schema";
import type { LoopCategory } from "./taxonomy";

/**
 * Deterministic verification of what the model proposed.
 *
 * The model is good at reading intent out of messy prose and bad at being held
 * to its word. So nothing it says becomes application state until this file has
 * checked it against the source text. Three things happen here:
 *
 *  1. Every evidence quote must actually occur in the message it cites.
 *     Quotes that do not are dropped; a loop left with no verified evidence is
 *     rejected outright. This is what makes "traceable to source" true rather
 *     than aspirational.
 *  2. A due date claimed as `explicit` is only kept as a fact if its supporting
 *     quote verifies. Otherwise it is demoted to `inferred` — the date survives,
 *     but the UI will no longer present it as something the source stated.
 *  3. Loops the user does not own, or that the model is not confident about,
 *     are filtered out. Precision over quantity.
 */

/** Below this we would rather show nothing. */
export const MIN_CONFIDENCE = 0.55;

export interface SourceText {
  id: string;
  subject: string | null;
  bodyText: string;
}

export interface VerifiedEvidence {
  documentId: string;
  quote: string;
  supports: "claim" | "due_date";
}

export interface VerifiedLoop {
  title: string;
  summary: string;
  category: LoopCategory;
  confidence: number;
  consequence: "high" | "medium" | "low";
  dueAt: Date | null;
  dueAtBasis: "explicit" | "inferred" | "none";
  dueAtEvidence: string | null;
  counterpartyName: string | null;
  counterpartyEmail: string | null;
  amountMinor: number | null;
  amountCurrency: string | null;
  inferenceNotes: string | null;
  evidence: VerifiedEvidence[];
}

export type RejectionReason =
  | "not_user_action"
  | "low_confidence"
  | "no_verified_evidence"
  | "unknown_source";

export interface VerificationOutcome {
  loop: VerifiedLoop | null;
  rejection: RejectionReason | null;
  /** Non-fatal adjustments made, e.g. a demoted due date. Useful in logs. */
  notes: string[];
}

/**
 * Collapses whitespace so a quote still matches when the mail client wrapped
 * the line differently. Case is ignored for the same reason. This tolerates
 * formatting, not paraphrase — the words must still be there, in order.
 */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function quoteAppearsIn(quote: string, source: SourceText): boolean {
  const needle = normalizeForMatch(quote);
  if (needle.length < 8) return false; // too short to be meaningful evidence
  const haystack = normalizeForMatch(`${source.subject ?? ""}\n${source.bodyText}`);
  return haystack.includes(needle);
}

export function verifyCandidate(
  candidate: CandidateLoop,
  sources: Map<string, SourceText>,
): VerificationOutcome {
  const notes: string[] = [];

  if (!candidate.requires_user_action) {
    return { loop: null, rejection: "not_user_action", notes };
  }
  if (candidate.confidence < MIN_CONFIDENCE) {
    return { loop: null, rejection: "low_confidence", notes };
  }

  const evidence: VerifiedEvidence[] = [];
  for (const item of candidate.evidence) {
    const source = sources.get(item.source_id);
    if (!source) {
      notes.push(`evidence cites unknown source ${item.source_id}`);
      continue;
    }
    if (!quoteAppearsIn(item.quote, source)) {
      notes.push(`evidence quote not found in ${item.source_id}`);
      continue;
    }
    evidence.push({ documentId: source.id, quote: item.quote.trim(), supports: "claim" });
  }

  if (evidence.length === 0) {
    return { loop: null, rejection: "no_verified_evidence", notes };
  }

  // --- Due date -----------------------------------------------------------
  let dueAt = parseModelDate(candidate.due_date);
  let dueAtBasis = candidate.due_date_basis;
  let dueAtEvidence: string | null = null;

  if (!dueAt) {
    // No parseable date means no date, whatever the model claimed.
    if (dueAtBasis !== "none") notes.push("due date unparseable; treated as absent");
    dueAtBasis = "none";
  } else if (dueAtBasis === "explicit") {
    const quote = candidate.due_date_evidence;
    const supported =
      quote !== null && [...sources.values()].some((source) => quoteAppearsIn(quote, source));
    if (supported && quote) {
      dueAtEvidence = quote.trim();
      const sourceForQuote = [...sources.values()].find((source) => quoteAppearsIn(quote, source));
      if (sourceForQuote) {
        evidence.push({ documentId: sourceForQuote.id, quote: quote.trim(), supports: "due_date" });
      }
    } else {
      // Keep the date, but stop calling it a fact.
      dueAtBasis = "inferred";
      notes.push("due date claimed as explicit but unsupported; demoted to inferred");
    }
  }

  const amountValid =
    candidate.amount_minor !== null &&
    Number.isFinite(candidate.amount_minor) &&
    candidate.amount_minor > 0;

  return {
    loop: {
      title: candidate.title.trim(),
      summary: candidate.summary.trim(),
      category: candidate.category,
      confidence: candidate.confidence,
      consequence: candidate.consequence,
      dueAt: dueAtBasis === "none" ? null : dueAt,
      dueAtBasis,
      dueAtEvidence,
      counterpartyName: candidate.counterparty_name?.trim() || null,
      counterpartyEmail: candidate.counterparty_email?.trim().toLowerCase() || null,
      amountMinor: amountValid ? candidate.amount_minor : null,
      amountCurrency: amountValid ? (candidate.amount_currency?.trim().toUpperCase() ?? null) : null,
      inferenceNotes: candidate.inference_notes.trim() || null,
      evidence,
    },
    rejection: null,
    notes,
  };
}
