"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Suggested actions, and the approval they require.
 *
 * Every proposal states in plain language exactly what will happen before the
 * user agrees to it, and nothing here can run on its own — approving is the
 * only path to execution, and the server re-checks that independently. A draft
 * is shown for the user to copy; Luma has no ability to send it, because the
 * OAuth scopes it holds do not permit sending at all.
 */

export interface ActionView {
  id: string;
  type: string;
  status: string;
  summary: string;
  requiresApproval: boolean;
  result: string | null;
  error: string | null;
}

interface DraftResult {
  to: string | null;
  subject: string;
  body: string;
  delivery: string;
}

function parseDraft(result: string | null): DraftResult | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result) as Partial<DraftResult>;
    if (typeof parsed.body !== "string" || typeof parsed.subject !== "string") return null;
    return {
      to: parsed.to ?? null,
      subject: parsed.subject,
      body: parsed.body,
      delivery: parsed.delivery ?? "not sent",
    };
  } catch {
    return null;
  }
}

function DraftView({ draft }: { draft: DraftResult }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="mt-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-3">
      {draft.to && (
        <p className="text-xs text-[var(--color-muted)]">
          To <span className="text-[var(--color-ink-soft)]">{draft.to}</span>
        </p>
      )}
      <p className="mt-1 text-sm font-medium">{draft.subject}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink-soft)]">
        {draft.body}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-accent)]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <span className="text-xs text-[var(--color-muted)]">{draft.delivery}</span>
      </div>
    </div>
  );
}

export function ActionPanel({ actions }: { actions: ActionView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const pending = actions.filter((a) => a.status === "proposed");
  const done = actions.filter((a) => a.status === "executed");

  if (pending.length === 0 && done.length === 0) return null;

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/actions/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload?.error?.message ?? "That didn't work.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="actions-heading" className="card px-5 py-4">
      <h2 id="actions-heading" className="text-sm font-semibold">
        Luma can help with this
      </h2>

      <ul className="mt-3 space-y-3">
        {pending.map((action) => (
          <li key={action.id}>
            <p className="text-sm text-[var(--color-ink-soft)]">{action.summary}</p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => decide(action.id, "approve")}
                disabled={busy !== null}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
              >
                {busy === action.id ? "Working…" : "Do it"}
              </button>
              <button
                type="button"
                onClick={() => decide(action.id, "reject")}
                disabled={busy !== null}
                className="rounded-md px-2.5 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-60"
              >
                No thanks
              </button>
              {action.requiresApproval && (
                <span className="text-xs text-[var(--color-muted)]">Needs your approval</span>
              )}
            </div>
          </li>
        ))}

        {done.map((action) => {
          const draft = action.type === "draft_email" ? parseDraft(action.result) : null;
          return (
            <li key={action.id}>
              <p className="text-sm text-[var(--color-muted)]">
                {action.type === "create_reminder" ? "Reminder set." : "Draft ready to review."}
              </p>
              {draft && <DraftView draft={draft} />}
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-2 text-xs text-[var(--color-now)]">{error}</p>}
    </section>
  );
}
