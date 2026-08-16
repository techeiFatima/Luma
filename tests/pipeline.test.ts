import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDatabase, type TestDatabase } from "./helpers/db";

import type { CandidateLoop } from "@/server/ai/schema";
import type { ExtractionBatchResult, ExtractionDocument, LoopExtractor } from "@/server/ai/extract";

/**
 * End-to-end pipeline test against a real SQLite database, with the model
 * call replaced by a stub.
 *
 * The stub is the point: it lets us assert what the deterministic stages do
 * with *known* model output — including output that is wrong. A real model
 * cannot be asked to hallucinate a specific fake quote on demand, so the
 * guarantees around evidence verification and duplicate prevention can only be
 * pinned down this way.
 */

let database: TestDatabase;
let prisma: typeof import("@/lib/db").prisma;
let runPipeline: typeof import("@/server/pipeline/run").runPipeline;
let FixtureMailProvider: typeof import("@/server/providers/fixtures/provider").FixtureMailProvider;
let listOpenLoops: typeof import("@/server/loops/queries").listOpenLoops;

/** Emits fixed candidates regardless of input, so assertions are exact. */
class StubExtractor implements LoopExtractor {
  readonly name = "stub";
  calls = 0;

  constructor(private readonly plan: (documents: ExtractionDocument[]) => CandidateLoop[]) {}

  async extract(
    _userId: string,
    documents: ExtractionDocument[],
  ): Promise<ExtractionBatchResult[]> {
    this.calls += 1;
    return [{ sourceItemIds: documents.map((d) => d.sourceId), candidates: this.plan(documents), failure: null }];
  }
}

function candidate(overrides: Partial<CandidateLoop> = {}): CandidateLoop {
  return {
    title: "Renew professional license",
    summary: "The license renewal form and $180 fee are outstanding.",
    category: "renewal",
    requires_user_action: true,
    confidence: 0.93,
    consequence: "high",
    due_date: "2026-03-14",
    due_date_basis: "explicit",
    due_date_evidence: "pay the $180 renewal fee before March 14, 2026",
    counterparty_name: "State Licensing Board",
    counterparty_email: "noreply@licensing.example.gov",
    amount_minor: 18000,
    amount_currency: "USD",
    evidence: [{ source_id: "", quote: "complete the online renewal form" }],
    inference_notes: "",
    ...overrides,
  };
}

/** Points a candidate's evidence at the licence-renewal fixture document. */
function withLicenseSource(base: CandidateLoop, documents: ExtractionDocument[]): CandidateLoop {
  const source = documents.find((d) => d.subject?.includes("renew your professional license"));
  if (!source) throw new Error("license fixture not found");
  return {
    ...base,
    evidence: base.evidence.map((item) => ({ ...item, source_id: source.sourceId })),
  };
}

async function setupUser() {
  const user = await prisma.user.create({ data: { email: `u${Date.now()}@example.com` } });
  const account = await prisma.connectedAccount.create({
    data: {
      userId: user.id,
      provider: "fixtures",
      providerAccountId: "demo@example.com",
      accessToken: "unused",
      scopes: "sample-inbox:read",
    },
  });
  return { user, account };
}

beforeAll(async () => {
  database = setupTestDatabase("pipeline");

  ({ prisma } = await import("@/lib/db"));
  ({ runPipeline } = await import("@/server/pipeline/run"));
  ({ FixtureMailProvider } = await import("@/server/providers/fixtures/provider"));
  ({ listOpenLoops } = await import("@/server/loops/queries"));
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.destroy();
});

describe("pipeline", () => {
  it("ingests, filters bulk mail, and only sends real mail to the model", async () => {
    const { user, account } = await setupUser();
    const extractor = new StubExtractor(() => []);

    const summary = await runPipeline({
      userId: user.id,
      accountId: account.id,
      provider: new FixtureMailProvider(),
      extractor,
    });

    expect(summary.ingest.fetched).toBeGreaterThan(0);
    expect(summary.ingest.created).toBe(summary.ingest.fetched);
    // The newsletter and the sale blast never reach the model.
    expect(summary.ingest.bulkFiltered).toBeGreaterThan(0);
    expect(summary.sourceItemsExtracted).toBe(summary.ingest.fetched - summary.ingest.bulkFiltered);
  });

  it("turns a verified candidate into a prioritized loop with traceable evidence", async () => {
    const { user, account } = await setupUser();
    const extractor = new StubExtractor((documents) => {
      const source = documents.find((d) => d.subject?.includes("renew your professional license"));
      return source ? [withLicenseSource(candidate(), documents)] : [];
    });

    const summary = await runPipeline({
      userId: user.id,
      accountId: account.id,
      provider: new FixtureMailProvider(),
      extractor,
      now: new Date("2026-03-10T00:00:00Z"),
    });

    expect(summary.candidatesAccepted).toBe(1);
    expect(summary.loopsCreated).toBe(1);

    const loop = await prisma.openLoop.findFirstOrThrow({
      where: { userId: user.id },
      include: { evidence: { include: { sourceItem: true } } },
    });

    expect(loop.title).toBe("Renew professional license");
    expect(loop.dueAtBasis).toBe("explicit");
    expect(loop.priorityScore).toBeGreaterThan(0);
    // The evidence resolves back to the actual source message.
    expect(loop.evidence.length).toBeGreaterThan(0);
    expect(loop.evidence[0]!.sourceItem.subject).toContain("renew your professional license");
  });

  it("discards a candidate whose evidence is not in the source", async () => {
    const { user, account } = await setupUser();
    const extractor = new StubExtractor((documents) =>
      documents.length > 0
        ? [
            withLicenseSource(
              candidate({
                title: "Wire $9,000 to the account below",
                evidence: [{ source_id: "", quote: "wire nine thousand dollars immediately" }],
              }),
              documents,
            ),
          ]
        : [],
    );

    const summary = await runPipeline({
      userId: user.id,
      accountId: account.id,
      provider: new FixtureMailProvider(),
      extractor,
    });

    expect(summary.candidatesProposed).toBeGreaterThan(0);
    expect(summary.candidatesAccepted).toBe(0);
    expect(summary.rejections.no_verified_evidence).toBeGreaterThan(0);
    expect(await prisma.openLoop.count({ where: { userId: user.id } })).toBe(0);
  });

  it("is idempotent: a second sync creates no duplicate documents or loops", async () => {
    const { user, account } = await setupUser();
    const plan = (documents: ExtractionDocument[]) => {
      const source = documents.find((d) => d.subject?.includes("renew your professional license"));
      return source ? [withLicenseSource(candidate(), documents)] : [];
    };

    const first = await runPipeline({
      userId: user.id,
      accountId: account.id,
      provider: new FixtureMailProvider(),
      extractor: new StubExtractor(plan),
    });
    expect(first.loopsCreated).toBe(1);

    const second = await runPipeline({
      userId: user.id,
      accountId: account.id,
      provider: new FixtureMailProvider(),
      extractor: new StubExtractor(plan),
    });

    // Nothing changed, so nothing is re-ingested and nothing is re-extracted.
    expect(second.ingest.created).toBe(0);
    expect(second.ingest.unchanged).toBe(second.ingest.fetched);
    expect(second.sourceItemsExtracted).toBe(0);
    expect(await prisma.openLoop.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.sourceItem.count({ where: { userId: user.id } })).toBe(
      first.ingest.fetched,
    );
  });

  it("does not resurrect a loop the user already resolved", async () => {
    const { user, account } = await setupUser();
    const plan = (documents: ExtractionDocument[]) => {
      const source = documents.find((d) => d.subject?.includes("renew your professional license"));
      return source ? [withLicenseSource(candidate(), documents)] : [];
    };

    await runPipeline({
      userId: user.id,
      accountId: account.id,
      provider: new FixtureMailProvider(),
      extractor: new StubExtractor(plan),
    });

    const loop = await prisma.openLoop.findFirstOrThrow({ where: { userId: user.id } });
    await prisma.openLoop.update({
      where: { id: loop.id },
      data: { status: "done", resolvedAt: new Date() },
    });

    // Force re-extraction of the same messages, as a content change would.
    await prisma.sourceItem.updateMany({
      where: { userId: user.id },
      data: { processedAt: null },
    });

    await runPipeline({
      userId: user.id,
      accountId: account.id,
      provider: new FixtureMailProvider(),
      extractor: new StubExtractor(plan),
    });

    const after = await prisma.openLoop.findUniqueOrThrow({ where: { id: loop.id } });
    expect(after.status).toBe("done");
    expect(await prisma.openLoop.count({ where: { userId: user.id, status: "open" } })).toBe(0);
  });

  it("shows only the top loops on the dashboard, highest priority first", async () => {
    const { user, account } = await setupUser();
    const extractor = new StubExtractor((documents) => {
      const source = documents[0];
      if (!source) return [];
      const evidence = [{ source_id: source.sourceId, quote: source.bodyText.slice(0, 40) }];
      return [
        candidate({ title: "Low stakes note", category: "other", consequence: "low", due_date: null, due_date_basis: "none", due_date_evidence: null, confidence: 0.7, evidence }),
        candidate({ title: "Urgent overdue payment", category: "payment", consequence: "high", due_date: "2026-03-01", due_date_basis: "inferred", due_date_evidence: null, confidence: 0.95, evidence }),
      ];
    });

    await runPipeline({
      userId: user.id,
      accountId: account.id,
      provider: new FixtureMailProvider(),
      extractor,
      now: new Date("2026-03-10T00:00:00Z"),
    });

    const { items } = await listOpenLoops(user.id);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]!.title).toBe("Urgent overdue payment");
    expect(items[0]!.priorityScore).toBeGreaterThan(items[1]!.priorityScore);
  });
});
