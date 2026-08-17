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

/**
 * Regression tests for the recall defect.
 *
 * An earlier prefilter treated any `noreply@` sender as bulk. That single rule
 * discarded 7 of 79 known obligations before the model ever saw them, capping
 * recall at 91% no matter how good extraction got. These cases are the ones it
 * threw away — they are the reason sender shape is now only a weak signal.
 */
describe("prefilter: obligations from automated senders", () => {
  const cases = [
    {
      name: "a background check that needs consent",
      from: "noreply@verifiedscreening.example.com",
      subject: "Action needed: authorize your background check",
      body: "Your employer has requested a background check. Please sign the authorization form within 5 business days so we can proceed.",
    },
    {
      name: "an expiring certificate",
      from: "noreply@certauthority.example.com",
      subject: "Your SSL certificate expires in 14 days",
      body: "The certificate for your domain expires on April 12. Renew it before that date to avoid an outage on your site.",
    },
    {
      name: "library items coming due",
      from: "noreply@citylibrary.example.org",
      subject: "Items due soon",
      body: "The following items are due back on April 3. Please return or renew them to avoid a late fee being applied to your account.",
    },
    {
      name: "a password about to expire",
      from: "no-reply@it.company.example.com",
      subject: "Your password expires in 3 days",
      body: "Your network password expires on Thursday. Change it before then or you will be locked out of your account.",
    },
    {
      name: "a direct question routed through a notifications address",
      from: "notifications@docs.example.com",
      subject: "Priya commented on your document",
      body: "Priya asked: can you confirm the Q3 numbers in section 4 before we send this to the board on Monday?",
    },
  ];

  for (const testCase of cases) {
    it(`keeps ${testCase.name}`, () => {
      const result = classifyMessage(
        message({
          fromEmail: testCase.from,
          subject: testCase.subject,
          bodyText: testCase.body,
        }),
      );
      expect(result.isBulk, `dropped as ${result.reason}`).toBe(false);
    });
  }

  it("still filters a no-reply address when a second signal agrees", () => {
    // One weak signal is not enough; two is. Here: no-reply sender plus the
    // message saying outright that nothing is being asked of the reader.
    const result = classifyMessage(
      message({
        fromEmail: "noreply@bank.example.com",
        subject: "Your statement is ready",
        bodyText:
          "Your monthly statement is now available to view. This is a confirmation only and no action is required from you.",
      }),
    );
    expect(result.isBulk).toBe(true);
    expect(result.reason).toContain("weak:");
  });

  it("filters a sender whose address names the content as promotional", () => {
    const result = classifyMessage(
      message({ fromEmail: "deals@retailer.example.com", subject: "Your weekend picks" }),
    );
    expect(result).toEqual({ isBulk: true, reason: "sender:marketing" });
  });
});

describe("prefilter: short messages", () => {
  it("keeps a short commitment the user sent themselves", () => {
    // 39 characters — under the old 40-char floor, and a real promise.
    const result = classifyMessage(
      message({
        labels: ["SENT"],
        bodyText: "Sure, I'll get to it today or tomorrow.",
      }),
    );
    expect(result.isBulk).toBe(false);
  });

  it("still drops a message with nothing quotable in it", () => {
    expect(classifyMessage(message({ bodyText: "ok thanks" })).isBulk).toBe(true);
  });
});
