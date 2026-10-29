import Link from "next/link";
import { PROBLEMS, DEBUG_CHALLENGES } from "@/lib/problems";
import ProblemList from "@/components/ProblemList";
import { Timer, MessageSquareWarning, Bug, Fingerprint } from "lucide-react";

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-12 grid lg:grid-cols-[1.2fr_0.8fr] gap-10 items-start">
        <div>
          <p className="font-ui text-xs tracking-[0.2em] text-[#e8b33d]">CODING PREP THAT CAN&apos;T BE PASTED</p>
          <h1 className="mt-3 text-4xl sm:text-5xl leading-[1.05] tracking-tight">Pasting an answer takes 20 seconds. Defending it takes understanding.</h1>
          <p className="mt-4 font-ui text-[15px] leading-7 text-[#c9c5ba] max-w-xl">
            A screenshot and an AI model solve any static problem. Codelit asks for proof instead:
            a timed defense of your own code, and debugging against a clock.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 font-ui">
            <Link href="/practice" className="px-5 py-2.5 rounded-md bg-[#e8b33d] text-black font-semibold text-sm">Start practicing</Link>
            <Link href="/arena" className="px-5 py-2.5 rounded-md border border-[#3a3c37] text-sm hover:bg-white/5">Graded Arena (one shot)</Link>
          </div>
          <div className="mt-8 grid sm:grid-cols-3 gap-3 font-ui text-sm">
            <div className="rounded-lg border border-[#262824] bg-[#141613] p-4"><Timer className="h-5 w-5 text-[#e8b33d]" /><p className="mt-2 font-semibold">90-second rounds</p><p className="text-[#9a968c] text-[13px] mt-1">Too short to re-prompt an AI three times.</p></div>
            <div className="rounded-lg border border-[#262824] bg-[#141613] p-4"><MessageSquareWarning className="h-5 w-5 text-[#e8b33d]" /><p className="mt-2 font-semibold">Your lines, mutated</p><p className="text-[#9a968c] text-[13px] mt-1">Follow-ups flip your code. Generic answers fail.</p></div>
            <div className="rounded-lg border border-[#262824] bg-[#141613] p-4"><Fingerprint className="h-5 w-5 text-[#e8b33d]" /><p className="mt-2 font-semibold">Credibility passport</p><p className="text-[#9a968c] text-[13px] mt-1">Defense traces, not green ticks.</p></div>
          </div>
        </div>
        <div className="rounded-lg border border-[#262824] bg-[#141613] p-5 font-ui">
          <p className="text-xs tracking-[0.18em] text-[#9a968c]">HOW IT WORKS</p>
          <ol className="mt-4 space-y-4 text-sm">
            <li className="flex gap-3"><span className="font-code text-[#e8b33d]">01</span><div><p className="font-semibold">Solve</p><p className="text-[#9a968c] text-[13px]">Editor + tests. Repeat freely in Practice.</p></div></li>
            <li className="flex gap-3"><span className="font-code text-[#e8b33d]">02</span><div><p className="font-semibold">Defend (3 × 90s)</p><p className="text-[#9a968c] text-[13px]">Intent, live mutation of your lines, trade-off.</p></div></li>
            <li className="flex gap-3"><span className="font-code text-[#e8b33d]">03</span><div><p className="font-semibold">Debug Under Fire</p><p className="text-[#9a968c] text-[13px]">Fix broken code on a prompt budget.</p></div></li>
            <li className="flex gap-3"><span className="font-code text-[#e8b33d]">04</span><div><p className="font-semibold">Passport</p><p className="text-[#9a968c] text-[13px]">Arena locks after one attempt — like an interview.</p></div></li>
          </ol>
        </div>
      </section>

      <section className="pb-6">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl">Practice — repeat until it is yours</h2>
          <Link href="/practice" className="font-ui text-sm text-[#e8b33d]">All practice →</Link>
        </div>
        <div className="mt-4"><ProblemList problems={PROBLEMS.filter((p) => p.mode === "practice")} /></div>
      </section>

      <section className="py-8">
        <div className="flex items-center gap-2"><Bug className="h-5 w-5 text-[#e8b33d]" /><h2 className="text-2xl">Debug Under Fire</h2><span className="font-ui text-xs text-[#9a968c]">{DEBUG_CHALLENGES.length} challenges · timed · limited prompts</span></div>
        <Link href="/debug" className="inline-block mt-4 font-ui text-sm px-4 py-2 rounded-md border border-[#3a3c37] hover:bg-white/5">Open debug arena →</Link>
      </section>
    </div>
  );
}
