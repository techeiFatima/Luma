"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { InboxNotification } from "@/server/domain/notify";

/**
 * The one notification worth showing, and a way to make it go away.
 *
 * Only the most recent is displayed even when several are pending. A stack of
 * notification cards is how an assistant becomes wallpaper, and the notifier
 * already collapses bursts into a digest — showing them all here would undo
 * that restraint at the last step.
 */
export function NotificationBanner({ notifications }: { notifications: InboxNotification[] }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  const visible = notifications.filter((n) => !dismissed.includes(n.id));
  const notification = visible[0];
  if (!notification) return null;

  async function dismiss(id: string) {
    setDismissed((prev) => [...prev, id]);
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    startTransition(() => router.refresh());
  }

  const body = (
    <>
      <p className="text-sm font-medium text-[var(--color-ink)]">{notification.title}</p>
      {notification.body && (
        <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">{notification.body}</p>
      )}
    </>
  );

  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-4 py-3">
      <span
        aria-hidden
        className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
      />
      <div className="min-w-0 flex-1">
        {notification.loopId ? (
          <Link href={`/loops/${notification.loopId}`} className="block">
            {body}
          </Link>
        ) : (
          body
        )}
        {visible.length > 1 && (
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            and {visible.length - 1} more
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(notification.id)}
        aria-label="Dismiss notification"
        className="shrink-0 rounded-md px-1.5 py-0.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
      >
        ×
      </button>
    </div>
  );
}
