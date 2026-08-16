import { contentHash } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { MailProvider } from "../providers/types";
import { classifyMessage } from "./prefilter";

const log = logger("ingest");

export interface IngestOptions {
  userId: string;
  accountId: string;
  provider: MailProvider;
  since?: Date;
  limit?: number;
  /** Provider cursor from the last sync; enables an incremental fetch. */
  cursor?: string | null;
}

export interface IngestSummary {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  bulkFiltered: number;
  cursor: string | null;
  /** False when the provider served a delta rather than re-reading the window. */
  full: boolean;
}

/**
 * Pulls messages from a provider and stores them as SourceItems.
 *
 * Idempotent by construction: `(accountId, externalId)` is unique, and a
 * document whose contentHash is unchanged is left completely alone — including
 * its `processedAt` stamp, so re-running a sync never re-extracts work we have
 * already paid for.
 */
export async function ingestMessages(options: IngestOptions): Promise<IngestSummary> {
  const { userId, accountId, provider } = options;

  const { messages, cursor, full } = await provider.fetchMessages({
    since: options.since,
    limit: options.limit,
    cursor: options.cursor,
  });

  const summary: IngestSummary = {
    fetched: messages.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    bulkFiltered: 0,
    cursor,
    full,
  };

  for (const message of messages) {
    const classification = classifyMessage(message);
    if (classification.isBulk) summary.bulkFiltered += 1;

    const hash = contentHash(
      message.subject,
      message.bodyText,
      message.fromEmail,
      message.sentAt.toISOString(),
    );

    const existing = await prisma.sourceItem.findUnique({
      where: { accountId_externalId: { accountId, externalId: message.externalId } },
      select: { id: true, contentHash: true },
    });

    if (existing?.contentHash === hash) {
      summary.unchanged += 1;
      continue;
    }

    const data = {
      userId,
      accountId,
      provider: provider.id,
      kind: "email",
      externalId: message.externalId,
      threadExternalId: message.threadExternalId,
      subject: message.subject,
      fromName: message.fromName,
      fromEmail: message.fromEmail,
      toEmails: JSON.stringify(message.toEmails),
      sentAt: message.sentAt,
      snippet: message.snippet,
      bodyText: message.bodyText,
      isBulk: classification.isBulk,
      contentHash: hash,
      // Content changed, so this document needs extraction again.
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

  // The cursor is only advanced once every message it covers is stored, so a
  // crash mid-ingest leaves the old cursor in place and the next sync re-reads
  // the same window rather than skipping it.
  const syncedAt = new Date();
  await prisma.syncState.upsert({
    where: { accountId },
    create: {
      accountId,
      cursor,
      lastSyncedAt: syncedAt,
      ...(full ? { lastFullSyncAt: syncedAt } : {}),
    },
    update: {
      cursor,
      lastSyncedAt: syncedAt,
      lastError: null,
      ...(full ? { lastFullSyncAt: syncedAt } : {}),
    },
  });

  log.info("ingest complete", { userId, accountId, ...summary });
  return summary;
}
