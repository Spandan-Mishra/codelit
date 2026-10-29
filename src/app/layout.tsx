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
  { href: "/passport", label: "Passport" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-[#262824] bg-[#0c0d0b]/95 sticky top-0 z-40">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-6">
            <Link href="/" className="font-code font-bold tracking-tight text-lg">
              code<span className="text-[#e8b33d]">lit</span>
              <span className="ml-2 hidden sm:inline text-[11px] font-ui font-normal text-[#9a968c]">prove you wrote it</span>
            </Link>
            <nav className="ml-auto flex items-center gap-1 font-ui text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="px-3 py-1.5 rounded-md text-[#c9c5ba] hover:text-white hover:bg-white/5">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[#262824] py-6">
          <div className="mx-auto max-w-6xl px-4 flex flex-wrap gap-3 items-center justify-between font-ui text-xs text-[#8a877d]">
            <span>Codelit — solve, defend, repeat.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
