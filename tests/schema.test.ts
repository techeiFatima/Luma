import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  setupTestDatabase,
  truncateAll,
  uniqueEmail,
  uniqueKey,
  type TestDatabase,
} from "./helpers/db";

/**
 * Tests for the database foundation itself.
 *
 * These assert the guarantees the schema is supposed to provide — uniqueness,
 * cascade behaviour, defaults — rather than any application logic. A constraint
 * that exists only in a developer's head is not a constraint, and these are the
 * ones the product's promises rest on:
 *
 *  - ingestion cannot duplicate a source item
 *  - the user can never be shown the same open loop twice
 *  - an action cannot execute twice
 *  - the user cannot be notified about the same thing twice
 *  - deleting a user really removes their data
 */

let database: TestDatabase;
let prisma: typeof import("@/lib/db").prisma;

beforeAll(async () => {
  database = setupTestDatabase("schema");
  ({ prisma } = await import("@/lib/db"));
}, 90_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.destroy();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

async function makeUser(email = uniqueEmail()) {
  return prisma.user.create({ data: { email } });
}

async function makeAccount(userId: string, provider = "gmail") {
  return prisma.connectedAccount.create({
    data: {
      userId,
      provider,
      providerAccountId: uniqueEmail("acct"),
      accessToken: "encrypted-token",
      scopes: "https://www.googleapis.com/auth/gmail.readonly",
    },
  });
}

async function makeSourceItem(userId: string, accountId: string, externalId = uniqueKey("msg")) {
  return prisma.sourceItem.create({
    data: {
      userId,
      accountId,
      provider: "gmail",
      kind: "email",
      externalId,
      sentAt: new Date("2026-03-01T09:00:00Z"),
      bodyText: "Please renew before March 14.",
      contentHash: "hash-1",
    },
  });
}

async function makeLoop(userId: string, dedupeKey = uniqueKey("loop")) {
  return prisma.openLoop.create({
    data: {
      userId,
      title: "Renew license",
      summary: "Renewal form and fee outstanding.",
      category: "renewal",
      confidence: 0.9,
      consequence: "high",
      dedupeKey,
    },
  });
}

describe("User", () => {
  it("requires a unique email", async () => {
    const email = uniqueEmail();
    await prisma.user.create({ data: { email } });
    await expect(prisma.user.create({ data: { email } })).rejects.toThrow();
  });

  it("defaults to an active account", async () => {
    const user = await makeUser();
    expect(user.deactivatedAt).toBeNull();
    expect(user.createdAt).toBeInstanceOf(Date);
  });
});

describe("ConnectedAccount", () => {
  it("allows one connection per (user, provider, account)", async () => {
    const user = await makeUser();
    const providerAccountId = uniqueEmail("acct");
    const data = {
      userId: user.id,
      provider: "gmail",
      providerAccountId,
      accessToken: "encrypted",
      scopes: "gmail.readonly",
    };
    await prisma.connectedAccount.create({ data });
    await expect(prisma.connectedAccount.create({ data })).rejects.toThrow();
  });

  it("lets the same mailbox be connected for two different providers", async () => {
    const user = await makeUser();
    const providerAccountId = uniqueEmail("acct");
    const base = { userId: user.id, providerAccountId, accessToken: "e", scopes: "s" };
    await prisma.connectedAccount.create({ data: { ...base, provider: "gmail" } });
    await expect(
      prisma.connectedAccount.create({ data: { ...base, provider: "google_calendar" } }),
    ).resolves.toBeTruthy();
  });

  it("stores granted scopes verbatim", async () => {
    const user = await makeUser();
    const scopes = "https://www.googleapis.com/auth/gmail.readonly openid";
    const account = await prisma.connectedAccount.create({
      data: {
        userId: user.id,
        provider: "gmail",
        providerAccountId: uniqueEmail("acct"),
        accessToken: "encrypted",
        scopes,
      },
    });
    expect(account.scopes).toBe(scopes);
  });
});

describe("SourceItem", () => {
  it("is unique per (account, externalId) so ingestion is idempotent", async () => {
    const user = await makeUser();
    const account = await makeAccount(user.id);
    const externalId = uniqueKey("msg");
    await makeSourceItem(user.id, account.id, externalId);
    await expect(makeSourceItem(user.id, account.id, externalId)).rejects.toThrow();
  });

  it("allows the same provider id under a different account", async () => {
    const user = await makeUser();
    const [a, b] = await Promise.all([makeAccount(user.id), makeAccount(user.id)]);
    const externalId = uniqueKey("msg");
    await makeSourceItem(user.id, a!.id, externalId);
    await expect(makeSourceItem(user.id, b!.id, externalId)).resolves.toBeTruthy();
  });

  it("starts unprocessed and not bulk", async () => {
    const user = await makeUser();
    const account = await makeAccount(user.id);
    const item = await makeSourceItem(user.id, account.id);
    expect(item.processedAt).toBeNull();
    expect(item.isBulk).toBe(false);
    expect(item.toEmails).toBe("[]");
  });
});

describe("OpenLoop", () => {
  it("cannot be created twice with the same dedupe key", async () => {
    const user = await makeUser();
    const key = uniqueKey("loop");
    await makeLoop(user.id, key);
    await expect(makeLoop(user.id, key)).rejects.toThrow();
  });

  it("scopes the dedupe key per user", async () => {
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const key = "shared-key";
    await makeLoop(a!.id, key);
    await expect(makeLoop(b!.id, key)).resolves.toBeTruthy();
  });

  it("defaults to an open, unprioritized loop with no date", async () => {
    const loop = await makeLoop((await makeUser()).id);
    expect(loop.status).toBe("open");
    expect(loop.dueAt).toBeNull();
    expect(loop.dueAtBasis).toBe("none");
    expect(loop.priorityScore).toBe(0);
    expect(loop.priorityBucket).toBe("later");
  });
});

describe("OpenLoopEvidence", () => {
  it("cannot store the same quote twice for a loop and source", async () => {
    const user = await makeUser();
    const account = await makeAccount(user.id);
    const item = await makeSourceItem(user.id, account.id);
    const loop = await makeLoop(user.id);
    const data = { loopId: loop.id, sourceItemId: item.id, quote: "renew before March 14" };
    await prisma.openLoopEvidence.create({ data });
    await expect(prisma.openLoopEvidence.create({ data })).rejects.toThrow();
  });

  it("is removed when its loop is deleted", async () => {
    const user = await makeUser();
    const account = await makeAccount(user.id);
    const item = await makeSourceItem(user.id, account.id);
    const loop = await makeLoop(user.id);
    await prisma.openLoopEvidence.create({
      data: { loopId: loop.id, sourceItemId: item.id, quote: "renew before March 14" },
    });

    await prisma.openLoop.delete({ where: { id: loop.id } });
    expect(await prisma.openLoopEvidence.count()).toBe(0);
    // The source item itself survives — evidence is a link, not ownership.
    expect(await prisma.sourceItem.count()).toBe(1);
  });
});

describe("Action", () => {
  it("defaults to a proposal that requires approval", async () => {
    const user = await makeUser();
    const action = await prisma.action.create({
      data: {
        userId: user.id,
        type: "draft_email",
        summary: "Draft a reply to Priya about the contract.",
        idempotencyKey: uniqueKey("action"),
      },
    });
    expect(action.status).toBe("proposed");
    expect(action.requiresApproval).toBe(true);
    expect(action.approvedAt).toBeNull();
    expect(action.executedAt).toBeNull();
    expect(action.attempts).toBe(0);
    expect(action.payload).toBe("{}");
  });

  it("cannot be executed twice under the same idempotency key", async () => {
    const user = await makeUser();
    const idempotencyKey = uniqueKey("action");
    const data = {
      userId: user.id,
      type: "create_reminder",
      summary: "Remind me on Friday.",
      idempotencyKey,
    };
    await prisma.action.create({ data });
    await expect(prisma.action.create({ data })).rejects.toThrow();
  });

  it("survives its loop being deleted, keeping the audit trail", async () => {
    const user = await makeUser();
    const loop = await makeLoop(user.id);
    const action = await prisma.action.create({
      data: {
        userId: user.id,
        loopId: loop.id,
        type: "draft_email",
        summary: "Draft a reply.",
        idempotencyKey: uniqueKey("action"),
      },
    });

    await prisma.openLoop.delete({ where: { id: loop.id } });
    const after = await prisma.action.findUnique({ where: { id: action.id } });
    // An executed action is a record of something that happened; deleting the
    // loop must not erase it.
    expect(after).not.toBeNull();
    expect(after?.loopId).toBeNull();
  });
});

describe("Notification", () => {
  it("defaults to pending and unread", async () => {
    const user = await makeUser();
    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        title: "Licence renewal due Friday",
        body: "The renewal form and fee are still outstanding.",
        dedupeKey: uniqueKey("notif"),
      },
    });
    expect(notification.status).toBe("pending");
    expect(notification.channel).toBe("in_app");
    expect(notification.sentAt).toBeNull();
    expect(notification.readAt).toBeNull();
  });

  it("cannot notify the same user about the same thing twice", async () => {
    const user = await makeUser();
    const dedupeKey = uniqueKey("notif");
    const data = { userId: user.id, title: "Due Friday", body: "…", dedupeKey };
    await prisma.notification.create({ data });
    await expect(prisma.notification.create({ data })).rejects.toThrow();
  });

  it("scopes the dedupe key per user", async () => {
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const dedupeKey = "same-trigger";
    await prisma.notification.create({
      data: { userId: a!.id, title: "t", body: "b", dedupeKey },
    });
    await expect(
      prisma.notification.create({ data: { userId: b!.id, title: "t", body: "b", dedupeKey } }),
    ).resolves.toBeTruthy();
  });

  it("is removed when its loop is deleted", async () => {
    const user = await makeUser();
    const loop = await makeLoop(user.id);
    await prisma.notification.create({
      data: {
        userId: user.id,
        loopId: loop.id,
        title: "Due Friday",
        body: "…",
        dedupeKey: uniqueKey("notif"),
      },
    });

    await prisma.openLoop.delete({ where: { id: loop.id } });
    // Unlike actions, a notification about a deleted loop has nothing left to
    // say, so it goes with it.
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe("deleting a user", () => {
  it("removes every trace of them", async () => {
    const user = await makeUser();
    const account = await makeAccount(user.id);
    const item = await makeSourceItem(user.id, account.id);
    const loop = await makeLoop(user.id);
    await prisma.syncState.create({ data: { accountId: account.id, cursor: "1" } });
    await prisma.openLoopEvidence.create({
      data: { loopId: loop.id, sourceItemId: item.id, quote: "renew before March 14" },
    });
    await prisma.action.create({
      data: {
        userId: user.id,
        loopId: loop.id,
        type: "draft_email",
        summary: "Draft.",
        idempotencyKey: uniqueKey("action"),
      },
    });
    await prisma.notification.create({
      data: { userId: user.id, loopId: loop.id, title: "t", body: "b", dedupeKey: uniqueKey("n") },
    });
    await prisma.aiRun.create({
      data: {
        userId: user.id,
        stage: "extract_open_loops",
        model: "test",
        promptVersion: "v1",
        status: "ok",
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    // A deletion request has to actually delete. Anything left behind here is
    // data we told the user was gone.
    expect(await prisma.connectedAccount.count()).toBe(0);
    expect(await prisma.syncState.count()).toBe(0);
    expect(await prisma.sourceItem.count()).toBe(0);
    expect(await prisma.openLoop.count()).toBe(0);
    expect(await prisma.openLoopEvidence.count()).toBe(0);
    expect(await prisma.action.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.aiRun.count()).toBe(0);
  });
});
