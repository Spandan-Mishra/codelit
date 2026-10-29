import Link from "next/link";
import { ALL_SCENARIOS as SCENARIOS } from "@/lib/scenarios";
import { DIFFICULTIES, type DifficultyKey } from "@/lib/duel";
import DuelCredits from "@/components/DuelCredits";
import Leaderboard from "@/components/Leaderboard";
import { Bot, Lock, MessageSquare, Swords, Timer } from "lucide-react";

const ORDER: DifficultyKey[] = ["easy", "medium", "hard"];

export default function DuelsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl tracking-tight">Agent duels</h1>
        <span className="ml-auto">
          <DuelCredits />
        </span>
      </div>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl leading-6">
        You + your agent vs the house agent. First green wins, and wins pay +2 credits.
      </p>

      <div className="grid gap-2.5 mt-6 sm:grid-cols-3">
        {ORDER.map((key) => {
          const d = DIFFICULTIES[key];
          return (
            <div
              key={key}
              className={`rounded-lg border bg-[#141613] px-4 py-4 font-ui ${
                d.locked ? "border-dashed border-[#3a3c37]" : "border-[#262824]"
              }`}
            >
              <p className="font-semibold text-sm flex items-center gap-2">
                {d.locked ? <Lock className="h-4 w-4 text-[#8a877d]" /> : <Swords className="h-4 w-4 text-[#e8b33d]" />}
                {d.label}
              </p>
              <p className="text-xs text-[#9a968c] mt-1.5 leading-5">
                {d.model} · solves in ~{Math.round(d.targetSolveSec / 60)}m
              </p>
              {d.locked ? (
                <p className="text-xs text-[#8a877d] mt-2 leading-5">
                  Entry: {d.cost} credits · earn credits by winning duels.
                </p>
              ) : (
                <p className="text-xs text-[#8a877d] mt-2 leading-5">Free entry · start below.</p>
              )}
            </div>
          );
        })}
      </div>

      {SCENARIOS.length === 0 ? (
        <div className="mt-6 rounded-lg border border-[#262824] bg-[#141613] px-5 py-8 text-center font-ui">
          <p className="text-sm font-semibold">No scenarios right now.</p>
          <p className="mt-1 text-[13px] text-[#9a968c]">New ones land soon.</p>
        </div>
      ) : (
        <div className="grid gap-2.5 mt-6">
          {SCENARIOS.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-[#262824] bg-[#141613] px-4 py-3.5 sm:px-5"
            >
              <Bot className="h-5 w-5 text-[#e8b33d] shrink-0" />
              <div className="flex-1 min-w-0 basis-44">
                <h3 className="text-base sm:text-lg leading-snug tracking-tight">{s.title}</h3>
                <p className="font-ui text-xs text-[#9a968c] mt-0.5">
                  {s.difficulty} · {s.tags.join(" · ")}
                </p>
              </div>
              <span className="font-ui text-[13px] text-[#9a968c] inline-flex items-center gap-1.5 whitespace-nowrap">
                <Timer className="h-4 w-4" /> {s.minutes}m · par {s.timePar}m
              </span>
              <span className="font-ui text-[13px] text-[#9a968c] inline-flex items-center gap-1.5 whitespace-nowrap">
                <MessageSquare className="h-4 w-4" /> par {s.promptPar} prompts
              </span>
              <Link
                href={`/duel/${s.id}?difficulty=easy`}
                className="font-ui font-semibold text-sm px-4 py-2 rounded-md bg-[#e8b33d] text-black hover:bg-[#f2c14e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]"
              >
                Duel →
              </Link>
            </div>
          ))}
        </div>
      )}

      <div id="leaderboard" className="mt-10 scroll-mt-6">
        <h2 className="text-xl tracking-tight">Leaderboard</h2>
        <p className="font-ui text-sm text-[#9a968c] mt-1">Top posted runs across scenarios.</p>
        <Leaderboard scenarios={SCENARIOS.map((s) => ({ id: s.id, title: s.title }))} />
      </div>
    </div>
  );
}
