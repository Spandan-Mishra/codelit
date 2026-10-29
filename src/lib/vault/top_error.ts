// Generative vault scenario: most frequent error code in on-call logs.
// Story: on-call triage for a randomized service. All test literals are
// cross-language (double-quoted strings with no brackets or apostrophes).

import type { Scenario, TestCase } from "../types";
import { mulberry32, pick, intBetween, shuffle } from "../rand";

const SERVICES = ["checkout", "search", "billing", "auth", "notify", "ledger", "catalog", "sessions"] as const;
const CODES = ["ERR500", "ERR404", "TIMEOUT", "OOM"] as const;

// Reference: most frequent code; ties break toward the
// lexicographically smallest string. Input is never empty.
export function topErrorRef(codes: string[]): string {
  const counts = new Map<string, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best = "";
  let bestCount = -1;
  for (const [code, n] of counts) {
    if (n > bestCount || (n === bestCount && code < best)) {
      best = code;
      bestCount = n;
    }
  }
  return best;
}

const fmtCodes = (a: string[]): string => `[${a.map((c) => `"${c}"`).join(",")}]`;
const fmtStr = (s: string): string => `"${s}"`;

export function generateTopError(seed: number): { briefs: [string, string, string]; tests: TestCase[] } {
  const rand = mulberry32(seed);
  const service = pick(rand, SERVICES);

  // Case 0 (sample): mixed log page with a clear-ish winner.
  const n0 = intBetween(rand, 4, 6);
  const winner = pick(rand, CODES);
  const codes0: string[] = [winner, winner];
  for (let i = codes0.length; i < n0; i++) codes0.push(pick(rand, CODES));
  const sample = shuffle(rand, codes0);
  // Case 1 (edge): exact tie resolves to the lexicographically smallest code.
  const pair = shuffle(rand, [...CODES]).slice(0, 2);
  const tieCount = intBetween(rand, 2, 3);
  const codes1 = shuffle(
    rand,
    Array.from({ length: tieCount * 2 }, (_, i) => pair[i % 2]),
  );
  // Case 2 (edge): a single code repeated through the whole page.
  const solo = pick(rand, CODES);
  const codes2 = new Array(intBetween(rand, 2, 4)).fill(solo) as string[];
  // Case 3 (hidden): longer noisy page.
  const n3 = intBetween(rand, 7, 10);
  const codes3: string[] = [];
  for (let i = 0; i < n3; i++) codes3.push(pick(rand, CODES));

  const cases = [sample, codes1, codes2, codes3];
  const tests: TestCase[] = cases.map((codes, i) => ({
    input: `top_error(${fmtCodes(codes)})`,
    expected: fmtStr(topErrorRef(codes)),
    hidden: i === cases.length - 1,
  }));

  const briefs: [string, string, string] = [
    `You are on call for the ${service} service and its log page is full of failures. Implement top_error(codes): given the list of error code strings, return the code that appears most often. When two codes tie for the top count, return the lexicographically smallest one. Sample: top_error(${fmtCodes(sample)}) -> ${fmtStr(topErrorRef(sample))}.`,
    `Edge pages: an exact tie such as ${fmtCodes(codes1)} must resolve to ${fmtStr(topErrorRef(codes1))}, while a page repeating one code like ${fmtCodes(codes2)} returns that code. Compare code strings with plain lexicographic order.`,
    `Longer noisy pages with close races and multi-way ties. Ties always break to the lexicographically smallest code string.`,
  ];
  return { briefs, tests };
}

const canon = generateTopError(0);

export const topErrorScenario: Scenario = {
  id: "vault-top-error",
  title: "Top Error",
  difficulty: "Medium",
  tags: ["Hash Map", "Strings"],
  minutes: 25,
  promptPar: 5,
  timePar: 20,
  stages: [
    { title: "Triage the page", brief: canon.briefs[0], unlockHint: "Run the sample — a passing run unlocks stage 2." },
    { title: "Ties and repeats", brief: canon.briefs[1], unlockHint: "A passing run here unlocks the hidden acceptance suite." },
    { title: "Hidden acceptance", brief: canon.briefs[2], unlockHint: "Finish to run the full acceptance suite." },
  ],
  acceptance: canon.tests,
  fnName: "top_error",
  variants: {
    seedKeys: ["service", "codes"],
    description: "Seeded service name and error-code log pages; expected winners computed by the count-with-lexicographic-tiebreak reference.",
  },
  cppReturn: "str",
  stubs: {
    py: "def top_error(codes):\n    # your code here\n    pass\n",
    js: "function topError(codes) {\n  // your code here\n}\n",
    cpp: "#include <string>\n#include <vector>\nusing namespace std;\n\nstring top_error(vector<string> codes) {\n    // your code here\n    return \"\";\n}\n",
  },
  generate: generateTopError,
};
