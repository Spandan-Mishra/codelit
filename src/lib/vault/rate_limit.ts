// Generative vault scenario: sliding-window API rate limiting.
// Story: gateway quota for a randomized service. All test literals are
// cross-language (ints and int lists only).

import type { Scenario, TestCase } from "../types";
import { mulberry32, pick, intBetween } from "../rand";

const SERVICES = ["checkout", "search", "billing", "auth", "notify", "ledger", "catalog", "sessions"] as const;

// Reference: request at t is allowed iff fewer than `capacity` already-allowed
// requests fall strictly after t - window (window covers (t-window, t]).
export function rateLimitRef(timestamps: number[], capacity: number, window: number): number[] {
  const allowed: number[] = [];
  const out: number[] = [];
  for (const t of timestamps) {
    const inWindow = allowed.filter((a) => a > t - window).length;
    if (inWindow < capacity) {
      allowed.push(t);
      out.push(1);
    } else {
      out.push(0);
    }
  }
  return out;
}

const fmtCompact = (a: number[]): string => `[${a.join(",")}]`;
const fmtSpaced = (a: number[]): string => `[${a.join(", ")}]`;

export function generateRateLimit(seed: number): { briefs: [string, string, string]; tests: TestCase[] } {
  const rand = mulberry32(seed);
  const service = pick(rand, SERVICES);
  const capacity = intBetween(rand, 1, 3);
  const window = intBetween(rand, 2, 10);
  const base = intBetween(rand, 0, 20);

  // Case 0 (sample): gentle mixed traffic with small gaps.
  const n0 = intBetween(rand, 4, 6);
  const ts0: number[] = [];
  let t = base;
  for (let i = 0; i < n0; i++) {
    ts0.push(t);
    t += intBetween(rand, 0, 2);
  }
  // Case 1 (edge): simultaneous burst bigger than capacity.
  const ts1 = new Array(capacity + 2).fill(base + window + 1) as number[];
  // Case 2 (edge): traffic spaced wider than the window always passes.
  const ts2 = [0, 1, 2, 3].map((i) => base + 30 + i * (window + 1));
  // Case 3 (hidden): longer mixed run with boundary gaps.
  const n3 = intBetween(rand, 6, 8);
  const ts3: number[] = [];
  let u = base + 60;
  for (let i = 0; i < n3; i++) {
    ts3.push(u);
    u += intBetween(rand, 0, window);
  }

  const cases = [ts0, ts1, ts2, ts3];
  const tests: TestCase[] = cases.map((ts, i) => ({
    input: `rate_limit(${fmtCompact(ts)}, ${capacity}, ${window})`,
    expected: fmtSpaced(rateLimitRef(ts, capacity, window)),
    hidden: i === cases.length - 1,
  }));

  const briefs: [string, string, string] = [
    `The ${service} API gateway allows ${capacity} requests per ${window}-second window. Implement rate_limit(timestamps, capacity, window): timestamps arrive in non-decreasing order, and you return one 1 (allowed) or 0 (denied) per request. A request at time t is allowed when fewer than ${capacity} already-allowed requests fall after t - ${window}. Sample: rate_limit(${fmtCompact(ts0)}, ${capacity}, ${window}) -> ${fmtSpaced(rateLimitRef(ts0, capacity, window))}.`,
    `Edge traffic: a burst of ${ts1.length} simultaneous requests must cap at ${capacity} allows, while requests spaced wider than the window (like ${fmtCompact(ts2)}) all pass. A request exactly ${window} seconds after an older one no longer shares its window. Only already-allowed requests count toward the quota.`,
    `Longer bursts and boundary timestamps: expect back-to-back requests at the window edge and bursts well above ${capacity}. Only already-allowed requests consume quota — denied ones never do.`,
  ];
  return { briefs, tests };
}

const canon = generateRateLimit(0);

export const rateLimitScenario: Scenario = {
  id: "vault-rate-limit",
  title: "Rate Limit",
  blurb: "Guard an API: each request is allowed only while fewer than capacity already-allowed requests sit inside the window. With capacity 2 and window 5, requests at [0, 1, 2, 3] give [1, 1, 0, 0] — denied requests never consume quota.",
  difficulty: "Medium",
  tags: ["Sliding Window", "Arrays"],
  minutes: 25,
  promptPar: 5,
  timePar: 20,
  stages: [
    { title: "Gateway quota", brief: canon.briefs[0], unlockHint: "Run the sample — a passing run unlocks stage 2." },
    { title: "Bursts and boundaries", brief: canon.briefs[1], unlockHint: "A passing run here unlocks the hidden acceptance suite." },
    { title: "Hidden acceptance", brief: canon.briefs[2], unlockHint: "Finish to run the full acceptance suite." },
  ],
  acceptance: canon.tests,
  fnName: "rate_limit",
  variants: {
    seedKeys: ["service", "capacity", "window", "timestamps"],
    description: "Seeded service name, quota config, and timestamp traffic; expected allows computed by the sliding-window reference.",
  },
  cppReturn: "vec",
  stubs: {
    py: "def rate_limit(timestamps, capacity, window):\n    # your code here\n    pass\n",
    js: "function rateLimit(timestamps, capacity, window) {\n  // your code here\n}\n",
    cpp: "#include <vector>\nusing namespace std;\n\nvector<int> rate_limit(vector<int> timestamps, int capacity, int window) {\n    // your code here\n    return {};\n}\n",
  },
  generate: generateRateLimit,
};
