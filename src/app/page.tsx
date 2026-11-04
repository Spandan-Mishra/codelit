import Link from "next/link";
import AgentCta from "@/components/AgentCta";
import { Timer, MessageSquareWarning, Fingerprint, Trophy, Bot } from "lucide-react";

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-8 sm:py-10 grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:gap-10 items-start">
        <div className="min-w-0">
          <p className="font-ui text-xs tracking-[0.2em] text-[#e8b33d]">PROVE HOW YOU WORK WITH AI</p>
          <h1 className="mt-3 text-3xl sm:text-5xl leading-[1.1] sm:leading-[1.05] tracking-tight text-balance">Everyone has an agent. Show you can drive one.</h1>
          <p className="mt-3 sm:mt-4 font-ui text-sm sm:text-[15px] leading-6 sm:leading-7 text-[#c9c5ba] max-w-xl">
            You solve scenarios with your agent — every prompt captured automatically —
            then defend your decisions under time pressure. The trace is the test.
          </p>
          <div className="mt-5 sm:mt-6 flex flex-col sm:flex-row sm:flex-wrap gap-2.5 sm:gap-3 font-ui">
            <Link href="/scenarios" className="text-center px-5 py-2.5 rounded-md bg-[#e8b33d] text-black font-semibold text-sm hover:bg-[#f2c14e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">Run a scenario</Link>
            <Link href="/agents" className="text-center px-5 py-2.5 rounded-md border border-[#3a3c37] text-sm hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">Connect your agent</Link>
          </div>
          <div className="mt-6 sm:mt-8 grid gap-2.5 sm:grid-cols-3 sm:gap-3 font-ui text-sm">
            <div className="rounded-lg border border-[#262824] bg-[#141613] p-4"><Timer className="h-5 w-5 text-[#e8b33d]" /><p className="mt-2 font-semibold">Timed runs</p><p className="text-[#9a968c] text-[13px] mt-1 leading-5">Prompt budgets and clocks beat copy-paste.</p></div>
            <div className="rounded-lg border border-[#262824] bg-[#141613] p-4"><MessageSquareWarning className="h-5 w-5 text-[#e8b33d]" /><p className="mt-2 font-semibold">Trace defense</p><p className="text-[#9a968c] text-[13px] mt-1 leading-5">Justify your own decisions, not a borrowed answer.</p></div>
            <div className="rounded-lg border border-[#262824] bg-[#141613] p-4"><Fingerprint className="h-5 w-5 text-[#e8b33d]" /><p className="mt-2 font-semibold">Credibility passport</p><p className="text-[#9a968c] text-[13px] mt-1 leading-5">Defense traces, not green ticks.</p></div>
          </div>
        </div>
        <div className="rounded-lg border border-[#262824] bg-[#141613] p-5 font-ui lg:sticky lg:top-20">
          <p className="text-xs tracking-[0.18em] text-[#9a968c]">HOW IT WORKS</p>
          <ol className="mt-4 space-y-4 text-sm">
            <li className="flex gap-3"><span className="font-code text-[#e8b33d]">01</span><div><p className="font-semibold">Connect your agent</p><p className="text-[#9a968c] text-[13px]">Pair your computer once. Codex or Muse Code, signed in on your machine — your login never leaves it.</p></div></li>
            <li className="flex gap-3"><span className="font-code text-[#e8b33d]">02</span><div><p className="font-semibold">Practice</p><p className="text-[#9a968c] text-[13px]">Repeatable, unscored. Requirements arrive in stages; every prompt is captured for you.</p></div></li>
            <li className="flex gap-3"><span className="font-code text-[#e8b33d]">03</span><div><p className="font-semibold">Unlock Ranked</p><p className="text-[#9a968c] text-[13px]">Pass 5 practice scenarios to enter counted runs.</p></div></li>
            <li className="flex gap-3"><span className="font-code text-[#e8b33d]">04</span><div><p className="font-semibold">Defend the trace</p><p className="text-[#9a968c] text-[13px]">Timed questions on your code, choices, and prompts.</p></div></li>
            <li className="flex gap-3"><span className="font-code text-[#e8b33d]">05</span><div><p className="font-semibold">Bank your passport</p><p className="text-[#9a968c] text-[13px]">Defended scores land on your passport as proof.</p></div></li>
          </ol>
        </div>
      </section>

      <section className="pb-2">
        <div className="grid gap-2.5 sm:grid-cols-2 font-ui text-sm">
          <div className="rounded-lg border border-[#262824] bg-[#141613] p-4"><p className="flex items-center gap-2 font-semibold"><Bot className="h-4 w-4 text-[#e8b33d]" /> Practice</p><p className="text-[#9a968c] text-[13px] mt-1 leading-5">Learn the system. Repeatable, unscored, no defense.</p></div>
          <div className="rounded-lg border border-[#e8b33d]/30 bg-[#141613] p-4"><p className="flex items-center gap-2 font-semibold"><Trophy className="h-4 w-4 text-[#e8b33d]" /> Ranked</p><p className="text-[#9a968c] text-[13px] mt-1 leading-5">Counted runs. Finish, defend under time, score your passport.</p></div>
        </div>
      </section>

      <section className="py-8">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h2 className="text-xl sm:text-2xl tracking-tight">Agent duels</h2><span className="font-ui text-[11px] font-semibold text-[#e8b33d] border border-[#e8b33d]/40 rounded px-1.5 py-0.5">Coming soon</span></div>
        <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl leading-6">You and your agent against a house agent on the same scenario, live progress on both sides, first fully-passing run wins. Casual races first, competitive matchmaking after.</p>
        <Link href="/duels" className="inline-block mt-4 font-ui text-sm px-4 py-2 rounded-md border border-[#3a3c37] hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">What&apos;s planned →</Link>
      </section>

      <AgentCta />
    </div>
  );
}
