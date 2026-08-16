"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/demo", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error ?? "Could not run the sample inbox");
        return;
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not run the sample inbox");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium disabled:opacity-60"
      >
        {busy ? "Reading the sample inbox…" : "Try it with a sample inbox"}
      </button>
      {error && <p className="text-xs text-[var(--color-now)]">{error}</p>}
    </div>
  );
}
