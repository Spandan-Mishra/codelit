"use client";
import { useMemo, useState } from "react";
import { PROBLEMS } from "@/lib/problems";
import ProblemList from "@/components/ProblemList";

const FILTERS = ["All", "Easy", "Medium", "Hard"] as const;
type Filter = (typeof FILTERS)[number];

export default function PracticePage() {
  const [filter, setFilter] = useState<Filter>("All");
  const problems = useMemo(
    () =>
      PROBLEMS.filter(
        (p) => p.mode === "practice" && (filter === "All" || p.difficulty === filter)
      ),
    [filter]
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <h1 className="text-3xl tracking-tight">Practice</h1>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl leading-6">Unlimited attempts. Solve, run, then survive 3 timed follow-ups. Nothing here locks.</p>
      <div className="mt-5 flex flex-wrap items-center gap-2 font-ui" role="group" aria-label="Filter by difficulty">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`px-3 py-1.5 rounded-full text-[13px] border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d] ${
              filter === f
                ? "border-[#e8b33d] bg-[#e8b33d] text-black font-semibold"
                : "border-[#3a3c37] text-[#c9c5ba] hover:bg-white/5"
            }`}
          >
            {f}
          </button>
        ))}
        <span className="ml-1 text-xs text-[#8a877d]">{problems.length} problem{problems.length === 1 ? "" : "s"}</span>
      </div>
      <div className="mt-4"><ProblemList problems={problems} /></div>
    </div>
  );
}
