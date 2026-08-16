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
}

export interface IngestSummary {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  bulkFiltered: number;
  cursor: string | null;
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

  const { messages, cursor } = await provider.fetchMessages({
    since: options.since,
    limit: options.limit,
  });

  const summary: IngestSummary = {
    fetched: messages.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    bulkFiltered: 0,
    cursor,
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

  await prisma.syncState.upsert({
    where: { accountId },
    create: { accountId, cursor, lastSyncedAt: new Date(), lastFullSyncAt: new Date() },
    update: { cursor, lastSyncedAt: new Date(), lastError: null },
  });

  log.info("ingest complete", { userId, accountId, ...summary });
  return summary;
}
