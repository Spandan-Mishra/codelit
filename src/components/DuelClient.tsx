"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import AgentClient from "@/components/AgentClient";
import HousePanel, { type HouseOutcome } from "@/components/HousePanel";
import PostToLeaderboard from "@/components/PostToLeaderboard";
import { verdictTier } from "@/lib/judge";
import { DUELS_KEY, type DifficultyKey, type DuelRecord, type DuelResult } from "@/lib/duel";
import type { ScenarioStubs } from "@/lib/types";
import { AlertTriangle, Swords } from "lucide-react";

function saveDuel(rec: DuelRecord) {
  try {
    const raw = localStorage.getItem(DUELS_KEY);
    const arr = raw ? (JSON.parse(raw) as DuelRecord[]) : [];
    arr.push(rec);
    localStorage.setItem(DUELS_KEY, JSON.stringify(arr.slice(-50)));
  } catch {}
}

export default function DuelClient(props: {
  scenarioId: string;
  title: string;
  difficulty: string;
  tags: string[];
  minutes: number;
  promptPar: number;
  timePar: number;
  fnName: string;
  stubs?: ScenarioStubs;
  cppReturn?: string;
  duelDifficulty: DifficultyKey;
  duelLabel: string;
  duelPace: string;
  duelTargetSec: number;
  duelCost: number;
}) {
  const { scenarioId, duelDifficulty } = props;
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  const [duelId, setDuelId] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [userDone, setUserDone] = useState(false);
  const [houseFirst, setHouseFirst] = useState(false);
  const [outcome, setOutcome] = useState<HouseOutcome | null>(null);
  const [resolveError, setResolveError] = useState("");

  async function startDuel() {
    if (creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/duel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", scenarioId, difficulty: duelDifficulty }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.duelId !== "string") {
        setCreateError(typeof data.error === "string" ? data.error : `Server error ${res.status}`);
        return;
      }
      setDuelId(data.duelId);
      setPhase("live");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const handleFinish = useCallback(
    async (passed: boolean) => {
      if (!duelId) return;
      setUserDone(true);
      try {
        const res = await fetch("/api/duel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resolve", duelId, userPassed: passed }),
        });
        const data = await res.json();
        if (!res.ok) {
          setResolveError(typeof data.error === "string" ? data.error : `Server error ${res.status}`);
          return;
        }
        const result = data.result as DuelResult;
        const credits = typeof data.credits === "number" ? data.credits : 0;
        setOutcome({ result, credits });
        saveDuel({ scenarioId, difficulty: duelDifficulty, result, at: new Date().toISOString() });
      } catch (e) {
        setResolveError(e instanceof Error ? e.message : String(e));
      }
    },
    [duelId, scenarioId, duelDifficulty]
  );

  const handleHouseFirst = useCallback(() => setHouseFirst(true), []);

  if (phase === "gate") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="flex flex-wrap items-center gap-3 font-ui text-xs text-[#9a968c]">
          <Link href="/duels" className="hover:text-white">← Duels</Link>
          <span>{props.difficulty}</span>
        </div>
        <h1 className="mt-2 text-3xl leading-tight">{props.title}</h1>
        <div className="mt-6 rounded-lg border border-[#262824] bg-[#141613] p-6 font-ui">
          <p className="font-semibold flex items-center gap-2">
            <Swords className="h-4 w-4 text-[#e8b33d]" /> {props.duelLabel}
          </p>
          <p className="text-sm text-[#9a968c] mt-2 leading-6">
            You + your agent vs a simulated house pace ({props.duelPace}). First green wins — the simulation solves in about{" "}
            {Math.round(props.duelTargetSec / 60)}m.
            {props.duelCost > 0 && <> Entry: {props.duelCost} credits.</>} Wins pay +2.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={() => void startDuel()}
              disabled={creating}
              className="px-5 py-2.5 rounded-md bg-[#e8b33d] text-black font-semibold text-sm disabled:opacity-50"
            >
              {creating ? "Starting…" : "Start duel"}
            </button>
            <Link href="/duels" className="px-4 py-2.5 rounded-md border border-[#3a3c37] text-sm">
              Pick another
            </Link>
          </div>
          {createError && (
            <p className="mt-3 text-sm text-[#e8b33d] flex items-start gap-1.5 leading-6">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {createError}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {houseFirst && !outcome && (
        <div className="mb-4 rounded-lg border border-red-400/30 bg-red-400/5 px-4 py-3 font-ui text-sm text-red-200">
          Simulated house finished first — duel lost. Finish your run anyway for a personal score.
        </div>
      )}
      {outcome && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 font-ui text-sm ${
            outcome.result === "win"
              ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-200"
              : "border-red-400/30 bg-red-400/5 text-red-200"
          }`}
        >
          {outcome.result === "win"
            ? `Duel won — +2 credits (balance ${outcome.credits}).`
            : `Duel lost — balance ${outcome.credits}. Wins earn +2.`}{" "}
          <Link href="/passport" className="underline underline-offset-2">
            Passport →
          </Link>{" "}
          <span className="ml-2 inline-flex">
            <PostToLeaderboard
              scenarioId={scenarioId}
              difficulty={duelDifficulty}
              score={outcome.result === "win" ? 100 : 0}
              tier={verdictTier(outcome.result === "win" ? 100 : 0).label}
              result={outcome.result}
              prompts={0}
            />
          </span>
        </div>
      )}
      {resolveError && (
        <p className="mb-4 font-ui text-sm text-[#e8b33d] flex items-start gap-1.5">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> Could not record the duel: {resolveError}
        </p>
      )}
      <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start">
        <div className="min-w-0 [&>div]:mx-0 [&>div]:max-w-none [&>div]:px-0 [&>div]:py-0">
          <AgentClient
            id={props.scenarioId}
            title={props.title}
            difficulty={props.difficulty}
            tags={props.tags}
            minutes={props.minutes}
            promptPar={props.promptPar}
            timePar={props.timePar}
            fnName={props.fnName}
            stubs={props.stubs}
            cppReturn={props.cppReturn}
            onFinish={(passed) => void handleFinish(passed)}
            boardDifficulty={duelDifficulty}
            boardResult={outcome?.result}
          />
        </div>
        <HousePanel
          duelId={duelId}
          difficultyLabel={props.duelLabel}
          frozen={userDone}
          outcome={outcome}
          onHouseFirst={handleHouseFirst}
        />
      </div>
    </div>
  );
}
