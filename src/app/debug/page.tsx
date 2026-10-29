"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DEBUG_CHALLENGES } from "@/lib/problems";
import { getDebugRecords } from "@/lib/store";
import { Bug, Timer, MessageSquare } from "lucide-react";

export default function DebugListPage() {
  const [records, setRecords] = useState<Record<string, { status: string }>>({});
  useEffect(() => { const t = setTimeout(() => setRecords(getDebugRecords()), 0); return () => clearTimeout(t); }, []);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl">Debug Under Fire</h1>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl">Broken code, a countdown, a prompt budget. Hints only — never the fix.</p>
      <div className="grid gap-3 mt-6">
        {DEBUG_CHALLENGES.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-4 rounded-lg border border-[#262824] bg-[#141613] px-5 py-4">
            <Bug className="h-5 w-5 text-[#e8b33d] shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-lg leading-snug">{d.title}</h3>
              <p className="font-ui text-xs text-[#9a968c] mt-0.5">{d.difficulty} · {records[d.id]?.status === "solved" ? "Solved ✓" : "Not solved yet"}</p>
            </div>
            <span className="font-ui text-sm text-[#9a968c] inline-flex items-center gap-1.5"><Timer className="h-4 w-4" /> {d.minutes}m</span>
            <span className="font-ui text-sm text-[#9a968c] inline-flex items-center gap-1.5"><MessageSquare className="h-4 w-4" /> {d.maxPrompts} prompts</span>
            <Link href={`/debug/${d.id}`} className="font-ui font-semibold text-sm px-4 py-2 rounded-md bg-[#e8b33d] text-black">Debug →</Link>
          </div>
        ))}
      </div>
    </div>
  );
}
