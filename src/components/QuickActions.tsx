"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Done, snooze, dismiss — from the list, without opening anything.
 *
 * Snooze times are computed in the browser on purpose. "Tomorrow morning" is a
 * fact about where the user is sitting, and the server has no idea; a snooze
 * that reappears at 3am because the server assumed UTC is a broken promise
 * dressed as a feature.
 */

function tomorrowMorning(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}

function nextWeek(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setHours(9, 0, 0, 0);
  return date;
}

/** The day before something is due, so a snooze cannot hide it past the point of use. */
function dayBefore(dueAt: string): Date | null {
  const due = new Date(dueAt);
  const date = new Date(due.getTime() - 24 * 60 * 60 * 1000);
  date.setHours(9, 0, 0, 0);
  return date.getTime() > Date.now() ? date : null;
}

export function QuickActions({ loopId, dueAt }: { loopId: string; dueAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function update(label: string, status: string, snoozeUntil?: Date) {
    setBusy(label);
    setError(null);
    try {
      const response = await fetch(`/api/loops/${loopId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          ...(snoozeUntil ? { snoozeUntil: snoozeUntil.toISOString() } : {}),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload?.error?.message ?? "That didn't work.");
        return;
      }
      setMenuOpen(false);
      startTransition(() => router.refresh());
    } catch {
      setError("That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  const beforeDue = dueAt ? dayBefore(dueAt) : null;

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <button
        type="button"
        onClick={() => update("done", "done")}
        disabled={busy !== null}
        className="rounded-md px-2 py-1 font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:opacity-50"
      >
        {busy === "done" ? "Saving…" : "Done"}
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          disabled={busy !== null}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="rounded-md px-2 py-1 text-[var(--color-muted)] hover:bg-[var(--color-line-soft)] hover:text-[var(--color-ink)] disabled:opacity-50"
        >
          Snooze
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute left-0 z-10 mt-1 w-44 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => update("snooze", "snoozed", tomorrowMorning())}
              className="block w-full px-3 py-1.5 text-left hover:bg-[var(--color-line-soft)]"
            >
              Tomorrow morning
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => update("snooze", "snoozed", nextWeek())}
              className="block w-full px-3 py-1.5 text-left hover:bg-[var(--color-line-soft)]"
            >
              Next week
            </button>
            {beforeDue && (
              <button
                type="button"
                role="menuitem"
                onClick={() => update("snooze", "snoozed", beforeDue)}
                className="block w-full px-3 py-1.5 text-left hover:bg-[var(--color-line-soft)]"
              >
                The day before it&apos;s due
              </button>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => update("dismiss", "dismissed")}
        disabled={busy !== null}
        className="rounded-md px-2 py-1 text-[var(--color-muted)] hover:bg-[var(--color-line-soft)] hover:text-[var(--color-ink)] disabled:opacity-50"
      >
        {busy === "dismiss" ? "Saving…" : "Not mine"}
      </button>

      {error && <span className="ml-1 text-[var(--color-now)]">{error}</span>}
    </div>
  );
}
