// Async leaderboard board: file-backed top list shared across processes.
// Demo-grade: JSON file at data/leaderboard.json (gitignored). All IO is
// wrapped in try/catch — a failed read yields an empty board, never a throw.

import { promises as fs } from "fs";
import path from "path";
import { isDifficulty, type DifficultyKey } from "./duel";

export type BoardResult = "win" | "loss" | "solo";

export interface LeaderboardEntry {
  name: string;
  scenarioId: string;
  difficulty: DifficultyKey;
  score: number;
  tier: string;
  result: BoardResult;
  prompts: number;
  at: string; // ISO timestamp, always server time
}

export interface ClientEntryFields {
  name: string;
  scenarioId: string;
  difficulty: DifficultyKey;
  score: number;
  tier: string;
  result: BoardResult;
  prompts: number;
}

const MAX_ENTRIES = 500;
const BOARD_PATH = path.join(process.cwd(), "data", "leaderboard.json");

function isEntry(v: unknown): v is LeaderboardEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.name === "string" &&
    typeof e.scenarioId === "string" &&
    isDifficulty(e.difficulty) &&
    typeof e.score === "number" &&
    Number.isFinite(e.score) &&
    typeof e.tier === "string" &&
    (e.result === "win" || e.result === "loss" || e.result === "solo") &&
    typeof e.prompts === "number" &&
    typeof e.at === "string"
  );
}

function byScoreDesc(a: LeaderboardEntry, b: LeaderboardEntry): number {
  return b.score - a.score || a.at.localeCompare(b.at);
}

async function readBoard(): Promise<LeaderboardEntry[]> {
  try {
    const raw = await fs.readFile(BOARD_PATH, "utf8");
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isEntry);
  } catch {
    return [];
  }
}

/** Append an entry, keep the best 500, persist. Returns 1-based rank + count. */
export async function recordEntry(entry: LeaderboardEntry): Promise<{ rank: number; count: number }> {
  const board = await readBoard();
  board.push(entry);
  board.sort(byScoreDesc);
  const capped = board.slice(0, MAX_ENTRIES);
  try {
    await fs.mkdir(path.dirname(BOARD_PATH), { recursive: true });
    await fs.writeFile(BOARD_PATH, JSON.stringify(capped));
  } catch {
    // Persist failure: rank against the in-memory board anyway.
  }
  const idx = capped.indexOf(entry);
  return { rank: idx >= 0 ? idx + 1 : capped.length + 1, count: capped.length };
}

/** Top entries by score desc, optionally filtered. Limit clamps to 1..100. */
export async function topEntries(
  scenarioId?: string,
  difficulty?: DifficultyKey,
  limit = 20
): Promise<LeaderboardEntry[]> {
  const board = await readBoard();
  const n = Math.max(1, Math.min(Math.floor(limit) || 20, 100));
  return board
    .filter((e) => (!scenarioId || e.scenarioId === scenarioId) && (!difficulty || e.difficulty === difficulty))
    .sort(byScoreDesc)
    .slice(0, n);
}

/** 1-based rank of a score against the whole board (ties share the rank). */
export async function rankFor(entry: Pick<LeaderboardEntry, "score">): Promise<number> {
  const board = await readBoard();
  return 1 + board.filter((e) => e.score > entry.score).length;
}
