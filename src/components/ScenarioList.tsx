"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, LockKeyhole, MessageSquare, Timer, Trophy } from "lucide-react";

type Scenario = { id: string; title: string; blurb: string; difficulty: string; tags: string[]; minutes: number; timePar: number; promptPar: number };
type Mode = "practice" | "ranked";
type Progress = Record<string, { practice: "solved" | "partial" | null; ranked: "solved" | "partial" | null }>;

export const RANKED_UNLOCK_COUNT = 5;

export default function ScenarioList({ scenarios }: { scenarios: Scenario[] }) {
  const [tab, setTab] = useState<Mode>("practice");
  const [progress, setProgress] = useState<Progress>({});
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    let fetching = false;
    const controller = new AbortController();
    async function refresh() {
      if (fetching) return;
      fetching = true;
      try {
        const response = await fetch("/api/native/devices?attempts=1", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.attempts)) throw new Error("Could not load scenario progress.");
        const next: Progress = {};
        for (const attempt of data.attempts) {
          if (typeof attempt.scenarioId !== "string") continue;
          const mode: Mode = attempt.mode === "ranked" ? "ranked" : "practice";
          const entry = next[attempt.scenarioId] || { practice: null, ranked: null };
          if (attempt.acceptance?.passed === true) entry[mode] = "solved";
          else if (!entry[mode]) entry[mode] = "partial";
          next[attempt.scenarioId] = entry;
        }
        if (active) { setProgress(next); setState("ready"); }
      } catch {
        if (active) setState("error");
      } finally { fetching = false; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { active = false; controller.abort(); clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, []);

  const practiceSolved = scenarios.filter((s) => progress[s.id]?.practice === "solved").length;
  const rankedUnlocked = practiceSolved >= RANKED_UNLOCK_COUNT;

  return <>
    <div role="tablist" aria-label="Scenario mode" className="mt-6 flex gap-1 rounded-lg border border-[#30322c] bg-[#141613] p-1 font-ui">
      {(["practice", "ranked"] as const).map((mode) => (
        <button
          key={mode}
          role="tab"
          aria-selected={tab === mode}
          onClick={() => setTab(mode)}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold ${tab === mode ? "bg-[#e8b33d] text-black" : "text-[#b3afa3] hover:text-white"}`}
        >
          {mode === "ranked" ? <Trophy className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
          {mode === "practice" ? "Practice" : "Ranked"}
          {mode === "ranked" && state === "ready" && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${tab === mode ? "bg-black/20" : "bg-white/5"}`}>
              {rankedUnlocked ? "unlocked" : `${practiceSolved}/${RANKED_UNLOCK_COUNT}`}
            </span>
          )}
        </button>
      ))}
    </div>
    <p className="mt-3 font-ui text-xs leading-5 text-[#8a877d]">
      {tab === "practice"
        ? "Learn the system with your agent. Repeatable and unscored — no defense, no passport entry."
        : rankedUnlocked
          ? "Counted runs. Finish, defend your solution under time, and bank the score on your passport."
          : `Ranked unlocks after passing ${RANKED_UNLOCK_COUNT} practice scenarios — you have ${practiceSolved}. Each defense banks a passport score.`}
    </p>

    {state === "error" && <p role="status" className="mt-4 font-ui text-xs text-[#e8b33d]">Progress could not refresh. It will retry automatically; your attempts are unchanged.</p>}
    {tab === "ranked" && !rankedUnlocked && state === "ready" && (
      <p role="status" className="mt-4 flex items-start gap-2 rounded-lg border border-[#e8b33d]/30 bg-[#e8b33d]/5 px-4 py-3 font-ui text-xs leading-6 text-[#d5c59e]">
        <LockKeyhole size={14} className="mt-1 shrink-0" />
        Ranked is locked. Pass {RANKED_UNLOCK_COUNT - practiceSolved} more practice scenario{RANKED_UNLOCK_COUNT - practiceSolved === 1 ? "" : "s"} to unlock it.
      </p>
    )}
    {scenarios.length === 0 ? (
      <div className="mt-6 rounded-lg border border-[#262824] bg-[#141613] px-5 py-8 text-center font-ui">
        <p className="text-sm font-semibold">No scenarios right now.</p>
        <p className="mt-1 text-[13px] text-[#9a968c]">New ones land soon.</p>
      </div>
    ) : (
      <div className="grid gap-2.5 mt-6">
        {scenarios.map((s) => {
          const status = progress[s.id]?.[tab] || null;
          const locked = tab === "ranked" && !rankedUnlocked;
          return (
            <article key={s.id} aria-label={s.title} className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-[#262824] bg-[#141613] px-4 py-3.5 sm:px-5">
              {locked ? <LockKeyhole className="h-5 w-5 text-[#8a877d] shrink-0" /> : <Bot className="h-5 w-5 text-[#e8b33d] shrink-0" />}
              <div className="flex-1 min-w-0 basis-44">
                <h3 className="text-base sm:text-lg leading-snug tracking-tight">{s.title}</h3>
                <p className="font-ui text-xs text-[#9a968c] mt-0.5">{s.difficulty} · {s.tags.join(" · ")}</p>
                <p className="font-ui text-xs leading-5 text-[#8a877d] mt-1 line-clamp-2">{s.blurb}</p>
              </div>
              <div className={`inline-flex items-center gap-2 font-ui text-xs ${status === "solved" ? "text-emerald-300" : status === "partial" ? "text-[#e8b33d]" : "text-[#8a877d]"}`} title={status === "solved" ? "All code acceptance checks passed" : status === "partial" ? "An attempt has been started; full acceptance is still pending" : undefined}>
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current" />
                <span>{locked ? "Locked" : status === "solved" ? "Solved" : status === "partial" ? "In progress" : state === "ready" ? "Not started" : state === "loading" ? "Checking…" : "Status unavailable"}</span>
              </div>
              <span className="font-ui text-[13px] text-[#9a968c] inline-flex items-center gap-1.5 whitespace-nowrap"><Timer className="h-4 w-4" /> {s.minutes}m · par {s.timePar}m</span>
              <span className="font-ui text-[13px] text-[#9a968c] inline-flex items-center gap-1.5 whitespace-nowrap"><MessageSquare className="h-4 w-4" /> par {s.promptPar} prompts</span>
              {locked ? (
                <span className="font-ui text-sm px-4 py-2 rounded-md border border-[#3a3c37] text-[#8a877d]">Locked</span>
              ) : (
                <Link href={`/native?scenario=${encodeURIComponent(s.id)}&mode=${tab}`} className="font-ui font-semibold text-sm px-4 py-2 rounded-md bg-[#e8b33d] text-black hover:bg-[#f2c14e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">
                  Start →
                </Link>
              )}
            </article>
          );
        })}
      </div>
    )}
  </>;
}
