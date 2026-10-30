import { Suspense } from "react";
import NativeStart from "@/components/NativeStart";
import { ALL_SCENARIOS } from "@/lib/scenarios";
import { stageContext, starterFor } from "@/lib/native/context";

type Query = Promise<{ scenario?: string | string[] }>;

async function Launcher({ searchParams }: { searchParams: Query }) {
  const { scenario } = await searchParams;
  const scenarios = ALL_SCENARIOS.map((item) => ({ id: item.id, title: item.title }));
  const initialScenarioId = typeof scenario === "string" && scenarios.some((item) => item.id === scenario) ? scenario : undefined;
  const selected = ALL_SCENARIOS.find((item) => item.id === initialScenarioId);
  // Only public stage-one context crosses this boundary. Each real attempt
  // still receives its own seed from session.start; this is a labelled sample.
  const sample = selected ? stageContext(selected, 0, 1, "python") : undefined;
  const preview = selected && sample ? {
    id: selected.id,
    difficulty: selected.difficulty,
    minutes: selected.minutes,
    promptPar: selected.promptPar,
    stageTitle: selected.stages[0].title,
    brief: sample.brief,
    visibleTests: sample.visibleTests,
    stubs: {
      python: sample.stub,
      javascript: starterFor(selected, "javascript"),
      "c++": starterFor(selected, "c++"),
    },
  } : undefined;
  return <NativeStart key={initialScenarioId || "launcher"} scenarios={scenarios} initialScenarioId={initialScenarioId} preview={preview} />;
}

export default function NativePage({ searchParams }: { searchParams: Query }) {
  return <Suspense fallback={<p className="mx-auto max-w-6xl px-4 py-8 font-ui text-sm text-[#b3afa3]">Loading workspace…</p>}><Launcher searchParams={searchParams} /></Suspense>;
}
