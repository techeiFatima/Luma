import { DemoButton } from "./DemoButton";

/**
 * First-run state. Permissions are spelled out before the user clicks, not
 * buried in a consent screen they will skim.
 */
export function ConnectPanel({ googleConfigured }: { googleConfigured: boolean }) {
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
        <h1 className="text-xl font-semibold">What am I forgetting?</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
          Connect Gmail and Luma will read your recent mail to find the unfinished things that may
          still need you — deadlines, forms, renewals, payments, replies you owe. You don&apos;t
          create any of it by hand.
        </p>

        <div className="mt-5 rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] p-4">
          <h2 className="text-sm font-semibold">What Luma is allowed to do</h2>
          <ul className="mt-2 space-y-1 text-sm text-[var(--color-muted)]">
            <li>· Read your Gmail messages — read-only access.</li>
            <li>· Read your email address, to label the connected account.</li>
          </ul>
          <h2 className="mt-4 text-sm font-semibold">What it cannot do</h2>
          <ul className="mt-2 space-y-1 text-sm text-[var(--color-muted)]">
            <li>· Send, reply to, delete, or modify any mail.</li>
            <li>· Take any action outside Luma without your explicit approval.</li>
          </ul>
        </div>

        {googleConfigured ? (
          <a
            href="/api/auth/google"
            className="mt-5 inline-block rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
          >
            Connect Gmail
          </a>
        ) : (
          <p className="mt-5 rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3 text-sm text-[var(--color-muted)]">
            Gmail isn&apos;t configured on this instance. Set <code>GOOGLE_CLIENT_ID</code> and{" "}
            <code>GOOGLE_CLIENT_SECRET</code> to enable it — see <code>.env.example</code>.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-dashed border-[var(--color-line)] p-6">
        <h2 className="text-sm font-semibold">Just want to see how it works?</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Run the pipeline against a sample inbox. Same extraction, same verification, same
          prioritization — no account connected.
        </p>
        <div className="mt-4">
          <DemoButton />
        </div>
      </section>
    </div>
  );
}
