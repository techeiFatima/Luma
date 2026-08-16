import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AnthropicLoopExtractor, type ExtractionDocument, type LoopExtractor } from "../ai/extract";
import { ingestMessages, type IngestSummary } from "../ingest/pipeline";
import type { MailProvider } from "../providers/types";
import { dedupeWithinBatch } from "../loops/dedupe";
import { persistLoops, rescoreOpenLoops } from "../loops/persist";
import { verifyCandidate, type RejectionReason, type SourceText, type VerifiedLoop } from "../loops/verify";

const log = logger("pipeline");

export interface PipelineOptions {
  userId: string;
  accountId: string;
  provider: MailProvider;
  extractor?: LoopExtractor;
  since?: Date;
  limit?: number;
  now?: Date;
}

export interface PipelineSummary {
  ingest: IngestSummary;
  documentsExtracted: number;
  candidatesProposed: number;
  candidatesAccepted: number;
  rejections: Record<RejectionReason, number>;
  loopsCreated: number;
  loopsUpdated: number;
  batchFailures: number;
}

const EMPTY_REJECTIONS = (): Record<RejectionReason, number> => ({
  not_user_action: 0,
  low_confidence: 0,
  no_verified_evidence: 0,
  unknown_source: 0,
});

/**
 * The full path from provider to prioritized dashboard:
 *
 *   ingest -> prefilter -> extract (LLM) -> verify -> dedupe -> persist -> score
 *
 * Only one of those stages is a model call. Everything before it decides what
 * is worth spending a model on, and everything after it decides what the model
 * is allowed to turn into application state.
 */
export async function runPipeline(options: PipelineOptions): Promise<PipelineSummary> {
  const now = options.now ?? new Date();
  const extractor = options.extractor ?? new AnthropicLoopExtractor();

  const ingest = await ingestMessages({
    userId: options.userId,
    accountId: options.accountId,
    provider: options.provider,
    since: options.since,
    limit: options.limit,
  });

  // Only unprocessed, non-bulk documents reach the model.
  const pending = await prisma.sourceDocument.findMany({
    where: { userId: options.userId, accountId: options.accountId, isBulk: false, processedAt: null },
    orderBy: { sentAt: "desc" },
    take: 200,
  });

  const summary: PipelineSummary = {
    ingest,
    documentsExtracted: pending.length,
    candidatesProposed: 0,
    candidatesAccepted: 0,
    rejections: EMPTY_REJECTIONS(),
    loopsCreated: 0,
    loopsUpdated: 0,
    batchFailures: 0,
  };

  if (pending.length === 0) {
    await rescoreOpenLoops(options.userId, now);
    log.info("nothing new to extract", { userId: options.userId });
    return summary;
  }

  const documents: ExtractionDocument[] = pending.map((document) => ({
    sourceId: document.id,
    threadKey: document.threadExternalId ?? document.id,
    subject: document.subject,
    fromName: document.fromName,
    fromEmail: document.fromEmail,
    sentAt: document.sentAt,
    bodyText: document.bodyText,
  }));

  const sources = new Map<string, SourceText>(
    pending.map((document) => [
      document.id,
      { id: document.id, subject: document.subject, bodyText: document.bodyText },
    ]),
  );

  const batches = await extractor.extract(options.userId, documents, now);

  const verified: VerifiedLoop[] = [];
  for (const batch of batches) {
    if (batch.failure) summary.batchFailures += 1;
    summary.candidatesProposed += batch.candidates.length;

    for (const candidate of batch.candidates) {
      const outcome = verifyCandidate(candidate, sources);
      if (outcome.notes.length > 0) {
        log.debug("verification notes", { title: candidate.title, notes: outcome.notes });
      }
      if (outcome.loop) {
        verified.push(outcome.loop);
        summary.candidatesAccepted += 1;
      } else if (outcome.rejection) {
        summary.rejections[outcome.rejection] += 1;
      }
    }

    // Mark documents processed even when a batch yielded nothing — "no open
    // loops here" is a real answer and re-running it would just cost money.
    // A failed batch is left unprocessed so the next sync retries it.
    if (!batch.failure) {
      await prisma.sourceDocument.updateMany({
        where: { id: { in: batch.documentIds } },
        data: { processedAt: now },
      });
    }
  }

  const collapsed = dedupeWithinBatch(verified);
  const persisted = await persistLoops(options.userId, collapsed, now);
  summary.loopsCreated = persisted.created;
  summary.loopsUpdated = persisted.updated;

  await rescoreOpenLoops(options.userId, now);

  log.info("pipeline complete", {
    userId: options.userId,
    proposed: summary.candidatesProposed,
    accepted: summary.candidatesAccepted,
    created: summary.loopsCreated,
    updated: summary.loopsUpdated,
    rejections: summary.rejections,
  });

  return summary;
}
