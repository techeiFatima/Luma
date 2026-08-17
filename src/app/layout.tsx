import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Luma — What am I forgetting?",
  description:
    "Luma reads your inbox and surfaces the small number of unfinished things that actually need you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        {/*
          The header stays quiet: no counts, no badges, no navigation beyond
          settings. Anything with a number on it competes with the one sentence
          this product exists to deliver.
        */}
        <header className="border-b border-[var(--color-line)]">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
            <Link href="/" className="group flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block size-2 rounded-full bg-[var(--color-accent)]"
              />
              <span className="text-[15px] font-semibold tracking-tight">Luma</span>
            </Link>
            <nav className="text-sm">
              <Link
                href="/settings"
                className="text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
              >
                Settings
              </Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">{children}</main>

        <footer className="mx-auto w-full max-w-2xl px-6 pb-10 pt-6 text-xs leading-relaxed text-[var(--color-muted)]">
          Luma reads your mail and calendar to find unfinished things. It cannot send, delete, or
          change anything, and nothing leaves the app without your explicit approval.
        </footer>
      </body>
    </html>
  );
}
