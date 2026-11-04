// Async leaderboard API: submit a posted run, list the top board.
// Timestamps are always server time — client `at` values are ignored.

import { NextResponse } from "next/server";
import { limited, clientIp } from "@/lib/ratelimit";
import { getScenario } from "@/lib/scenarios";
import { isDifficulty, type DifficultyKey } from "@/lib/duel";
import { recordEntry, topEntries, type BoardResult } from "@/lib/leaderboard";

const TIERS = new Set(["Convincing", "Credible", "Thin", "Untrusted"]);

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function isResult(v: unknown): v is BoardResult {
  return v === "win" || v === "loss" || v === "solo";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const scenarioId = url.searchParams.get("scenarioId") || undefined;
  const diffRaw = url.searchParams.get("difficulty") || undefined;
  if (scenarioId && !getScenario(scenarioId)) {
    return NextResponse.json({ error: "Unknown scenario." }, { status: 400 });
  }
  let difficulty: DifficultyKey | undefined;
  if (diffRaw) {
    if (!isDifficulty(diffRaw)) {
      return NextResponse.json({ error: "Unknown difficulty." }, { status: 400 });
    }
    difficulty = diffRaw;
  }
  const entries = await topEntries(scenarioId, difficulty, 20);
  return NextResponse.json({ entries, count: entries.length });
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (limited(`leaderboard:${ip}`, 10)) {
    return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try {
    body = asRecord(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (body.action !== "submit") {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  const f = asRecord(body.entry);

  const name = typeof f.name === "string" ? f.name.trim() : "";
  if (name.length < 1 || name.length > 24) {
    return NextResponse.json({ error: "Name must be 1–24 characters." }, { status: 400 });
  }
  const scenarioId = typeof f.scenarioId === "string" ? f.scenarioId : "";
  if (!getScenario(scenarioId)) {
    return NextResponse.json({ error: "Unknown scenario." }, { status: 400 });
  }
  if (!isDifficulty(f.difficulty)) {
    return NextResponse.json({ error: "Unknown difficulty." }, { status: 400 });
  }
  if (typeof f.score !== "number" || !Number.isFinite(f.score) || f.score < 0 || f.score > 100) {
    return NextResponse.json({ error: "Score must be 0–100." }, { status: 400 });
  }
  const tier = typeof f.tier === "string" ? f.tier : "";
  if (!TIERS.has(tier)) {
    return NextResponse.json({ error: "Unknown tier." }, { status: 400 });
  }
  if (!isResult(f.result)) {
    return NextResponse.json({ error: "Unknown result." }, { status: 400 });
  }
  if (typeof f.prompts !== "number" || !Number.isFinite(f.prompts) || f.prompts < 0) {
    return NextResponse.json({ error: "Invalid prompts." }, { status: 400 });
  }

  const { rank, count } = await recordEntry({
    name,
    scenarioId,
    difficulty: f.difficulty,
    score: Math.round(f.score),
    tier,
    result: f.result,
    prompts: Math.floor(f.prompts),
    at: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true, rank, count });
}
