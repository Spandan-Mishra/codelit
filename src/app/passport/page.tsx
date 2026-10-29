"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getName, setName } from "@/lib/store";
import { verdictTier } from "@/lib/judge";
import { DUELS_KEY, type DuelRecord } from "@/lib/duel";
import { getActiveProviderLabel } from "@/lib/agentStore";
import { ShieldCheck, Bot, Swords } from "lucide-react";

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

function getDuels(): DuelRecord[] {
  try {
    const raw = localStorage.getItem(DUELS_KEY);
    const arr = raw ? (JSON.parse(raw) as DuelRecord[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export default function PassportPage() {
  const [agentRuns, setAgentRuns] = useState<AgentRunRecord[]>([]);
  const [duels, setDuels] = useState<DuelRecord[]>([]);
  const [name, setNameState] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [agentLabel, setAgentLabel] = useState("House Agent (free)");
  const [agentModel, setAgentModel] = useState("house-guided");

  function refresh() {
    setAgentRuns(getAgentRuns());
    setDuels(getDuels());
    setNameState(getName());
    const active = getActiveProviderLabel();
    setAgentLabel(active.label);
    setAgentModel(active.model);
    setLoaded(true);
  }
  useEffect(() => { const t = setTimeout(refresh, 0); return () => clearTimeout(t); }, []);

  const empty = loaded && agentRuns.length === 0 && duels.length === 0;
  const best = agentRuns.length ? Math.max(...agentRuns.map((r) => r.score)) : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <h1 className="text-3xl tracking-tight">Credibility passport</h1>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl leading-6">Defended traces, not green ticks. This page fills up when you explain code under a clock.</p>
      {loaded && (
        <p className="font-ui text-sm text-[#9a968c] mt-2 flex items-center gap-2">
          <Bot className="h-4 w-4 text-[#e8b33d]" />
          Active agent: <span className="text-[#c9c5ba]">{agentLabel} · <span className="font-code text-[13px]">{agentModel}</span></span>
          <Link href="/agents" className="text-[#e8b33d] hover:underline rounded">Manage →</Link>
        </p>
      )}

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
            <p className="text-sm text-[#9a968c] mt-2">No runs yet.</p>
            <div className="h-2 rounded bg-white/10 mt-4 overflow-hidden"><div className="h-full bg-[#e8b33d]" style={{ width: "0%" }} /></div>
            <label htmlFor="passport-name" className="sr-only">Display name</label>
            <input id="passport-name" value={name} onChange={(e) => { setNameState(e.target.value); setName(e.target.value); }} placeholder="Your display name" className="mt-5 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2 text-sm outline-none focus:border-[#e8b33d]" />
            <p className="text-xs text-[#8a877d] mt-2">Stored on this device.</p>
          </div>
          <div className="rounded-lg border border-dashed border-[#3a3c37] bg-[#141613] p-6 sm:p-8 text-center font-ui">
            <ShieldCheck className="mx-auto h-8 w-8 text-[#e8b33d]" />
            <p className="mt-3 font-semibold">Your passport is blank.</p>
            <p className="mt-1 text-[13px] text-[#9a968c] max-w-sm mx-auto leading-6">Run a scenario, defend your trace, and your score shows up here.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2.5">
              <Link href="/scenarios" className="text-sm font-semibold px-4 py-2 rounded-md bg-[#e8b33d] text-black hover:bg-[#f2c14e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">Run a scenario</Link>
              <Link href="/duels" className="text-sm px-4 py-2 rounded-md border border-[#3a3c37] hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">Try a duel</Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-[0.8fr_1.2fr] items-start">
          <div className="rounded-lg border border-[#262824] bg-[#141613] p-6 font-ui text-center">
            <p className="text-xs tracking-[0.18em] text-[#9a968c]">CREDIBILITY SCORE</p>
            <p className="text-6xl mt-2">{best}<span className="text-xl text-[#9a968c]">/100</span></p>
            <p className="text-sm text-[#9a968c] mt-2">{verdictTier(best).label} · {agentRuns.length} run{agentRuns.length === 1 ? "" : "s"}</p>
            <div className="h-2 rounded bg-white/10 mt-4 overflow-hidden"><div className="h-full bg-[#e8b33d]" style={{ width: `${best}%` }} /></div>
            <label htmlFor="passport-name" className="sr-only">Display name</label>
            <input id="passport-name" value={name} onChange={(e) => { setNameState(e.target.value); setName(e.target.value); }} placeholder="Your display name" className="mt-5 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2 text-sm outline-none focus:border-[#e8b33d]" />
            <p className="text-xs text-[#8a877d] mt-2">Stored on this device.</p>
          </div>
          <div className="space-y-4 min-w-0">
            <div className="rounded-lg border border-[#262824] bg-[#141613] p-5">
              <h2 className="font-ui font-semibold flex items-center gap-2"><Bot className="h-4 w-4 text-[#e8b33d]" /> Agent runs</h2>
              {agentRuns.length === 0 ? (
                <p className="font-ui text-sm text-[#9a968c] mt-2">No agent runs yet.</p>
              ) : (
              <div className="mt-3 space-y-2 font-ui text-sm">{agentRuns.map((r, i) => (
                <div key={`${r.scenarioId}-${i}`} className="flex flex-wrap gap-x-2 gap-y-1.5 items-center rounded-md bg-black/40 border border-[#262824] px-3 py-2.5">
                  <span className="flex-1 min-w-40">{r.title}</span>
                  <span>{r.score}/100 · {verdictTier(r.score).label}</span>
                  <span className="text-[#8a877d] text-xs">{r.prompts} prompts · {Math.max(1, Math.round(r.secondsUsed / 60))}m</span>
                </div>
              ))}</div>
              )}
            </div>
            <div className="rounded-lg border border-[#262824] bg-[#141613] p-5">
              <h2 className="font-ui font-semibold flex items-center gap-2"><Swords className="h-4 w-4 text-[#e8b33d]" /> Duels</h2>
              {duels.length === 0 ? (
                <p className="font-ui text-sm text-[#9a968c] mt-2">Duel history lands here. <Link href="/duels" className="text-[#e8b33d] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d] rounded">Start one →</Link></p>
              ) : (
                <div className="mt-3 space-y-2 font-ui text-sm">{duels.slice().reverse().map((d, i) => (
                  <div key={`${d.at}-${i}`} className="flex flex-wrap gap-x-2 gap-y-1.5 items-center rounded-md bg-black/40 border border-[#262824] px-3 py-2.5">
                    <span className={d.result === "win" ? "text-emerald-300 font-semibold" : "text-red-300 font-semibold"}>
                      {d.result === "win" ? "Won" : "Lost"}
                    </span>
                    <span className="flex-1 min-w-40">{d.scenarioId}</span>
                    <span className="text-[#8a877d] text-xs">{d.difficulty} · {new Date(d.at).toLocaleDateString()}</span>
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
