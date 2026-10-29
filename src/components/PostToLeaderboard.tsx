"use client";
import { useState } from "react";
import Link from "next/link";
import { getName, setName } from "@/lib/store";
import type { DifficultyKey } from "@/lib/duel";
import type { BoardResult } from "@/lib/leaderboard";

export default function PostToLeaderboard(props: {
  scenarioId: string;
  difficulty: DifficultyKey;
  score: number;
  tier: string;
  result: BoardResult;
  prompts: number;
}) {
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState("");
  const [error, setError] = useState("");

  async function post() {
    if (posting || posted) return;
    let name = getName().trim();
    if (!name) {
      const input = window.prompt("Display name for the leaderboard?");
      if (!input || !input.trim()) return;
      name = input.trim().slice(0, 24);
      setName(name);
    }
    setPosting(true);
    setError("");
    try {
      const res = await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          entry: {
            name,
            scenarioId: props.scenarioId,
            difficulty: props.difficulty,
            score: props.score,
            tier: props.tier,
            result: props.result,
            prompts: props.prompts,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `Server error ${res.status}`);
        return;
      }
      setPosted(typeof data.rank === "number" ? `Posted — rank #${data.rank}.` : "Posted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  }

  if (posted) {
    return (
      <p className="font-ui text-sm text-emerald-300">
        {posted}{" "}
        <Link href="/duels#leaderboard" className="underline underline-offset-2">
          View board →
        </Link>
      </p>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        onClick={() => void post()}
        disabled={posting}
        className="font-ui px-3 py-1.5 rounded-md border border-[#e8b33d]/50 text-[#e8b33d] text-sm hover:bg-[#e8b33d]/10 disabled:opacity-40"
      >
        {posting ? "Posting…" : "Post to leaderboard"}
      </button>
      {error && <span className="font-ui text-xs text-red-300">{error}</span>}
    </span>
  );
}
