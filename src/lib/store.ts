"use client";
import { useEffect, useState } from "react";
import type { AttemptRecord, DebugRecord } from "./types";

const ATTEMPTS_KEY = "codelit:attempts";
const DEBUG_KEY = "codelit:debug";
const NAME_KEY = "codelit:name";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function getAttempts(): Record<string, AttemptRecord> {
  return read(ATTEMPTS_KEY, {});
}
export function saveAttempt(rec: AttemptRecord) {
  const all = getAttempts();
  all[rec.problemId] = rec;
  write(ATTEMPTS_KEY, all);
}
export function getDebugRecords(): Record<string, DebugRecord> {
  return read(DEBUG_KEY, {});
}
export function saveDebug(rec: DebugRecord) {
  const all = getDebugRecords();
  all[rec.challengeId] = rec;
  write(DEBUG_KEY, all);
}

export function useLocal<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    // External-system sync (localStorage), deferred to a callback.
    const t = setTimeout(() => setValue(read(key, fallback)), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = (v: T) => {
    setValue(v);
    write(key, v);
  };
  return [value, set] as const;
}

export function getName(): string {
  return read(NAME_KEY, "");
}
export function setName(name: string) {
  write(NAME_KEY, name);
}

export function credibilityScore(): { score: number; defended: number; debugSolved: number; total: number } {
  const attempts = Object.values(getAttempts());
  const debug = Object.values(getDebugRecords());
  const defendedRecs = attempts.filter((a) => a.defendScore !== null);
  const avgDefend = defendedRecs.length
    ? defendedRecs.reduce((s, a) => s + (a.defendScore || 0), 0) / defendedRecs.length
    : 0;
  const debugSolved = debug.filter((d) => d.status === "solved").length;
  const score = Math.round(Math.min(100, avgDefend * 7 + defendedRecs.length * 5 + debugSolved * 8));
  return { score, defended: defendedRecs.length, debugSolved, total: attempts.length };
}
