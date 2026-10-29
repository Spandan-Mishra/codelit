// Final judging (phase 1): blend trace efficiency with live defense.

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
