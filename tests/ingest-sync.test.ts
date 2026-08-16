import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDatabase, uniqueEmail, type TestDatabase } from "./helpers/db";

import type {
  FetchOptions,
  FetchResult,
  MailProvider,
  NormalizedMessage,
} from "@/server/providers/types";

/**
 * Sync-state behaviour: the cursor, the full/incremental distinction, and
 * resumability.
 *
 * These are the guarantees that decide whether mail can go missing. A cursor
 * advanced too eagerly, or a failed sync that still looks successful, loses
 * messages permanently — and a product about not forgetting things cannot
 * forget things.
 */

let database: TestDatabase;
let prisma: typeof import("@/lib/db").prisma;
let ingestMessages: typeof import("@/server/ingest/pipeline").ingestMessages;

/** Records what it was asked for and returns whatever it was told to. */
class SpyProvider implements MailProvider {
  readonly id = "gmail";
  readonly seen: FetchOptions[] = [];

  constructor(private readonly results: FetchResult[]) {}

  async describe() {
    return { accountId: "spy@example.com", email: "spy@example.com" };
  }

  async fetchMessages(options: FetchOptions): Promise<FetchResult> {
    this.seen.push(options);
    const next = this.results.shift();
    if (!next) throw new Error("SpyProvider ran out of scripted results");
    return next;
  }
}

/** A provider that always fails, standing in for a mid-sync outage. */
class FailingProvider implements MailProvider {
  readonly id = "gmail";
  async describe() {
    return { accountId: "x@example.com", email: "x@example.com" };
  }
  async fetchMessages(): Promise<FetchResult> {
    throw new Error("Gmail is unavailable");
  }
}

function mail(id: string, body = `Please confirm ${id} by Friday.`): NormalizedMessage {
  return {
    externalId: id,
    threadExternalId: `t-${id}`,
    subject: `About ${id}`,
    fromName: "Alex Rivera",
    fromEmail: "alex@example.com",
    toEmails: ["you@example.com"],
    sentAt: new Date("2026-02-10T09:00:00Z"),
    snippet: body.slice(0, 40),
    bodyText: body,
    headers: { from: "Alex Rivera <alex@example.com>" },
    labels: ["INBOX"],
  };
}

async function connectedAccount() {
  const user = await prisma.user.create({ data: { email: uniqueEmail("sync") } });
  const account = await prisma.connectedAccount.create({
    data: {
      userId: user.id,
      provider: "gmail",
      providerAccountId: "spy@example.com",
      accessToken: "unused",
      scopes: "https://www.googleapis.com/auth/gmail.readonly",
    },
  });
  return { user, account };
}

beforeAll(async () => {
  database = setupTestDatabase("ingest-sync");
  ({ prisma } = await import("@/lib/db"));
  ({ ingestMessages } = await import("@/server/ingest/pipeline"));
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.destroy();
});

beforeEach(async () => {
  await prisma.sourceItem.deleteMany();
  await prisma.syncState.deleteMany();
  await prisma.connectedAccount.deleteMany();
  await prisma.user.deleteMany();
});

describe("incremental sync state", () => {
  it("hands the stored cursor to the provider on the next run", async () => {
    const { user, account } = await connectedAccount();
    const provider = new SpyProvider([
      { messages: [mail("m1")], cursor: "100", full: true },
      { messages: [mail("m2")], cursor: "200", full: false },
    ]);

    await ingestMessages({ userId: user.id, accountId: account.id, provider });
    const state = await prisma.syncState.findUniqueOrThrow({ where: { accountId: account.id } });
    expect(state.cursor).toBe("100");

    await ingestMessages({
      userId: user.id,
      accountId: account.id,
      provider,
      cursor: state.cursor,
    });

    expect(provider.seen[1]?.cursor).toBe("100");
    const updated = await prisma.syncState.findUniqueOrThrow({ where: { accountId: account.id } });
    expect(updated.cursor).toBe("200");
  });

  it("only moves lastFullSyncAt on a full read", async () => {
    // Otherwise a cursor that keeps expiring looks like a healthy delta sync.
    const { user, account } = await connectedAccount();
    const provider = new SpyProvider([
      { messages: [mail("m1")], cursor: "100", full: true },
      { messages: [mail("m2")], cursor: "200", full: false },
    ]);

    await ingestMessages({ userId: user.id, accountId: account.id, provider });
    const afterFull = await prisma.syncState.findUniqueOrThrow({
      where: { accountId: account.id },
    });
    expect(afterFull.lastFullSyncAt).not.toBeNull();

    await ingestMessages({ userId: user.id, accountId: account.id, provider, cursor: "100" });
    const afterDelta = await prisma.syncState.findUniqueOrThrow({
      where: { accountId: account.id },
    });

    expect(afterDelta.lastFullSyncAt?.getTime()).toBe(afterFull.lastFullSyncAt?.getTime());
    expect(afterDelta.lastSyncedAt!.getTime()).toBeGreaterThanOrEqual(
      afterFull.lastSyncedAt!.getTime(),
    );
  });

  it("does not advance the cursor when the fetch fails", async () => {
    // The next sync must re-read the same window rather than skip past it.
    const { user, account } = await connectedAccount();
    await prisma.syncState.create({ data: { accountId: account.id, cursor: "100" } });

    await expect(
      ingestMessages({
        userId: user.id,
        accountId: account.id,
        provider: new FailingProvider(),
        cursor: "100",
      }),
    ).rejects.toThrow("Gmail is unavailable");

    const state = await prisma.syncState.findUniqueOrThrow({ where: { accountId: account.id } });
    expect(state.cursor).toBe("100");
  });

  it("clears a previous error once a sync succeeds", async () => {
    const { user, account } = await connectedAccount();
    await prisma.syncState.create({
      data: { accountId: account.id, cursor: "100", lastError: "Gmail is unavailable" },
    });

    await ingestMessages({
      userId: user.id,
      accountId: account.id,
      provider: new SpyProvider([{ messages: [mail("m1")], cursor: "150", full: false }]),
      cursor: "100",
    });

    const state = await prisma.syncState.findUniqueOrThrow({ where: { accountId: account.id } });
    expect(state.lastError).toBeNull();
  });

  it("stores a delta's messages without disturbing what is already there", async () => {
    const { user, account } = await connectedAccount();

    await ingestMessages({
      userId: user.id,
      accountId: account.id,
      provider: new SpyProvider([{ messages: [mail("m1"), mail("m2")], cursor: "100", full: true }]),
    });

    const second = await ingestMessages({
      userId: user.id,
      accountId: account.id,
      provider: new SpyProvider([{ messages: [mail("m3")], cursor: "200", full: false }]),
      cursor: "100",
    });

    expect(second.created).toBe(1);
    expect(second.unchanged).toBe(0);
    expect(await prisma.sourceItem.count({ where: { userId: user.id } })).toBe(3);
  });

  it("re-ingesting an overlapping window changes nothing", async () => {
    // The overlap exists so a message that lands mid-sync isn't skipped; it is
    // only safe because repeating it is a no-op.
    const { user, account } = await connectedAccount();
    const messages = [mail("m1"), mail("m2")];

    const first = await ingestMessages({
      userId: user.id,
      accountId: account.id,
      provider: new SpyProvider([{ messages, cursor: "100", full: true }]),
    });
    const second = await ingestMessages({
      userId: user.id,
      accountId: account.id,
      provider: new SpyProvider([{ messages, cursor: "100", full: true }]),
    });

    expect(first.created).toBe(2);
    expect(second.created).toBe(0);
    expect(second.unchanged).toBe(2);
  });

  it("re-extracts a message whose content actually changed", async () => {
    const { user, account } = await connectedAccount();
    await ingestMessages({
      userId: user.id,
      accountId: account.id,
      provider: new SpyProvider([{ messages: [mail("m1")], cursor: "100", full: true }]),
    });
    await prisma.sourceItem.updateMany({ data: { processedAt: new Date() } });

    const second = await ingestMessages({
      userId: user.id,
      accountId: account.id,
      provider: new SpyProvider([
        { messages: [mail("m1", "Actually, please confirm by Monday.")], cursor: "200", full: false },
      ]),
      cursor: "100",
    });

    expect(second.updated).toBe(1);
    const item = await prisma.sourceItem.findFirstOrThrow({ where: { externalId: "m1" } });
    expect(item.processedAt).toBeNull();
  });
});
