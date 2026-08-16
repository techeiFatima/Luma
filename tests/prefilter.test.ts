import { describe, expect, it } from "vitest";
import { classifyMessage } from "@/server/ingest/prefilter";
import { fixtureMessages } from "@/server/providers/fixtures/emails";
import type { NormalizedMessage } from "@/server/providers/types";

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    externalId: "m1",
    threadExternalId: "t1",
    subject: "A question about the contract",
    fromName: "Priya",
    fromEmail: "priya@northwind.example.com",
    toEmails: ["you@example.com"],
    sentAt: new Date("2026-03-01T10:00:00Z"),
    snippet: null,
    bodyText: "Could you send me your comments on sections 4 and 7 by Friday please?",
    headers: {},
    labels: ["INBOX"],
    ...overrides,
  };
}

describe("prefilter", () => {
  it("keeps ordinary person-to-person mail", () => {
    expect(classifyMessage(message()).isBulk).toBe(false);
  });

  it("filters anything carrying a list-unsubscribe header", () => {
    const result = classifyMessage(
      message({ headers: { "list-unsubscribe": "<https://x.example/u>" } }),
    );
    expect(result.isBulk).toBe(true);
    expect(result.reason).toBe("header:list-unsubscribe");
  });

  it("filters bulk precedence and promotional labels", () => {
    expect(classifyMessage(message({ headers: { precedence: "bulk" } })).isBulk).toBe(true);
    expect(classifyMessage(message({ labels: ["CATEGORY_PROMOTIONS"] })).isBulk).toBe(true);
  });

  it("filters marketing subject lines", () => {
    expect(classifyMessage(message({ subject: "50% OFF EVERYTHING — 48 hours only!!" })).isBulk).toBe(
      true,
    );
    expect(classifyMessage(message({ subject: "Weekly digest: 12 stories" })).isBulk).toBe(true);
  });

  it("filters generic automated senders", () => {
    expect(classifyMessage(message({ fromEmail: "newsletter@dispatch.example.com" })).isBulk).toBe(
      true,
    );
  });

  it("keeps automated senders that carry real obligations", () => {
    // A licensing board emailing from noreply@ is exactly what the product exists
    // to catch, so the sender heuristic must not swallow it.
    expect(classifyMessage(message({ fromEmail: "noreply@licensing.example.gov" })).isBulk).toBe(
      false,
    );
    expect(classifyMessage(message({ fromEmail: "billing@atlas.example.com" })).isBulk).toBe(false);
  });

  it("filters messages with essentially no body", () => {
    expect(classifyMessage(message({ bodyText: "ok" })).isBulk).toBe(true);
  });

  it("filters the marketing fixtures but keeps the obligation fixtures", () => {
    const byId = new Map(fixtureMessages().map((m) => [m.externalId, classifyMessage(m)]));
    // Newsletter and the sale blast.
    expect(byId.get("fx-004")?.isBulk).toBe(true);
    expect(byId.get("fx-006")?.isBulk).toBe(true);
    // Licence renewal, contract review, passport documents.
    expect(byId.get("fx-001")?.isBulk).toBe(false);
    expect(byId.get("fx-002")?.isBulk).toBe(false);
    expect(byId.get("fx-011")?.isBulk).toBe(false);
  });
});
