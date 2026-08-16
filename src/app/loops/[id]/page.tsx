import Link from "next/link";
import { notFound } from "next/navigation";
import { LoopActions } from "@/components/LoopActions";
import { getSessionUserId } from "@/lib/session";
import { formatRelativeDue, formatSentAt } from "@/lib/time";
import { getLoopDetail } from "@/server/loops/queries";
import { CATEGORY_LABELS, isLoopCategory } from "@/server/loops/taxonomy";

export const dynamic = "force-dynamic";

export default async function LoopDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await getSessionUserId();
  if (!userId) notFound();

  const { id } = await params;
  const loop = await getLoopDetail(userId, id);
  if (!loop) notFound();

  const category = isLoopCategory(loop.category) ? loop.category : "other";
  const claimEvidence = loop.evidence.filter((item) => item.supports === "claim");

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]">
        ← Back
      </Link>

      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
          {CATEGORY_LABELS[category]}
        </p>
        <h1 className="text-2xl font-semibold leading-tight">{loop.title}</h1>
        <p className="text-sm leading-relaxed text-[var(--color-muted)]">{loop.summary}</p>
      </header>

      <LoopActions loopId={loop.id} status={loop.status} />

      {/* Facts and inference are presented separately, and labelled. */}
      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="text-sm font-semibold">What the source says</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex gap-3">
            <dt className="w-32 shrink-0 text-[var(--color-muted)]">Deadline</dt>
            <dd>
              {loop.dueAt === null ? (
                <span className="text-[var(--color-muted)]">No date stated</span>
              ) : loop.dueAtBasis === "explicit" ? (
                <>
                  <span>{formatRelativeDue(loop.dueAt)}</span>
                  <span className="ml-2 rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-xs text-[var(--color-muted)]">
                    stated in the email
                  </span>
                </>
              ) : (
                <>
                  <span>{formatRelativeDue(loop.dueAt)}</span>
                  <span className="ml-2 rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-xs text-[var(--color-muted)]">
                    estimated by Luma
                  </span>
                </>
              )}
            </dd>
          </div>
          {loop.dueAtEvidence && (
            <div className="flex gap-3">
              <dt className="w-32 shrink-0 text-[var(--color-muted)]">Quoted</dt>
              <dd className="italic">&ldquo;{loop.dueAtEvidence}&rdquo;</dd>
            </div>
          )}
          {(loop.counterpartyName || loop.counterpartyEmail) && (
            <div className="flex gap-3">
              <dt className="w-32 shrink-0 text-[var(--color-muted)]">Who</dt>
              <dd>
                {loop.counterpartyName ?? loop.counterpartyEmail}
                {loop.counterpartyName && loop.counterpartyEmail && (
                  <span className="text-[var(--color-muted)]"> · {loop.counterpartyEmail}</span>
                )}
              </dd>
            </div>
          )}
          {loop.amountMinor !== null && (
            <div className="flex gap-3">
              <dt className="w-32 shrink-0 text-[var(--color-muted)]">Amount</dt>
              <dd>
                {(loop.amountMinor / 100).toLocaleString(undefined, {
                  style: "currency",
                  currency: loop.amountCurrency ?? "USD",
                })}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="text-sm font-semibold">What Luma worked out</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
          {loop.inferenceNotes ?? "Everything above is stated directly in the source."}
        </p>
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Confidence {Math.round(loop.confidence * 100)}% · {loop.consequence} consequence ·
          priority {loop.priorityScore}/100 ({loop.priorityBucket})
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          Where this came from ({claimEvidence.length} quote
          {claimEvidence.length === 1 ? "" : "s"})
        </h2>
        {claimEvidence.map((item) => (
          <article
            key={item.id}
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
          >
            <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-[var(--color-muted)]">
              <span className="font-medium text-[var(--color-ink)]">
                {item.document.fromName ?? item.document.fromEmail ?? "Unknown sender"}
              </span>
              <span>{formatSentAt(item.document.sentAt)}</span>
            </div>
            <p className="mt-1 text-sm font-medium">{item.document.subject ?? "(no subject)"}</p>
            <blockquote className="mt-2 border-l-2 border-[var(--color-line)] pl-3 text-sm italic text-[var(--color-muted)]">
              {item.quote}
            </blockquote>
          </article>
        ))}
        <p className="text-xs text-[var(--color-muted)]">
          Every quote above was checked against the original message before this loop was saved.
        </p>
      </section>
    </div>
  );
}
