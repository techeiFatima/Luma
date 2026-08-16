"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Status changes are local to Luma — marking a loop done does not touch the
 * user's mailbox. Anything that would leave the app (sending a draft, creating
 * a calendar event) is a separate, explicitly approved action and is not part
 * of this MVP.
 */
export function LoopActions({ loopId, status }: { loopId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update(next: string) {
    setBusy(next);
    setError(null);
    try {
      const response = await fetch(`/api/loops/${loopId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body?.error?.message ?? "Could not update");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (status !== "open") {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-[var(--color-muted)]">
          Marked {status === "done" ? "done" : "not relevant"}.
        </span>
        <button
          type="button"
          onClick={() => update("open")}
          disabled={busy !== null}
          className="text-sm underline underline-offset-2 disabled:opacity-60"
        >
          Reopen
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => update("done")}
        disabled={busy !== null}
        className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy === "done" ? "Saving…" : "Mark done"}
      </button>
      <button
        type="button"
        onClick={() => update("dismissed")}
        disabled={busy !== null}
        className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {busy === "dismissed" ? "Saving…" : "Not relevant"}
      </button>
      {error && <span className="text-xs text-[var(--color-now)]">{error}</span>}
    </div>
  );
}
