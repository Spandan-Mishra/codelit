// Final judging (phase 1): blend trace efficiency with live defense.
//
// Shape of a score (what the user chose):
// - Number 0-100 plus a tier label, with a per-dimension breakdown.
// - The trace score stays PROVISIONAL (capped below Credible) until the
//   text defense is completed; defending banks the final score.

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

// Trace counts 60%, defense (0..30 scale) counts 40%.
export function combineScores(traceScore0_100: number, defendTotal0_30: number): number {
  const trace = clamp100(traceScore0_100);
  const defend = clamp100((defendTotal0_30 / 30) * 100);
  return Math.round(trace * 0.6 + defend * 0.4);
}

export type TierLabel = "Convincing" | "Credible" | "Thin" | "Untrusted";

export interface Verdict {
  label: TierLabel;
  blurb: string;
}

export function verdictTier(score: number): Verdict {
  const s = clamp100(score);
  if (s >= 85) return { label: "Convincing", blurb: "Efficient trace, defended cold." };
  if (s >= 65) return { label: "Credible", blurb: "Solid run with a real defense." };
  if (s >= 40) return { label: "Thin", blurb: "Something is missing — trace or defense." };
  return { label: "Untrusted", blurb: "No evidence of understanding yet." };
}

// A score that was never defended cannot reach Credible, no matter how
// clean the trace looks. Pasted code has a clean trace too.
export const PROVISIONAL_CAP = 59;

export function provisionalScore(traceScore0_100: number): number {
  return Math.min(clamp100(traceScore0_100), PROVISIONAL_CAP);
}

export interface ScoreBreakdown {
  acceptance: number; // hidden-acceptance pass rate 0-100
  efficiency: number; // trace efficiency 0-100
  defense: number | null; // 0-100, null until defended
}

// The final banked score. Green acceptance is required to reach Credible:
// a run that never went green caps at Thin no matter the defense.
export function finalScore(args: {
  passedCount: number;
  totalCount: number;
  traceScore0_100: number;
  defendTotal0_30: number;
}): { score: number; breakdown: ScoreBreakdown; tier: Verdict } {
  const acceptance = args.totalCount > 0 ? Math.round((args.passedCount / args.totalCount) * 100) : 0;
  const defense = Math.round(clamp100((args.defendTotal0_30 / 30) * 100));
  const breakdown: ScoreBreakdown = { acceptance, efficiency: Math.round(clamp100(args.traceScore0_100)), defense };
  let score = combineScores(args.traceScore0_100, args.defendTotal0_30);
  if (acceptance < 100) score = Math.min(score, PROVISIONAL_CAP);
  return { score, breakdown, tier: verdictTier(score) };
}
