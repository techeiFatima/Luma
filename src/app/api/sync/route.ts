import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ConfigError } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getSessionUserId } from "@/lib/session";
import { DAY_MS } from "@/lib/time";
import { FixtureMailProvider } from "@/server/providers/fixtures/provider";
import { GmailProvider } from "@/server/providers/gmail/provider";
import { authorizedClientForAccount } from "@/server/providers/gmail/oauth";
import type { MailProvider } from "@/server/providers/types";
import { runPipeline } from "@/server/pipeline/run";

const log = logger("api.sync");

/** How far back a sync looks when the account has never been synced. */
const INITIAL_LOOKBACK_DAYS = 30;

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const account = await prisma.connectedAccount.findFirst({
    where: { userId, revokedAt: null },
    include: { syncState: true },
  });
  if (!account) {
    return NextResponse.json({ error: "No connected account" }, { status: 400 });
  }

  try {
    const provider: MailProvider =
      account.provider === "fixtures"
        ? new FixtureMailProvider(account.providerAccountId)
        : new GmailProvider(await authorizedClientForAccount(account.id));

    // Re-read a small overlap window so a message that arrived mid-sync isn't
    // skipped; ingestion is idempotent, so overlap is free.
    const since = account.syncState?.lastSyncedAt
      ? new Date(account.syncState.lastSyncedAt.getTime() - DAY_MS)
      : new Date(Date.now() - INITIAL_LOOKBACK_DAYS * DAY_MS);

    const summary = await runPipeline({
      userId,
      accountId: account.id,
      provider,
      since,
    });

    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    if (error instanceof ConfigError) {
      return NextResponse.json({ error: error.message }, { status: 501 });
    }
    const message = error instanceof Error ? error.message : String(error);
    log.error("sync failed", { userId, error: message });
    await prisma.syncState.updateMany({
      where: { accountId: account.id },
      data: { lastError: message.slice(0, 1000) },
    });
    return NextResponse.json({ error: `Sync failed: ${message}` }, { status: 500 });
  }
}
