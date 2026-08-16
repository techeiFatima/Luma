import Link from "next/link";
import { DisconnectButton } from "@/components/DisconnectButton";
import { prisma } from "@/lib/db";
import { getConfig } from "@/config";
import { getSessionUserId } from "@/lib/session";
import { formatSentAt } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const userId = await getSessionUserId();

  if (!userId) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-[var(--color-muted)]">
          No account connected.{" "}
          <Link href="/" className="underline underline-offset-2">
            Go back
          </Link>
          .
        </p>
      </div>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { accounts: { include: { syncState: true } } },
  });

  const recentRuns = await prisma.aiRun.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{user?.email}</p>
      </div>

      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="text-sm font-semibold">Connected accounts</h2>
        {user?.accounts.length === 0 && (
          <p className="mt-2 text-sm text-[var(--color-muted)]">Nothing connected yet.</p>
        )}
        <ul className="mt-3 space-y-3">
          {user?.accounts.map((account) => (
            <li key={account.id} className="rounded-md border border-[var(--color-line)] p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{account.providerAccountId}</span>
                <span className="text-xs text-[var(--color-muted)]">
                  {account.revokedAt ? "disconnected" : account.provider}
                </span>
              </div>
              <p className="mt-2 text-xs text-[var(--color-muted)]">
                Granted {formatSentAt(account.grantedAt)}
                {account.syncState?.lastSyncedAt
                  ? ` · last checked ${formatSentAt(account.syncState.lastSyncedAt)}`
                  : " · never synced"}
                {account.syncState?.lastFullSyncAt
                  ? ` · last full read ${formatSentAt(account.syncState.lastFullSyncAt)}`
                  : ""}
              </p>

              {/* A sync that failed is worth saying out loud — a silently stale
                  dashboard is exactly the thing this product exists to prevent. */}
              {account.revokedAt ? (
                <p className="mt-2 rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 text-xs">
                  This account is disconnected. Luma is no longer reading it.{" "}
                  <Link href="/api/auth/google" className="underline underline-offset-2">
                    Reconnect
                  </Link>
                </p>
              ) : (
                account.syncState?.lastError && (
                  <p className="mt-2 rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 text-xs text-[var(--color-now)]">
                    Last sync failed: {account.syncState.lastError}
                  </p>
                )
              )}
              <div className="mt-2">
                <p className="text-xs font-medium">Scopes you granted</p>
                <ul className="mt-1 space-y-0.5">
                  {account.scopes.split(/\s+/).filter(Boolean).map((scope) => (
                    <li key={scope} className="font-mono text-xs text-[var(--color-muted)]">
                      {scope}
                    </li>
                  ))}
                </ul>
              </div>
              {!account.revokedAt && (
                <div className="mt-3">
                  <DisconnectButton
                    accountId={account.id}
                    accountLabel={account.providerAccountId}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="text-sm font-semibold">Recent extraction runs</h2>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Every model call Luma makes is recorded here.
        </p>
        {recentRuns.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">No runs yet.</p>
        ) : (
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-[var(--color-muted)]">
              <tr>
                <th className="py-1 font-medium">When</th>
                <th className="py-1 font-medium">Model</th>
                <th className="py-1 font-medium">Status</th>
                <th className="py-1 font-medium">Found</th>
                <th className="py-1 font-medium">Tokens</th>
                <th className="py-1 font-medium">Latency</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => (
                <tr key={run.id} className="border-t border-[var(--color-line)]">
                  <td className="py-1.5">{formatSentAt(run.createdAt)}</td>
                  <td className="py-1.5 font-mono">{run.model}</td>
                  <td className="py-1.5">{run.status}</td>
                  <td className="py-1.5">{run.candidatesProposed}</td>
                  <td className="py-1.5">
                    {run.inputTokens ?? "—"} / {run.outputTokens ?? "—"}
                  </td>
                  <td className="py-1.5">{run.latencyMs ? `${run.latencyMs}ms` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="text-sm font-semibold">Model</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Extraction runs on <span className="font-mono">{getConfig().ai.model}</span>. Luma only ever
          asks it to read and structure what is already in your mail — ordering, deduplication, and
          every decision about what to show you are computed by Luma itself.
        </p>
      </section>

      <form action="/api/auth/logout" method="post">
        <button
          type="submit"
          className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
