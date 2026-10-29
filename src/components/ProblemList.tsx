"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Problem } from "@/lib/types";
import { getAttempts } from "@/lib/store";
import { Clock, ShieldCheck, Lock } from "lucide-react";

export default function ProblemList({ problems }: { problems: Problem[] }) {
  const [attempts, setAttempts] = useState<Record<string, { status: string; defendScore: number | null }>>({});
  useEffect(() => {
    const t = setTimeout(() => {
    const all = getAttempts();
    const map: Record<string, { status: string; defendScore: number | null }> = {};
    for (const [k, v] of Object.entries(all)) map[k] = { status: v.status, defendScore: v.defendScore };
    setAttempts(map);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="grid gap-3">
      {problems.map((p) => {
        const a = attempts[p.id];
        const locked = p.mode === "arena" && a?.status === "locked";
        return (
          <div key={p.id} className="flex flex-wrap items-center gap-4 rounded-lg border border-[#262824] bg-[#141613] px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 font-ui">
                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${p.difficulty === "Hard" ? "border-red-400/40 text-red-300" : p.difficulty === "Medium" ? "border-[#e8b33d]/50 text-[#e8b33d]" : "border-emerald-400/40 text-emerald-300"}`}>{p.difficulty}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-[#b9b5a9]">{p.mode === "arena" ? "GRADED · ONE SHOT" : "PRACTICE · REPEATABLE"}</span>
                {a?.defendScore !== null && a?.defendScore !== undefined && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" /> Defended {a.defendScore}/30</span>
                )}
                {locked && <span className="inline-flex items-center gap-1 text-[11px] text-[#9a968c]"><Lock className="h-3.5 w-3.5" /> Locked</span>}
              </div>
              <h3 className="mt-1.5 text-lg leading-snug">{p.title}</h3>
              <p className="font-ui text-xs text-[#9a968c] mt-0.5">{p.tags.join(" · ")}</p>
            </div>
            <div className="font-ui text-sm text-[#9a968c] inline-flex items-center gap-1.5"><Clock className="h-4 w-4" /> {p.minutes}m + 3×{p.defendSeconds}s defense</div>
            {locked ? (
              <span className="font-ui text-sm px-4 py-2 rounded-md bg-white/5 text-[#8a877d]">Attempt used</span>
            ) : (
              <Link href={`/solve/${p.id}`} className="font-ui font-semibold text-sm px-4 py-2 rounded-md bg-[#e8b33d] text-black hover:bg-[#f2c14e]">
                {a ? "Continue" : "Solve →"}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
