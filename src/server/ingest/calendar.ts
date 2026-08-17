import { contentHash } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { NormalizedMessage } from "../providers/types";

const log = logger("ingest.calendar");

export interface CalendarIngestSummary {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
}

/**
 * Stores calendar events as source items.
 *
 * Deliberately the same table and the same idempotency rules as email. An
 * event and the email discussing it are two documents about one obligation, and
 * keeping them in one place is what lets deduplication collapse them into a
 * single Open Loop instead of showing the user the same dentist appointment
 * twice.
 *
 * Events are never marked bulk: the user put them on their own calendar, which
 * is a stronger signal of relevance than anything the prefilter could infer.
 */
export async function ingestCalendarEvents(options: {
  userId: string;
  accountId: string;
  events: NormalizedMessage[];
}): Promise<CalendarIngestSummary> {
  const { userId, accountId, events } = options;
  const summary: CalendarIngestSummary = {
    fetched: events.length,
    created: 0,
    updated: 0,
    unchanged: 0,
  };

  for (const event of events) {
    const hash = contentHash(
      event.subject,
      event.bodyText,
      event.fromEmail,
      event.sentAt.toISOString(),
    );

    const existing = await prisma.sourceItem.findUnique({
      where: { accountId_externalId: { accountId, externalId: event.externalId } },
      select: { id: true, contentHash: true },
    });

    if (existing?.contentHash === hash) {
      summary.unchanged += 1;
      continue;
    }

    const data = {
      userId,
      accountId,
      provider: "google_calendar",
      kind: "calendar_event",
      externalId: event.externalId,
      threadExternalId: event.threadExternalId,
      subject: event.subject,
      fromName: event.fromName,
      fromEmail: event.fromEmail,
      toEmails: JSON.stringify(event.toEmails),
      sentAt: event.sentAt,
      snippet: event.snippet,
      bodyText: event.bodyText,
      isBulk: false,
      contentHash: hash,
      // A rescheduled event is new information; it has to be looked at again.
      processedAt: null,
    };

    if (existing) {
      await prisma.sourceItem.update({ where: { id: existing.id }, data });
      summary.updated += 1;
    } else {
      await prisma.sourceItem.create({ data });
      summary.created += 1;
    }
  }

  log.info("calendar ingest complete", { userId, accountId, ...summary });
  return summary;
}
