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
      <body className="min-h-screen">
        <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-tight">Luma</span>
              <span className="text-sm text-[var(--color-muted)]">What am I forgetting?</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-[var(--color-muted)]">
              <Link href="/settings" className="hover:text-[var(--color-ink)]">
                Settings
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-3xl px-6 pb-10 text-xs text-[var(--color-muted)]">
          Luma reads email to find open loops. It never sends, deletes, or changes anything without
          your explicit approval.
        </footer>
      </body>
    </html>
  );
}
