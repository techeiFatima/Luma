import type { Briefing } from "@/server/loops/briefing";

/**
 * The answer to the question the product is named after.
 *
 * Given the top of the page, in a serif, as a sentence. Everything below it is
 * supporting evidence for this one claim — which is why the claim is computed
 * rather than generated, and why the tone changes the punctuation of the page
 * rather than its colour scheme.
 */

const TONE_DOT: Record<string, string> = {
  urgent: "var(--color-now)",
  steady: "var(--color-soon)",
  clear: "var(--color-accent)",
  unknown: "var(--color-muted)",
};

export function BriefingPanel({ briefing }: { briefing: Briefing }) {
  return (
    <section aria-labelledby="briefing-heading" className="pb-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block size-1.5 rounded-full"
          style={{ backgroundColor: TONE_DOT[briefing.tone] ?? "var(--color-muted)" }}
        />
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--color-muted)]">
          What am I forgetting?
        </p>
      </div>

      <h1
        id="briefing-heading"
        className="answer mt-3 text-3xl font-normal text-[var(--color-ink)] sm:text-4xl"
      >
        {briefing.headline}
      </h1>

      {briefing.detail.length > 0 && (
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--color-ink-soft)]">
          {briefing.detail.join(" ")}
        </p>
      )}
    </section>
  );
}
