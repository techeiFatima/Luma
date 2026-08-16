import type {
  ExtractionBatchResult,
  ExtractionDocument,
  LoopExtractor,
} from "@/server/ai/extract";

/**
 * Wraps the real extractor and keeps everything it proposed, before the
 * deterministic guards see it.
 *
 * This is what makes failure attribution possible. Comparing raw candidates to
 * persisted loops separates "the model never found it" from "the model found it
 * and verification threw it away" — two failures with completely different
 * fixes that look identical if you only inspect the final output.
 */
export interface RecordedBatch {
  sourceItemIds: string[];
  candidates: ExtractionBatchResult["candidates"];
  failure: string | null;
}

export class RecordingExtractor implements LoopExtractor {
  readonly name: string;
  readonly batches: RecordedBatch[] = [];

  constructor(private readonly inner: LoopExtractor) {
    this.name = `recording(${inner.name})`;
  }

  async extract(
    userId: string,
    documents: ExtractionDocument[],
    now: Date,
  ): Promise<ExtractionBatchResult[]> {
    const results = await this.inner.extract(userId, documents, now);
    for (const result of results) {
      this.batches.push({
        sourceItemIds: result.sourceItemIds,
        candidates: result.candidates,
        failure: result.failure,
      });
    }
    return results;
  }

  get rawCandidateCount(): number {
    return this.batches.reduce((sum, batch) => sum + batch.candidates.length, 0);
  }

  get failedBatchCount(): number {
    return this.batches.filter((batch) => batch.failure !== null).length;
  }
}
