import type { calendar_v3 } from "googleapis";
import { describe, expect, it } from "vitest";
import {
  GoogleCalendarProvider,
  normalizeCalendarEvent,
  type CalendarApi,
} from "@/server/providers/google/calendar";
import { classifyMessage } from "@/server/ingest/prefilter";

/**
 * Calendar is context, not a second inbox. These tests pin the two properties
 * that follow from that: events must survive the prefilter (the user put them
 * on their own calendar, so relevance is not in question), and they must render
 * as quotable prose, because verification checks every stored quote against
 * this text.
 */

const NOW = new Date("2026-03-10T12:00:00Z");

function event(overrides: Partial<calendar_v3.Schema$Event> = {}): calendar_v3.Schema$Event {
  return {
    id: "evt-1",
    status: "confirmed",
    summary: "Dentist — Ridgeline Dental",
    start: { dateTime: "2026-03-14T09:30:00Z" },
    location: "220 Oak Street",
    organizer: { displayName: "Ridgeline Dental", email: "appointments@ridgeline.example.com" },
    description: "New patients must complete the medical history form before the visit.",
    ...overrides,
  };
}

class FakeCalendar implements CalendarApi {
  readonly listed: unknown[] = [];
  constructor(
    private readonly pages: { items: calendar_v3.Schema$Event[]; nextPageToken?: string }[] = [],
  ) {}

  calendarList = {
    list: async () => ({ data: { items: [{ id: "you@example.com", primary: true }] } }),
  };

  events = {
    list: async (params: { pageToken?: string }) => {
      this.listed.push(params);
      const index = params.pageToken ? Number(params.pageToken) : 0;
      const page = this.pages[index];
      if (!page) return { data: {} };
      return {
        data: {
          items: page.items,
          ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
        },
      };
    },
  };
}

const NO_WAIT = { sleep: async () => {}, random: () => 0.5 };

describe("normalizeCalendarEvent", () => {
  it("renders an event as prose that can be quoted as evidence", () => {
    const normalized = normalizeCalendarEvent(event(), "you@example.com")!;

    expect(normalized.subject).toBe("Dentist — Ridgeline Dental");
    expect(normalized.externalId).toBe("event:evt-1");
    // The description has to survive verbatim: verification rejects any loop
    // whose quote is not an exact substring of this body.
    expect(normalized.bodyText).toContain(
      "New patients must complete the medical history form before the visit.",
    );
    expect(normalized.bodyText).toContain("When: 2026-03-14 09:30");
    expect(normalized.bodyText).toContain("Location: 220 Oak Street");
  });

  it("uses the start time as the document date, not the creation time", () => {
    const normalized = normalizeCalendarEvent(event(), "you@example.com")!;
    expect(normalized.sentAt.toISOString()).toBe("2026-03-14T09:30:00.000Z");
  });

  it("marks an all-day event so a time is not invented for it", () => {
    const normalized = normalizeCalendarEvent(
      event({ start: { date: "2026-03-14" } }),
      "you@example.com",
    )!;
    expect(normalized.labels).toContain("ALL_DAY");
    expect(normalized.bodyText).toContain("(all day)");
    expect(normalized.bodyText).not.toMatch(/When: 2026-03-14 \d\d:\d\d/);
  });

  it("skips an event with no start at all", () => {
    expect(normalizeCalendarEvent(event({ start: undefined }), "you@example.com")).toBeNull();
  });
});

describe("calendar events and the prefilter", () => {
  it("never discards a calendar event as bulk", () => {
    // The user put it on their own calendar. No heuristic should second-guess
    // that — and the automated-sender rule would once have dropped it.
    const normalized = normalizeCalendarEvent(
      event({ organizer: { email: "noreply@calendar.example.com" } }),
      "you@example.com",
    )!;
    expect(classifyMessage(normalized).isBulk).toBe(false);
  });
});

describe("GoogleCalendarProvider", () => {
  it("expands recurring events and asks for a bounded window", async () => {
    const calendar = new FakeCalendar([{ items: [event()] }]);
    await new GoogleCalendarProvider(calendar, NO_WAIT).fetchEvents({ now: NOW });

    const params = calendar.listed[0] as Record<string, unknown>;
    expect(params.singleEvents).toBe(true);
    expect(params.orderBy).toBe("startTime");
    expect(params.calendarId).toBe("primary");
    expect(typeof params.timeMin).toBe("string");
    expect(typeof params.timeMax).toBe("string");
  });

  it("looks slightly backwards as well as forwards", async () => {
    // A meeting that happened yesterday can still leave an obligation.
    const calendar = new FakeCalendar([{ items: [event()] }]);
    await new GoogleCalendarProvider(calendar, NO_WAIT).fetchEvents({ now: NOW });
    const { timeMin } = calendar.listed[0] as { timeMin: string };
    expect(new Date(timeMin).getTime()).toBeLessThan(NOW.getTime());
  });

  it("drops events the user declined", async () => {
    const declined = event({
      id: "evt-2",
      attendees: [{ self: true, responseStatus: "declined" }],
    });
    const calendar = new FakeCalendar([{ items: [event(), declined] }]);
    const events = await new GoogleCalendarProvider(calendar, NO_WAIT).fetchEvents({ now: NOW });

    expect(events.map((e) => e.externalId)).toEqual(["event:evt-1"]);
  });

  it("keeps an invitation the user has not answered yet", async () => {
    // Not responding is itself a thing people forget to do.
    const pending = event({ id: "evt-3", attendees: [{ self: true, responseStatus: "needsAction" }] });
    const calendar = new FakeCalendar([{ items: [pending] }]);
    const events = await new GoogleCalendarProvider(calendar, NO_WAIT).fetchEvents({ now: NOW });

    expect(events).toHaveLength(1);
  });

  it("drops cancelled events", async () => {
    const calendar = new FakeCalendar([{ items: [event({ status: "cancelled" })] }]);
    expect(await new GoogleCalendarProvider(calendar, NO_WAIT).fetchEvents({ now: NOW })).toEqual([]);
  });

  it("pages through results and stops at the limit", async () => {
    const calendar = new FakeCalendar([
      { items: [event({ id: "a" }), event({ id: "b" })], nextPageToken: "1" },
      { items: [event({ id: "c" })] },
    ]);
    const events = await new GoogleCalendarProvider(calendar, NO_WAIT).fetchEvents({
      now: NOW,
      limit: 2,
    });
    expect(events).toHaveLength(2);
  });
});
