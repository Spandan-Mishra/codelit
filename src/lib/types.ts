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
  fnName: string;
  tests: TestCase[];
  hints: string[];
}

export interface DebugChallenge {
  id: string;
  title: string;
  difficulty: Difficulty;
  minutes: number;
  maxPrompts: number;
  description: string;
  buggyPy: string;
  fixedHint: string;
  tests: TestCase[];
  fnName: string;
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

export interface DebugRecord {
  challengeId: string;
  status: "in-progress" | "solved" | "failed";
  promptsUsed: number;
  secondsUsed: number;
  finishedAt: string | null;
}
