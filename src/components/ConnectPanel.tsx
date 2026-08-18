import { DemoButton } from "./DemoButton";

/**
 * The first thing anyone sees.
 *
 * Written for the case that actually happens on a fresh clone: nothing is
 * configured yet. An earlier version showed a "Connect Gmail" button that did
 * nothing without Google credentials and a sample-inbox button that failed
 * without an API key, so the whole page was inert — which is exactly how it
 * gets described. Now the path that always works comes first, and the two
 * optional credentials are shown as status with the steps to obtain them,
 * rather than as an error the reader has to decode.
 */
export function ConnectPanel({
  googleConfigured,
  aiConfigured,
}: {
  googleConfigured: boolean;
  aiConfigured: boolean;
}) {
  return (
    <div className="space-y-10">
      <section>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--color-muted)]">
          What am I forgetting?
        </p>
        <h1 className="answer mt-3 text-3xl font-normal sm:text-4xl">
          Luma reads your mail and tells you what you&apos;re forgetting.
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--color-ink-soft)]">
          Deadlines, forms, renewals, payments, replies you owe. You never type any of it in, and
          nothing appears unless Luma can point at the sentence it came from.
        </p>
      </section>

      {/* The path that works with nothing configured, first. */}
      <section className="card px-6 py-5">
        <h2 className="text-sm font-semibold">See it working now</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
          Open a sample inbox — no account, no keys, nothing to set up.
          {aiConfigured
            ? " Your API key is configured, so the real pipeline will analyze it."
            : " Results are prepared rather than analyzed until an API key is added."}
        </p>
        <div className="mt-4">
          <DemoButton />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--color-muted)]">
          Connect your own accounts
        </h2>

        <div className="card px-6 py-5">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-sm font-semibold">Gmail and Google Calendar</h3>
            <span
              className={`text-xs ${
                googleConfigured ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"
              }`}
            >
              {googleConfigured ? "ready" : "needs setup"}
            </span>
          </div>

          {googleConfigured ? (
            <>
              <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                Read-only access. Luma cannot send, delete, or change anything in your account.
              </p>
              <a
                href="/api/auth/google"
                className="mt-4 inline-block rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
              >
                Connect Gmail
              </a>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                Google requires credentials from your own account before any app can request
                access. This takes about five minutes, once:
              </p>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-[var(--color-ink-soft)]">
                <li>
                  In{" "}
                  <a
                    className="underline underline-offset-2"
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google Cloud Console
                  </a>
                  , create a project and enable the <strong>Gmail API</strong> and{" "}
                  <strong>Google Calendar API</strong>.
                </li>
                <li>
                  Create an OAuth client of type <strong>Web application</strong>, with redirect URI{" "}
                  <code className="rounded bg-[var(--color-canvas)] px-1 py-0.5 text-xs">
                    http://localhost:3000/api/auth/google/callback
                  </code>
                </li>
                <li>On the consent screen, add your own address as a test user.</li>
                <li>
                  Put the client ID and secret in <code className="text-xs">.env</code> as{" "}
                  <code className="text-xs">GOOGLE_CLIENT_ID</code> and{" "}
                  <code className="text-xs">GOOGLE_CLIENT_SECRET</code>, then restart.
                </li>
              </ol>
            </>
          )}
        </div>

        <div className="card px-6 py-5">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-sm font-semibold">Reading your mail with AI</h3>
            <span
              className={`text-xs ${
                aiConfigured ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"
              }`}
            >
              {aiConfigured ? "ready" : "needs setup"}
            </span>
          </div>
          <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
            {aiConfigured
              ? "Configured. Luma will analyze messages and check every claim against its source."
              : "Add ANTHROPIC_API_KEY to your .env to have Luma actually read messages. Roughly a cent per email."}
          </p>
        </div>
      </section>
    </div>
  );
}
