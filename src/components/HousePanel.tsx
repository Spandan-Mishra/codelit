"use client";
import { useEffect, useRef, useState } from "react";
import { Bot, TriangleAlert } from "lucide-react";
import type { DuelResult } from "@/lib/duel";

export interface HouseOutcome {
  result: DuelResult;
  credits: number;
}

function fmtClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function HousePanel(props: {
  duelId: string;
  difficultyLabel: string;
  /** Parent sets this once the user finishes — polling stops. */
  frozen: boolean;
  outcome: HouseOutcome | null;
  onHouseFirst: () => void;
}) {
  const { duelId, difficultyLabel, frozen, outcome, onHouseFirst } = props;
  const [stepLabel, setStepLabel] = useState("warming up…");
  const [progress, setProgress] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [housePassed, setHousePassed] = useState(false);
  const [error, setError] = useState("");
  const notified = useRef(false);

  // Poll every 4s; consecutive failures back off exponentially (capped at
  // 30s) so a struggling feed isn't hammered by a fixed-interval loop.
  useEffect(() => {
    if (frozen || outcome) return;
    let alive = true;
    let failures = 0;
    let t: ReturnType<typeof setTimeout>;
    function schedule(ms: number) {
      if (alive) t = setTimeout(() => void poll(), ms);
    }
    async function poll() {
      try {
        const res = await fetch("/api/duel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", duelId }),
        });
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          failures += 1;
          setError(typeof data.error === "string" ? data.error : `House feed error ${res.status}. Retrying…`);
          schedule(Math.min(4000 * 2 ** failures, 30000));
          return;
        }
        failures = 0;
        setError("");
        if (typeof data.stepLabel === "string") setStepLabel(data.stepLabel);
        if (typeof data.progress0_100 === "number") setProgress(Math.max(0, Math.min(100, data.progress0_100)));
        if (typeof data.elapsedSec === "number") setElapsedSec(data.elapsedSec);
        if (data.housePassed === true) {
          setHousePassed(true);
          if (!notified.current) {
            notified.current = true;
            onHouseFirst();
          }
        }
        schedule(4000);
      } catch (e) {
        if (!alive) return;
        failures += 1;
        setError(e instanceof Error ? `${e.message}. Retrying…` : "House feed unreachable. Retrying…");
        schedule(Math.min(4000 * 2 ** failures, 30000));
      }
    }
    void poll();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [duelId, frozen, outcome, onHouseFirst]);

  // Local elapsed ticker so the clock moves between polls.
  useEffect(() => {
    if (frozen || outcome || housePassed) return;
    const t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [frozen, outcome, housePassed]);

  return (
    <aside className="rounded-lg border border-[#262824] bg-[#141613] p-5 font-ui lg:sticky lg:top-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-sm flex items-center gap-2">
          <Bot className="h-4 w-4 text-[#e8b33d]" /> House pace · simulated
        </p>
        <span className="text-xs px-2 py-0.5 rounded-full border border-[#3a3c37] text-[#9a968c]">{difficultyLabel}</span>
      </div>

      <div className="mt-4 flex items-baseline justify-between text-xs text-[#9a968c]">
        <span className="max-w-[70%] truncate">{housePassed ? "full suite green → passed" : stepLabel}</span>
        <span className="font-code">{fmtClock(elapsedSec)}</span>
      </div>
      <div
        className="h-2 rounded bg-white/10 mt-2 overflow-hidden"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="House agent progress"
      >
        <div
          className={`h-full transition-all duration-1000 ${housePassed ? "bg-emerald-300" : "bg-[#e8b33d]"}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {error && !outcome && (
        <p className="mt-3 text-xs text-[#e8b33d] flex items-start gap-1.5 leading-5">
          <TriangleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {outcome ? (
        <div
          className={`mt-4 rounded-md border p-3 text-sm ${
            outcome.result === "win"
              ? "border-emerald-400/30 bg-emerald-400/5"
              : "border-red-400/30 bg-red-400/5"
          }`}
        >
          {outcome.result === "win" ? (
            <p>
              <strong className="text-emerald-300">You beat the house. +2 credits.</strong>
              <span className="block text-xs text-[#9a968c] mt-1">Balance: {outcome.credits}</span>
            </p>
          ) : (
            <p>
              <strong className="text-red-300">Duel lost.</strong>
              <span className="block text-xs text-[#9a968c] mt-1">Balance: {outcome.credits} · wins earn +2</span>
            </p>
          )}
        </div>
      ) : (
        housePassed && (
          <p className="mt-4 rounded-md border border-red-400/30 bg-red-400/5 p-3 text-sm text-red-200">
            Simulated house finished first.
          </p>
        )
      )}
    </aside>
  );
}
