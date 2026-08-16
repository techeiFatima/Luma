import { daysUntil } from "@/lib/time";
import { CATEGORY_WEIGHTS, type LoopCategory } from "./taxonomy";

/**
 * Prioritization is ordinary code, not a model call.
 *
 * The model's job is reading email; deciding what matters most is application
 * logic. Keeping it here means ordering is deterministic, testable, explainable
 * to the user, and cannot drift because a prompt changed.
 */

export type PriorityBucket = "now" | "soon" | "later";

export interface PriorityInput {
  category: LoopCategory;
  dueAt: Date | null;
  consequence: "high" | "medium" | "low";
  confidence: number;
  /** When Luma first saw this loop — used to age dateless items upward. */
  firstSeenAt: Date;
}

export interface PriorityBreakdown {
  score: number;
  bucket: PriorityBucket;
  urgency: number;
  impact: number;
  categoryWeight: number;
  /** Short human-readable reason, shown in the UI. */
  explanation: string;
}

const CONSEQUENCE_IMPACT: Record<PriorityInput["consequence"], number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
};

/** How close a deadline is, on a 0-1 scale. */
export function urgencyFromDueDate(dueAt: Date | null, now: Date): number {
  if (!dueAt) return 0;
  const days = daysUntil(dueAt, now);
  if (days < -30) return 0.7; // long overdue: probably stale, but not nothing
  if (days < 0) return 1.0; // overdue and still recoverable
  if (days === 0) return 0.98;
  if (days <= 1) return 0.95;
  if (days <= 3) return 0.85;
  if (days <= 7) return 0.7;
  if (days <= 14) return 0.5;
  if (days <= 30) return 0.35;
  return 0.2;
}

/**
 * A loop with no date does not get to sit at the bottom forever — an unanswered
 * request quietly becomes more urgent the longer it goes unanswered. Capped so
 * age can never outrank a real deadline.
 */
export function stalenessBoost(firstSeenAt: Date, dueAt: Date | null, now: Date): number {
  if (dueAt) return 0;
  const ageDays = Math.max(0, -daysUntil(firstSeenAt, now));
  if (ageDays < 3) return 0;
  if (ageDays < 7) return 0.1;
  if (ageDays < 21) return 0.2;
  return 0.3;
}

function describe(input: PriorityInput, now: Date): string {
  const parts: string[] = [];
  if (input.dueAt) {
    const days = daysUntil(input.dueAt, now);
    if (days < 0) parts.push(`${Math.abs(days)} days overdue`);
    else if (days === 0) parts.push("due today");
    else if (days === 1) parts.push("due tomorrow");
    else parts.push(`due in ${days} days`);
  } else {
    parts.push("no stated deadline");
  }
  parts.push(`${input.consequence} consequence`);
  if (input.confidence < 0.7) parts.push("lower confidence");
  return parts.join(" · ");
}

export function scoreLoop(input: PriorityInput, now: Date = new Date()): PriorityBreakdown {
  const urgency = Math.min(1, urgencyFromDueDate(input.dueAt, now) + stalenessBoost(input.firstSeenAt, input.dueAt, now));
  const impact = CONSEQUENCE_IMPACT[input.consequence];
  const categoryWeight = CATEGORY_WEIGHTS[input.category];

  const base = 0.45 * urgency + 0.35 * impact + 0.2 * categoryWeight;

  // Confidence dampens the score rather than gating it — a 0.6-confidence
  // licence renewal should still outrank a certain-but-trivial reply.
  const confidenceFactor = 0.6 + 0.4 * input.confidence;
  const score = Math.round(100 * base * confidenceFactor);

  const bucket: PriorityBucket = score >= 70 ? "now" : score >= 45 ? "soon" : "later";

  return {
    score,
    bucket,
    urgency,
    impact,
    categoryWeight,
    explanation: describe(input, now),
  };
}

/** Highest score first; ties broken by the sooner deadline. */
export function compareLoops(
  a: { priorityScore: number; dueAt: Date | null },
  b: { priorityScore: number; dueAt: Date | null },
): number {
  if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
  if (a.dueAt && b.dueAt) return a.dueAt.getTime() - b.dueAt.getTime();
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return 0;
}
