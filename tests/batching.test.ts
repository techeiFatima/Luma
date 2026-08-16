import { describe, expect, it } from "vitest";
import {
  BATCH_CHAR_BUDGET,
  BATCH_THREAD_LIMIT,
  groupIntoBatches,
  type ExtractionDocument,
} from "@/server/ai/extract";

function doc(threadKey: string, id: string, bodyChars = 100): ExtractionDocument {
  return {
    sourceId: id,
    threadKey,
    subject: `Subject ${id}`,
    fromName: "Someone",
    fromEmail: "someone@example.com",
    sentAt: new Date(`2026-03-0${(Number(id.slice(-1)) % 9) + 1}T09:00:00Z`),
    bodyText: "x".repeat(bodyChars),
  };
}

describe("groupIntoBatches", () => {
  it("keeps a thread's messages together and in chronological order", () => {
    const batches = groupIntoBatches([
      { ...doc("t1", "b"), sentAt: new Date("2026-03-05T09:00:00Z") },
      { ...doc("t1", "a"), sentAt: new Date("2026-03-01T09:00:00Z") },
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((d) => d.sourceId)).toEqual(["a", "b"]);
  });

  it("packs several small threads into one request", () => {
    const documents = Array.from({ length: 5 }, (_, i) => doc(`t${i}`, `d${i}`));
    const batches = groupIntoBatches(documents);
    // Five one-message threads should not become five API calls.
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(5);
  });

  it("splits once the thread limit is reached", () => {
    const documents = Array.from({ length: BATCH_THREAD_LIMIT + 2 }, (_, i) => doc(`t${i}`, `d${i}`));
    const batches = groupIntoBatches(documents);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches[0]!.length).toBeLessThanOrEqual(BATCH_THREAD_LIMIT);
  });

  it("splits on the character budget", () => {
    const big = Math.floor(BATCH_CHAR_BUDGET * 0.7);
    const batches = groupIntoBatches([doc("t1", "d1", big), doc("t2", "d2", big)]);
    expect(batches).toHaveLength(2);
  });

  it("never splits a single oversized thread across requests", () => {
    // Splitting a thread would produce one loop per message instead of one per
    // situation, so an oversized thread stays whole even past the budget.
    const batches = groupIntoBatches([
      doc("t1", "d1", BATCH_CHAR_BUDGET),
      doc("t1", "d2", BATCH_CHAR_BUDGET),
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it("returns nothing for no input", () => {
    expect(groupIntoBatches([])).toEqual([]);
  });
});
