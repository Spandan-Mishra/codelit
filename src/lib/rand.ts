// Seeded PRNG + helpers shared by scenario generators.
// Deterministic: same seed -> same suite, every machine.

export type Rand = () => number;

// Deterministic PRNG (mulberry32).
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rand: Rand, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function intBetween(rand: Rand, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

// Fisher-Yates; returns a new shuffled array.
export function shuffle<T>(rand: Rand, arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
