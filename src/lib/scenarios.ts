// Agent-assisted scenarios (phase 1). Each scenario reuses a proven problem
// core (two-sum map task, merge-intervals sweep task) and drip-feeds it in
// 3 stages: core sample -> edge/extension -> hidden acceptance.
// A variantSeed deterministically alters numeric test params (offset +
// input-order shuffle); expected outputs transform identically, so any seed
// yields a valid suite.

import type { Scenario, TestCase } from "./types";
import { mulberry32 } from "./rand";
import { VAULT_SCENARIOS, getVaultScenario } from "./vault/registry";

export { mulberry32 };

export const STAGE_COUNT = 3;

// --- Pair-sum (two-sum core) ---
// Uniform offset preserves solutions: (a+d)+(b+d) = t+2d iff a+b = t.

interface PairCase {
  nums: number[];
  target: number;
  expected: string;
  hidden?: boolean;
}

const PAIR_SUM_BASE: PairCase[] = [
  { nums: [2, 7, 11, 15], target: 9, expected: "[0, 1]" },
  { nums: [3, 2, 4], target: 6, expected: "[1, 2]" },
  { nums: [3, 3], target: 6, expected: "[0, 1]" },
  { nums: [-1, -2, -3], target: -5, expected: "[1, 2]", hidden: true },
];

function pairSumTests(seed: number): TestCase[] {
  if (seed === 0) {
    return PAIR_SUM_BASE.map((c) => ({
      input: `two_sum([${c.nums.join(",")}], ${c.target})`,
      expected: c.expected,
      hidden: c.hidden,
    }));
  }
  const rand = mulberry32(seed);
  const offset = 1 + Math.floor(rand() * 50);
  return PAIR_SUM_BASE.map((c) => {
    const nums = c.nums.map((n) => n + offset);
    const target = c.target + 2 * offset;
    return {
      input: `two_sum([${nums.join(",")}], ${target})`,
      expected: c.expected,
      hidden: c.hidden,
    };
  });
}

// --- Merge sweep (merge-intervals core) ---
// Uniform endpoint offset preserves overlaps; input order is shuffled with
// the seeded PRNG while expected output stays sorted.

interface MergeCase {
  intervals: number[][];
  merged: number[][];
  hidden?: boolean;
}

const MERGE_BASE: MergeCase[] = [
  {
    intervals: [
      [1, 3],
      [2, 6],
      [8, 10],
      [15, 18],
    ],
    merged: [
      [1, 6],
      [8, 10],
      [15, 18],
    ],
  },
  {
    intervals: [
      [1, 4],
      [4, 5],
    ],
    merged: [[1, 5]],
  },
  {
    intervals: [
      [1, 4],
      [0, 4],
    ],
    merged: [[0, 4]],
    hidden: true,
  },
];

function fmtCompact(iv: number[][]): string {
  return `[${iv.map((p) => `[${p[0]},${p[1]}]`).join(",")}]`;
}

function fmtSpaced(iv: number[][]): string {
  return `[${iv.map((p) => `[${p[0]}, ${p[1]}]`).join(", ")}]`;
}

function mergeTests(seed: number): TestCase[] {
  if (seed === 0) {
    return MERGE_BASE.map((c) => ({
      input: `merge(${fmtCompact(c.intervals)})`,
      expected: fmtSpaced(c.merged),
      hidden: c.hidden,
    }));
  }
  const rand = mulberry32(seed);
  const offset = 1 + Math.floor(rand() * 30);
  const shift = (iv: number[][]) => iv.map(([s, e]) => [s + offset, e + offset]);
  return MERGE_BASE.map((c) => {
    const shuffled = shift(c.intervals);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return {
      input: `merge(${fmtCompact(shuffled)})`,
      expected: fmtSpaced(shift(c.merged)),
      hidden: c.hidden,
    };
  });
}

export const SCENARIOS: Scenario[] = [
  {
    id: "agent-two-sum",
    title: "Pair Sum",
    difficulty: "Easy",
    tags: ["Hash Map", "Arrays"],
    minutes: 20,
    promptPar: 4,
    timePar: 15,
    stages: [
      {
        title: "Core pair",
        brief: "Implement two_sum(nums, target): return the indices of the two numbers that add up to target. Exactly one solution exists; the same element cannot be used twice. Pass the sample run to unlock the edge cases.",
        unlockHint: "Run the sample — a passing run unlocks stage 2.",
      },
      {
        title: "Duplicates and the self-pair trap",
        brief: "Extension: your map must not pair an element with itself. Handle duplicate values (e.g. [3, 3], target 6) and confirm the complement lookup runs before the insert, not after.",
        unlockHint: "A passing run here unlocks the hidden acceptance suite.",
      },
      {
        title: "Hidden acceptance",
        brief: "Final gate: the full suite including hidden negative-number cases runs at finish. No new visible tests — defend what you built.",
        unlockHint: "Finish to run the full acceptance suite.",
      },
    ],
    acceptance: pairSumTests(0),
    fnName: "two_sum",
    variants: {
      seedKeys: ["offset"],
      description: "Seeded uniform offset of nums/target; solution indices unchanged.",
    },
    cppReturn: "vec",
    stubs: {
      py: "def two_sum(nums, target):\n    # your code here\n    pass\n",
      js: "function twoSum(nums, target) {\n  // your code here\n}\n",
      cpp: "#include <vector>\nusing namespace std;\n\nvector<int> two_sum(vector<int> nums, int target) {\n    // your code here\n    return {};\n}\n",
    },
  },
  {
    id: "agent-merge-intervals",
    title: "Merge Sweep",
    difficulty: "Medium",
    tags: ["Sorting", "Intervals"],
    minutes: 25,
    promptPar: 4,
    timePar: 20,
    stages: [
      {
        title: "Overlapping cover",
        brief: "Implement merge(intervals): merge all overlapping intervals and return the non-overlapping cover sorted by start. Pass the sample run to unlock the edge cases.",
        unlockHint: "Run the sample — a passing run unlocks stage 2.",
      },
      {
        title: "Touching and unsorted input",
        brief: "Extension: touching intervals ([1,4],[4,5]) merge, and the input arrives shuffled — sort by start before you sweep. A passing run unlocks the hidden acceptance suite.",
        unlockHint: "Sort-then-sweep; a passing run here unlocks stage 3.",
      },
      {
        title: "Hidden acceptance",
        brief: "Final gate: the full suite including hidden containment cases runs at finish. No new visible tests — defend what you built.",
        unlockHint: "Finish to run the full acceptance suite.",
      },
    ],
    acceptance: mergeTests(0),
    fnName: "merge",
    variants: {
      seedKeys: ["offset", "order"],
      description: "Seeded uniform endpoint offset plus shuffled input order; merged cover shifts identically.",
    },
    cppReturn: "vecvec",
    stubs: {
      py: "def merge(intervals):\n    # your code here\n    pass\n",
      js: "function merge(intervals) {\n  // your code here\n}\n",
      cpp: "#include <vector>\nusing namespace std;\n\nvector<vector<int>> merge(vector<vector<int>> intervals) {\n    // your code here\n    return {};\n}\n",
    },
  },
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id) ?? getVaultScenario(id);
}

export const ALL_SCENARIOS: Scenario[] = [...SCENARIOS, ...VAULT_SCENARIOS];

// Full acceptance suite for a variant seed. Seed 0 is the canonical suite.
export function instantiateTests(scenario: Scenario, seed: number): TestCase[] {
  const s = seed >>> 0;
  if (scenario.generate) return scenario.generate(s).tests;
  if (scenario.id === "agent-two-sum") return pairSumTests(s);
  if (scenario.id === "agent-merge-intervals") return mergeTests(s);
  return scenario.acceptance;
}

// Drip-fed visible tests: stage 1 shows only the sample; stage 2+ show all
// non-hidden tests. Hidden tests are never revealed — finish evaluates them.
export function visibleTests(scenario: Scenario, seed: number, stageUnlocked: number): TestCase[] {
  const all = instantiateTests(scenario, seed).filter((t) => !t.hidden);
  if (stageUnlocked <= 1) return all.slice(0, 1);
  return all;
}
