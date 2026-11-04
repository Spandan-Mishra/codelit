// House-agent duel core: scripted house timeline + demo credit ledger.
//
// NOTE (demo-grade): credits live in a per-process in-memory Map keyed by
// IP. Dev-server reloads and redeploys reset balances — swap for KV before
// real users, same as the attempt store in /api/agent-run.

export type DifficultyKey = "easy" | "medium" | "hard";

export interface DifficultyConfig {
  label: string;
  pace: string;
  targetSolveSec: number;
  stepEverySec: number;
  cost: number;
  locked: boolean;
}

export const DIFFICULTIES: Record<DifficultyKey, DifficultyConfig> = {
  easy: {
    label: "Easy Sparring",
    pace: "Steady pace",
    targetSolveSec: 480,
    stepEverySec: 75,
    cost: 0,
    locked: false,
  },
  medium: {
    label: "Medium Sparring",
    pace: "Fast pace",
    targetSolveSec: 300,
    stepEverySec: 50,
    cost: 3,
    locked: true,
  },
  hard: {
    label: "Hard Sparring",
    pace: "Relentless pace",
    targetSolveSec: 180,
    stepEverySec: 30,
    cost: 6,
    locked: true,
  },
};

export function isDifficulty(v: unknown): v is DifficultyKey {
  return v === "easy" || v === "medium" || v === "hard";
}

export const HOUSE_STEPS = [
  "reading the brief",
  "drafting an approach",
  "passing the sample",
  "half the suite green",
  "fixing the last edge",
  "full suite green → passed",
] as const;

export interface DuelTick {
  stepIndex: number;
  stepLabel: string;
  progress0_100: number;
  housePassed: boolean;
  elapsedSec: number;
}

// == LIVE-MODEL INTEGRATION SEAM ==
// tickDuel is intentionally a pure function of (startMs, nowMs, difficulty)
// so the scripted timeline below can be swapped for a live model loop later:
// keep this signature and have the loop report {stepIndex, stepLabel,
// progress0_100, housePassed} from real agent events instead of the clock.
// No callers depend on the timeline internals, only on DuelTick.
export function tickDuel(startMs: number, nowMs: number, difficulty: DifficultyKey): DuelTick {
  const cfg = DIFFICULTIES[difficulty];
  const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const elapsedExact = Math.max(0, (nowMs - startMs) / 1000);
  const stepIndex = Math.min(HOUSE_STEPS.length - 1, Math.floor(elapsedExact / cfg.stepEverySec));
  const progress0_100 = Math.min(100, Math.floor((elapsedExact / cfg.targetSolveSec) * 100));
  const housePassed = elapsedExact >= cfg.targetSolveSec;
  return { stepIndex, stepLabel: HOUSE_STEPS[stepIndex], progress0_100, housePassed, elapsedSec };
}

// --- Credit ledger (in-memory, per IP; demo-grade, see note above) ---

const credits = new Map<string, number>();

export function getCredits(ip: string): number {
  return credits.get(ip) ?? 0;
}

export function addCredits(ip: string, delta: number): number {
  const next = Math.max(0, getCredits(ip) + delta);
  credits.set(ip, next);
  return next;
}

/** Deduct cost when the balance covers it. Returns false (no-op) otherwise. */
export function trySpendCredits(ip: string, cost: number): boolean {
  if (getCredits(ip) < cost) return false;
  addCredits(ip, -cost);
  return true;
}

export type DuelResult = "win" | "loss";

export function resolveDuel(outcome: { userPassed: boolean; housePassed: boolean; ip: string }): {
  result: DuelResult;
  credits: number;
} {
  const { userPassed, housePassed, ip } = outcome;
  if (userPassed && !housePassed) {
    return { result: "win", credits: addCredits(ip, 2) };
  }
  return { result: "loss", credits: getCredits(ip) };
}

// --- Local duel history (passport reads this key) ---

export const DUELS_KEY = "codelit:duels";

export interface DuelRecord {
  scenarioId: string;
  difficulty: DifficultyKey;
  result: DuelResult;
  at: string;
}
