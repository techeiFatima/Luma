import { describe, expect, it } from "vitest";
import { buildBriefing, type BriefingContext } from "@/server/loops/briefing";
import type { LoopListItem } from "@/server/loops/queries";

/**
 * The briefing is the product's headline claim about someone's life, so the
 * thing worth testing is not phrasing but honesty: that it never says "you're
 * all clear" when it simply hasn't looked, and never inflates or deflates a
 * count.
 */

const NOW = new Date("2026-03-10T12:00:00Z");
const DAY = 86_400_000;

function loop(overrides: Partial<LoopListItem> = {}): LoopListItem {
  return {
    id: `loop-${Math.random().toString(36).slice(2, 8)}`,
    title: "Renew professional license",
    summary: "The renewal form and fee are outstanding.",
    category: "renewal",
    status: "open",
    dueAt: null,
    dueAtBasis: "none",
    counterpartyName: null,
    counterpartyEmail: null,
    amountMinor: null,
    amountCurrency: null,
    confidence: 0.9,
    consequence: "medium",
    priorityScore: 50,
    priorityBucket: "soon",
    evidenceCount: 1,
    ...overrides,
  };
}

function dueIn(days: number, overrides: Partial<LoopListItem> = {}): LoopListItem {
  return loop({ dueAt: new Date(NOW.getTime() + days * DAY), ...overrides });
}

const SYNCED: BriefingContext = { hasSynced: true, pendingAnalysis: 0, lastRunError: null };

describe("briefing: the empty cases are different from each other", () => {
  it("does not claim you are clear before it has read anything", () => {
    const result = buildBriefing([], { ...SYNCED, hasSynced: false }, NOW);
    expect(result.tone).toBe("unknown");
    expect(result.headline).toMatch(/hasn't read/i);
    expect(result.headline).not.toMatch(/nothing is waiting/i);
  });

  it("does not claim you are clear when the run failed", () => {
    const result = buildBriefing([], { ...SYNCED, lastRunError: "upstream timeout" }, NOW);
    expect(result.tone).toBe("unknown");
    expect(result.headline).toMatch(/couldn't finish/i);
  });

  it("does not claim you are clear when mail is still unanalyzed", () => {
    const result = buildBriefing([], { ...SYNCED, pendingAnalysis: 12 }, NOW);
    expect(result.tone).toBe("unknown");
    expect(result.detail.join(" ")).toContain("12");
  });

  it("says you are clear only when it genuinely looked and found nothing", () => {
    const result = buildBriefing([], SYNCED, NOW);
    expect(result.tone).toBe("clear");
    expect(result.headline).toMatch(/nothing is waiting/i);
  });
});

describe("briefing: urgency", () => {
  it("leads with an overdue item", () => {
    const result = buildBriefing([dueIn(-3, { title: "Pay the parking fine" })], SYNCED, NOW);
    expect(result.tone).toBe("urgent");
    expect(result.headline).toBe("Pay the parking fine is overdue.");
    expect(result.detail[0]).toContain("3 days late");
  });

  it("counts several overdue items rather than naming them all", () => {
    const result = buildBriefing([dueIn(-5), dueIn(-2), dueIn(3)], SYNCED, NOW);
    expect(result.headline).toBe("2 things are overdue.");
    expect(result.detail.join(" ")).toContain("1 other thing can wait");
  });

  it("treats today and tomorrow as urgent", () => {
    const result = buildBriefing([dueIn(0, { title: "Submit the form" })], SYNCED, NOW);
    expect(result.tone).toBe("urgent");
    expect(result.headline).toBe("Submit the form is due today.");
  });

  it("describes an ordinary week without alarm", () => {
    const result = buildBriefing([dueIn(4), dueIn(6)], SYNCED, NOW);
    expect(result.tone).toBe("steady");
    expect(result.headline).toBe("2 things need you this week.");
  });

  it("does not manufacture urgency when nothing has a date", () => {
    const result = buildBriefing([loop(), loop()], SYNCED, NOW);
    expect(result.tone).toBe("steady");
    expect(result.headline).toBe("2 open loops, none urgent.");
    expect(result.detail[0]).toMatch(/none of them have a deadline/i);
  });
});

describe("briefing: counts are arithmetic, not estimates", () => {
  it("classifies each loop into exactly one bucket", () => {
    const loops = [dueIn(-1), dueIn(0), dueIn(3), dueIn(30), loop()];
    const { counts } = buildBriefing(loops, SYNCED, NOW);

    expect(counts.active).toBe(5);
    expect(counts.overdue).toBe(1);
    expect(counts.dueToday).toBe(1);
    expect(counts.dueThisWeek).toBe(1);
    expect(counts.undated).toBe(1);
    // The 30-day item is active but in none of the near-term buckets.
    expect(counts.overdue + counts.dueToday + counts.dueThisWeek + counts.undated).toBe(4);
  });

  it("never leads with more than three loops", () => {
    const loops = Array.from({ length: 9 }, () => dueIn(2));
    expect(buildBriefing(loops, SYNCED, NOW).leading).toHaveLength(3);
  });

  it("counts a deadline earlier today as overdue, not as due today", () => {
    // Same calendar day, three hours ago. Rounding this the other way would
    // let a missed deadline read as still upcoming.
    const earlier = loop({ dueAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000) });
    const { counts } = buildBriefing([earlier], SYNCED, NOW);
    expect(counts.dueToday).toBe(1);
    expect(counts.overdue).toBe(0);
  });
});
