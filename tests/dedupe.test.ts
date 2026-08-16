import { describe, expect, it } from "vitest";
import {
  buildDedupeKey,
  counterpartyDomain,
  dedupeWithinBatch,
  findSimilar,
  similarity,
  stem,
  titleStem,
  type ExistingLoopSummary,
} from "@/server/loops/dedupe";
import type { VerifiedLoop } from "@/server/loops/verify";

function loop(overrides: Partial<VerifiedLoop> = {}): VerifiedLoop {
  return {
    title: "Renew professional license",
    summary: "Renewal form and fee due.",
    category: "renewal",
    confidence: 0.9,
    consequence: "high",
    dueAt: new Date("2026-03-14T23:59:59Z"),
    dueAtBasis: "explicit",
    dueAtEvidence: null,
    counterpartyName: "State Licensing Board",
    counterpartyEmail: "noreply@licensing.example.gov",
    amountMinor: 18000,
    amountCurrency: "USD",
    inferenceNotes: null,
    evidence: [{ documentId: "doc-1", quote: "complete the online renewal form", supports: "claim" }],
    ...overrides,
  };
}

describe("stem", () => {
  it("collapses inflections of the same word", () => {
    expect(stem("renewal")).toBe(stem("renew"));
    expect(stem("renewals")).toBe(stem("renew"));
    expect(stem("licensing")).toBe(stem("license"));
    expect(stem("applications")).toBe(stem("application"));
  });

  it("leaves short words alone rather than over-stemming them", () => {
    expect(stem("payment")).toBe("payment");
    expect(stem("fee")).toBe("fee");
  });

  it("keeps unrelated words distinct", () => {
    expect(stem("license")).not.toBe(stem("contract"));
  });
});

describe("dedupe keys", () => {
  it("ignores word order and filler words in the title", () => {
    expect(titleStem("Renew your professional license")).toBe(titleStem("Professional license renew"));
  });

  it("produces the same key for the same obligation phrased differently", () => {
    const a = buildDedupeKey({
      category: "renewal",
      counterpartyEmail: "noreply@licensing.example.gov",
      title: "Renew professional license",
    });
    const b = buildDedupeKey({
      category: "renewal",
      counterpartyEmail: "billing@licensing.example.gov",
      title: "Professional license renewal",
    });
    expect(a).toBe(b);
  });

  it("separates different categories from the same sender", () => {
    const renewal = buildDedupeKey({
      category: "renewal",
      counterpartyEmail: "billing@atlas.example.com",
      title: "Subscription renews March 20",
    });
    const payment = buildDedupeKey({
      category: "payment",
      counterpartyEmail: "billing@atlas.example.com",
      title: "Subscription renews March 20",
    });
    expect(renewal).not.toBe(payment);
  });

  it("extracts the counterparty domain", () => {
    expect(counterpartyDomain("Someone@Example.COM")).toBe("example.com");
    expect(counterpartyDomain(null)).toBe("");
  });
});

describe("similarity", () => {
  it("scores restatements of the same obligation highly", () => {
    expect(similarity("Renew professional license", "Renew your professional license")).toBeGreaterThan(
      0.6,
    );
  });

  it("scores unrelated titles low", () => {
    expect(similarity("Renew professional license", "Send contract comments to Priya")).toBeLessThan(
      0.3,
    );
  });
});

describe("findSimilar", () => {
  const existing: ExistingLoopSummary[] = [
    {
      id: "loop-1",
      title: "Renew your professional license",
      category: "renewal",
      counterpartyEmail: "billing@licensing.example.gov",
      dueAt: new Date("2026-03-14T00:00:00Z"),
      status: "open",
    },
  ];

  it("finds the same obligation from the same domain", () => {
    expect(findSimilar(loop(), existing)?.id).toBe("loop-1");
  });

  it("does not match across categories", () => {
    expect(findSimilar(loop({ category: "payment" }), existing)).toBeNull();
  });

  it("never resurrects a loop the user already resolved", () => {
    const resolved = existing.map((item) => ({ ...item, status: "done" }));
    expect(findSimilar(loop(), resolved)).toBeNull();
  });

  it("requires a strong title match when the domains differ", () => {
    const otherDomain = existing.map((item) => ({
      ...item,
      counterpartyEmail: "someone@unrelated.example.com",
    }));
    // Same wording, different sender: still matched on a near-identical title.
    expect(findSimilar(loop({ title: "Renew your professional license" }), otherDomain)?.id).toBe(
      "loop-1",
    );
    // Merely similar wording from an unrelated sender is left as its own loop.
    expect(findSimilar(loop({ title: "Renew license membership plan" }), otherDomain)).toBeNull();
  });
});

describe("dedupeWithinBatch", () => {
  it("collapses duplicates, keeping the more confident one", () => {
    const result = dedupeWithinBatch([
      loop({ confidence: 0.7, summary: "weaker read" }),
      loop({ title: "Renew your professional license", confidence: 0.95, summary: "stronger read" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.summary).toBe("stronger read");
  });

  it("merges evidence from both copies so no source is lost", () => {
    const result = dedupeWithinBatch([
      loop({
        confidence: 0.95,
        evidence: [{ documentId: "doc-1", quote: "renewal form", supports: "claim" }],
      }),
      loop({
        confidence: 0.7,
        evidence: [{ documentId: "doc-2", quote: "reminder about renewal", supports: "claim" }],
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.evidence.map((item) => item.documentId).sort()).toEqual(["doc-1", "doc-2"]);
  });

  it("keeps genuinely different loops apart", () => {
    const result = dedupeWithinBatch([
      loop(),
      loop({ title: "Send contract comments to Priya", category: "follow_up" }),
    ]);
    expect(result).toHaveLength(2);
  });
});
