import { daysUntil } from "@/lib/time";
import type { LoopListItem } from "./queries";

/**
 * The answer to "What am I forgetting?".
 *
 * This is computed, not generated. A sentence like "two things need you this
 * week" is a claim about the user's life, and the one thing this product
 * cannot afford is to be confidently wrong about that. Counting is something
 * code does perfectly and a model does approximately, so code does it.
 *
 * The model's job ended upstream: deciding what each email meant. Turning that
 * into a summary is arithmetic, and running a second model call over already-
 * verified data would add cost, latency, and a fresh opportunity to hallucinate
 * in exchange for slightly warmer phrasing.
 */

export type BriefingTone = "urgent" | "steady" | "clear" | "unknown";

export interface Briefing {
  tone: BriefingTone;
  /** One short sentence answering the question. */
  headline: string;
  /** At most two sentences of supporting detail. May be empty. */
  detail: string[];
  /** Loops the user should look at first, in order. */
  leading: LoopListItem[];
  counts: {
    active: number;
    overdue: number;
    dueToday: number;
    dueThisWeek: number;
    undated: number;
  };
}

export interface BriefingContext {
  /** True once at least one successful sync has happened. */
  hasSynced: boolean;
  /** Non-bulk mail fetched but not yet analyzed — the last run didn't finish. */
  pendingAnalysis: number;
  /** Set when the most recent extraction run failed. */
  lastRunError: string | null;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** "the dentist forms" -> a short reference the sentence can carry. */
function refer(loop: LoopListItem): string {
  const title = loop.title.trim();
  return title.charAt(0).toLowerCase() + title.slice(1);
}

function whenPhrase(loop: LoopListItem, now: Date): string {
  if (!loop.dueAt) return "";
  const days = daysUntil(loop.dueAt, now);
  if (days < -1) return `${Math.abs(days)} days late`;
  if (days === -1) return "a day late";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 7) return `in ${days} days`;
  return "";
}

export function buildBriefing(
  loops: LoopListItem[],
  context: BriefingContext,
  now: Date = new Date(),
): Briefing {
  const counts = {
    active: loops.length,
    overdue: 0,
    dueToday: 0,
    dueThisWeek: 0,
    undated: 0,
  };

  for (const loop of loops) {
    if (!loop.dueAt) {
      counts.undated += 1;
      continue;
    }
    const days = daysUntil(loop.dueAt, now);
    if (days < 0) counts.overdue += 1;
    else if (days === 0) counts.dueToday += 1;
    else if (days <= 7) counts.dueThisWeek += 1;
  }

  // Already sorted by the priority comparator upstream.
  const leading = loops.slice(0, 3);

  // --- Nothing to show: say which kind of nothing it is ---------------------
  // "You're all clear" and "I haven't looked yet" are completely different
  // statements, and conflating them is how a product quietly loses trust.
  if (loops.length === 0) {
    if (!context.hasSynced) {
      return {
        tone: "unknown",
        headline: "Luma hasn't read anything yet.",
        detail: ["Check your inbox to get started."],
        leading: [],
        counts,
      };
    }
    if (context.lastRunError || context.pendingAnalysis > 0) {
      return {
        tone: "unknown",
        headline: "Luma couldn't finish reading your mail.",
        detail: [
          context.pendingAnalysis > 0
            ? `${context.pendingAnalysis} ${plural(context.pendingAnalysis, "message is", "messages are")} still waiting to be analyzed.`
            : "The last run didn't complete, so this list may be incomplete.",
        ],
        leading: [],
        counts,
      };
    }
    return {
      tone: "clear",
      headline: "Nothing is waiting on you.",
      detail: ["Luma read your recent mail and found no unfinished obligations."],
      leading: [],
      counts,
    };
  }

  // --- Something is late ----------------------------------------------------
  const first = leading[0]!;
  const detail: string[] = [];

  if (counts.overdue > 0) {
    const late = loops.find((loop) => loop.dueAt && daysUntil(loop.dueAt, now) < 0)!;
    const headline =
      counts.overdue === 1
        ? `${first.title} is overdue.`
        : `${counts.overdue} things are overdue.`;
    detail.push(
      counts.overdue === 1
        ? `It was due ${whenPhrase(late, now)}.`
        : `The oldest is ${refer(late)}, ${whenPhrase(late, now)}.`,
    );
    const rest = counts.active - counts.overdue;
    if (rest > 0) {
      detail.push(`${rest} other ${plural(rest, "thing", "things")} can wait.`);
    }
    return { tone: "urgent", headline, detail, leading, counts };
  }

  // --- Something is due today or tomorrow -----------------------------------
  const soon = loops.filter(
    (loop) => loop.dueAt && daysUntil(loop.dueAt, now) >= 0 && daysUntil(loop.dueAt, now) <= 1,
  );
  if (soon.length > 0) {
    const headline =
      soon.length === 1
        ? `${soon[0]!.title} is due ${whenPhrase(soon[0]!, now)}.`
        : `${soon.length} things are due in the next day.`;
    if (soon.length > 1) {
      detail.push(`Starting with ${refer(soon[0]!)}.`);
    }
    const rest = counts.active - soon.length;
    if (rest > 0) {
      detail.push(`${rest} other ${plural(rest, "thing", "things")} ${plural(rest, "is", "are")} further out.`);
    }
    return { tone: "urgent", headline, detail, leading, counts };
  }

  // --- The ordinary week ----------------------------------------------------
  const thisWeek = counts.dueThisWeek;
  if (thisWeek > 0) {
    const headline = `${thisWeek} ${plural(thisWeek, "thing needs", "things need")} you this week.`;
    const next = loops.find((loop) => loop.dueAt && daysUntil(loop.dueAt, now) <= 7)!;
    detail.push(`The nearest is ${refer(next)}, ${whenPhrase(next, now)}.`);
    if (counts.undated > 0) {
      detail.push(
        `${counts.undated} other ${plural(counts.undated, "thing has", "things have")} no date attached.`,
      );
    }
    return { tone: "steady", headline, detail, leading, counts };
  }

  // --- Open, but nothing pressing ------------------------------------------
  const headline = `${counts.active} open ${plural(counts.active, "loop", "loops")}, none urgent.`;
  detail.push(
    counts.undated === counts.active
      ? "None of them have a deadline attached."
      : "Nothing is due in the next week.",
  );
  return { tone: "steady", headline, detail, leading, counts };
}
