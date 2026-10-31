import { ALL_SCENARIOS as SCENARIOS } from "@/lib/scenarios";
import ScenarioList from "@/components/ScenarioList";

export default function ScenariosPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <h1 className="text-3xl tracking-tight">Agent scenarios</h1>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl leading-6">
        Direct your coding agent, review the file it writes, and test it against evolving requirements.
        Each scenario has three stages and a limited prompt budget.
      </p>
      <p className="font-ui text-xs text-[#8a877d] mt-2 max-w-2xl leading-5">
        Your agent writes the solution. You decide what to ask, what to check, and when it is ready.
      </p>

      <p className="mt-3 font-ui text-xs text-[#8a877d]">Progress is saved for this browser. Solved means all code acceptance checks passed.</p>
      <ScenarioList scenarios={SCENARIOS.map(({ id, title, difficulty, tags, minutes, timePar, promptPar }) => ({ id, title, difficulty, tags, minutes, timePar, promptPar }))} />
    </div>
  );
}
