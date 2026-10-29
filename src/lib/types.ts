export type Mode = "practice" | "arena";
export type Difficulty = "Easy" | "Medium" | "Hard";

export interface TestCase {
  input: string;
  expected: string;
  hidden?: boolean;
}

export interface Problem {
  id: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  mode: Mode;
  minutes: number;
  defendSeconds: number;
  statement: string;
  constraints: string[];
  examples: { input: string; output: string; note?: string }[];
  starterPy: string;
  starterJs: string;
  starterCpp: string;
  cppReturn: "vec" | "vecvec" | "bool" | "int" | "groups" | "str";
  fnName: string;
  tests: TestCase[];
  hints: string[];
}

export interface DefendTurn {
  question: string;
  answer: string;
  score: number; // 0-10
  feedback: string;
  secondsUsed: number;
  pastedChars: number;
}

export interface AttemptRecord {
  problemId: string;
  mode: Mode;
  status: "in-progress" | "code-passed" | "defended" | "locked";
  codeScore: number;
  defendScore: number | null;
  turns: DefendTurn[];
  finishedAt: string | null;
}

// --- Phase 1: agent-assisted scenarios + trace recorder ---
// All scenario data is JSON-serializable. A variant is a seeded shuffle of
// numeric test params (see instantiateTests in scenarios.ts), never prose.

export interface ScenarioStage {
  title: string;
  brief: string;
  unlockHint: string;
}

export interface ScenarioVariants {
  seedKeys: string[];
  description?: string;
}

export interface ScenarioStubs {
  py: string;
  js: string;
  cpp: string;
}

export interface Scenario {
  id: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  minutes: number;
  promptPar: number;
  timePar: number; // minutes; efficiency par, may differ from wall-clock limit
  stages: ScenarioStage[]; // exactly 3, drip-fed
  acceptance: TestCase[];
  fnName: string;
  variants: ScenarioVariants;
  cppReturn?: "vec" | "vecvec" | "bool" | "int" | "groups" | "str";
  stubs?: ScenarioStubs;
  // Generative scenarios: seed -> 3 drip-fed stage briefs + full test suite.
  // Seed 0 is the canonical suite (must equal `acceptance`).
  generate?: (seed: number) => { briefs: [string, string, string]; tests: TestCase[] };
}

export type TraceEventKind = "prompt" | "reply" | "code" | "run" | "stage" | "hint";

export interface TraceEvent {
  t: number; // seconds since attempt start
  kind: TraceEventKind;
  text?: string;
  passed?: boolean;
  linesChanged?: number;
}

export interface AgentAttempt {
  scenarioId: string;
  variantSeed: number;
  status: "active" | "finished" | "locked";
  startedAt: number; // epoch ms
  stageUnlocked: number; // 1-based
  events: TraceEvent[];
  cooldownUntil: number; // epoch ms, 0 = none
}
