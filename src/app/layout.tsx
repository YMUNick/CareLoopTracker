import type { Metadata } from "next";
import { Inter, Noto_Sans_Arabic } from "next/font/google";
import Link from "next/link";
import { ResetButton } from "@/components/ResetButton";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const notoArabic = Noto_Sans_Arabic({ variable: "--font-noto-arabic", subsets: ["arabic"] });

export const metadata: Metadata = {
  title: "Care Loop Tracker",
  description: "Every abnormal screening result has an owner, is followed to closure, and leaves an audit trail.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${notoArabic.variable} antialiased`}>
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold text-primary">
              Care Loop Tracker
            </Link>
            <nav className="flex gap-4 text-sm text-muted">
              <Link href="/" className="hover:text-foreground">Today</Link>
              <Link href="/tickets" className="hover:text-foreground">All tickets</Link>
              <Link href="/escalations" className="hover:text-foreground">Escalations</Link>
              <Link href="/about" className="hover:text-foreground">About</Link>
            </nav>
            <span className="ml-auto text-sm text-muted">Signed in as Nurse Mariam K. (demo)</span>
          </div>
        </header>
        <div className="bg-warn-soft text-warn">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-1.5 text-xs">
            <span>Prototype · synthetic data only · not for clinical use · newborn hearing screening programme</span>
            <ResetButton />
          </div>
        </div>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
