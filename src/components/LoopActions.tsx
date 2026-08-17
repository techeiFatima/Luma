"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { QuickActions } from "./QuickActions";

/**
 * Status changes are local to Luma — marking a loop done does not touch the
 * user's mailbox. Anything that would leave the app goes through the Action
 * table and its own approval.
 */
export function LoopActions({
  loopId,
  status,
  dueAt,
  snoozedUntil,
}: {
  loopId: string;
  status: string;
  dueAt: string | null;
  snoozedUntil: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function reopen() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/loops/${loopId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "open" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload?.error?.message ?? "That didn't work.");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  if (status === "open") {
    return <QuickActions loopId={loopId} dueAt={dueAt} />;
  }

  const label =
    status === "done"
      ? "Marked done."
      : status === "dismissed"
        ? "Marked as not yours."
        : snoozedUntil
          ? `Snoozed until ${new Date(snoozedUntil).toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}.`
          : "Snoozed.";

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-[var(--color-muted)]">{label}</span>
      <button
        type="button"
        onClick={reopen}
        disabled={busy}
        className="text-[var(--color-accent)] underline underline-offset-2 disabled:opacity-60"
      >
        {busy ? "Reopening…" : "Reopen"}
      </button>
      {error && <span className="text-xs text-[var(--color-now)]">{error}</span>}
    </div>
  );
}
