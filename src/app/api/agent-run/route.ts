// Phase-1 agent-run API: start an agent-assisted scenario attempt, record
// trace events, and finish with hidden acceptance. Attempt state lives in
// a per-process in-memory map keyed by ip+scenario (fine for the demo;
// dev-server reloads reset it — swap for KV before real users).

import { NextResponse } from "next/server";
import { friendlyRunError } from "@/lib/errors";
import { limited, clientIp } from "@/lib/ratelimit";
import { runPython, runJs, runCpp } from "@/lib/exec";
import { getScenario, instantiateTests, visibleTests, STAGE_COUNT } from "@/lib/scenarios";
import { validateEvent, efficiencyScore, summarizeTrace, parseStageNumber, MAX_EVENT_TEXT } from "@/lib/trace";
import type { AgentAttempt, TraceEvent, TraceEventKind } from "@/lib/types";

const attempts = new Map<string, AgentAttempt>();
const COOLDOWN_MS = 10 * 60 * 1000;
const MAX_CODE = 20_000;
const MAX_SEED = 2 ** 31 - 1;

type Language = "python" | "javascript" | "c++";
const LANGUAGES: Language[] = ["python", "javascript", "c++"];

function key(ip: string, scenarioId: string) {
  return `${ip}::${scenarioId}`;
}

function publicState(a: AgentAttempt) {
  const scenario = getScenario(a.scenarioId);
  if (!scenario) return null;
  return {
    status: a.status,
    scenarioId: a.scenarioId,
    variantSeed: a.variantSeed,
    stageUnlocked: a.stageUnlocked,
    stages: scenario.stages.slice(0, a.stageUnlocked),
    tests: visibleTests(scenario, a.variantSeed, a.stageUnlocked),
    startedAt: a.startedAt,
    cooldownUntil: a.cooldownUntil,
  };
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function parseEvent(v: unknown): TraceEvent | null {
  const o = asRecord(v);
  if (typeof o.t !== "number" || typeof o.kind !== "string") return null;
  const kinds: TraceEventKind[] = ["prompt", "code", "run", "stage", "hint"];
  if (!kinds.includes(o.kind as TraceEventKind)) return null;
  const e: TraceEvent = { t: o.t, kind: o.kind as TraceEventKind };
  if (typeof o.text === "string") e.text = o.text;
  if (typeof o.passed === "boolean") e.passed = o.passed;
  if (typeof o.linesChanged === "number") e.linesChanged = o.linesChanged;
  return e;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (limited(`agent-run:${ip}`, 20)) {
    return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
  }
  const body = asRecord(await req.json());
  const action = body.action;
  const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId : "";
  const scenario = getScenario(scenarioId);
  if (!scenario) return NextResponse.json({ error: "Unknown scenario." }, { status: 400 });

  // --- start: one-shot lock + cooldown ---
  if (action === "start") {
    const k = key(ip, scenarioId);
    const existing = attempts.get(k);
    if (existing?.status === "active") return NextResponse.json({ ...publicState(existing), resumed: true });
    if (existing?.status === "locked") {
      return NextResponse.json({ error: "Attempt locked.", cooldownUntil: existing.cooldownUntil }, { status: 403 });
    }
    if (existing?.status === "finished" && Date.now() < existing.cooldownUntil) {
      return NextResponse.json(
        {
          error: "One shot per cooldown — this scenario is spent for now.",
          cooldownUntil: existing.cooldownUntil,
          retryAfterSec: Math.ceil((existing.cooldownUntil - Date.now()) / 1000),
        },
        { status: 403 }
      );
    }
    const rawSeed = body.variantSeed;
    const variantSeed =
      typeof rawSeed === "number" && Number.isInteger(rawSeed) && rawSeed >= 0 && rawSeed <= MAX_SEED
        ? rawSeed
        : Math.floor(Math.random() * MAX_SEED);
    const attempt: AgentAttempt = {
      scenarioId,
      variantSeed,
      status: "active",
      startedAt: Date.now(),
      stageUnlocked: 1,
      events: [],
      cooldownUntil: 0,
    };
    attempts.set(k, attempt);
    return NextResponse.json(publicState(attempt));
  }

  // --- event: validate and append ---
  if (action === "event") {
    const attempt = attempts.get(key(ip, scenarioId));
    if (!attempt) return NextResponse.json({ error: "No attempt — start first." }, { status: 404 });
    if (attempt.status !== "active") {
      return NextResponse.json({ error: `Attempt is ${attempt.status}.`, cooldownUntil: attempt.cooldownUntil }, { status: 403 });
    }
    const event = parseEvent(body.event);
    if (!event) return NextResponse.json({ error: "Malformed event {t, kind, text?, passed?, linesChanged?}." }, { status: 400 });
    if ((event.text?.length ?? 0) > MAX_EVENT_TEXT) {
      return NextResponse.json({ error: `Event text exceeds ${MAX_EVENT_TEXT} chars.` }, { status: 413 });
    }
    const v = validateEvent(attempt, event);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    attempt.events.push(event);
    // Stage advance: validateEvent already gated the unlock.
    if (event.kind === "stage") {
      const n = parseStageNumber(event.text) ?? attempt.stageUnlocked;
      if (n === attempt.stageUnlocked + 1 && n <= STAGE_COUNT) {
        attempt.stageUnlocked = n;
        return NextResponse.json({
          ok: true,
          stageUnlocked: attempt.stageUnlocked,
          unlocked: {
            stage: scenario.stages[n - 1],
            tests: visibleTests(scenario, attempt.variantSeed, attempt.stageUnlocked),
          },
        });
      }
    }
    return NextResponse.json({ ok: true, stageUnlocked: attempt.stageUnlocked });
  }

  // --- finish: hidden acceptance via the shared local runners ---
  if (action === "finish") {
    const attempt = attempts.get(key(ip, scenarioId));
    if (!attempt) return NextResponse.json({ error: "No attempt — start first." }, { status: 404 });
    if (attempt.status !== "active") {
      return NextResponse.json({ error: `Attempt is ${attempt.status}.`, cooldownUntil: attempt.cooldownUntil }, { status: 403 });
    }
    const language = body.language;
    const code = typeof body.code === "string" ? body.code : "";
    if (!LANGUAGES.includes(language as Language)) return NextResponse.json({ error: "Unknown language." }, { status: 400 });
    if (!code) return NextResponse.json({ error: "Missing code." }, { status: 400 });
    if (code.length > MAX_CODE) {
      return NextResponse.json({ error: `Code too long (max ${MAX_CODE} chars).` }, { status: 413 });
    }
    const tests = instantiateTests(scenario, attempt.variantSeed);
    try {
      const lang = language as Language;
      const results =
        lang === "javascript"
          ? runJs(code, scenario.fnName, tests)
          : lang === "c++"
            ? await runCpp(code, scenario.fnName, tests, scenario.cppReturn ?? "vec")
            : await runPython(code, scenario.fnName, tests);
      // Evaluation completed — the one shot is consumed either way.
      attempt.status = "finished";
      attempt.cooldownUntil = Date.now() + COOLDOWN_MS;
      const score = efficiencyScore(attempt);
      const passedCount = results.filter((r) => r.passed).length;
      return NextResponse.json({
        results,
        passed: passedCount === results.length,
        passedCount,
        totalCount: results.length,
        score,
        traceSummary: summarizeTrace(attempt),
        cooldownUntil: attempt.cooldownUntil,
        engine: lang === "javascript" ? "local-js" : lang === "c++" ? "local-cpp" : "local-python",
      });
    } catch (e) {
      // Infra failure: do NOT consume the one shot.
      return NextResponse.json(
        {
          error: friendlyRunError(e instanceof Error ? e.message : String(e)),
          engine: "local-error",
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
