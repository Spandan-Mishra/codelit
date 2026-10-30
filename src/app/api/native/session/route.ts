// Browser session API for native attempts. Every op is authenticated by the
// signed browser-session cookie and scoped to attempts that session owns.
// Solver turns reserve prompt budget BEFORE anything is forwarded; approvals
// bind one decision to one pending request id; finish evaluates frozen bytes
// the connector uploaded — never a locally reported pass flag.

import { NextResponse } from "next/server";
import { limited, clientIp } from "@/lib/ratelimit";
import {
  createAttempt,
  enqueueCommand,
  getDevice,
  ownAttempt,
  readBrowserSession,
  saveAttempt,
} from "@/lib/native/registry";
import { recordServerEvent } from "@/lib/native/events";
import { APPROVAL_TTL_MS, type NativeAttempt } from "@/lib/native/protocol";
import { getScenario, instantiateTests, visibleTests } from "@/lib/scenarios";
import { runCpp, runJs, runPython } from "@/lib/exec";
import { snapshotHash } from "@/lib/native/workspace";
import { storeGet, storeSet } from "@/lib/native/store";
import { newId } from "@/lib/native/secret";

type Language = "python" | "javascript" | "c++";
const LANGUAGES: Language[] = ["python", "javascript", "c++"];
const MAX_PROMPT = 6000;

function stubFor(scenario: ReturnType<typeof getScenario>, language: Language): string {
  const stubs = scenario?.stubs as Record<string, string> | undefined;
  if (!stubs) return "";
  return stubs[language === "c++" ? "cpp" : language === "javascript" ? "js" : "py"] || "";
}

function contextPayload(scenario: NonNullable<ReturnType<typeof getScenario>>, seed: number, stage: number, language: Language) {
  const stages = scenario.generate ? scenario.generate(seed >>> 0).briefs : null;
  const brief = stages ? stages[stage - 1] || "" : scenario.stages[stage - 1]?.brief || "";
  return {
    title: scenario.title,
    stage,
    brief,
    fnName: scenario.fnName,
    language,
    stub: stubFor(scenario, language),
    visibleTests: visibleTests(scenario, seed, stage).map((t) => ({ input: t.input, expected: t.expected })),
  };
}

export async function POST(req: Request) {
  if (limited(`native-session:${clientIp(req)}`, 60)) {
    return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
  }
  const sessionId = readBrowserSession(req);
  if (!sessionId) return NextResponse.json({ error: "No browser session — reconnect your agent first." }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const op = String(body.op || "");

  // --- start: owned attempt + fixed variant, one native session command ---
  if (op === "start") {
    const scenario = getScenario(String(body.scenarioId || ""));
    if (!scenario) return NextResponse.json({ error: "Unknown scenario." }, { status: 400 });
    const language = String(body.language || "python");
    if (!LANGUAGES.includes(language as Language)) return NextResponse.json({ error: "Unknown language." }, { status: 400 });
    const device = await getDevice(String(body.deviceId || ""));
    if (!device || device.sessionId !== sessionId || device.revokedAt !== null) {
      return NextResponse.json({ error: "Unknown or revoked device." }, { status: 404 });
    }
    const adapter = String(body.adapter || "");
    if (!device.adapters.some((a) => a.adapter === adapter)) {
      return NextResponse.json({ error: "That agent is not available on this device." }, { status: 400 });
    }
    const seed = Math.floor(Math.random() * 2 ** 31);
    const attempt = await createAttempt(sessionId, scenario.id, seed, language);
    attempt.deviceId = device.deviceId;
    attempt.adapter = adapter as NativeAttempt["adapter"];
    await saveAttempt(attempt);
    await enqueueCommand(attempt.id, device.deviceId, "session.start", {
      context: contextPayload(scenario, seed, 1, language as Language),
      adapter,
    });
    await recordServerEvent(attempt.id, device.deviceId, null, null, "context.delivered", { stage: 1 });
    return NextResponse.json({ attempt });
  }

  const attempt = await ownAttempt(sessionId, String(body.attemptId || ""));
  if (!attempt) return NextResponse.json({ error: "Unknown attempt." }, { status: 404 });
  const scenario = getScenario(attempt.scenarioId);
  if (!scenario) return NextResponse.json({ error: "Unknown scenario." }, { status: 400 });
  if (!attempt.deviceId) return NextResponse.json({ error: "Attempt has no device." }, { status: 409 });

  // --- get: public attempt state (refresh recovery reads this + events) ---
  if (op === "get") {
    return NextResponse.json({ attempt });
  }

  // --- send: reserve a prompt slot, then queue exactly one turn ---
  if (op === "send") {
    if (attempt.status === "done" || attempt.status === "finishing") {
      return NextResponse.json({ error: "Attempt is closed." }, { status: 403 });
    }
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim() || text.length > MAX_PROMPT) {
      return NextResponse.json({ error: "Prompt must be 1-6000 characters." }, { status: 400 });
    }
    if (attempt.turnsUsed + attempt.turnsReserved >= scenario.promptPar) {
      return NextResponse.json({ error: "Prompt budget exhausted for this attempt." }, { status: 403 });
    }
    const turnId = newId("turn");
    attempt.turnsReserved += 1;
    await saveAttempt(attempt);
    // Single-writer flush: an edited browser buffer travels WITH the turn so
    // the connector applies it (or reports a conflict) before the agent reads.
    const payload: Record<string, unknown> = { text, turnId, stage: attempt.stage };
    if (typeof body.code === "string" && body.code.length > 0 && body.code.length <= 60000) {
      payload.pendingEdit = { code: body.code, baseRev: typeof body.baseRev === "number" ? body.baseRev : -1 };
    }
    await enqueueCommand(attempt.id, attempt.deviceId, "turn.send", payload, turnId);
    await recordServerEvent(attempt.id, attempt.deviceId, attempt.nativeSessionId, turnId, "prompt.accepted", {
      chars: text.length,
    });
    return NextResponse.json({ ok: true, turnId });
  }

  // --- interrupt: best-effort stop; safe to repeat ---
  if (op === "interrupt") {
    await enqueueCommand(attempt.id, attempt.deviceId, "turn.interrupt", {});
    return NextResponse.json({ ok: true });
  }

  // --- test: run the RELEASED visible checks locally (labeled local activity,
  // never official acceptance) ---
  if (op === "test") {
    if (attempt.status === "done" || attempt.status === "finishing") {
      return NextResponse.json({ error: "Attempt is closed." }, { status: 403 });
    }
    await enqueueCommand(attempt.id, attempt.deviceId, "test.run", { stage: attempt.stage });
    return NextResponse.json({ ok: true });
  }

  // --- approval: one decision binds one pending request, then it is spent ---
  if (op === "approval") {
    const approvalId = String(body.approvalId || "");
    const decision = String(body.decision || "");
    if (!approvalId || (decision !== "allow-once" && decision !== "deny")) {
      return NextResponse.json({ error: "Bad approval decision." }, { status: 400 });
    }
    const key = `approval:${attempt.id}:${approvalId}`;
    if (await storeGet<string>("kv", key)) {
      return NextResponse.json({ error: "Already decided — replayed decisions never authorize." }, { status: 409 });
    }
    await storeSet("kv", key, decision);
    await enqueueCommand(attempt.id, attempt.deviceId, "approval.decide", { approvalId, decision }, undefined, APPROVAL_TTL_MS);
    await recordServerEvent(attempt.id, attempt.deviceId, attempt.nativeSessionId, null, "approval.decided", {
      approvalId,
      decision,
    });
    return NextResponse.json({ ok: true });
  }

  // --- stage: release the next stage context exactly once ---
  if (op === "stage") {
    if (attempt.stage >= 3) return NextResponse.json({ error: "All stages released." }, { status: 400 });
    const syncKey = `sync:${attempt.id}:${attempt.stage + 1}`;
    if (await storeGet<string>("kv", syncKey)) return NextResponse.json({ ok: true, stage: attempt.stage });
    attempt.stage += 1;
    await saveAttempt(attempt);
    await storeSet("kv", syncKey, "queued");
    await enqueueCommand(
      attempt.id,
      attempt.deviceId,
      "context.sync",
      { context: contextPayload(scenario, attempt.seed, attempt.stage, attempt.language as Language) },
      `ctx-${attempt.id}-${attempt.stage}`
    );
    await recordServerEvent(attempt.id, attempt.deviceId, attempt.nativeSessionId, null, "context.delivered", {
      stage: attempt.stage,
    });
    return NextResponse.json({ ok: true, stage: attempt.stage });
  }

  // --- reopen: recover from a stuck freeze back to solving. Only valid
  // while no acceptance is banked; the next finish re-freezes from scratch.
  if (op === "reopen") {
    if (attempt.status !== "finishing" || attempt.acceptance) {
      return NextResponse.json({ error: "Nothing to reopen." }, { status: 409 });
    }
    attempt.status = "open";
    await saveAttempt(attempt);
    await recordServerEvent(attempt.id, attempt.deviceId, attempt.nativeSessionId, null, "session.replaced", {
      reason: "reopened after stuck freeze",
    });
    return NextResponse.json({ ok: true });
  }

  // --- finish: freeze -> evaluate uploaded bytes -> banked acceptance ---
  if (op === "finish") {
    if (attempt.acceptance) return NextResponse.json({ ok: true, acceptance: attempt.acceptance });
    if (attempt.status !== "finishing") {
      attempt.status = "finishing";
      await saveAttempt(attempt);
      await enqueueCommand(attempt.id, attempt.deviceId, "freeze.request", {});
      return NextResponse.json({ ok: true, freezing: true });
    }
    const snap = await storeGet<{ source: string; hash: string; language: string; revision: number }>(
      "snapshots",
      attempt.id
    );
    if (!snap) return NextResponse.json({ ok: true, freezing: true, waiting: true });
    if (snap.hash !== snapshotHash(snap.source, snap.language) || snap.language !== attempt.language) {
      return NextResponse.json({ error: "Snapshot failed integrity check." }, { status: 409 });
    }
    const tests = instantiateTests(scenario, attempt.seed);
    const lang = snap.language as Language;
    const results =
      lang === "javascript"
        ? runJs(snap.source, scenario.fnName, tests)
        : lang === "c++"
          ? await runCpp(snap.source, scenario.fnName, tests, scenario.cppReturn ?? "vec")
          : await runPython(snap.source, scenario.fnName, tests);
    const passedCount = results.filter((r) => r.passed).length;
    attempt.acceptance = { passed: passedCount === results.length, passedCount, totalCount: results.length, at: Date.now() };
    attempt.submissionHash = snap.hash;
    attempt.status = "done";
    await saveAttempt(attempt);
    await recordServerEvent(attempt.id, attempt.deviceId, attempt.nativeSessionId, null, "official.test", {
      passedCount,
      totalCount: results.length,
    });
    await recordServerEvent(attempt.id, attempt.deviceId, attempt.nativeSessionId, null, "official.submission", {
      hash: snap.hash,
      revision: snap.revision,
    });
    return NextResponse.json({
      ok: true,
      acceptance: attempt.acceptance,
      results: results.map((r) => ({ ...r, expected: r.hidden ? undefined : r.expected })),
    });
  }

  return NextResponse.json({ error: "Unknown op." }, { status: 400 });
}
