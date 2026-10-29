// Generative vault scenario: auditing meetings that exceed room capacity.
// Story: calendar overbooking audit for a randomized team. All test
// literals are cross-language (ints and int lists only).

import type { Scenario, TestCase } from "../types";
import { mulberry32, pick, intBetween } from "../rand";

const TEAMS = ["checkout", "search", "billing", "auth", "notify", "ledger", "catalog", "sessions"] as const;

// Reference: sweep start/end events in time order, ends before starts at
// equal times. A meeting is overbooked when the occupancy at its start
// (itself included) exceeds capacity. Output follows sweep order.
export function overbookedSlotsRef(starts: number[], ends: number[], capacity: number): number[] {
  const events: { t: number; end: boolean; idx: number }[] = [];
  for (let i = 0; i < starts.length; i++) {
    events.push({ t: starts[i], end: false, idx: i });
    events.push({ t: ends[i], end: true, idx: i });
  }
  events.sort((a, b) => a.t - b.t || Number(b.end) - Number(a.end) || a.idx - b.idx);
  let occupancy = 0;
  const bad: number[] = [];
  for (const e of events) {
    if (e.end) {
      occupancy--;
    } else {
      occupancy++;
      if (occupancy > capacity) bad.push(e.idx);
    }
  }
  return bad;
}

const fmtCompact = (a: number[]): string => `[${a.join(",")}]`;
const fmtSpaced = (a: number[]): string => `[${a.join(", ")}]`;

interface Day {
  starts: number[];
  ends: number[];
}

export function generateOverbookedSlots(seed: number): { briefs: [string, string, string]; tests: TestCase[] } {
  const rand = mulberry32(seed);
  const team = pick(rand, TEAMS);
  const capacity = intBetween(rand, 1, 2);
  const base = intBetween(rand, 0, 12);

  // Case 0 (sample): a forced overlap on top of random meetings.
  const n0 = intBetween(rand, 3, 4);
  const d0: Day = { starts: [base, base + 1], ends: [base + 5, base + 6] };
  for (let i = d0.starts.length; i < n0; i++) {
    const st = base + intBetween(rand, 0, 6);
    d0.starts.push(st);
    d0.ends.push(st + intBetween(rand, 1, 4));
  }
  // Case 1 (edge): back-to-back chain never overlaps, so nothing is overbooked.
  const n1 = intBetween(rand, 3, 4);
  const step = intBetween(rand, 1, 3);
  const d1: Day = { starts: [], ends: [] };
  for (let i = 0; i < n1; i++) {
    d1.starts.push(base + 20 + i * step);
    d1.ends.push(base + 20 + (i + 1) * step);
  }
  // Case 2 (edge): fully overlapping block overbooks all but `capacity`.
  const n2 = capacity + intBetween(rand, 1, 3);
  const d2: Day = { starts: [], ends: [] };
  for (let i = 0; i < n2; i++) {
    d2.starts.push(base + 40 + i);
    d2.ends.push(base + 40 + n2 + 5);
  }
  // Case 3 (hidden): larger random day.
  const n3 = intBetween(rand, 5, 7);
  const d3: Day = { starts: [], ends: [] };
  for (let i = 0; i < n3; i++) {
    const st = base + intBetween(rand, 0, 10);
    d3.starts.push(st);
    d3.ends.push(st + intBetween(rand, 1, 5));
  }

  const cases = [d0, d1, d2, d3];
  const tests: TestCase[] = cases.map((d, i) => ({
    input: `overbooked_slots(${fmtCompact(d.starts)}, ${fmtCompact(d.ends)}, ${capacity})`,
    expected: fmtSpaced(overbookedSlotsRef(d.starts, d.ends, capacity)),
    hidden: i === cases.length - 1,
  }));

  const briefs: [string, string, string] = [
    `The ${team} team shares rooms with capacity ${capacity}, and too many meetings got double-booked. Implement overbooked_slots(starts, ends, capacity): given parallel lists of meeting start and end times, return the indices of the meetings that push occupancy over capacity. Sweep events in time order with ends before starts at equal times, and flag a meeting when the occupancy at its start, itself included, exceeds ${capacity}. Sample: overbooked_slots(${fmtCompact(d0.starts)}, ${fmtCompact(d0.ends)}, ${capacity}) -> ${fmtSpaced(overbookedSlotsRef(d0.starts, d0.ends, capacity))}.`,
    `Edge days: a back-to-back chain like ${fmtCompact(d1.starts)} reuses the room at every touch, so nothing is overbooked. A fully overlapping block of ${n2} meetings must flag exactly ${n2 - capacity} of them. Report flagged indices in sweep order.`,
    `Final gate: hidden full-day calendars run at finish, mixing chains, pileups, and boundary touches. No new visible tests — defend what you built.`,
  ];
  return { briefs, tests };
}

const canon = generateOverbookedSlots(0);

export const overbookedSlotsScenario: Scenario = {
  id: "vault-overbooked-slots",
  title: "Overbooked Slots",
  difficulty: "Hard",
  tags: ["Sweep Line", "Intervals"],
  minutes: 30,
  promptPar: 5,
  timePar: 25,
  stages: [
    { title: "Audit the calendar", brief: canon.briefs[0], unlockHint: "Run the sample — a passing run unlocks stage 2." },
    { title: "Chains and pileups", brief: canon.briefs[1], unlockHint: "A passing run here unlocks the hidden acceptance suite." },
    { title: "Hidden acceptance", brief: canon.briefs[2], unlockHint: "Finish to run the full acceptance suite." },
  ],
  acceptance: canon.tests,
  fnName: "overbooked_slots",
  variants: {
    seedKeys: ["team", "capacity", "starts", "ends"],
    description: "Seeded team name, room capacity, and meeting timelines; expected overbooked indices computed by the ends-first sweep reference.",
  },
  cppReturn: "vec",
  stubs: {
    py: "def overbooked_slots(starts, ends, capacity):\n    # your code here\n    pass\n",
    js: "function overbookedSlots(starts, ends, capacity) {\n  // your code here\n}\n",
    cpp: "#include <vector>\nusing namespace std;\n\nvector<int> overbooked_slots(vector<int> starts, vector<int> ends, int capacity) {\n    // your code here\n    return {};\n}\n",
  },
  generate: generateOverbookedSlots,
};
