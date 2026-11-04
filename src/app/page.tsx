import Link from "next/link";
import { ALL_SCENARIOS } from "@/lib/scenarios";
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
            <Link href="/duels" className="text-center px-5 py-2.5 rounded-md border border-[#3a3c37] text-sm hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">Race the house pace</Link>
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
            <li className="flex gap-3"><span className="font-code text-[#e8b33d]">01</span><div><p className="font-semibold">Practice with your agent</p><p className="text-[#9a968c] text-[13px]">Requirements arrive in stages. Prompts are captured for you.</p></div></li>
            <li className="flex gap-3"><span className="font-code text-[#e8b33d]">02</span><div><p className="font-semibold">Unlock Ranked</p><p className="text-[#9a968c] text-[13px]">Pass 5 practice scenarios to enter counted runs.</p></div></li>
            <li className="flex gap-3"><span className="font-code text-[#e8b33d]">03</span><div><p className="font-semibold">Defend the trace</p><p className="text-[#9a968c] text-[13px]">Timed questions on your code, choices, and prompts.</p></div></li>
            <li className="flex gap-3"><span className="font-code text-[#e8b33d]">04</span><div><p className="font-semibold">Bank your passport</p><p className="text-[#9a968c] text-[13px]">Defended scores land on your passport as proof.</p></div></li>
          </ol>
        </div>
      </section>

      <section className="pb-2">
        <div className="grid gap-2.5 sm:grid-cols-2 font-ui text-sm">
          <div className="rounded-lg border border-[#262824] bg-[#141613] p-4"><p className="flex items-center gap-2 font-semibold"><Bot className="h-4 w-4 text-[#e8b33d]" /> Practice</p><p className="text-[#9a968c] text-[13px] mt-1 leading-5">Learn the system. Repeatable, unscored, no defense.</p></div>
          <div className="rounded-lg border border-[#e8b33d]/30 bg-[#141613] p-4"><p className="flex items-center gap-2 font-semibold"><Trophy className="h-4 w-4 text-[#e8b33d]" /> Ranked</p><p className="text-[#9a968c] text-[13px] mt-1 leading-5">Counted runs. Finish, defend under time, score your passport.</p></div>
        </div>
      </section>

      <section className="pb-6 pt-6">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-xl sm:text-2xl tracking-tight">Agent scenarios</h2>
          <Link href="/scenarios" className="shrink-0 font-ui text-sm text-[#e8b33d] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d] rounded">All scenarios →</Link>
        </div>
        <div className="mt-4 grid gap-3">
          {ALL_SCENARIOS.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-4 rounded-lg border border-[#262824] bg-[#141613] px-5 py-4">
              <div className="min-w-0 flex-1 basis-56">
                <h3 className="text-base sm:text-lg leading-snug">{s.title}</h3>
                <p className="font-ui text-xs text-[#9a968c] mt-0.5">{s.difficulty} · {s.tags.join(" · ")} · {s.minutes}m</p>
                <p className="font-ui text-xs leading-5 text-[#8a877d] mt-1 line-clamp-2">{s.blurb}</p>
              </div>
              <Link href="/scenarios" className="font-ui font-semibold text-sm px-4 py-2 rounded-md bg-[#e8b33d] text-black hover:bg-[#f2c14e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">Run →</Link>
            </div>
          ))}
        </div>
      </section>

      <section className="py-8">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h2 className="text-xl sm:text-2xl tracking-tight">Agent duels</h2><span className="font-ui text-xs text-[#9a968c]">you + your agent vs a simulated house pace · first green wins</span></div>
        <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl leading-6">Watch its progress live while you work. Beat it to earn credits toward harder difficulties.</p>
        <Link href="/duels" className="inline-block mt-4 font-ui text-sm px-4 py-2 rounded-md border border-[#3a3c37] hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">Open duels →</Link>
      </section>

      <AgentCta />
    </div>
  );
}
