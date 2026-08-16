import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDatabase, uniqueEmail, type TestDatabase } from "./helpers/db";

/**
 * Disconnection and revocation, against a real database.
 *
 * The thing worth proving here is that credentials genuinely leave the system:
 * a disconnect that only flipped a flag would leave working tokens in the
 * database, which is exactly the failure a user disconnecting is trying to
 * prevent.
 */

let database: TestDatabase;
let prisma: typeof import("@/lib/db").prisma;
let disconnectAccount: typeof import("@/server/providers/gmail/account").disconnectAccount;
let markAccountRevoked: typeof import("@/server/providers/gmail/oauth").markAccountRevoked;
let encryptSecret: typeof import("@/lib/crypto").encryptSecret;
let NotFoundError: typeof import("@/lib/errors").NotFoundError;

async function connectedUser() {
  const user = await prisma.user.create({ data: { email: uniqueEmail("gmail") } });
  const account = await prisma.connectedAccount.create({
    data: {
      userId: user.id,
      provider: "gmail",
      providerAccountId: `${user.id}@gmail.example`,
      accessToken: encryptSecret("access-token-value"),
      refreshToken: encryptSecret("refresh-token-value"),
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: "https://www.googleapis.com/auth/gmail.readonly",
    },
  });
  await prisma.syncState.create({
    data: { accountId: account.id, cursor: "12345", lastSyncedAt: new Date() },
  });
  return { user, account };
}

beforeAll(async () => {
  database = setupTestDatabase("gmail-account");
  ({ prisma } = await import("@/lib/db"));
  ({ disconnectAccount } = await import("@/server/providers/gmail/account"));
  ({ markAccountRevoked } = await import("@/server/providers/gmail/oauth"));
  ({ encryptSecret } = await import("@/lib/crypto"));
  ({ NotFoundError } = await import("@/lib/errors"));
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.destroy();
});

beforeEach(async () => {
  await prisma.openLoopEvidence.deleteMany();
  await prisma.openLoop.deleteMany();
  await prisma.sourceItem.deleteMany();
  await prisma.syncState.deleteMany();
  await prisma.connectedAccount.deleteMany();
  await prisma.user.deleteMany();
});

describe("disconnectAccount", () => {
  it("revokes at Google using the refresh token, not the access token", async () => {
    // Revoking the refresh token invalidates everything issued from it.
    const { user, account } = await connectedUser();
    const revoked: string[] = [];

    const result = await disconnectAccount({
      userId: user.id,
      accountId: account.id,
      revoke: async (token) => {
        revoked.push(token);
      },
    });

    expect(revoked).toEqual(["refresh-token-value"]);
    expect(result.revokedAtProvider).toBe(true);
  });

  it("destroys the stored tokens, not just a flag", async () => {
    const { user, account } = await connectedUser();
    await disconnectAccount({ userId: user.id, accountId: account.id, revoke: async () => {} });

    const stored = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(stored.accessToken).toBe("");
    expect(stored.refreshToken).toBeNull();
    expect(stored.expiresAt).toBeNull();
    expect(stored.revokedAt).not.toBeNull();
  });

  it("still disconnects when Google's revocation endpoint fails", async () => {
    // Google answers 400 for an already-dead token; the user asked to
    // disconnect either way, and leaving tokens behind would be the worse bug.
    const { user, account } = await connectedUser();

    const result = await disconnectAccount({
      userId: user.id,
      accountId: account.id,
      revoke: async () => {
        throw new Error("400 invalid_token");
      },
    });

    expect(result.revokedAtProvider).toBe(false);
    const stored = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(stored.refreshToken).toBeNull();
    expect(stored.revokedAt).not.toBeNull();
  });

  it("clears the sync cursor so a reconnection does not resume from a dead grant", async () => {
    const { user, account } = await connectedUser();
    await disconnectAccount({ userId: user.id, accountId: account.id, revoke: async () => {} });

    const state = await prisma.syncState.findUniqueOrThrow({ where: { accountId: account.id } });
    expect(state.cursor).toBeNull();
  });

  it("keeps ingested mail by default", async () => {
    const { user, account } = await connectedUser();
    await prisma.sourceItem.create({
      data: {
        userId: user.id,
        accountId: account.id,
        provider: "gmail",
        kind: "email",
        externalId: "m1",
        sentAt: new Date(),
        bodyText: "Renew the permit by Friday.",
        contentHash: "hash-1",
      },
    });

    const result = await disconnectAccount({
      userId: user.id,
      accountId: account.id,
      revoke: async () => {},
    });

    expect(result.purgedSourceItems).toBeNull();
    expect(await prisma.sourceItem.count()).toBe(1);
  });

  it("deletes mail and the loops it supported when asked to purge", async () => {
    const { user, account } = await connectedUser();
    const item = await prisma.sourceItem.create({
      data: {
        userId: user.id,
        accountId: account.id,
        provider: "gmail",
        kind: "email",
        externalId: "m1",
        sentAt: new Date(),
        bodyText: "Renew the permit by Friday.",
        contentHash: "hash-1",
      },
    });
    const loop = await prisma.openLoop.create({
      data: {
        userId: user.id,
        title: "Renew the permit",
        summary: "Due Friday.",
        category: "renewal",
        confidence: 0.9,
        consequence: "high",
        dedupeKey: "renew-permit",
        evidence: { create: { sourceItemId: item.id, quote: "Renew the permit by Friday." } },
      },
    });

    const result = await disconnectAccount({
      userId: user.id,
      accountId: account.id,
      purgeData: true,
      revoke: async () => {},
    });

    expect(result.purgedSourceItems).toBe(1);
    expect(result.purgedLoops).toBe(1);
    // A loop whose every citation is gone cannot be shown honestly, so it goes.
    expect(await prisma.openLoop.findUnique({ where: { id: loop.id } })).toBeNull();
  });

  it("keeps a purged account's loops that other sources still support", async () => {
    const { user, account } = await connectedUser();
    const other = await prisma.connectedAccount.create({
      data: {
        userId: user.id,
        provider: "gmail",
        providerAccountId: "second@gmail.example",
        accessToken: encryptSecret("a"),
        scopes: "https://www.googleapis.com/auth/gmail.readonly",
      },
    });

    const items = await Promise.all(
      [account, other].map((owner, index) =>
        prisma.sourceItem.create({
          data: {
            userId: user.id,
            accountId: owner.id,
            provider: "gmail",
            kind: "email",
            externalId: `m${index}`,
            sentAt: new Date(),
            bodyText: "Renew the permit by Friday.",
            contentHash: `hash-${index}`,
          },
        }),
      ),
    );

    const loop = await prisma.openLoop.create({
      data: {
        userId: user.id,
        title: "Renew the permit",
        summary: "Due Friday.",
        category: "renewal",
        confidence: 0.9,
        consequence: "high",
        dedupeKey: "renew-permit",
        evidence: {
          create: items.map((item) => ({ sourceItemId: item.id, quote: "Renew the permit by Friday." })),
        },
      },
    });

    const result = await disconnectAccount({
      userId: user.id,
      accountId: account.id,
      purgeData: true,
      revoke: async () => {},
    });

    expect(result.purgedLoops).toBe(0);
    expect(await prisma.openLoop.findUnique({ where: { id: loop.id } })).not.toBeNull();
  });

  it("refuses to disconnect an account belonging to somebody else", async () => {
    const mine = await connectedUser();
    const theirs = await connectedUser();

    await expect(
      disconnectAccount({
        userId: mine.user.id,
        accountId: theirs.account.id,
        revoke: async () => {},
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const untouched = await prisma.connectedAccount.findUniqueOrThrow({
      where: { id: theirs.account.id },
    });
    expect(untouched.revokedAt).toBeNull();
    expect(untouched.refreshToken).not.toBeNull();
  });

  it("is idempotent — disconnecting twice is not an error", async () => {
    const { user, account } = await connectedUser();
    const first = await disconnectAccount({
      userId: user.id,
      accountId: account.id,
      revoke: async () => {},
    });
    const second = await disconnectAccount({
      userId: user.id,
      accountId: account.id,
      revoke: async () => {},
    });

    // Nothing left to send the second time, so nothing was revoked upstream.
    expect(second.revokedAtProvider).toBe(false);
    const stored = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(stored.revokedAt?.getTime()).toBe(
      (await prisma.connectedAccount.findUniqueOrThrow({ where: { id: first.accountId } })).revokedAt?.getTime(),
    );
  });
});

describe("markAccountRevoked", () => {
  it("clears credentials and explains itself in the sync state", async () => {
    const { account } = await connectedUser();
    await markAccountRevoked(account.id, "invalid_grant");

    const stored = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(stored.revokedAt).not.toBeNull();
    expect(stored.accessToken).toBe("");
    expect(stored.refreshToken).toBeNull();

    const state = await prisma.syncState.findUniqueOrThrow({ where: { accountId: account.id } });
    expect(state.lastError).toContain("invalid_grant");
    expect(state.cursor).toBeNull();
  });

  it("does not overwrite the timestamp of an already-revoked account", async () => {
    const { account } = await connectedUser();
    await markAccountRevoked(account.id, "first");
    const first = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: account.id } });

    await markAccountRevoked(account.id, "second");
    const second = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: account.id } });

    expect(second.revokedAt?.getTime()).toBe(first.revokedAt?.getTime());
  });
});
