import Link from "next/link";
import DuelClient from "@/components/DuelClient";
import { getScenario } from "@/lib/scenarios";
import { DIFFICULTIES, isDifficulty } from "@/lib/duel";

export const instant = false;

// Thin server wrapper: only display metadata crosses to the client.
// Duel state always comes from /api/duel at runtime.
export default async function DuelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ difficulty?: string }>;
}) {
  const { id } = await params;
  const { difficulty } = await searchParams;
  const s = getScenario(id);
  if (!s) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 font-ui">
        Scenario not found.{" "}
        <Link className="text-[#e8b33d]" href="/duels">
          Back to duels
        </Link>
      </div>
    );
  }
  if (!isDifficulty(difficulty)) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 font-ui">
        Unknown difficulty.{" "}
        <Link className="text-[#e8b33d]" href="/duels">
          Back to duels
        </Link>
      </div>
    );
  }
  const d = DIFFICULTIES[difficulty];
  return (
    <DuelClient
      scenarioId={s.id}
      title={s.title}
      difficulty={s.difficulty}
      tags={s.tags}
      minutes={s.minutes}
      promptPar={s.promptPar}
      timePar={s.timePar}
      fnName={s.fnName}
      stubs={s.stubs}
      cppReturn={s.cppReturn}
      duelDifficulty={difficulty}
      duelLabel={d.label}
      duelPace={d.pace}
      duelTargetSec={d.targetSolveSec}
      duelCost={d.cost}
    />
  );
}
