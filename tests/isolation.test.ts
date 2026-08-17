import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDatabase, uniqueEmail, uniqueKey, type TestDatabase } from "./helpers/db";

/**
 * One user must never reach another user's data.
 *
 * Written from the attacker's side: assume a valid session and a correctly
 * guessed id for someone else's row, then try every read and write path in the
 * product. The property being defended is that knowing an id is not authority
 * to use it — every query carries the owner in its WHERE clause, so a leak
 * would require a missing predicate rather than an unlucky id.
 *
 * Reads must return nothing and writes must change nothing. A route that threw
 * a distinguishable error would also be a (smaller) leak, so misses are
 * asserted to look identical to genuinely absent rows.
 */

let database: TestDatabase;
let prisma: typeof import("@/lib/db").prisma;
let queries: typeof import("@/server/loops/queries");
let notify: typeof import("@/server/domain/notify");
let execute: typeof import("@/server/domain/execute");
let account: typeof import("@/server/providers/gmail/account");

interface Actor {
  id: string;
  loopId: string;
  actionId: string;
  notificationId: string;
  accountId: string;
}

async function makeActor(label: string): Promise<Actor> {
  const user = await prisma.user.create({ data: { email: uniqueEmail(label) } });

  const connected = await prisma.connectedAccount.create({
    data: {
      userId: user.id,
      provider: "gmail",
      providerAccountId: `${label}@gmail.example`,
      accessToken: "encrypted-placeholder",
      scopes: "https://www.googleapis.com/auth/gmail.readonly",
    },
  });

  const loop = await prisma.openLoop.create({
    data: {
      userId: user.id,
      title: `${label}'s private obligation`,
      summary: "Something personal.",
      category: "renewal",
      confidence: 0.9,
      consequence: "high",
      dedupeKey: uniqueKey("loop"),
      dueAt: new Date(Date.now() + 86_400_000),
    },
  });

  const action = await prisma.action.create({
    data: {
      userId: user.id,
      loopId: loop.id,
      type: "create_reminder",
      status: "proposed",
      summary: "Remind them.",
      payload: JSON.stringify({ remindAt: new Date(Date.now() + 3600_000).toISOString() }),
      requiresApproval: false,
      idempotencyKey: uniqueKey("action"),
    },
  });

  const notification = await prisma.notification.create({
    data: {
      userId: user.id,
      loopId: loop.id,
      channel: "in_app",
      status: "pending",
      title: `${label}'s private notification`,
      body: "Personal.",
      dedupeKey: uniqueKey("notif"),
    },
  });

  return {
    id: user.id,
    loopId: loop.id,
    actionId: action.id,
    notificationId: notification.id,
    accountId: connected.id,
  };
}

let alice: Actor;
let mallory: Actor;

beforeAll(async () => {
  database = setupTestDatabase("isolation");
  ({ prisma } = await import("@/lib/db"));
  queries = await import("@/server/loops/queries");
  notify = await import("@/server/domain/notify");
  execute = await import("@/server/domain/execute");
  account = await import("@/server/providers/gmail/account");
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.destroy();
});

beforeEach(async () => {
  await prisma.notification.deleteMany();
  await prisma.action.deleteMany();
  await prisma.openLoopEvidence.deleteMany();
  await prisma.openLoop.deleteMany();
  await prisma.sourceItem.deleteMany();
  await prisma.syncState.deleteMany();
  await prisma.connectedAccount.deleteMany();
  await prisma.user.deleteMany();

  alice = await makeActor("alice");
  mallory = await makeActor("mallory");
});

describe("reads never cross the user boundary", () => {
  it("the dashboard shows only your own loops", async () => {
    const { items } = await queries.listOpenLoops(mallory.id);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toContain("mallory");
  });

  it("a loop id belonging to someone else resolves to nothing", async () => {
    expect(await queries.getLoopDetail(mallory.id, alice.loopId)).toBeNull();
    // And is indistinguishable from an id that does not exist at all.
    expect(await queries.getLoopDetail(mallory.id, "does-not-exist")).toBeNull();
  });

  it("notifications are scoped to their owner", async () => {
    const mine = await notify.listNotifications(mallory.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.title).toContain("mallory");
    expect(mine.some((n) => n.id === alice.notificationId)).toBe(false);
  });

  it("resolved and snoozed lists are scoped too", async () => {
    await prisma.openLoop.update({
      where: { id: alice.loopId },
      data: { status: "done", resolvedAt: new Date() },
    });
    expect(await queries.listResolvedLoops(mallory.id)).toHaveLength(0);

    await prisma.openLoop.update({
      where: { id: alice.loopId },
      data: { status: "snoozed", snoozedUntil: new Date(Date.now() + 86_400_000) },
    });
    expect(await queries.listSnoozedLoops(mallory.id)).toHaveLength(0);
  });

  it("dashboard counters do not include other users' documents", async () => {
    await prisma.sourceItem.create({
      data: {
        userId: alice.id,
        accountId: alice.accountId,
        provider: "gmail",
        kind: "email",
        externalId: "alice-secret",
        sentAt: new Date(),
        bodyText: "Alice's private mail.",
        contentHash: uniqueKey("hash"),
      },
    });

    const stats = await queries.getDashboardStats(mallory.id);
    expect(stats.documents).toBe(0);
  });
});

describe("writes never cross the user boundary", () => {
  it("cannot mark someone else's notification read", async () => {
    expect(await notify.markNotificationRead(mallory.id, alice.notificationId)).toBe(false);

    const untouched = await prisma.notification.findUniqueOrThrow({
      where: { id: alice.notificationId },
    });
    expect(untouched.status).toBe("pending");
    expect(untouched.readAt).toBeNull();
  });

  it("marking all read affects only your own", async () => {
    await notify.markAllNotificationsRead(mallory.id);

    const hers = await prisma.notification.findUniqueOrThrow({
      where: { id: alice.notificationId },
    });
    expect(hers.status).toBe("pending");
  });

  it("cannot approve or execute someone else's action", async () => {
    await expect(execute.decideAction(mallory.id, alice.actionId, "approve")).rejects.toThrow();
    await expect(execute.executeAction(mallory.id, alice.actionId)).rejects.toThrow();

    const untouched = await prisma.action.findUniqueOrThrow({ where: { id: alice.actionId } });
    expect(untouched.status).toBe("proposed");
    expect(untouched.approvedAt).toBeNull();
    // No side effect leaked out either.
    expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(1);
  });

  it("cannot disconnect someone else's account", async () => {
    await expect(
      account.disconnectAccount({
        userId: mallory.id,
        accountId: alice.accountId,
        revoke: async () => {},
      }),
    ).rejects.toThrow();

    const untouched = await prisma.connectedAccount.findUniqueOrThrow({
      where: { id: alice.accountId },
    });
    expect(untouched.revokedAt).toBeNull();
    expect(untouched.accessToken).not.toBe("");
  });
});

describe("deleting a user removes their data with them", () => {
  it("cascades to loops, actions, notifications, and accounts", async () => {
    await prisma.user.delete({ where: { id: alice.id } });

    expect(await prisma.openLoop.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma.connectedAccount.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma.action.count({ where: { userId: alice.id } })).toBe(0);

    // And the other user is untouched.
    expect(await prisma.openLoop.count({ where: { userId: mallory.id } })).toBe(1);
  });
});

describe("credentials never leave the server", () => {
  it("stores tokens encrypted, not as plaintext", async () => {
    const { encryptSecret } = await import("@/lib/crypto");
    const secret = "ya29.super-secret-access-token";

    await prisma.connectedAccount.update({
      where: { id: alice.accountId },
      data: { accessToken: encryptSecret(secret) },
    });

    const row = await prisma.connectedAccount.findUniqueOrThrow({
      where: { id: alice.accountId },
    });
    expect(row.accessToken).not.toContain(secret);
    expect(row.accessToken.startsWith("v1.")).toBe(true);
  });

  it("keeps tokens out of every read model the UI consumes", async () => {
    // The loop detail view walks evidence -> source item; none of that chain
    // may carry an account token along with it.
    const detail = await queries.getLoopDetail(alice.id, alice.loopId);
    const serialized = JSON.stringify(detail ?? {});
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("refreshToken");

    const notifications = JSON.stringify(await notify.listNotifications(alice.id));
    expect(notifications).not.toContain("accessToken");
  });
});
