"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Disconnects a connected account.
 *
 * Unlike syncing, this is not reversible without going through Google's consent
 * screen again, and it can optionally delete stored mail — so it confirms
 * first, and it states plainly what each choice does rather than relying on the
 * word "disconnect" to carry the meaning.
 */
export function DisconnectButton({
  accountId,
  accountLabel,
}: {
  accountId: string;
  accountLabel: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [purgeData, setPurgeData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/accounts/${accountId}/disconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purgeData }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? "Could not disconnect this account.");
        return;
      }
      setConfirming(false);
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect this account.");
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-xs"
      >
        Disconnect
      </button>
    );
  }

  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] p-3">
      <p className="text-xs">
        Disconnect <span className="font-medium">{accountLabel}</span>? Luma will revoke its access
        at Google and delete the stored tokens. It will stop reading this mailbox.
      </p>
      <label className="mt-2 flex items-start gap-2 text-xs text-[var(--color-muted)]">
        <input
          type="checkbox"
          checked={purgeData}
          onChange={(event) => setPurgeData(event.target.checked)}
          className="mt-0.5"
        />
        <span>
          Also delete the mail Luma stored and the Open Loops drawn from it. Without this, what Luma
          already found stays on your dashboard.
        </span>
      </label>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={disconnect}
          disabled={busy || pending}
          className="rounded-md bg-[var(--color-now)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        >
          {busy || pending ? "Disconnecting…" : "Disconnect"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-xs"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--color-now)]">{error}</p>}
    </div>
  );
}
