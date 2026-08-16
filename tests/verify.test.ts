import { describe, expect, it } from "vitest";
import type { CandidateLoop } from "@/server/ai/schema";
import { normalizeForMatch, quoteAppearsIn, verifyCandidate, type SourceText } from "@/server/loops/verify";

const source: SourceText = {
  id: "doc-1",
  subject: "Action required: renew your professional license by March 14",
  bodyText:
    "To remain in good standing you must complete the online renewal form and pay the\n$180 renewal fee before March 14, 2026. Licenses not renewed by that date are\nplaced in inactive status.",
};

const sources = new Map<string, SourceText>([["doc-1", source]]);

function candidate(overrides: Partial<CandidateLoop> = {}): CandidateLoop {
  return {
    title: "Renew professional license",
    summary: "The license expires and requires a renewal form and a $180 fee.",
    category: "renewal",
    requires_user_action: true,
    confidence: 0.95,
    consequence: "high",
    due_date: "2026-03-14",
    due_date_basis: "explicit",
    due_date_evidence: "pay the $180 renewal fee before March 14, 2026",
    counterparty_name: "State Licensing Board",
    counterparty_email: "noreply@licensing.example.gov",
    amount_minor: 18000,
    amount_currency: "usd",
    evidence: [{ source_id: "doc-1", quote: "complete the online renewal form" }],
    inference_notes: "",
    ...overrides,
  };
}

describe("quote matching", () => {
  it("normalizes whitespace and smart punctuation", () => {
    expect(normalizeForMatch("  Hello   “world” ")).toBe('hello "world"');
  });

  it("matches a quote that spans a line wrap in the source", () => {
    // The source wraps between "the" and "$180"; the model quotes it as one line.
    expect(quoteAppearsIn("pay the $180 renewal fee before March 14, 2026", source)).toBe(true);
  });

  it("matches text from the subject line", () => {
    expect(quoteAppearsIn("renew your professional license", source)).toBe(true);
  });

  it("rejects a paraphrase", () => {
    expect(quoteAppearsIn("you need to renew the licence and pay a fee", source)).toBe(false);
  });

  it("rejects quotes too short to be meaningful", () => {
    expect(quoteAppearsIn("the", source)).toBe(false);
  });
});

describe("verifyCandidate", () => {
  it("accepts a well-evidenced candidate and normalizes its fields", () => {
    const { loop, rejection } = verifyCandidate(candidate(), sources);
    expect(rejection).toBeNull();
    expect(loop?.title).toBe("Renew professional license");
    expect(loop?.dueAtBasis).toBe("explicit");
    expect(loop?.dueAt?.toISOString().slice(0, 10)).toBe("2026-03-14");
    expect(loop?.amountCurrency).toBe("USD");
    // The due-date quote is stored as evidence in its own right.
    expect(loop?.evidence.some((item) => item.supports === "due_date")).toBe(true);
  });

  it("rejects a candidate whose evidence is not in the source", () => {
    const { loop, rejection } = verifyCandidate(
      candidate({ evidence: [{ source_id: "doc-1", quote: "we have cancelled your license" }] }),
      sources,
    );
    expect(loop).toBeNull();
    expect(rejection).toBe("no_verified_evidence");
  });

  it("rejects a candidate citing a source it was never given", () => {
    const { loop, rejection } = verifyCandidate(
      candidate({ evidence: [{ source_id: "doc-99", quote: "complete the online renewal form" }] }),
      sources,
    );
    expect(loop).toBeNull();
    expect(rejection).toBe("no_verified_evidence");
  });

  it("rejects loops the user does not own", () => {
    const { rejection } = verifyCandidate(candidate({ requires_user_action: false }), sources);
    expect(rejection).toBe("not_user_action");
  });

  it("rejects low-confidence candidates", () => {
    const { rejection } = verifyCandidate(candidate({ confidence: 0.4 }), sources);
    expect(rejection).toBe("low_confidence");
  });

  it("demotes an explicit due date whose quote does not verify", () => {
    // The model claims the date is stated but the quote is invented. The date is
    // kept as an estimate rather than presented to the user as a fact.
    const { loop, notes } = verifyCandidate(
      candidate({ due_date_evidence: "must be renewed no later than March 14" }),
      sources,
    );
    expect(loop?.dueAtBasis).toBe("inferred");
    expect(loop?.dueAtEvidence).toBeNull();
    expect(notes.join(" ")).toContain("demoted to inferred");
  });

  it("drops a due date that does not parse as an unambiguous ISO date", () => {
    const { loop } = verifyCandidate(
      candidate({ due_date: "sometime next month", due_date_basis: "inferred" }),
      sources,
    );
    expect(loop?.dueAt).toBeNull();
    expect(loop?.dueAtBasis).toBe("none");
  });

  it("ignores a nonsensical amount", () => {
    const { loop } = verifyCandidate(candidate({ amount_minor: 0 }), sources);
    expect(loop?.amountMinor).toBeNull();
    expect(loop?.amountCurrency).toBeNull();
  });
});
