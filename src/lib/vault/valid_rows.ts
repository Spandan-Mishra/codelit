// Generative vault scenario: scrubbing signup rows by age and ZIP.
// Story: signup data scrub for a randomized club. All test literals are
// cross-language (ints and int lists only).

import type { Scenario, TestCase } from "../types";
import { mulberry32, pick, intBetween } from "../rand";

const CLUBS = ["checkout", "search", "billing", "auth", "notify", "ledger", "catalog", "sessions"] as const;

// Reference: keep index i when 18 <= ages[i] <= 99 and
// 10000 <= zips[i] <= 99999. Both bounds are inclusive.
export function validRowsRef(ages: number[], zips: number[]): number[] {
  const out: number[] = [];
  const n = Math.min(ages.length, zips.length);
  for (let i = 0; i < n; i++) {
    if (ages[i] >= 18 && ages[i] <= 99 && zips[i] >= 10000 && zips[i] <= 99999) out.push(i);
  }
  return out;
}

const fmtCompact = (a: number[]): string => `[${a.join(",")}]`;
const fmtSpaced = (a: number[]): string => `[${a.join(", ")}]`;

export function generateValidRows(seed: number): { briefs: [string, string, string]; tests: TestCase[] } {
  const rand = mulberry32(seed);
  const club = pick(rand, CLUBS);

  // Case 0 (sample): mixed rows, some valid and some not.
  const n0 = intBetween(rand, 4, 6);
  const ages0: number[] = [];
  const zips0: number[] = [];
  for (let i = 0; i < n0; i++) {
    ages0.push(pick(rand, [intBetween(rand, 0, 120), intBetween(rand, 18, 99)]));
    zips0.push(pick(rand, [intBetween(rand, 0, 200000), intBetween(rand, 10000, 99999)]));
  }
  // Case 1 (edge): every boundary value, just inside and just outside.
  const ages1 = [17, 18, 99, 100];
  const zips1 = [9999, 10000, 99999, 100000];
  // Case 2 (edge): empty signup sheet.
  const ages2: number[] = [];
  const zips2: number[] = [];
  // Case 3 (hidden): longer sheet with boundary-heavy values.
  const poolA = [17, 18, 25, 99, 100, intBetween(rand, 0, 120)];
  const poolZ = [9999, 10000, 50000, 99999, 100000, intBetween(rand, 0, 200000)];
  const n3 = intBetween(rand, 6, 8);
  const ages3: number[] = [];
  const zips3: number[] = [];
  for (let i = 0; i < n3; i++) {
    ages3.push(pick(rand, poolA));
    zips3.push(pick(rand, poolZ));
  }

  const cases = [
    { ages: ages0, zips: zips0 },
    { ages: ages1, zips: zips1 },
    { ages: ages2, zips: zips2 },
    { ages: ages3, zips: zips3 },
  ];
  const tests: TestCase[] = cases.map((c, i) => ({
    input: `valid_rows(${fmtCompact(c.ages)}, ${fmtCompact(c.zips)})`,
    expected: fmtSpaced(validRowsRef(c.ages, c.zips)),
    hidden: i === cases.length - 1,
  }));

  const briefs: [string, string, string] = [
    `The ${club} club collected parallel lists of signup ages and ZIP codes, and some rows are junk. Implement valid_rows(ages, zips): return the indices of rows where the age is between 18 and 99 and the ZIP is between 10000 and 99999, with all bounds inclusive. Return the indices in ascending order. Sample: valid_rows(${fmtCompact(ages0)}, ${fmtCompact(zips0)}) -> ${fmtSpaced(validRowsRef(ages0, zips0))}.`,
    `Edge sheets: the boundary rows ${fmtCompact(ages1)} against ${fmtCompact(zips1)} keep only indices ${fmtSpaced(validRowsRef(ages1, zips1))}, and an empty sheet returns an empty list. Ages like 17 or 100 and ZIPs like 9999 or 100000 are always rejected.`,
    `Final gate: hidden signup sheets run at finish, with longer rosters and boundary-heavy rows. No new visible tests — defend what you built.`,
  ];
  return { briefs, tests };
}

const canon = generateValidRows(0);

export const validRowsScenario: Scenario = {
  id: "vault-valid-rows",
  title: "Valid Rows",
  difficulty: "Medium",
  tags: ["Filtering", "Arrays"],
  minutes: 25,
  promptPar: 5,
  timePar: 20,
  stages: [
    { title: "Scrub the sheet", brief: canon.briefs[0], unlockHint: "Run the sample — a passing run unlocks stage 2." },
    { title: "Boundaries and empties", brief: canon.briefs[1], unlockHint: "A passing run here unlocks the hidden acceptance suite." },
    { title: "Hidden acceptance", brief: canon.briefs[2], unlockHint: "Finish to run the full acceptance suite." },
  ],
  acceptance: canon.tests,
  fnName: "valid_rows",
  variants: {
    seedKeys: ["club", "ages", "zips"],
    description: "Seeded club name and signup sheets; expected index lists computed by the inclusive-bounds filter reference.",
  },
  cppReturn: "vec",
  stubs: {
    py: "def valid_rows(ages, zips):\n    # your code here\n    pass\n",
    js: "function validRows(ages, zips) {\n  // your code here\n}\n",
    cpp: "#include <vector>\nusing namespace std;\n\nvector<int> valid_rows(vector<int> ages, vector<int> zips) {\n    // your code here\n    return {};\n}\n",
  },
  generate: generateValidRows,
};
