// House-agent duel API: create a duel, poll house progress, resolve the
// outcome. Duel state lives in a per-process in-memory map keyed by duelId
// (fine for the demo; reloads reset it — swap for KV before real users).
// Everything is lazy on poll: no background timers anywhere.

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { limited, clientIp } from "@/lib/ratelimit";
import { getScenario } from "@/lib/scenarios";
import {
  DIFFICULTIES,
  isDifficulty,
  tickDuel,
  getCredits,
  trySpendCredits,
  resolveDuel,
  type DifficultyKey,
  type DuelResult,
} from "@/lib/duel";

interface DuelState {
  duelId: string;
  scenarioId: string;
  difficulty: DifficultyKey;
  houseStartedAt: number;
  ip: string;
  decided: { result: DuelResult; userPassed: boolean; housePassed: boolean; at: number } | null;
}

const duels = new Map<string, DuelState>();

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function ownedDuel(duelId: unknown, ip: string): DuelState | null {
  if (typeof duelId !== "string" || !duelId) return null;
  const d = duels.get(duelId);
  if (!d || d.ip !== ip) return null;
  return d;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (limited(`duel:${ip}`, 20)) {
    return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
  }
  const body = asRecord(await req.json());
  const action = body.action;

  if (action === "credits") {
    return NextResponse.json({ credits: getCredits(ip) });
  }

  // --- create: spend credits for locked tiers, start the house clock ---
  if (action === "create") {
    const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId : "";
    const difficulty = body.difficulty;
    const scenario = getScenario(scenarioId);
    if (!scenario) return NextResponse.json({ error: "Unknown scenario." }, { status: 400 });
    if (!isDifficulty(difficulty)) return NextResponse.json({ error: "Unknown difficulty." }, { status: 400 });
    const cfg = DIFFICULTIES[difficulty];
    if (cfg.locked && !trySpendCredits(ip, cfg.cost)) {
      return NextResponse.json(
        { error: `Needs ${cfg.cost} credits — win duels to earn more.`, credits: getCredits(ip), cost: cfg.cost },
        { status: 403 }
      );
    }
    const duel: DuelState = {
      duelId: randomUUID(),
      scenarioId,
      difficulty,
      houseStartedAt: Date.now(),
      ip,
      decided: null,
    };
    duels.set(duel.duelId, duel);
    return NextResponse.json({ duelId: duel.duelId, houseStartedAt: duel.houseStartedAt, credits: getCredits(ip) });
  }

  // --- status: pure tick of the house timeline at poll time ---
  if (action === "status") {
    const duel = ownedDuel(body.duelId, ip);
    if (!duel) return NextResponse.json({ error: "Unknown duel." }, { status: 404 });
    const tick = tickDuel(duel.houseStartedAt, Date.now(), duel.difficulty);
    return NextResponse.json({
      ...tick,
      credits: getCredits(ip),
      decided: duel.decided,
      scenarioId: duel.scenarioId,
      difficulty: duel.difficulty,
      houseStartedAt: duel.houseStartedAt,
    });
  }

  // --- resolve: user finished — compare against the house clock now ---
  if (action === "resolve") {
    const duel = ownedDuel(body.duelId, ip);
    if (!duel) return NextResponse.json({ error: "Unknown duel." }, { status: 404 });
    if (typeof body.userPassed !== "boolean") {
      return NextResponse.json({ error: "Missing userPassed." }, { status: 400 });
    }
    if (duel.decided) {
      const tick = tickDuel(duel.houseStartedAt, Date.now(), duel.difficulty);
      return NextResponse.json({ ...duel.decided, ...tick, credits: getCredits(ip) });
    }
    const tick = tickDuel(duel.houseStartedAt, Date.now(), duel.difficulty);
    const { result, credits } = resolveDuel({ userPassed: body.userPassed, housePassed: tick.housePassed, ip });
    duel.decided = { result, userPassed: body.userPassed, housePassed: tick.housePassed, at: Date.now() };
    return NextResponse.json({ ...duel.decided, ...tick, credits });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
