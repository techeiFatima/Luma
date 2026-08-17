import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  nextDeliverableTime,
  planNotifications,
  qualifies,
} from "@/server/domain/notifier";
import type { LoopListItem } from "@/server/loops/queries";

/**
 * These tests are mostly about what Luma refuses to send.
 *
 * Anyone can make a notifier fire. The property worth defending is that it
 * stays quiet — for uncertain extractions, for low-stakes items, at 3am, and
 * for anything it has already said once. A regression in any of those turns a
 * useful assistant into an app people mute.
 */

const NOW = new Date("2026-03-10T12:00:00Z"); // midday UTC
const HOUR = 3_600_000;

function loop(overrides: Partial<LoopListItem> = {}): LoopListItem {
  return {
    id: "loop-1",
    title: "Renew professional license",
    summary: "The renewal form and fee are outstanding.",
    category: "renewal",
    status: "open",
    dueAt: new Date(NOW.getTime() + 12 * HOUR),
    dueAtBasis: "explicit",
    counterpartyName: null,
    counterpartyEmail: null,
    amountMinor: null,
    amountCurrency: null,
    confidence: 0.9,
    consequence: "high",
    priorityScore: 80,
    priorityBucket: "now",
    evidenceCount: 1,
    ...overrides,
  };
}

function plan(loops: LoopListItem[], overrides: Partial<Parameters<typeof planNotifications>[0]> = {}) {
  return planNotifications({
    loops,
    existingKeys: new Set(),
    sentInLastDay: 0,
    now: NOW,
    ...overrides,
  });
}

describe("what does not justify an interruption", () => {
  it("stays quiet when the extraction was not confident", () => {
    expect(qualifies(loop({ confidence: 0.6 }), DEFAULT_POLICY, NOW)).toBeNull();
  });

  it("stays quiet about low-consequence items", () => {
    expect(qualifies(loop({ consequence: "low" }), DEFAULT_POLICY, NOW)).toBeNull();
  });

  it("stays quiet when there is no deadline to be late for", () => {
    expect(qualifies(loop({ dueAt: null }), DEFAULT_POLICY, NOW)).toBeNull();
  });

  it("stays quiet about a deadline that is still far away", () => {
    const far = loop({ dueAt: new Date(NOW.getTime() + 20 * 24 * HOUR) });
    expect(qualifies(far, DEFAULT_POLICY, NOW)).toBeNull();
  });

  it("stays quiet about a loop the user already resolved", () => {
    expect(qualifies(loop({ status: "done" }), DEFAULT_POLICY, NOW)).toBeNull();
  });

  it("does not repeat itself", () => {
    const first = plan([loop()]);
    expect(first).toHaveLength(1);

    const second = plan([loop()], { existingKeys: new Set([first[0]!.dedupeKey]) });
    expect(second).toEqual([]);
  });

  it("respects the daily ceiling", () => {
    expect(plan([loop()], { sentInLastDay: DEFAULT_POLICY.maxPerDay })).toEqual([]);
  });
});

describe("what does justify one", () => {
  it("speaks up about a close deadline", () => {
    const planned = plan([loop()]);
    expect(planned).toHaveLength(1);
    expect(planned[0]!.trigger).toBe("due_soon");
    expect(planned[0]!.title).toContain("Renew professional license");
  });

  it("speaks up about something already missed, whatever its score", () => {
    // Overdue bypasses the priority floor: a missed deadline is the case this
    // product exists for.
    const missed = loop({ dueAt: new Date(NOW.getTime() - 30 * HOUR), priorityScore: 10 });
    const verdict = qualifies(missed, DEFAULT_POLICY, NOW);
    expect(verdict?.trigger).toBe("overdue");
  });

  it("distinguishes overdue from due-soon in the dedupe key", () => {
    // The same loop may legitimately notify twice: once as it approaches, once
    // when it passes. These must not collide.
    const soon = plan([loop()])[0]!;
    const late = plan([loop({ dueAt: new Date(NOW.getTime() - HOUR) })])[0]!;
    expect(soon.dedupeKey).not.toBe(late.dedupeKey);
  });
});

describe("several at once become one message", () => {
  const many = [
    loop({ id: "a", title: "Renew licence", priorityScore: 90 }),
    loop({ id: "b", title: "Pay invoice", priorityScore: 80 }),
    loop({ id: "c", title: "Submit form", priorityScore: 70 }),
  ];

  it("collapses a burst into a digest", () => {
    const planned = plan(many);
    expect(planned).toHaveLength(1);
    expect(planned[0]!.trigger).toBe("digest");
    expect(planned[0]!.title).toBe("3 things need you");
  });

  it("leads the digest with the most urgent item", () => {
    expect(plan(many)[0]!.body).toContain("Renew licence");
  });

  it("does not send a second digest the same day", () => {
    const first = plan(many)[0]!;
    expect(plan(many, { existingKeys: new Set([first.dedupeKey]) })).toEqual([]);
  });

  it("names them individually when there are only a couple", () => {
    const planned = plan(many.slice(0, 2));
    expect(planned).toHaveLength(2);
    expect(planned.every((n) => n.trigger !== "digest")).toBe(true);
  });
});

describe("quiet hours", () => {
  const policy = { ...DEFAULT_POLICY, quietFromHour: 21, quietUntilHour: 8 };

  it("delivers immediately during the day", () => {
    const midday = new Date("2026-03-10T12:00:00Z");
    expect(nextDeliverableTime(midday, policy).getTime()).toBe(midday.getTime());
  });

  it("holds a late-night notification until morning", () => {
    const lateNight = new Date("2026-03-10T23:30:00Z");
    const when = nextDeliverableTime(lateNight, policy);
    expect(when.toISOString()).toBe("2026-03-11T08:00:00.000Z");
  });

  it("holds an early-morning notification until the same morning", () => {
    const preDawn = new Date("2026-03-10T03:00:00Z");
    expect(nextDeliverableTime(preDawn, policy).toISOString()).toBe("2026-03-10T08:00:00.000Z");
  });

  it("delays rather than drops, so nothing urgent is lost overnight", () => {
    const lateNight = new Date("2026-03-10T23:30:00Z");
    const planned = planNotifications({
      loops: [loop()],
      existingKeys: new Set(),
      sentInLastDay: 0,
      now: lateNight,
    });
    expect(planned).toHaveLength(1);
    expect(planned[0]!.scheduledFor.getTime()).toBeGreaterThan(lateNight.getTime());
  });

  it("honours the user's timezone rather than the server's", () => {
    // 23:30 UTC is 18:30 in New York — a perfectly reasonable time to notify.
    const evening = new Date("2026-03-10T23:30:00Z");
    const newYork = { ...policy, utcOffsetMinutes: -5 * 60 };
    expect(nextDeliverableTime(evening, newYork).getTime()).toBe(evening.getTime());
  });
});
