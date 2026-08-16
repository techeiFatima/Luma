"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Triggers a sync. Reading mail is a safe, idempotent action, so it runs on a
 * click without a confirmation step — unlike anything that would leave the app.
 */
export function SyncButton({ label = "Check my inbox" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error ?? "Sync failed");
        return;
      }
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy || pending}
        className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy || pending ? "Checking…" : label}
      </button>
      {error && <p className="text-xs text-[var(--color-now)]">{error}</p>}
    </div>
  );
}
