import { describe, expect, it } from "vitest";
import { compareLoops, scoreLoop, stalenessBoost, urgencyFromDueDate } from "@/server/loops/priority";
import { DAY_MS } from "@/lib/time";

const NOW = new Date("2026-03-01T12:00:00Z");
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

describe("urgencyFromDueDate", () => {
  it("has no urgency without a date", () => {
    expect(urgencyFromDueDate(null, NOW)).toBe(0);
  });

  it("decreases monotonically as the deadline recedes", () => {
    const values = [0, 1, 3, 7, 14, 30, 90].map((d) => urgencyFromDueDate(inDays(d), NOW));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeLessThanOrEqual(values[i - 1]!);
    }
  });

  it("treats an overdue item as maximally urgent", () => {
    expect(urgencyFromDueDate(inDays(-2), NOW)).toBe(1);
  });

  it("discounts items that are long overdue as probably stale", () => {
    expect(urgencyFromDueDate(inDays(-60), NOW)).toBeLessThan(urgencyFromDueDate(inDays(-2), NOW));
  });
});

describe("stalenessBoost", () => {
  it("does not apply to items that have a deadline", () => {
    expect(stalenessBoost(inDays(-30), inDays(5), NOW)).toBe(0);
  });

  it("grows as a dateless item ages", () => {
    expect(stalenessBoost(inDays(-1), null, NOW)).toBe(0);
    expect(stalenessBoost(inDays(-5), null, NOW)).toBeGreaterThan(0);
    expect(stalenessBoost(inDays(-30), null, NOW)).toBeGreaterThan(
      stalenessBoost(inDays(-5), null, NOW),
    );
  });
});

describe("scoreLoop", () => {
  it("puts an overdue high-consequence deadline in the 'now' bucket", () => {
    const result = scoreLoop(
      {
        category: "deadline",
        dueAt: inDays(-1),
        consequence: "high",
        confidence: 0.95,
        firstSeenAt: inDays(-3),
      },
      NOW,
    );
    expect(result.bucket).toBe("now");
    expect(result.explanation).toContain("overdue");
  });

  it("puts a dateless low-consequence reply in the 'later' bucket", () => {
    const result = scoreLoop(
      {
        category: "unanswered_email",
        dueAt: null,
        consequence: "low",
        confidence: 0.7,
        firstSeenAt: inDays(-1),
      },
      NOW,
    );
    expect(result.bucket).toBe("later");
  });

  it("ranks a hard deadline above a vague follow-up", () => {
    const deadline = scoreLoop(
      { category: "deadline", dueAt: inDays(2), consequence: "high", confidence: 0.9, firstSeenAt: NOW },
      NOW,
    );
    const followUp = scoreLoop(
      { category: "follow_up", dueAt: null, consequence: "low", confidence: 0.9, firstSeenAt: NOW },
      NOW,
    );
    expect(deadline.score).toBeGreaterThan(followUp.score);
  });

  it("dampens but does not erase a lower-confidence high-stakes loop", () => {
    const confident = scoreLoop(
      { category: "renewal", dueAt: inDays(3), consequence: "high", confidence: 0.95, firstSeenAt: NOW },
      NOW,
    );
    const unsure = scoreLoop(
      { category: "renewal", dueAt: inDays(3), consequence: "high", confidence: 0.6, firstSeenAt: NOW },
      NOW,
    );
    expect(unsure.score).toBeLessThan(confident.score);

    const trivialButCertain = scoreLoop(
      { category: "other", dueAt: null, consequence: "low", confidence: 1, firstSeenAt: NOW },
      NOW,
    );
    expect(unsure.score).toBeGreaterThan(trivialButCertain.score);
  });

  it("keeps scores within 0-100", () => {
    const max = scoreLoop(
      { category: "deadline", dueAt: inDays(-1), consequence: "high", confidence: 1, firstSeenAt: inDays(-90) },
      NOW,
    );
    const min = scoreLoop(
      { category: "other", dueAt: inDays(365), consequence: "low", confidence: 0, firstSeenAt: NOW },
      NOW,
    );
    expect(max.score).toBeLessThanOrEqual(100);
    expect(min.score).toBeGreaterThanOrEqual(0);
  });
});

describe("compareLoops", () => {
  it("sorts by score, then by the sooner deadline", () => {
    const loops = [
      { priorityScore: 50, dueAt: inDays(10) },
      { priorityScore: 80, dueAt: null },
      { priorityScore: 50, dueAt: inDays(2) },
    ];
    const sorted = [...loops].sort(compareLoops);
    expect(sorted[0]!.priorityScore).toBe(80);
    expect(sorted[1]!.dueAt).toEqual(inDays(2));
  });

  it("puts a dated loop ahead of a dateless one at equal score", () => {
    const sorted = [{ priorityScore: 50, dueAt: null }, { priorityScore: 50, dueAt: inDays(4) }].sort(
      compareLoops,
    );
    expect(sorted[0]!.dueAt).not.toBeNull();
  });
});
