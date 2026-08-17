import Link from "next/link";
import { formatRelativeDue } from "@/lib/time";
import { CATEGORY_LABELS } from "@/server/loops/taxonomy";
import type { LoopListItem } from "@/server/loops/queries";
import { QuickActions } from "./QuickActions";

const BUCKET_DOT: Record<string, string> = {
  now: "bg-[var(--color-now)]",
  soon: "bg-[var(--color-soon)]",
  later: "bg-[var(--color-later)]",
};

function formatAmount(minor: number | null, currency: string | null): string | null {
  if (minor === null) return null;
  return (minor / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 2,
  });
}

/**
 * One thing the user might be forgetting.
 *
 * The card states the obligation and the few facts needed to judge it, and
 * nothing else — no confidence percentage, no priority score, no category
 * badge competing for attention. Those exist and are visible on the detail
 * page; putting them here would turn a short list of real-world problems into
 * a dashboard of metrics about them.
 *
 * `now` is a prop rather than a `Date.now()` call so the component is pure:
 * reading the clock during render makes output depend on when React happens to
 * re-render. The page reads the clock once and passes it down.
 */
export function LoopCard({ loop, now }: { loop: LoopListItem; now: Date }) {
  const amount = formatAmount(loop.amountMinor, loop.amountCurrency);
  const dueLabel = formatRelativeDue(loop.dueAt, now);
  const isOverdue = loop.dueAt !== null && loop.dueAt.getTime() < now.getTime();
  const isEstimated = loop.dueAt !== null && loop.dueAtBasis === "inferred";

  const facts = [
    loop.counterpartyName,
    amount,
    `${loop.evidenceCount} source${loop.evidenceCount === 1 ? "" : "s"}`,
  ].filter(Boolean) as string[];

  return (
    <li className="card card-interactive group">
      <Link href={`/loops/${loop.id}`} className="block px-5 pt-4 pb-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={`mt-[7px] inline-block size-2 shrink-0 rounded-full ${
              BUCKET_DOT[loop.priorityBucket] ?? BUCKET_DOT.later
            }`}
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-snug text-[var(--color-ink)]">
              {loop.title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {loop.summary}
            </p>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted)]">
              <span
                className={
                  isOverdue ? "font-semibold text-[var(--color-now)]" : "text-[var(--color-ink-soft)]"
                }
              >
                {dueLabel}
              </span>
              {/*
                An inferred date is shown as an estimate every time it appears.
                A date Luma worked out and a date the sender wrote down are
                different kinds of claim, and the difference has to survive into
                the smallest surface that shows it.
              */}
              {isEstimated && (
                <span className="rounded-full border border-[var(--color-line)] px-1.5 py-px text-[10px] uppercase tracking-wide">
                  estimated
                </span>
              )}
              <span aria-hidden>·</span>
              <span>{CATEGORY_LABELS[loop.category]}</span>
              {facts.map((fact) => (
                <span key={fact} className="contents">
                  <span aria-hidden>·</span>
                  <span>{fact}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </Link>

      {/*
        Kept out of the link so acting on a card never navigates by accident,
        and dimmed until hover or focus so a calm list does not read as a row
        of buttons.
      */}
      <div className="border-t border-[var(--color-line-soft)] px-5 py-2 opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <QuickActions loopId={loop.id} dueAt={loop.dueAt?.toISOString() ?? null} />
      </div>
    </li>
  );
}
