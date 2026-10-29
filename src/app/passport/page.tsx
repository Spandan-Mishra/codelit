"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getAttempts, getDebugRecords, credibilityScore, getName, setName } from "@/lib/store";
import { PROBLEMS, DEBUG_CHALLENGES } from "@/lib/problems";
import type { AttemptRecord, DebugRecord } from "@/lib/types";
import { ShieldCheck, Bug, Bot } from "lucide-react";

interface AgentRunRecord {
  scenarioId: string;
  title: string;
  score: number;
  traceScore: number;
  defendScore: number;
  prompts: number;
  secondsUsed: number;
  finishedAt: string;
}

const AGENT_RUNS_KEY = "codelit:agent-runs";

function getAgentRuns(): AgentRunRecord[] {
  try {
    const raw = localStorage.getItem(AGENT_RUNS_KEY);
    const arr = raw ? (JSON.parse(raw) as AgentRunRecord[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export default function PassportPage() {
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [debug, setDebug] = useState<DebugRecord[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRunRecord[]>([]);
  const [name, setNameState] = useState("");
  const [cred, setCred] = useState({ score: 0, defended: 0, debugSolved: 0, total: 0 });
  const [loaded, setLoaded] = useState(false);

  function refresh() {
    setAttempts(Object.values(getAttempts()));
    setDebug(Object.values(getDebugRecords()));
    setAgentRuns(getAgentRuns());
    setCred(credibilityScore());
    setNameState(getName());
    setLoaded(true);
  }
  useEffect(() => { const t = setTimeout(refresh, 0); return () => clearTimeout(t); }, []);

  const title = (id: string) => PROBLEMS.find((p) => p.id === id)?.title || id;
  const dtitle = (id: string) => DEBUG_CHALLENGES.find((d) => d.id === id)?.title || id;
  const empty = loaded && attempts.length === 0 && debug.length === 0 && agentRuns.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <h1 className="text-3xl tracking-tight">Credibility passport</h1>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl leading-6">Defended traces, not green ticks. This page fills up when you explain code under a clock.</p>

      {!loaded ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-[0.8fr_1.2fr] items-start" aria-busy="true" aria-label="Loading passport">
          <div className="rounded-lg border border-[#262824] bg-[#141613] p-6 animate-pulse">
            <div className="mx-auto h-3 w-32 rounded bg-white/10" />
            <div className="mx-auto mt-3 h-12 w-24 rounded bg-white/10" />
            <div className="mt-4 h-2 rounded bg-white/5" />
          </div>
          <div className="rounded-lg border border-[#262824] bg-[#141613] p-5 animate-pulse">
            <div className="h-4 w-32 rounded bg-white/10" />
            <div className="mt-3 h-10 rounded bg-white/5" />
            <div className="mt-2 h-10 rounded bg-white/5" />
          </div>
        </div>
      ) : empty ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-[0.8fr_1.2fr] items-start">
          <div className="rounded-lg border border-[#262824] bg-[#141613] p-6 font-ui text-center">
            <p className="text-xs tracking-[0.18em] text-[#9a968c]">CREDIBILITY SCORE</p>
            <p className="text-6xl mt-2">0<span className="text-xl text-[#9a968c]">/100</span></p>
            <p className="text-sm text-[#9a968c] mt-2">No defenses yet.</p>
            <div className="h-2 rounded bg-white/10 mt-4 overflow-hidden"><div className="h-full bg-[#e8b33d]" style={{ width: "0%" }} /></div>
            <label htmlFor="passport-name" className="sr-only">Display name</label>
            <input id="passport-name" value={name} onChange={(e) => { setNameState(e.target.value); setName(e.target.value); }} placeholder="Your display name" className="mt-5 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2 text-sm outline-none focus:border-[#e8b33d]" />
            <p className="text-xs text-[#8a877d] mt-2">Stored on this device.</p>
          </div>
          <div className="rounded-lg border border-dashed border-[#3a3c37] bg-[#141613] p-6 sm:p-8 text-center font-ui">
            <ShieldCheck className="mx-auto h-8 w-8 text-[#e8b33d]" />
            <p className="mt-3 font-semibold">Your passport is blank.</p>
            <p className="mt-1 text-[13px] text-[#9a968c] max-w-sm mx-auto leading-6">Solve a problem, defend it under the clock, and your trace shows up here.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2.5">
              <Link href="/practice" className="text-sm font-semibold px-4 py-2 rounded-md bg-[#e8b33d] text-black hover:bg-[#f2c14e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">Start practicing</Link>
              <Link href="/debug" className="text-sm px-4 py-2 rounded-md border border-[#3a3c37] hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">Try Debug Under Fire</Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-[0.8fr_1.2fr] items-start">
          <div className="rounded-lg border border-[#262824] bg-[#141613] p-6 font-ui text-center">
            <p className="text-xs tracking-[0.18em] text-[#9a968c]">CREDIBILITY SCORE</p>
            <p className="text-6xl mt-2">{cred.score}<span className="text-xl text-[#9a968c]">/100</span></p>
            <p className="text-sm text-[#9a968c] mt-2">{cred.defended} defended · {cred.debugSolved} debug solves</p>
            <div className="h-2 rounded bg-white/10 mt-4 overflow-hidden"><div className="h-full bg-[#e8b33d]" style={{ width: `${cred.score}%` }} /></div>
            <label htmlFor="passport-name" className="sr-only">Display name</label>
            <input id="passport-name" value={name} onChange={(e) => { setNameState(e.target.value); setName(e.target.value); }} placeholder="Your display name" className="mt-5 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2 text-sm outline-none focus:border-[#e8b33d]" />
            <p className="text-xs text-[#8a877d] mt-2">Stored on this device.</p>
          </div>
          <div className="space-y-4 min-w-0">
            <div className="rounded-lg border border-[#262824] bg-[#141613] p-5">
              <h2 className="font-ui font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#e8b33d]" /> Defenses</h2>
              {attempts.length === 0 ? (
                <div className="mt-3 rounded-md border border-dashed border-[#3a3c37] px-4 py-5 text-center font-ui">
                  <p className="text-sm text-[#9a968c]">No defenses yet.</p>
                  <Link href="/practice" className="mt-2 inline-block text-sm text-[#e8b33d] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d] rounded">Solve and defend one →</Link>
                </div>
              ) : (
                <div className="mt-3 space-y-2 font-ui text-sm">{attempts.map((a) => (
                  <div key={a.problemId} className="flex flex-wrap gap-x-2 gap-y-1.5 items-center rounded-md bg-black/40 border border-[#262824] px-3 py-2.5">
                    <span className="flex-1 min-w-40">{title(a.problemId)}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/5">{a.mode}</span>
                    <span>{a.defendScore === null ? "not defended" : `${a.defendScore}/30`}</span>
                    <span className="text-[#8a877d] text-xs">{a.status}</span>
                  </div>
                ))}</div>
              )}
            </div>
            <div className="rounded-lg border border-[#262824] bg-[#141613] p-5">
              <h2 className="font-ui font-semibold flex items-center gap-2"><Bug className="h-4 w-4 text-[#e8b33d]" /> Debug traces</h2>
              {debug.length === 0 ? (
                <div className="mt-3 rounded-md border border-dashed border-[#3a3c37] px-4 py-5 text-center font-ui">
                  <p className="text-sm text-[#9a968c]">No debug attempts yet.</p>
                  <Link href="/debug" className="mt-2 inline-block text-sm text-[#e8b33d] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d] rounded">Open Debug Under Fire →</Link>
                </div>
              ) : (
                <div className="mt-3 space-y-2 font-ui text-sm">{debug.map((d) => (
                  <div key={d.challengeId} className="flex flex-wrap gap-x-2 gap-y-1.5 items-center rounded-md bg-black/40 border border-[#262824] px-3 py-2.5">
                    <span className="flex-1 min-w-40">{dtitle(d.challengeId)}</span>
                    <span>{d.status}</span><span className="text-[#8a877d] text-xs">{d.promptsUsed} prompts · {d.secondsUsed}s</span>
                  </div>
                ))}</div>
              )}
            </div>
            <div className="rounded-lg border border-[#262824] bg-[#141613] p-5">
              <h2 className="font-ui font-semibold flex items-center gap-2"><Bot className="h-4 w-4 text-[#e8b33d]" /> Agent runs</h2>
              {agentRuns.length === 0 ? (
                <div className="mt-3 rounded-md border border-dashed border-[#3a3c37] px-4 py-5 text-center font-ui">
                  <p className="text-sm text-[#9a968c]">No agent runs yet.</p>
                  <Link href="/scenarios" className="mt-2 inline-block text-sm text-[#e8b33d] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d] rounded">Run a scenario →</Link>
                </div>
              ) : (
                <div className="mt-3 space-y-2 font-ui text-sm">{agentRuns.map((r, i) => (
                  <div key={`${r.scenarioId}-${i}`} className="flex flex-wrap gap-x-2 gap-y-1.5 items-center rounded-md bg-black/40 border border-[#262824] px-3 py-2.5">
                    <span className="flex-1 min-w-40">{r.title}</span>
                    <span>{r.score}/100</span>
                    <span className="text-[#8a877d] text-xs">{r.prompts} prompts · {Math.max(1, Math.round(r.secondsUsed / 60))}m</span>
                  </div>
                ))}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
