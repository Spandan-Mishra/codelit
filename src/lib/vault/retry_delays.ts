// Generative vault scenario: exponential backoff retry schedule.
// Story: deploy pipeline retries for a randomized team. All test literals
// are cross-language (ints and int lists only).

import type { Scenario, TestCase } from "../types";
import { mulberry32, pick, intBetween } from "../rand";

const TEAMS = ["checkout", "search", "billing", "auth", "notify", "ledger", "catalog", "sessions"] as const;

// Reference: wait i is base * factor^i, capped at cap.
export function retryDelaysRef(failures: number, base: number, factor: number, cap: number): number[] {
  const out: number[] = [];
  let d = base;
  for (let i = 0; i < failures; i++) {
    out.push(Math.min(cap, d));
    d *= factor;
  }
  return out;
}

const fmtSpaced = (a: number[]): string => `[${a.join(", ")}]`;

export function generateRetryDelays(seed: number): { briefs: [string, string, string]; tests: TestCase[] } {
  const rand = mulberry32(seed);
  const team = pick(rand, TEAMS);
  const base = intBetween(rand, 1, 3);
  const factor = intBetween(rand, 2, 3);
  const cap = base * factor * factor;
  const failures = [2, intBetween(rand, 3, 5), intBetween(rand, 0, 1), intBetween(rand, 5, 7)];

  const tests: TestCase[] = failures.map((f, i) => ({
    input: `retry_delays(${f}, ${base}, ${factor}, ${cap})`,
    expected: fmtSpaced(retryDelaysRef(f, base, factor, cap)),
    hidden: i === failures.length - 1,
  }));

  const briefs: [string, string, string] = [
    `The ${team} deploy pipeline waits between retries. Implement retry_delays(failures, base, factor, cap): return the wait before each of ${failures[0]} attempts, where wait i is base * factor^i capped at cap. With base ${base}, factor ${factor} and cap ${cap}, retry_delays(${failures[0]}, ${base}, ${factor}, ${cap}) -> ${fmtSpaced(retryDelaysRef(failures[0], base, factor, cap))}.`,
    `Edge cases: zero failures means an empty schedule, and long outage streaks must flatline at the cap of ${cap} instead of growing forever. Delays never decrease along the schedule.`,
    `Longer outage streaks: schedules many failures deep that must flatline at ${cap}. Delay i never exceeds the cap and never decreases along the schedule.`,
  ];
  return { briefs, tests };
}

const canon = generateRetryDelays(0);

export const retryDelaysScenario: Scenario = {
  id: "vault-retry-delays",
  title: "Retry Backoff",
  blurb: "Schedule waits between retries that grow exponentially but never pass a cap. With base 1, factor 2, cap 5 over 4 failures: waits are 1, 2, 4, then 8 capped to 5 — [1, 2, 4, 5].",
  difficulty: "Medium",
  tags: ["Math", "Simulation"],
  minutes: 25,
  promptPar: 5,
  timePar: 20,
  stages: [
    { title: "Backoff schedule", brief: canon.briefs[0], unlockHint: "Run the sample — a passing run unlocks stage 2." },
    { title: "Empty streaks and the cap", brief: canon.briefs[1], unlockHint: "A passing run here unlocks the hidden acceptance suite." },
    { title: "Hidden acceptance", brief: canon.briefs[2], unlockHint: "Finish to run the full acceptance suite." },
  ],
  acceptance: canon.tests,
  fnName: "retry_delays",
  variants: {
    seedKeys: ["team", "base", "factor", "failures"],
    description: "Seeded team name, backoff base/factor, and streak lengths; expected waits computed by the capped-exponential reference.",
  },
  cppReturn: "vec",
  stubs: {
    py: "def retry_delays(failures, base, factor, cap):\n    # your code here\n    pass\n",
    js: "function retryDelays(failures, base, factor, cap) {\n  // your code here\n}\n",
    cpp: "#include <vector>\nusing namespace std;\n\nvector<int> retry_delays(int failures, int base, int factor, int cap) {\n    // your code here\n    return {};\n}\n",
  },
  generate: generateRetryDelays,
};
