import Link from "next/link";
import { formatRelativeDue } from "@/lib/time";
import { CATEGORY_LABELS } from "@/server/loops/taxonomy";
import type { LoopListItem } from "@/server/loops/queries";

const BUCKET_STYLES: Record<string, string> = {
  now: "bg-[var(--color-now)]",
  soon: "bg-[var(--color-soon)]",
  later: "bg-[var(--color-later)]",
};

const BUCKET_LABELS: Record<string, string> = {
  now: "Needs you now",
  soon: "Soon",
  later: "Later",
};

function formatAmount(minor: number | null, currency: string | null): string | null {
  if (minor === null) return null;
  const value = (minor / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 2,
  });
  return value;
}

/**
 * `now` is a prop rather than a `Date.now()` call so the component is pure:
 * reading the clock during render makes output depend on when React happens to
 * re-render. The page reads the clock once and passes it down.
 */
export function LoopCard({ loop, now }: { loop: LoopListItem; now: Date }) {
  const amount = formatAmount(loop.amountMinor, loop.amountCurrency);
  const dueLabel = formatRelativeDue(loop.dueAt, now);
  const isOverdue = loop.dueAt !== null && loop.dueAt.getTime() < now.getTime();

  return (
    <li className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
      <Link href={`/loops/${loop.id}`} className="block px-5 py-4">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-block h-2 w-2 rounded-full ${BUCKET_STYLES[loop.priorityBucket] ?? BUCKET_STYLES.later}`}
            aria-hidden
          />
          <span className="font-medium uppercase tracking-wide text-[var(--color-muted)]">
            {BUCKET_LABELS[loop.priorityBucket] ?? "Later"}
          </span>
          <span className="text-[var(--color-muted)]">·</span>
          <span className="text-[var(--color-muted)]">{CATEGORY_LABELS[loop.category]}</span>
        </div>

        <h2 className="mt-2 text-base font-semibold leading-snug">{loop.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--color-muted)]">{loop.summary}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)]">
          <span className={isOverdue ? "font-semibold text-[var(--color-now)]" : ""}>
            {dueLabel}
            {loop.dueAt && loop.dueAtBasis === "inferred" ? " (estimated)" : ""}
          </span>
          {loop.counterpartyName && (
            <>
              <span aria-hidden>·</span>
              <span>{loop.counterpartyName}</span>
            </>
          )}
          {amount && (
            <>
              <span aria-hidden>·</span>
              <span>{amount}</span>
            </>
          )}
          <>
            <span aria-hidden>·</span>
            <span>
              {loop.evidenceCount} source{loop.evidenceCount === 1 ? "" : "s"}
            </span>
          </>
        </div>
      </Link>
    </li>
  );
}
