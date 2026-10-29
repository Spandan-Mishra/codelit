import Link from "next/link";
import { SCENARIOS } from "@/lib/scenarios";
import { Bot, Timer, MessageSquare } from "lucide-react";

export default function ScenariosPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <h1 className="text-3xl tracking-tight">Agent scenarios</h1>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl leading-6">
        Solve with an AI agent at your side. Stages unlock one at a time, your prompts are the trace,
        and the defense grades whether you understood what the agent wrote.
      </p>
      <p className="font-ui text-xs text-[#8a877d] mt-2 max-w-2xl leading-5">
        One shot per scenario per cooldown — finishing consumes the attempt either way.
      </p>

      {SCENARIOS.length === 0 ? (
        <div className="mt-6 rounded-lg border border-[#262824] bg-[#141613] px-5 py-8 text-center font-ui">
          <p className="text-sm font-semibold">No scenarios right now.</p>
          <p className="mt-1 text-[13px] text-[#9a968c]">Try Practice while new ones land.</p>
          <Link href="/practice" className="mt-4 inline-block text-sm px-4 py-2 rounded-md border border-[#3a3c37] hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">Go to Practice →</Link>
        </div>
      ) : (
        <div className="grid gap-2.5 mt-6">
          {SCENARIOS.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-[#262824] bg-[#141613] px-4 py-3.5 sm:px-5">
              <Bot className="h-5 w-5 text-[#e8b33d] shrink-0" />
              <div className="flex-1 min-w-0 basis-44">
                <h3 className="text-base sm:text-lg leading-snug tracking-tight">{s.title}</h3>
                <p className="font-ui text-xs text-[#9a968c] mt-0.5">{s.difficulty} · {s.tags.join(" · ")}</p>
              </div>
              <span className="font-ui text-[13px] text-[#9a968c] inline-flex items-center gap-1.5 whitespace-nowrap"><Timer className="h-4 w-4" /> {s.minutes}m · par {s.timePar}m</span>
              <span className="font-ui text-[13px] text-[#9a968c] inline-flex items-center gap-1.5 whitespace-nowrap"><MessageSquare className="h-4 w-4" /> par {s.promptPar} prompts</span>
              <Link href={`/agent/${s.id}`} className="font-ui font-semibold text-sm px-4 py-2 rounded-md bg-[#e8b33d] text-black hover:bg-[#f2c14e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">
                Start →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
