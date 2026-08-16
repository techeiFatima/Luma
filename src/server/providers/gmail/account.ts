/**
 * Disconnecting a connected account.
 *
 * Two things have to happen, and only one of them is under our control: the
 * grant is revoked at Google, and the credentials are destroyed locally. The
 * local half always runs. If Google's endpoint is unreachable or the token was
 * already dead, disconnecting still succeeds — leaving a user unable to
 * disconnect because a third party is down would be the worse failure, and the
 * stored tokens are gone either way.
 */
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createOAuthClient } from "./oauth";

const log = logger("gmail.account");

export interface DisconnectResult {
  accountId: string;
  /** Whether Google confirmed the revocation. False means local-only cleanup. */
  revokedAtProvider: boolean;
  /** How much stored mail was deleted, or null when the data was kept. */
  purgedSourceItems: number | null;
  /** Loops removed because the purge left them with no evidence at all. */
  purgedLoops: number;
}

export interface DisconnectOptions {
  userId: string;
  accountId: string;
  /**
   * Also delete the ingested mail and everything derived from it. Off by
   * default: disconnecting stops future syncing, and silently destroying the
   * user's Open Loops because they unlinked an account would be a surprise.
   */
  purgeData?: boolean;
  /** Injectable so tests do not call Google. */
  revoke?: (token: string) => Promise<void>;
}

async function revokeWithGoogle(token: string): Promise<void> {
  await createOAuthClient().revokeToken(token);
}

export async function disconnectAccount(options: DisconnectOptions): Promise<DisconnectResult> {
  const { userId, accountId, purgeData = false } = options;
  const revoke = options.revoke ?? revokeWithGoogle;

  // Scoped by userId so an account id alone is never enough to disconnect
  // somebody else's mailbox.
  const account = await prisma.connectedAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) throw new NotFoundError("That account is not connected.");

  // Revoking the refresh token invalidates every access token issued from it,
  // so it is the one to send when we have it.
  let token: string | null = null;
  for (const stored of [account.refreshToken, account.accessToken]) {
    if (!stored) continue;
    try {
      token = decryptSecret(stored);
      break;
    } catch {
      // A token we cannot decrypt is already useless; carry on and clear it.
      log.warn("stored token could not be decrypted", { accountId });
    }
  }

  let revokedAtProvider = false;
  if (token) {
    try {
      await revoke(token);
      revokedAtProvider = true;
    } catch (error) {
      // Google answers 400 for a token that is already invalid, which means the
      // user got what they asked for. Either way the local purge below runs.
      log.warn("provider revocation did not succeed", {
        accountId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await prisma.connectedAccount.update({
    where: { id: account.id },
    data: {
      accessToken: "",
      refreshToken: null,
      expiresAt: null,
      revokedAt: account.revokedAt ?? new Date(),
    },
  });

  // Reset the cursor: a historyId from a grant that no longer exists is not a
  // safe starting point if the user reconnects later.
  await prisma.syncState.updateMany({
    where: { accountId: account.id },
    data: { cursor: null, lastError: null },
  });

  let purgedSourceItems: number | null = null;
  let purgedLoops = 0;
  if (purgeData) {
    // Deleting a source item cascades to its evidence but not to the loop the
    // evidence supported. A loop with no evidence left is unprovable, and this
    // product does not keep claims it cannot trace to a source — so any loop
    // that loses its last citation goes with it.
    const touchedLoopIds = [
      ...new Set(
        (
          await prisma.openLoopEvidence.findMany({
            where: { sourceItem: { accountId: account.id } },
            select: { loopId: true },
          })
        ).map((row) => row.loopId),
      ),
    ];

    purgedSourceItems = (
      await prisma.sourceItem.deleteMany({ where: { accountId: account.id, userId } })
    ).count;

    purgedLoops = (
      await prisma.openLoop.deleteMany({
        where: { id: { in: touchedLoopIds }, userId, evidence: { none: {} } },
      })
    ).count;
  }

  log.info("account disconnected", {
    accountId,
    revokedAtProvider,
    purgedSourceItems,
    purgedLoops,
  });
  return { accountId: account.id, revokedAtProvider, purgedSourceItems, purgedLoops };
}
