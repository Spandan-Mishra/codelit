import type { TestCase } from "./types";

export interface RunResult {
  input: string;
  expected: string;
  actual: string;
  passed: boolean;
  hidden?: boolean;
}

export async function runTests(args: {
  language: "python" | "javascript";
  code: string;
  fnName: string;
  tests: TestCase[];
}): Promise<{ results: RunResult[]; error?: string; engine: string }> {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) return { results: [], error: `Runner error ${res.status}`, engine: "error" };
  return res.json();
}

export function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").replace(/'/g, '"').toLowerCase();
}

export function outputsMatch(actual: string, expected: string, fnName: string): boolean {
  const a = normalize(actual);
  const e = normalize(expected);
  if (a === e) return true;
  // group-anagrams special-case: compare sorted groups loosely
  if (e.startsWith("groups:")) {
    const groups = e
      .replace("groups:", "")
      .split("|")
      .map((g) => g.split(",").map((x) => x.trim()).filter(Boolean).sort().join(","))
      .sort();
    const flat = a.replace(/[\[\]"]/g, " ");
    return groups.every((g) => g.split(",").every((w) => flat.includes(w)));
  }
  try {
    const pa = JSON.parse(actual.replace(/'/g, '"').replace(/True/g, "true").replace(/False/g, "false"));
    const pe = JSON.parse(expected.replace(/'/g, '"').replace(/True/g, "true").replace(/False/g, "false"));
    const sortDeep = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(sortDeep).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))) : v;
    if (fnName.includes("group")) return JSON.stringify(sortDeep(pa)) === JSON.stringify(sortDeep(pe));
    if (Array.isArray(pa) && Array.isArray(pe) && pa.length === pe.length && typeof pa[0] === "number")
      return JSON.stringify([...pa].sort((x, y) => x - y)) === JSON.stringify([...pe].sort((x, y) => x - y));
    return JSON.stringify(pa) === JSON.stringify(pe);
  } catch {
    return false;
  }
}
