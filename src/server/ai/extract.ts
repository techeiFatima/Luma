import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { callStructured } from "./anthropic";
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT, type PromptMessage } from "./prompt";
import { extractionJsonSchema, extractionResultSchema, type CandidateLoop } from "./schema";

const log = logger("ai.extract");

export interface ExtractionDocument extends PromptMessage {
  /** SourceDocument.id — the same value the model cites as `source_id`. */
  sourceId: string;
  threadKey: string;
}

export interface ExtractionBatchResult {
  /** Documents that went into this batch, by SourceDocument id. */
  documentIds: string[];
  candidates: CandidateLoop[];
  /** Set when the batch produced nothing usable. */
  failure: string | null;
}

/**
 * The extraction stage, behind an interface.
 *
 * Everything downstream depends on this type rather than on Anthropic, so the
 * model — or the whole approach — can be swapped without touching persistence,
 * dedupe, or prioritization.
 */
export interface LoopExtractor {
  readonly name: string;
  extract(userId: string, documents: ExtractionDocument[], now: Date): Promise<ExtractionBatchResult[]>;
}

/** Roughly 6k tokens of message text per request. */
export const BATCH_CHAR_BUDGET = 24_000;
/** Cap on threads per request, so one batch can't get unwieldy to reason about. */
export const BATCH_THREAD_LIMIT = 6;

/**
 * Groups documents into model requests.
 *
 * Threads are the atomic unit — a thread is one situation, and splitting it
 * across requests would produce a duplicate loop per message. But most inbox
 * threads are a single email, and one API call per email is needlessly slow and
 * expensive, so whole threads are packed together up to a size budget.
 */
export function groupIntoBatches(documents: ExtractionDocument[]): ExtractionDocument[][] {
  const byThread = new Map<string, ExtractionDocument[]>();
  for (const document of documents) {
    const existing = byThread.get(document.threadKey);
    if (existing) existing.push(document);
    else byThread.set(document.threadKey, [document]);
  }

  const threads = [...byThread.values()].map((thread) =>
    [...thread].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime()),
  );

  const batches: ExtractionDocument[][] = [];
  let current: ExtractionDocument[] = [];
  let currentChars = 0;
  let currentThreads = 0;

  for (const thread of threads) {
    const threadChars = thread.reduce((sum, doc) => sum + doc.bodyText.length, 0);
    const wouldOverflow =
      current.length > 0 &&
      (currentChars + threadChars > BATCH_CHAR_BUDGET || currentThreads >= BATCH_THREAD_LIMIT);

    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentChars = 0;
      currentThreads = 0;
    }

    current.push(...thread);
    currentChars += threadChars;
    currentThreads += 1;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

/** Small helper so a slow inbox doesn't turn into a serial crawl. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}

export class AnthropicLoopExtractor implements LoopExtractor {
  readonly name = "anthropic";

  constructor(private readonly concurrency = 3) {}

  async extract(
    userId: string,
    documents: ExtractionDocument[],
    now: Date,
  ): Promise<ExtractionBatchResult[]> {
    const batches = groupIntoBatches(documents);
    log.info("starting extraction", { userId, documents: documents.length, batches: batches.length });

    return mapWithConcurrency(batches, this.concurrency, (batch) =>
      this.extractBatch(userId, batch, now),
    );
  }

  private async extractBatch(
    userId: string,
    batch: ExtractionDocument[],
    now: Date,
  ): Promise<ExtractionBatchResult> {
    const documentIds = batch.map((document) => document.sourceId);
    const baseRun = {
      userId,
      stage: "extract_open_loops",
      promptVersion: PROMPT_VERSION,
      inputDocumentIds: JSON.stringify(documentIds),
    };

    try {
      const result = await callStructured({
        system: SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(batch, now),
        jsonSchema: extractionJsonSchema as unknown as Record<string, unknown>,
      });

      if (!result.text) {
        const reason = result.refusal
          ? `model declined (${result.refusal.category ?? "unspecified"})`
          : `no content returned (stop_reason=${result.stopReason ?? "unknown"})`;
        await prisma.aiRun.create({
          data: {
            ...baseRun,
            model: result.model,
            status: "error",
            error: reason,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: result.latencyMs,
          },
        });
        log.warn("batch produced no output", { reason, documentIds });
        return { documentIds, candidates: [], failure: reason };
      }

      const parsed = extractionResultSchema.safeParse(JSON.parse(result.text));
      if (!parsed.success) {
        await prisma.aiRun.create({
          data: {
            ...baseRun,
            model: result.model,
            status: "invalid_output",
            error: parsed.error.message.slice(0, 2000),
            rawOutput: result.text.slice(0, 20_000),
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: result.latencyMs,
          },
        });
        log.warn("output failed validation", { documentIds });
        return { documentIds, candidates: [], failure: "output failed schema validation" };
      }

      await prisma.aiRun.create({
        data: {
          ...baseRun,
          model: result.model,
          status: "ok",
          rawOutput: result.text.slice(0, 20_000),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs,
          candidatesProposed: parsed.data.loops.length,
        },
      });

      return { documentIds, candidates: parsed.data.loops, failure: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.aiRun.create({
        data: { ...baseRun, model: "unknown", status: "error", error: message.slice(0, 2000) },
      });
      log.error("extraction call failed", { documentIds, error: message });
      return { documentIds, candidates: [], failure: message };
    }
  }
}
