import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codelit — prove you wrote it",
  description: "Cheat-resistant coding prep: solve, then defend your code under timed interrogation.",
};

const NAV = [
  { href: "/practice", label: "Practice" },
  { href: "/arena", label: "Arena · Graded" },
  { href: "/debug", label: "Debug Under Fire" },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/passport", label: "Passport" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:rounded-md focus:bg-[#e8b33d] focus:text-black focus:font-ui focus:text-sm focus:font-semibold">
          Skip to content
        </a>
        <header className="border-b border-[#262824] bg-[#0c0d0b]/95 sticky top-0 z-40">
          <div className="mx-auto max-w-6xl px-4 min-h-14 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <Link href="/" className="font-code font-bold tracking-tight text-lg rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">
              code<span className="text-[#e8b33d]">lit</span>
              <span className="ml-2 hidden md:inline text-[11px] font-ui font-normal text-[#9a968c]">prove you wrote it</span>
            </Link>
            <nav aria-label="Primary" className="ml-auto flex items-center gap-0.5 sm:gap-1 font-ui text-[13px] sm:text-sm overflow-x-auto">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="shrink-0 px-2.5 sm:px-3 py-1.5 rounded-md text-[#c9c5ba] hover:text-white hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#e8b33d]">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main id="main" className="flex-1">{children}</main>
        <footer className="border-t border-[#262824] py-6">
          <div className="mx-auto max-w-6xl px-4 flex flex-wrap gap-3 items-center justify-between font-ui text-xs text-[#8a877d]">
            <span>Codelit — solve, defend, repeat.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
