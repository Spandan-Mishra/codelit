"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DEBUG_CHALLENGES } from "@/lib/problems";
import { getDebugRecords } from "@/lib/store";
import { Bug, Timer, MessageSquare } from "lucide-react";

export default function DebugListPage() {
  const [records, setRecords] = useState<Record<string, { status: string }>>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setRecords(getDebugRecords());
      setLoaded(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <h1 className="text-3xl tracking-tight">Debug Under Fire</h1>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl leading-6">Broken code, a countdown, a prompt budget. Hints only — never the fix.</p>

      {!loaded ? (
        <div className="grid gap-2.5 mt-6" aria-busy="true" aria-label="Loading challenges">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-[#262824] bg-[#141613] px-5 py-4 animate-pulse">
              <div className="h-4 w-2/3 rounded bg-white/10" />
              <div className="mt-2 h-3 w-1/3 rounded bg-white/5" />
            </div>
          ))}
        </div>
      ) : DEBUG_CHALLENGES.length === 0 ? (
        <div className="mt-6 rounded-lg border border-[#262824] bg-[#141613] px-5 py-8 text-center font-ui">
          <p className="text-sm font-semibold">No debug challenges right now.</p>
          <p className="mt-1 text-[13px] text-[#9a968c]">New ones land soon.</p>
        </div>
      ) : (
        <div className="grid gap-2.5 mt-6">
          {DEBUG_CHALLENGES.map((d) => {
            const solved = records[d.id]?.status === "solved";
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-[#262824] bg-[#141613] px-4 py-3.5 sm:px-5">
                <Bug className="h-5 w-5 text-[#e8b33d] shrink-0" />
                <div className="flex-1 min-w-0 basis-44">
                  <h3 className="text-base sm:text-lg leading-snug tracking-tight">{d.title}</h3>
                  <p className="font-ui text-xs text-[#9a968c] mt-0.5">{d.difficulty} · {solved ? "Solved" : "Not solved yet"}</p>
                </div>
                <span className="font-ui text-[13px] text-[#9a968c] inline-flex items-center gap-1.5 whitespace-nowrap"><Timer className="h-4 w-4" /> {d.minutes}m</span>
                <span className="font-ui text-[13px] text-[#9a968c] inline-flex items-center gap-1.5 whitespace-nowrap"><MessageSquare className="h-4 w-4" /> {d.maxPrompts} prompts</span>
                <Link href={`/debug/${d.id}`} className="font-ui font-semibold text-sm px-4 py-2 rounded-md bg-[#e8b33d] text-black hover:bg-[#f2c14e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">
                  {solved ? "Retry →" : "Debug →"}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
