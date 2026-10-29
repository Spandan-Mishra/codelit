"use client";
import { useEffect, useState } from "react";
import type { DifficultyKey } from "@/lib/duel";
import type { LeaderboardEntry } from "@/lib/leaderboard";
import { Trophy } from "lucide-react";

export default function Leaderboard(props: { scenarios: { id: string; title: string }[] }) {
  const [scenarioId, setScenarioId] = useState("all");
  const [difficulty, setDifficulty] = useState<"all" | DifficultyKey>("all");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const q = new URLSearchParams();
        if (scenarioId !== "all") q.set("scenarioId", scenarioId);
        if (difficulty !== "all") q.set("difficulty", difficulty);
        const qs = q.toString();
        const res = await fetch(`/api/leaderboard${qs ? `?${qs}` : ""}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(typeof data.error === "string" ? data.error : `Server error ${res.status}`);
          setEntries([]);
          return;
        }
        setEntries(Array.isArray(data.entries) ? data.entries : []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setEntries([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [scenarioId, difficulty]);

  const titleFor = (id: string) => props.scenarios.find((s) => s.id === id)?.title ?? id;
  const selectCls =
    "rounded-md bg-black/50 border border-[#3a3c37] px-2.5 py-1.5 text-sm outline-none focus:border-[#e8b33d]";

  return (
    <div className="mt-4 rounded-lg border border-[#262824] bg-[#141613] p-5 font-ui">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="text-xs text-[#8a877d]">
          Scenario{" "}
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} className={selectCls}>
            <option value="all">All</option>
            {props.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[#8a877d]">
          Difficulty{" "}
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as "all" | DifficultyKey)}
            className={selectCls}
          >
            <option value="all">All</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-[#9a968c]" aria-busy="true">
          Loading board…
        </p>
      ) : error ? (
        <p className="mt-4 text-sm text-red-300">{error}</p>
      ) : entries.length === 0 ? (
        <p className="mt-4 text-sm text-[#9a968c]">
          No posted runs yet — finish a run or win a duel to claim the top spot.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-xs text-[#8a877d] border-b border-[#262824]">
                <th className="py-2 pr-3 font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Score</th>
                <th className="py-2 pr-3 font-medium">Scenario</th>
                <th className="py-2 pr-3 font-medium">Difficulty</th>
                <th className="py-2 pr-3 font-medium">Prompts</th>
                <th className="py-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.at}-${i}`} className="border-b border-[#1e201d] last:border-0">
                  <td className="py-2 pr-3 text-[#9a968c] inline-flex items-center gap-1">
                    {i === 0 && <Trophy className="h-3.5 w-3.5 text-[#e8b33d]" />}
                    {i + 1}
                  </td>
                  <td className="py-2 pr-3">{e.name}</td>
                  <td className="py-2 pr-3">
                    {e.score}
                    <span className="text-[#8a877d] text-xs"> · {e.tier}</span>
                  </td>
                  <td className="py-2 pr-3 text-[#b9b5a9]">{titleFor(e.scenarioId)}</td>
                  <td className="py-2 pr-3 text-[#9a968c] capitalize">{e.difficulty}</td>
                  <td className="py-2 pr-3 text-[#9a968c]">{e.prompts}</td>
                  <td className="py-2 text-[#9a968c]">{new Date(e.at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
