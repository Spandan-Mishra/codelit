// Only released requirements and visible examples cross to the agent/browser.
import { visibleTests } from "@/lib/scenarios";
import type { Scenario } from "@/lib/types";
import type { NativeAttempt } from "./protocol";

export function starterFor(scenario: Scenario, language: string): string {
  return scenario.stubs?.[language === "c++" ? "cpp" : language === "javascript" ? "js" : "py"] || "";
}

export function stageContext(scenario: Scenario, seed: number, stage: number, language: string) {
  const generated = scenario.generate?.(seed >>> 0).briefs;
  return {
    title: scenario.title, stage,
    brief: generated?.[stage - 1] || scenario.stages[stage - 1]?.brief || "",
    fnName: scenario.fnName, language,
    stub: starterFor(scenario, language),
    visibleTests: visibleTests(scenario, seed, stage).map(({ input, expected }) => ({ input, expected })),
  };
}

export function publicScenario(scenario: Scenario, attempt: NativeAttempt) {
  return {
    id: scenario.id, title: scenario.title, difficulty: scenario.difficulty,
    tags: scenario.tags, fnName: scenario.fnName, promptPar: scenario.promptPar,
    minutes: scenario.minutes, stub: starterFor(scenario, attempt.language),
    stages: scenario.stages.slice(0, attempt.stage).map((s, i) => ({
      ...stageContext(scenario, attempt.seed, i + 1, attempt.language), title: s.title,
    })),
  };
}
