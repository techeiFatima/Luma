import { google, type calendar_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { logger } from "@/lib/logger";
import { DAY_MS } from "@/lib/time";
import { withGmailRetry, type RetryOptions } from "../gmail/retry";
import type { NormalizedMessage } from "../types";

const log = logger("google.calendar");

/**
 * Calendar as context, not as a second inbox.
 *
 * Luma does not turn every meeting into an Open Loop — a calendar full of
 * meetings is not a list of things you are forgetting, and treating it as one
 * would bury the handful of items that matter. What the calendar is genuinely
 * good for is answering two questions the mail alone cannot:
 *
 *   1. Does this appointment need preparation? ("bring your passport",
 *      "complete the form before your visit")
 *   2. Is a deadline the mail mentioned already on the calendar, meaning the
 *      user has visibly dealt with it?
 *
 * So events flow through the same `NormalizedMessage` shape as email and land
 * in the same context window. The model sees an appointment next to the mail
 * that discusses it, which is the whole point: an email saying "bring the form
 * to your appointment" only becomes actionable when you know when the
 * appointment is.
 */

/** How far ahead to look. Beyond this, preparation isn't urgent yet. */
const DEFAULT_HORIZON_DAYS = 21;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

/** The slice of the Calendar API used here, declared so tests can supply it. */
export interface CalendarApi {
  events: {
    list(params: {
      calendarId: string;
      timeMin?: string;
      timeMax?: string;
      singleEvents?: boolean;
      orderBy?: string;
      maxResults?: number;
      pageToken?: string;
      showDeleted?: boolean;
    }): Promise<{ data: calendar_v3.Schema$Events }>;
  };
  calendarList: {
    list(params: { maxResults?: number }): Promise<{ data: calendar_v3.Schema$CalendarList }>;
  };
}

export interface CalendarFetchOptions {
  now?: Date;
  horizonDays?: number;
  limit?: number;
}

/**
 * An event the user declined is not their obligation, and one they have not
 * answered is a decision they may well be forgetting — but it is the organizer's
 * meeting either way, so only declines are excluded outright.
 */
function isDeclined(event: calendar_v3.Schema$Event): boolean {
  return (event.attendees ?? []).some(
    (attendee) => attendee.self === true && attendee.responseStatus === "declined",
  );
}

function eventStart(event: calendar_v3.Schema$Event): Date | null {
  const raw = event.start?.dateTime ?? event.start?.date;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Renders an event as the kind of document the extractor already understands.
 *
 * The body is written as prose rather than a field dump because that is what
 * the rest of the pipeline quotes from: verification checks that every stored
 * quote appears verbatim in this text, so it has to read like something worth
 * quoting.
 */
export function normalizeCalendarEvent(
  event: calendar_v3.Schema$Event,
  calendarEmail: string,
): NormalizedMessage | null {
  if (!event.id) return null;
  const start = eventStart(event);
  if (!start) return null;

  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  const when = allDay
    ? start.toISOString().slice(0, 10)
    : start.toISOString().replace("T", " ").slice(0, 16);

  const lines = [`Event: ${event.summary ?? "(no title)"}`, `When: ${when}${allDay ? " (all day)" : ""}`];
  if (event.location) lines.push(`Location: ${event.location}`);
  const organizer = event.organizer?.displayName ?? event.organizer?.email;
  if (organizer) lines.push(`Organizer: ${organizer}`);
  const guests = (event.attendees ?? []).filter((a) => !a.self).length;
  if (guests > 0) lines.push(`Guests: ${guests}`);
  if (event.description) lines.push("", event.description.trim());

  return {
    externalId: `event:${event.id}`,
    threadExternalId: event.recurringEventId ?? null,
    subject: event.summary ?? "(no title)",
    fromName: event.organizer?.displayName ?? "Calendar",
    fromEmail: event.organizer?.email ?? calendarEmail,
    toEmails: [calendarEmail],
    sentAt: start,
    snippet: event.description?.slice(0, 160).replace(/\s+/g, " ").trim() ?? null,
    bodyText: lines.join("\n"),
    headers: {},
    // Marks the document's origin for the prompt and the prefilter alike.
    labels: ["CALENDAR", allDay ? "ALL_DAY" : "TIMED"],
  };
}

export class GoogleCalendarProvider {
  readonly id = "google_calendar";

  constructor(
    private readonly calendar: CalendarApi,
    private readonly retry: RetryOptions = {},
  ) {}

  static forAuth(auth: OAuth2Client, retry: RetryOptions = {}): GoogleCalendarProvider {
    return new GoogleCalendarProvider(
      google.calendar({ version: "v3", auth }) as unknown as CalendarApi,
      retry,
    );
  }

  async describe(): Promise<{ accountId: string; email: string }> {
    const list = await withGmailRetry(
      "calendarList.list",
      () => this.calendar.calendarList.list({ maxResults: 10 }),
      this.retry,
    );
    const primary = (list.data.items ?? []).find((item) => item.primary) ?? list.data.items?.[0];
    const email = primary?.id ?? "unknown";
    return { accountId: email, email };
  }

  /**
   * Upcoming events, plus a short look backwards.
   *
   * The backward window matters: an appointment that happened yesterday can
   * still leave an obligation ("bring the signed form to your next visit"), and
   * a deadline that just passed is exactly what the user wants to be told about.
   */
  async fetchEvents(options: CalendarFetchOptions = {}): Promise<NormalizedMessage[]> {
    const now = options.now ?? new Date();
    const horizon = options.horizonDays ?? DEFAULT_HORIZON_DAYS;
    const limit = options.limit ?? 100;

    const { email } = await this.describe();

    const messages: NormalizedMessage[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES && messages.length < limit; page += 1) {
      const response = await withGmailRetry(
        "events.list",
        () =>
          this.calendar.events.list({
            calendarId: "primary",
            timeMin: new Date(now.getTime() - 2 * DAY_MS).toISOString(),
            timeMax: new Date(now.getTime() + horizon * DAY_MS).toISOString(),
            // Expands recurring events into concrete instances, so "every
            // Tuesday" becomes the specific Tuesday that needs preparing for.
            singleEvents: true,
            orderBy: "startTime",
            maxResults: Math.min(PAGE_SIZE, limit - messages.length),
            showDeleted: false,
            ...(pageToken ? { pageToken } : {}),
          }),
        this.retry,
      );

      const items = response.data.items ?? [];
      for (const event of items) {
        if (event.status === "cancelled" || isDeclined(event)) continue;
        const normalized = normalizeCalendarEvent(event, email);
        if (normalized) messages.push(normalized);
      }

      pageToken = response.data.nextPageToken ?? undefined;
      if (!pageToken || items.length === 0) break;
    }

    log.info("fetched calendar events", { count: messages.length, horizonDays: horizon });
    return messages.slice(0, limit);
  }
}
