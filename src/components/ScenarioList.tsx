"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, Timer, MessageSquare } from "lucide-react";

type Scenario = { id: string; title: string; difficulty: string; tags: string[]; minutes: number; timePar: number; promptPar: number };
type Progress = Record<string, "solved" | "partial">;

export default function ScenarioList({ scenarios }: { scenarios: Scenario[] }) {
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
          if (attempt.acceptance?.passed === true) next[attempt.scenarioId] = "solved";
          else if (!next[attempt.scenarioId]) next[attempt.scenarioId] = "partial";
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

  return <>
    {state === "error" && <p role="status" className="mt-4 font-ui text-xs text-[#e8b33d]">Progress could not refresh. It will retry automatically; your attempts are unchanged.</p>}
      {scenarios.length === 0 ? (
        <div className="mt-6 rounded-lg border border-[#262824] bg-[#141613] px-5 py-8 text-center font-ui">
          <p className="text-sm font-semibold">No scenarios right now.</p>
          <p className="mt-1 text-[13px] text-[#9a968c]">New ones land soon.</p>
        </div>
      ) : (
        <div className="grid gap-2.5 mt-6">
          {scenarios.map((s) => (
            <article key={s.id} aria-label={s.title} className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-[#262824] bg-[#141613] px-4 py-3.5 sm:px-5">
              <Bot className="h-5 w-5 text-[#e8b33d] shrink-0" />
              <div className="flex-1 min-w-0 basis-44">
                <h3 className="text-base sm:text-lg leading-snug tracking-tight">{s.title}</h3>
                <p className="font-ui text-xs text-[#9a968c] mt-0.5">{s.difficulty} · {s.tags.join(" · ")}</p>
              </div>
              <div className={`inline-flex items-center gap-2 font-ui text-xs ${progress[s.id] === "solved" ? "text-emerald-300" : progress[s.id] === "partial" ? "text-[#e8b33d]" : "text-[#8a877d]"}`} title={progress[s.id] === "solved" ? "All code acceptance checks passed" : progress[s.id] === "partial" ? "An attempt has been started; full acceptance is still pending" : undefined}>
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current" />
                <span>{progress[s.id] === "solved" ? "Solved" : progress[s.id] === "partial" ? "In progress" : state === "ready" ? "Not started" : state === "loading" ? "Checking…" : "Status unavailable"}</span>
              </div>
              <span className="font-ui text-[13px] text-[#9a968c] inline-flex items-center gap-1.5 whitespace-nowrap"><Timer className="h-4 w-4" /> {s.minutes}m · par {s.timePar}m</span>
              <span className="font-ui text-[13px] text-[#9a968c] inline-flex items-center gap-1.5 whitespace-nowrap"><MessageSquare className="h-4 w-4" /> par {s.promptPar} prompts</span>
              <Link href={`/native?scenario=${encodeURIComponent(s.id)}`} className="font-ui font-semibold text-sm px-4 py-2 rounded-md bg-[#e8b33d] text-black hover:bg-[#f2c14e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">
                Start →
              </Link>
            </article>
          ))}
        </div>
      )}
  </>;
}
