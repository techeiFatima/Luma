import { describe, expect, it } from "vitest";
import {
  htmlToText,
  parseAddress,
  parseAddressList,
  stripQuotedReplies,
} from "@/server/providers/gmail/parse";
import { parseModelDate } from "@/lib/time";
import { extractionResultSchema } from "@/server/ai/schema";

describe("address parsing", () => {
  it("splits a display name from an address", () => {
    expect(parseAddress('"Priya Raman" <priya@example.com>')).toEqual({
      name: "Priya Raman",
      email: "priya@example.com",
    });
  });

  it("handles a bare address", () => {
    expect(parseAddress("priya@example.com").email).toBe("priya@example.com");
  });

  it("lowercases addresses so dedupe by domain is stable", () => {
    expect(parseAddress("Priya <Priya@Example.COM>").email).toBe("priya@example.com");
  });

  it("parses a recipient list", () => {
    expect(parseAddressList("a@example.com, B <b@example.com>")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });
});

describe("body extraction", () => {
  it("turns html into readable text", () => {
    const text = htmlToText("<p>Hello <b>there</b></p><style>.x{}</style><p>Second&nbsp;line</p>");
    expect(text).toContain("Hello there");
    expect(text).toContain("Second line");
    expect(text).not.toContain("<");
  });

  it("removes the quoted reply chain", () => {
    const body = [
      "Yes, Friday works.",
      "",
      "On Mon, Mar 2, 2026 Priya wrote:",
      "> Can you send comments by Friday?",
    ].join("\n");
    const stripped = stripQuotedReplies(body);
    expect(stripped).toBe("Yes, Friday works.");
  });

  it("keeps the original when stripping would remove everything", () => {
    const body = "> Only quoted content here, nothing else at all.";
    expect(stripQuotedReplies(body)).toBe(body);
  });
});

describe("parseModelDate", () => {
  it("accepts an ISO date and treats it as end of day", () => {
    expect(parseModelDate("2026-03-14")?.toISOString()).toBe("2026-03-14T23:59:59.000Z");
  });

  it("accepts a full ISO timestamp", () => {
    expect(parseModelDate("2026-03-14T09:00:00Z")?.toISOString()).toBe("2026-03-14T09:00:00.000Z");
  });

  it("refuses anything ambiguous rather than guessing a deadline", () => {
    for (const value of ["next Friday", "03/14/2026", "March 14", "", null, "soon"]) {
      expect(parseModelDate(value)).toBeNull();
    }
  });
});

describe("extraction output validation", () => {
  const base = {
    title: "Renew license",
    summary: "Fee and form due.",
    category: "renewal",
    requires_user_action: true,
    confidence: 0.9,
    consequence: "high",
    due_date: "2026-03-14",
    due_date_basis: "explicit",
    due_date_evidence: "before March 14, 2026",
    counterparty_name: null,
    counterparty_email: null,
    amount_minor: 18000,
    amount_currency: "USD",
    evidence: [{ source_id: "doc-1", quote: "renewal form" }],
    inference_notes: "",
  };

  it("accepts a well-formed payload", () => {
    expect(extractionResultSchema.safeParse({ loops: [base] }).success).toBe(true);
  });

  it("accepts an empty result — finding nothing is a valid answer", () => {
    expect(extractionResultSchema.safeParse({ loops: [] }).success).toBe(true);
  });

  it("rejects an unknown category rather than coercing it", () => {
    const result = extractionResultSchema.safeParse({ loops: [{ ...base, category: "chores" }] });
    expect(result.success).toBe(false);
  });

  it("clamps an out-of-range confidence instead of failing the batch", () => {
    const result = extractionResultSchema.safeParse({ loops: [{ ...base, confidence: 4.2 }] });
    expect(result.success).toBe(true);
    expect(result.success && result.data.loops[0]!.confidence).toBe(1);
  });
});
