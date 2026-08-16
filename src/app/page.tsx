import { prisma } from "@/lib/db";
import { getConfig } from "@/config";
import { getSessionUserId } from "@/lib/session";
import { ConnectPanel } from "@/components/ConnectPanel";
import { LoopCard } from "@/components/LoopCard";
import { SyncButton } from "@/components/SyncButton";
import { getDashboardStats, listOpenLoops } from "@/server/loops/queries";
import { rescoreOpenLoops } from "@/server/loops/persist";
import { formatSentAt } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const userId = await getSessionUserId();
  const googleConfigured = getConfig().google.enabled;

  if (!userId) {
    return <ConnectPanel googleConfigured={googleConfigured} />;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return <ConnectPanel googleConfigured={googleConfigured} />;
  }

  // Urgency is a function of the current time, so scores are refreshed on read.
  const now = new Date();
  await rescoreOpenLoops(userId, now);

  const [{ items, total }, stats] = await Promise.all([
    listOpenLoops(userId),
    getDashboardStats(userId),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">What you may be forgetting</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {total === 0
              ? "Nothing open right now."
              : `${total} open loop${total === 1 ? "" : "s"}${
                  total > items.length ? `, showing the top ${items.length}` : ""
                }.`}
          </p>
        </div>
        <SyncButton />
      </div>

      {/*
        An empty list has two very different causes, and conflating them would
        be a lie: either nothing is outstanding, or the analysis did not finish.
      */}
      {stats.pendingAnalysis > 0 && (
        <div className="rounded-lg border border-[var(--color-now)] bg-[var(--color-surface)] p-4">
          <p className="text-sm font-medium">Luma hasn&apos;t finished reading your mail.</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {stats.pendingAnalysis} message{stats.pendingAnalysis === 1 ? "" : "s"} could not be
            analyzed{stats.lastRunError ? `: ${stats.lastRunError}` : ""}. This list may be
            incomplete — try checking again.
          </p>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-line)] p-8 text-center">
          <p className="text-sm font-medium">
            {stats.pendingAnalysis > 0 ? "No open loops found yet." : "Nothing needs you right now."}
          </p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {stats.documents === 0
              ? "Check your inbox to get started."
              : stats.pendingAnalysis > 0
                ? "Luma couldn't finish analyzing your mail, so this may not be the whole picture."
                : "Luma read your recent mail and didn't find anything genuinely unfinished. That's a real answer, not an error."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((loop) => (
            <LoopCard key={loop.id} loop={loop} now={now} />
          ))}
        </ul>
      )}

      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5 text-sm">
        <h2 className="font-semibold">How this list was built</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[var(--color-muted)] sm:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide">Messages read</dt>
            <dd className="text-[var(--color-ink)]">{stats.documents}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide">Filtered as bulk</dt>
            <dd className="text-[var(--color-ink)]">{stats.bulkFiltered}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide">Analyzed</dt>
            <dd className="text-[var(--color-ink)]">{stats.processed}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide">Open loops</dt>
            <dd className="text-[var(--color-ink)]">{stats.openLoops}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          {stats.lastSyncedAt
            ? `Last checked ${formatSentAt(stats.lastSyncedAt, now)}.`
            : "Not synced yet."}{" "}
          {stats.lastModel ? `Extraction by ${stats.lastModel} (${stats.lastPromptVersion}).` : ""}{" "}
          Ordering is computed by Luma, not by the model.
        </p>
      </section>
    </div>
  );
}
