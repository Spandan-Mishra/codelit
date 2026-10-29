"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getAttempts, getDebugRecords, credibilityScore, getName, setName } from "@/lib/store";
import { PROBLEMS, DEBUG_CHALLENGES } from "@/lib/problems";
import type { AttemptRecord, DebugRecord } from "@/lib/types";
import { ShieldCheck, Bug } from "lucide-react";

export default function PassportPage() {
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [debug, setDebug] = useState<DebugRecord[]>([]);
  const [name, setNameState] = useState("");
  const [cred, setCred] = useState({ score: 0, defended: 0, debugSolved: 0, total: 0 });

  function refresh() {
    setAttempts(Object.values(getAttempts()));
    setDebug(Object.values(getDebugRecords()));
    setCred(credibilityScore());
    setNameState(getName());
  }
  useEffect(() => { const t = setTimeout(refresh, 0); return () => clearTimeout(t); }, []);

  const title = (id: string) => PROBLEMS.find((p) => p.id === id)?.title || id;
  const dtitle = (id: string) => DEBUG_CHALLENGES.find((d) => d.id === id)?.title || id;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl">Credibility passport</h1>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl">Defended traces, not green ticks. This page fills up when you explain code under a clock.</p>

      <div className="mt-6 grid sm:grid-cols-[0.8fr_1.2fr] gap-4 items-start">
        <div className="rounded-lg border border-[#262824] bg-[#141613] p-6 font-ui text-center">
          <p className="text-xs tracking-[0.18em] text-[#9a968c]">CREDIBILITY SCORE</p>
          <p className="text-6xl mt-2">{cred.score}<span className="text-xl text-[#9a968c]">/100</span></p>
          <p className="text-sm text-[#9a968c] mt-2">{cred.defended} defended · {cred.debugSolved} debug solves</p>
          <div className="h-2 rounded bg-white/10 mt-4 overflow-hidden"><div className="h-full bg-[#e8b33d]" style={{ width: `${cred.score}%` }} /></div>
          <input value={name} onChange={(e) => { setNameState(e.target.value); setName(e.target.value); }} placeholder="Your display name" className="mt-5 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2 text-sm outline-none focus:border-[#e8b33d]" />
          <p className="text-xs text-[#8a877d] mt-2">Stored on this device.</p>
        </div>
        <div className="space-y-4">
          <div className="rounded-lg border border-[#262824] bg-[#141613] p-5">
            <h2 className="font-ui font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#e8b33d]" /> Defenses</h2>
            {attempts.length === 0 ? <p className="font-ui text-sm text-[#9a968c] mt-2">No defenses yet. <Link href="/practice" className="text-[#e8b33d]">Solve & defend one →</Link></p> : (
              <div className="mt-3 space-y-2 font-ui text-sm">{attempts.map((a) => (
                <div key={a.problemId} className="flex flex-wrap gap-2 items-center rounded-md bg-black/40 border border-[#262824] px-3 py-2.5">
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
            {debug.length === 0 ? <p className="font-ui text-sm text-[#9a968c] mt-2">No debug attempts yet. <Link href="/debug" className="text-[#e8b33d]">Open Debug Under Fire →</Link></p> : (
              <div className="mt-3 space-y-2 font-ui text-sm">{debug.map((d) => (
                <div key={d.challengeId} className="flex flex-wrap gap-2 items-center rounded-md bg-black/40 border border-[#262824] px-3 py-2.5">
                  <span className="flex-1 min-w-40">{dtitle(d.challengeId)}</span>
                  <span>{d.status}</span><span className="text-[#8a877d] text-xs">{d.promptsUsed} prompts · {d.secondsUsed}s</span>
                </div>
              ))}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
