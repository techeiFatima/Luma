import { prisma } from "@/lib/db";
import { BadRequestError, isAppError, UpstreamError } from "@/lib/errors";
import { DAY_MS } from "@/lib/time";
import { route } from "@/server/http/route";
import { FixtureMailProvider } from "@/server/providers/fixtures/provider";
import { authorizedClientForAccount } from "@/server/providers/gmail/oauth";
import { GmailProvider } from "@/server/providers/gmail/provider";
import type { MailProvider } from "@/server/providers/types";
import { runPipeline } from "@/server/pipeline/run";

/** How far back a sync looks when the account has never been synced. */
const INITIAL_LOOKBACK_DAYS = 30;

export const POST = route("sync", async ({ requireUserId, log }) => {
  const userId = await requireUserId();

  const account = await prisma.connectedAccount.findFirst({
    where: { userId, revokedAt: null },
    include: { syncState: true },
  });
  if (!account) {
    throw new BadRequestError("No account is connected yet.");
  }

  const provider: MailProvider =
    account.provider === "fixtures"
      ? new FixtureMailProvider(account.providerAccountId)
      : new GmailProvider(await authorizedClientForAccount(account.id));

  // Re-read a small overlap window so a message that arrived mid-sync isn't
  // skipped; ingestion is idempotent, so overlap is free.
  const since = account.syncState?.lastSyncedAt
    ? new Date(account.syncState.lastSyncedAt.getTime() - DAY_MS)
    : new Date(Date.now() - INITIAL_LOOKBACK_DAYS * DAY_MS);

  try {
    return await runPipeline({ userId, accountId: account.id, provider, since });
  } catch (error) {
    // Record the failure against the account so the UI can explain itself,
    // then rethrow for the shared error handler.
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncState.updateMany({
      where: { accountId: account.id },
      data: { lastError: message.slice(0, 1000) },
    });
    log.warn("sync failed", { accountId: account.id });
    // A typed error (missing API key, not signed in) already knows how it
    // should surface; anything else is the provider failing on us.
    throw isAppError(error) ? error : new UpstreamError(message, account.provider);
  }
});
