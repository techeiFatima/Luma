import { prisma } from "@/lib/db";
import { getConfig } from "@/config";
import { getSessionUserId } from "@/lib/session";
import { ConnectPanel } from "@/components/ConnectPanel";
import { BriefingPanel } from "@/components/Briefing";
import { LoopCard } from "@/components/LoopCard";
import { NotificationBanner } from "@/components/NotificationBanner";
import { SyncButton } from "@/components/SyncButton";
import { getDashboardStats, listOpenLoops, listSnoozedLoops } from "@/server/loops/queries";
import { buildBriefing } from "@/server/loops/briefing";
import { listNotifications } from "@/server/domain/notify";
import { rescoreOpenLoops } from "@/server/loops/persist";
import { formatRelativeDue, formatSentAt } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const userId = await getSessionUserId();
  const googleConfigured = getConfig().google.enabled;

  if (!userId) return <ConnectPanel googleConfigured={googleConfigured} />;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return <ConnectPanel googleConfigured={googleConfigured} />;

  // Urgency is a function of the current time, so scores are refreshed on read.
  // This also wakes any snooze whose time has come.
  const now = new Date();
  await rescoreOpenLoops(userId, now);

  const [{ items, total }, stats, snoozed, notifications] = await Promise.all([
    listOpenLoops(userId, undefined, now),
    getDashboardStats(userId),
    listSnoozedLoops(userId, now),
    listNotifications(userId, now),
  ]);

  const briefing = buildBriefing(
    items,
    {
      hasSynced: stats.lastSyncedAt !== null,
      pendingAnalysis: stats.pendingAnalysis,
      lastRunError: stats.lastRunError,
    },
    now,
  );

  const hidden = total - items.length;

  return (
    <div className="space-y-8">
      {notifications.length > 0 && <NotificationBanner notifications={notifications} />}

      <div className="flex items-start justify-between gap-6">
        <BriefingPanel briefing={briefing} />
        <div className="shrink-0 pt-1">
          <SyncButton />
        </div>
      </div>

      {/*
        An incomplete run is stated in the briefing, but repeated here with the
        detail, because a list that silently omits things is worse than an
        error message.
      */}
      {stats.pendingAnalysis > 0 && items.length > 0 && (
        <div className="card border-[var(--color-now)] px-5 py-4">
          <p className="text-sm font-medium">This list may be incomplete.</p>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            {stats.pendingAnalysis} message{stats.pendingAnalysis === 1 ? "" : "s"} could not be
            analyzed{stats.lastRunError ? `: ${stats.lastRunError}` : ""}. Try checking again.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-3">
          {items.map((loop) => (
            <LoopCard key={loop.id} loop={loop} now={now} />
          ))}
        </ul>
      )}

      {hidden > 0 && (
        <p className="text-sm text-[var(--color-muted)]">
          {hidden} less pressing {hidden === 1 ? "item is" : "items are"} not shown. Luma keeps this
          list short on purpose.
        </p>
      )}

      {snoozed.length > 0 && (
        <section aria-labelledby="snoozed-heading" className="space-y-2">
          <h2
            id="snoozed-heading"
            className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--color-muted)]"
          >
            Snoozed
          </h2>
          <ul className="divide-y divide-[var(--color-line-soft)] overflow-hidden rounded-xl border border-[var(--color-line)]">
            {snoozed.map((loop) => (
              <li
                key={loop.id}
                className="flex items-center justify-between gap-4 bg-[var(--color-surface)] px-4 py-2.5 text-sm"
              >
                <span className="truncate text-[var(--color-ink-soft)]">{loop.title}</span>
                <span className="shrink-0 text-xs text-[var(--color-muted)]">
                  back {formatRelativeDue(loop.snoozedUntil, now).toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {items.length === 0 && snoozed.length === 0 && (
        <div className="rounded-xl border border-dashed border-[var(--color-line)] px-6 py-10 text-center">
          <p className="text-sm text-[var(--color-ink-soft)]">
            {stats.documents === 0
              ? "Connect your inbox and Luma will start noticing things for you."
              : briefing.tone === "clear"
                ? "That's a real answer, not an error. Luma read your recent mail and found nothing unfinished."
                : "Try checking your inbox again."}
          </p>
        </div>
      )}

      {/*
        Transparency without a control panel: how the list was built is worth
        being able to check, and worth staying closed until someone asks.
      */}
      <details className="group border-t border-[var(--color-line)] pt-4">
        <summary className="cursor-pointer list-none text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]">
          How Luma built this list
          <span className="ml-1 inline-block transition-transform group-open:rotate-90">›</span>
        </summary>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          {[
            ["Messages read", stats.documents],
            ["Skipped as bulk", stats.bulkFiltered],
            ["Analyzed", stats.processed],
            ["Open loops", stats.openLoops],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-xs uppercase tracking-wide text-[var(--color-muted)]">{label}</dt>
              <dd className="mt-0.5 text-[var(--color-ink)]">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-[var(--color-muted)]">
          {stats.lastSyncedAt
            ? `Last checked ${formatSentAt(stats.lastSyncedAt, now)}.`
            : "Not synced yet."}{" "}
          {stats.lastModel ? `Read by ${stats.lastModel}.` : ""} Every item is checked against its
          source before it appears, and the ordering is computed by Luma rather than by the model.
        </p>
      </details>
    </div>
  );
}
