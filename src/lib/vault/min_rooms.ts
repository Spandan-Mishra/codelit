// Generative vault scenario: minimum meeting rooms.
// Story: conference scheduler for a randomized team. All test literals are
// cross-language (ints and int lists only).

import type { Scenario, TestCase } from "../types";
import { mulberry32, pick, intBetween } from "../rand";

const TEAMS = ["checkout", "search", "billing", "auth", "notify", "ledger", "catalog", "sessions"] as const;

// Reference: sweep sorted starts against sorted ends; a meeting starting
// exactly when another ends reuses the room (strict < takes a new room).
export function minRoomsRef(starts: number[], ends: number[]): number {
  if (starts.length === 0) return 0;
  const s = [...starts].sort((a, b) => a - b);
  const e = [...ends].sort((a, b) => a - b);
  let rooms = 0;
  let j = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] < e[j]) rooms++;
    else j++;
  }
  return rooms;
}

const fmtCompact = (a: number[]): string => `[${a.join(",")}]`;

interface MeetingSet {
  starts: number[];
  ends: number[];
}

export function generateMinRooms(seed: number): { briefs: [string, string, string]; tests: TestCase[] } {
  const rand = mulberry32(seed);
  const team = pick(rand, TEAMS);
  const base = intBetween(rand, 0, 12);

  // Case 0 (sample): partial overlaps in a tight block.
  const n0 = intBetween(rand, 3, 4);
  const m0: MeetingSet = { starts: [], ends: [] };
  for (let i = 0; i < n0; i++) {
    const st = base + intBetween(rand, 0, 4);
    m0.starts.push(st);
    m0.ends.push(st + intBetween(rand, 2, 5));
  }
  // Case 1 (edge): back-to-back chain reuses a single room.
  const n1 = intBetween(rand, 3, 4);
  const step = intBetween(rand, 1, 3);
  const m1: MeetingSet = { starts: [], ends: [] };
  for (let i = 0; i < n1; i++) {
    m1.starts.push(base + 20 + i * step);
    m1.ends.push(base + 20 + (i + 1) * step);
  }
  // Case 2 (edge): fully overlapping block needs one room per meeting.
  const n2 = intBetween(rand, 2, 4);
  const m2: MeetingSet = { starts: [], ends: [] };
  for (let i = 0; i < n2; i++) {
    m2.starts.push(base + 40 + i);
    m2.ends.push(base + 40 + n2 + 5);
  }
  // Case 3 (hidden): larger random day.
  const n3 = intBetween(rand, 4, 6);
  const m3: MeetingSet = { starts: [], ends: [] };
  for (let i = 0; i < n3; i++) {
    const st = base + intBetween(rand, 0, 10);
    m3.starts.push(st);
    m3.ends.push(st + intBetween(rand, 1, 4));
  }

  const cases = [m0, m1, m2, m3];
  const tests: TestCase[] = cases.map((m, i) => ({
    input: `min_rooms(${fmtCompact(m.starts)}, ${fmtCompact(m.ends)})`,
    expected: String(minRoomsRef(m.starts, m.ends)),
    hidden: i === cases.length - 1,
  }));

  const briefs: [string, string, string] = [
    `The ${team} team books standups in shared rooms. Implement min_rooms(starts, ends): given parallel lists of meeting start and end times, return the fewest rooms that fit every meeting. A meeting that ends exactly when another starts can reuse the room. Sample: min_rooms(${fmtCompact(m0.starts)}, ${fmtCompact(m0.ends)}) -> ${minRoomsRef(m0.starts, m0.ends)}.`,
    `Edge days: a back-to-back chain like ${fmtCompact(m1.starts)} needs just one room, while a fully overlapping block needs one room per meeting. Sort both timelines before you sweep.`,
    `Full-day schedules mixing chains, full overlaps, and boundary touches. A meeting that ends exactly when another starts frees its room first.`,
  ];
  return { briefs, tests };
}

const canon = generateMinRooms(0);

export const minRoomsScenario: Scenario = {
  id: "vault-min-rooms",
  title: "Meeting Rooms",
  blurb: "Book the fewest rooms that fit every meeting. Sort starts and ends, then sweep: meetings [9, 10] and [10, 11] touch but never overlap, so 1 room is enough — an ending meeting frees its room first.",
  difficulty: "Medium",
  tags: ["Sorting", "Intervals"],
  minutes: 25,
  promptPar: 5,
  timePar: 20,
  stages: [
    { title: "Room count", brief: canon.briefs[0], unlockHint: "Run the sample — a passing run unlocks stage 2." },
    { title: "Chains and pileups", brief: canon.briefs[1], unlockHint: "A passing run here unlocks the hidden acceptance suite." },
    { title: "Hidden acceptance", brief: canon.briefs[2], unlockHint: "Finish to run the full acceptance suite." },
  ],
  acceptance: canon.tests,
  fnName: "min_rooms",
  variants: {
    seedKeys: ["team", "starts", "ends"],
    description: "Seeded team name and meeting timelines; expected room counts computed by the sort-and-sweep reference.",
  },
  cppReturn: "int",
  stubs: {
    py: "def min_rooms(starts, ends):\n    # your code here\n    pass\n",
    js: "function minRooms(starts, ends) {\n  // your code here\n}\n",
    cpp: "#include <vector>\nusing namespace std;\n\nint min_rooms(vector<int> starts, vector<int> ends) {\n    // your code here\n    return 0;\n}\n",
  },
  generate: generateMinRooms,
};
