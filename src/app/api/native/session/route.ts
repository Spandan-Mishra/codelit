// Browser session API for native attempts. Every op is authenticated by the
// signed browser-session cookie and scoped to attempts that session owns.
// Solver turns reserve prompt budget BEFORE anything is forwarded; approvals
// bind one decision to one pending request id; finish evaluates frozen bytes
// the connector uploaded — never a locally reported pass flag.

import { NextResponse } from "next/server";
import { limited, clientIp } from "@/lib/ratelimit";
import {
  attemptEpoch,
  createAttempt,
  enqueueCommand,
  getDevice,
  listAttempts,
  ownAttempt,
  pendingFreeze,
  readBrowserSession,
  saveAttempt,
  settleQueuedTurns,
} from "@/lib/native/registry";
import { readEvents, recordServerEvent } from "@/lib/native/events";
import { APPROVAL_TTL_MS, type NativeAttempt } from "@/lib/native/protocol";
import { getScenario, instantiateTests, visibleTests } from "@/lib/scenarios";
import { runCpp, runJs, runPython, isExecutionUnavailable } from "@/lib/exec";
import { snapshotHash, solutionHash } from "@/lib/native/workspace";
import { storeDelete, storeGet, storeList, storeSet } from "@/lib/native/store";
import type { BrowserCommand } from "@/lib/native/protocol";
import { newId } from "@/lib/native/secret";
import { stageContext as contextPayload, starterFor } from "@/lib/native/context";
import { isDeviceOnline } from "@/lib/native/devices";
import { withNativeLock } from "@/lib/native/lock";
import type { DeviceRecord } from "@/lib/native/protocol";

type Language = "python" | "javascript" | "c++";
const LANGUAGES: Language[] = ["python", "javascript", "c++"];
const MAX_PROMPT = 6000;
// Ranked unlocks after this many DISTINCT practice scenarios are passed.
// Attempts stored before modes existed count as practice.
export const RANKED_UNLOCK_PRACTICE_SOLVES = 5;

export async function practiceSolves(sessionId: string): Promise<number> {
  const solved = new Set<string>();
  for (const a of await listAttempts(sessionId)) {
    if (a.acceptance?.passed === true && (a.mode || "practice") !== "ranked") solved.add(a.scenarioId);
  }
  return solved.size;
}

function providerError(device: DeviceRecord, adapter: string, model: unknown): string | null {
  if (!isDeviceOnline(device)) return "Your connector is offline. Open Providers and run the connector to reconnect.";
  const provider = device.adapters.find((a) => a.adapter === adapter);
  if (!provider || provider.status !== "ready" || provider.ready !== true) {
    return provider?.message || "This provider is not ready. Update the connector and check Providers.";
  }
  if (model !== undefined && model !== null && model !== "" &&
      (typeof model !== "string" || !provider.models?.some((m) => m.id === model))) {
    return "That model is not in this provider's current catalog. Refresh and select an available model.";
  }
  return null;
}

async function solutionFor(attempt: NativeAttempt, fallback: string) {
  const events = await readEvents(attempt.id, -1);
  const file = events.filter((e) => e.type === "file.revision" && typeof e.payload.content === "string").at(-1);
  return typeof file?.payload.content === "string" ? file.payload.content : fallback;
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
  return withNativeLock(`attempt:${String(body.attemptId || `start:${sessionId}`)}`, async () => {

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
      const invalidProvider = providerError(device, adapter, body.model);
      if (invalidProvider) return NextResponse.json({ error: invalidProvider }, { status: 409 });
      // Adopt-and-start convenience: transferFromDeviceId gets byte-identical
      // validation to op transfer (same-session old device), without mutating
      // the old attempt. It authorizes the connector's local replacement.
      if (body.transferFromDeviceId !== undefined && body.transferFromDeviceId !== null && body.transferFromDeviceId !== "") {
        const fromId = String(body.transferFromDeviceId);
        const from = await getDevice(fromId);
        if (!from || from.sessionId !== sessionId) {
          return NextResponse.json({ error: "Transfer source must be another device you paired in this browser." }, { status: 403 });
        }
      }
      const mode = String(body.mode || "practice") === "ranked" ? "ranked" : "practice";
      if (mode === "ranked") {
        const solved = await practiceSolves(sessionId);
        if (solved < RANKED_UNLOCK_PRACTICE_SOLVES) {
          return NextResponse.json({ error: `Ranked unlocks after passing ${RANKED_UNLOCK_PRACTICE_SOLVES} practice scenarios — you have ${solved}. Practice is repeatable and unscored.` }, { status: 403 });
        }
      }
      const seed = Math.floor(Math.random() * 2 ** 31);
      const attempt = await createAttempt(sessionId, scenario.id, seed, language, mode);
      attempt.deviceId = device.deviceId;
      attempt.adapter = adapter as NativeAttempt["adapter"];
      attempt.model = typeof body.model === "string" && body.model ? body.model : null;
      attempt.title = scenario.title;
      await saveAttempt(attempt);
      await enqueueCommand(attempt.id, device.deviceId, "session.start", {
        context: contextPayload(scenario, seed, 1, language as Language),
        adapter, model: attempt.model,
      });
      await recordServerEvent(attempt.id, device.deviceId, null, null, "context.delivered", { stage: 1 });
      return NextResponse.json({ attempt });
    }

    const attempt = await ownAttempt(sessionId, String(body.attemptId || ""));
    if (!attempt) return NextResponse.json({ error: "Unknown attempt." }, { status: 404 });
    const scenario = getScenario(attempt.scenarioId);
    if (!scenario) return NextResponse.json({ error: "Unknown scenario." }, { status: 400 });
    await settleQueuedTurns(attempt);
    if (op === "rename") {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title || title.length > 80) return NextResponse.json({ error: "Choose a title between 1 and 80 characters." }, { status: 400 });
      attempt.title = title;
      await saveAttempt(attempt);
      return NextResponse.json({ ok: true, attempt });
    }
    if (op === "archive" || op === "restore") {
      if (op === "archive" && (attempt.status === "running" || attempt.status === "waiting_approval" || attempt.status === "finishing" || attempt.turnsReserved > 0)) {
        return NextResponse.json({ error: "Stop the agent and let the current turn settle before archiving." }, { status: 409 });
      }
      attempt.archivedAt = op === "archive" ? Date.now() : null;
      await saveAttempt(attempt);
      return NextResponse.json({ ok: true, attempt });
    }
    if (!attempt.deviceId) return NextResponse.json({ error: "Attempt has no device." }, { status: 409 });
    const device = await getDevice(attempt.deviceId);
    const active = attempt.status === "running" || attempt.status === "waiting_approval" || attempt.turnsReserved > 0;
    const closed = attempt.status === "done" || attempt.status === "finishing";
    if (op === "provider") {
      if (active || closed) return NextResponse.json({ error: "Change provider or model between turns in an open attempt." }, { status: 409 });
      if (!device || device.sessionId !== sessionId || device.revokedAt !== null) return NextResponse.json({ error: "Device is unavailable. Reconnect in Providers." }, { status: 409 });
      const adapter = typeof body.adapter === "string" ? body.adapter : attempt.adapter || "";
      const invalidProvider = providerError(device, adapter, body.model);
      if (invalidProvider) return NextResponse.json({ error: invalidProvider }, { status: 409 });
      attempt.adapter = adapter as NativeAttempt["adapter"];
      attempt.model = typeof body.model === "string" && body.model ? body.model : null;
      await saveAttempt(attempt);
      await enqueueCommand(attempt.id, attempt.deviceId, "session.start", {
        adapter, model: attempt.model,
        context: contextPayload(scenario, attempt.seed, attempt.stage, attempt.language),
      });
      return NextResponse.json({ ok: true, attempt });
    }

    // --- get: public attempt state (refresh recovery reads this + events) ---
    if (op === "get") {
      return NextResponse.json({ attempt });
    }

    // --- transfer: browser-authorized same-owner device reassignment
    // (transport-contract.md). Both devices must belong to this browser
    // session; the attempt must be idle. Grants bump the epoch so the old
    // generation's queued work goes stale; the transfer is logged.
    if (op === "transfer") {
      const toDeviceId = String(body.toDeviceId || "");
      const to = await getDevice(toDeviceId);
      if (!to || to.sessionId !== sessionId || to.revokedAt !== null) {
        return NextResponse.json({ error: "Unknown or revoked destination device." }, { status: 404 });
      }
      const fromId = attempt.deviceId;
      if (fromId) {
        const from = await getDevice(fromId);
        if (from && from.sessionId !== sessionId) {
          return NextResponse.json({ error: "Cross-owner transfers are not allowed." }, { status: 403 });
        }
      }
      if (attempt.status !== "open" || attempt.turnsReserved > 0) {
        return NextResponse.json({ error: "Stop the agent turn first, then transfer." }, { status: 409 });
      }
      if (attempt.archivedAt) return NextResponse.json({ error: "Restore this attempt before continuing." }, { status: 409 });
      attempt.deviceId = toDeviceId;
      attempt.sessionEpoch = attemptEpoch(attempt) + 1;
      await saveAttempt(attempt);
      await storeDelete("kv", `freeze:${attempt.id}`);
      await recordServerEvent(attempt.id, toDeviceId, attempt.nativeSessionId, null, "session.replaced", {
        reason: "transfer",
        fromDeviceId: fromId,
        toDeviceId,
        sessionEpoch: attempt.sessionEpoch,
      });
      return NextResponse.json({ ok: true, attempt, sessionEpoch: attempt.sessionEpoch });
    }

    // --- send: reserve a prompt slot, then queue exactly one turn ---
    if (op === "send") {
      if (attempt.status === "done" || attempt.status === "finishing") {
        return NextResponse.json({ error: "Attempt is closed." }, { status: 403 });
      }
      if (active) return NextResponse.json({ error: "The agent already has a queued or running turn. Wait or stop it first." }, { status: 409 });
      if (attempt.archivedAt) return NextResponse.json({ error: "Restore this attempt before continuing." }, { status: 409 });
      if (!device || device.sessionId !== sessionId || device.revokedAt !== null) return NextResponse.json({ error: "Device is unavailable. Reconnect in Providers." }, { status: 409 });
      const invalidProvider = providerError(device, attempt.adapter || "", attempt.model);
      if (invalidProvider) return NextResponse.json({ error: invalidProvider }, { status: 409 });
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
      // Issued-turn ledger: the relay only honors turn.* events that reference
      // a turn this endpoint reserved, so replayed/foreign terminals cannot
      // move budgets or state (F06).
      await storeSet("kv", `issuedturn:${attempt.id}:${turnId}`, true);
      // Single-writer flush: an edited browser buffer travels WITH the turn so
      // the connector applies it (or reports a conflict) before the agent reads.
      const payload: Record<string, unknown> = {
        text, turnId, stage: attempt.stage, adapter: attempt.adapter, model: attempt.model || null,
        context: contextPayload(scenario, attempt.seed, attempt.stage, attempt.language),
      };
      if (typeof body.code === "string" && body.code.length > 0 && body.code.length <= 60000) {
        payload.pendingEdit = { code: body.code, baseRev: typeof body.baseRev === "number" ? body.baseRev : -1 };
      }
      await enqueueCommand(attempt.id, attempt.deviceId, "turn.send", payload, turnId);
      await recordServerEvent(attempt.id, attempt.deviceId, attempt.nativeSessionId, turnId, "prompt.accepted", {
        chars: text.length, text,
      });
      return NextResponse.json({ ok: true, turnId });
    }

    // --- edit: idle-only human-authored file change (F11). Travels as a
    // human.edit command with editId/baseRev; the connector applies it on
    // revision match or reports human.edit.conflict. Never spends prompt budget.
    if (op === "edit") {
      if (active || closed) return NextResponse.json({ error: "Edit while the agent is idle in an open attempt." }, { status: 409 });
      if (attempt.archivedAt) return NextResponse.json({ error: "Restore this attempt before continuing." }, { status: 409 });
      if (!device || device.sessionId !== sessionId || device.revokedAt !== null) return NextResponse.json({ error: "Device is unavailable. Reconnect in Providers." }, { status: 409 });
      const code = typeof body.code === "string" ? body.code : "";
      const baseRev = typeof body.baseRev === "number" ? body.baseRev : -1;
      if (!code || code.length > 60000 || baseRev < 0) {
        return NextResponse.json({ error: "Edit needs code (1-60000 chars) and the base revision you reviewed." }, { status: 400 });
      }
      const editId = newId("edit");
      await enqueueCommand(attempt.id, attempt.deviceId, "human.edit", { editId, baseRev, code });
      return NextResponse.json({ ok: true, editId });
    }

    // --- delete: remove the attempt workspace record, keep the event log as
    // audit trail. Guarded like archive: no live or reserved work.
    if (op === "delete") {
      if (active || attempt.status === "finishing" || attempt.turnsReserved > 0) {
        return NextResponse.json({ error: "Stop the agent and let the current turn settle before deleting." }, { status: 409 });
      }
      const queued = await storeList<BrowserCommand>("commands");
      for (const c of queued) {
        if (c.attemptId === attempt.id) await storeDelete("commands", c.id);
      }
      await storeDelete("snapshots", attempt.id);
      await storeDelete("kv", `freeze:${attempt.id}`);
      await storeDelete("attempts", attempt.id);
      await recordServerEvent(attempt.id, attempt.deviceId, attempt.nativeSessionId, null, "session.replaced", {
        reason: "attempt deleted by owner; event log retained",
      });
      return NextResponse.json({ ok: true });
    }

    // --- interrupt: best-effort stop; safe to repeat ---
    if (op === "interrupt") {
      if (closed) return NextResponse.json({ error: "This attempt is closed." }, { status: 409 });
      await settleQueuedTurns(attempt, true);
      const events = await readEvents(attempt.id, -1);
      const pendingTurnIds: string[] = [];
      for (const event of events) {
        if (event.type === "prompt.accepted" && event.turnId && !await storeGet("kv", `terminal:${attempt.id}:${event.turnId}`)) pendingTurnIds.push(event.turnId);
      }
      await enqueueCommand(attempt.id, attempt.deviceId, "turn.interrupt", { pendingTurnIds });
      return NextResponse.json({ ok: true });
    }

    // --- test: independently run only the released visible checks on the
    // latest complete solution revision; hidden acceptance remains at finish. ---
    if (op === "test") {
      if (attempt.status === "done" || attempt.status === "finishing") {
        return NextResponse.json({ error: "Attempt is closed." }, { status: 403 });
      }
      if (active) return NextResponse.json({ error: "Wait for the agent's file edit to finish before running checks." }, { status: 409 });
      const source = await solutionFor(attempt, starterFor(scenario, attempt.language));
      const tests = visibleTests(scenario, attempt.seed, attempt.stage);
      let results;
      try {
        results = attempt.language === "javascript" ? await runJs(source, scenario.fnName, tests)
          : attempt.language === "c++" ? await runCpp(source, scenario.fnName, tests, scenario.cppReturn || "vec")
          : await runPython(source, scenario.fnName, tests);
      } catch (error) {
        // Infrastructure failure stores and banks nothing: retryable (F12).
        if (isExecutionUnavailable(error)) {
          return NextResponse.json({ error: "Execution is temporarily unavailable — retry in a minute. Nothing was banked.", retryable: true }, { status: 503 });
        }
        const message = error instanceof Error ? error.message : "The solution could not run.";
        results = tests.map((test) => ({ ...test, passed: false, actual: message.slice(0, 1000) }));
      }
      const passedCount = results.filter((r) => r.passed).length;
      const check = { stage: attempt.stage, hash: snapshotHash(source, attempt.language), passed: passedCount === results.length && results.length > 0 };
      await storeSet("kv", `visible:${attempt.id}`, check);
      await recordServerEvent(attempt.id, attempt.deviceId, attempt.nativeSessionId, null, "official.test", {
        scope: "visible", stage: attempt.stage, hash: solutionHash(source), passedCount, totalCount: results.length, results,
      });
      return NextResponse.json({ ok: true, passedCount, totalCount: results.length, results });
    }

    // --- approval: one decision binds one pending request, then it is spent ---
    if (op === "approval") {
      const approvalId = String(body.approvalId || "");
      const decision = String(body.decision || "");
      if (!approvalId || (decision !== "allow-once" && decision !== "deny")) {
        return NextResponse.json({ error: "Bad approval decision." }, { status: 400 });
      }
      if (closed) return NextResponse.json({ error: "This attempt is closed." }, { status: 409 });
      const approvalEvents = await readEvents(attempt.id, -1);
      const request = approvalEvents.find((event) => event.type === "approval.requested" && event.payload.approvalId === approvalId);
      if (!request || !request.turnId || request.nativeSessionId !== attempt.nativeSessionId ||
        approvalEvents.some((event) => event.seq > request.seq && event.turnId === request.turnId && ["turn.completed", "turn.failed", "turn.interrupted"].includes(event.type)) ||
        typeof request.payload.expiresAt !== "number" || request.payload.expiresAt <= Date.now() ||
        approvalEvents.some((event) => (event.type === "approval.decided" || event.type === "approval.expired") && event.payload.approvalId === approvalId)) {
        return NextResponse.json({ error: "This approval is no longer pending. Ask your agent to retry if needed." }, { status: 409 });
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
      if (active || closed) return NextResponse.json({ error: "Release stages between turns in an open attempt." }, { status: 409 });
      const source = await solutionFor(attempt, starterFor(scenario, attempt.language));
      const check = await storeGet<{ stage: number; hash: string; passed: boolean }>("kv", `visible:${attempt.id}`);
      if (!check?.passed || check.stage !== attempt.stage || check.hash !== snapshotHash(source, attempt.language)) {
        return NextResponse.json({ error: "Run and pass this stage's visible checks on the current solution before unlocking the next stage." }, { status: 409 });
      }
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
    // Cancels the pending freeze generation so its late upload can never
    // satisfy the next finish (F05).
    if (op === "reopen") {
      if (attempt.status !== "finishing" || attempt.acceptance) {
        return NextResponse.json({ error: "Nothing to reopen." }, { status: 409 });
      }
      attempt.status = "open";
      await saveAttempt(attempt);
      await storeDelete("kv", `freeze:${attempt.id}`);
      await recordServerEvent(attempt.id, attempt.deviceId, attempt.nativeSessionId, null, "session.replaced", {
        reason: "reopened after stuck freeze",
      });
      return NextResponse.json({ ok: true });
    }

    // --- finish: freeze -> evaluate uploaded bytes -> banked acceptance ---
    if (op === "finish") {
      if (attempt.acceptance) return NextResponse.json({ ok: true, acceptance: attempt.acceptance });
      if (active) return NextResponse.json({ error: "Wait for the agent turn to finish before evaluating." }, { status: 409 });
      if (attempt.stage < 3) return NextResponse.json({ error: "Complete the visible checks and unlock all three stages before final evaluation." }, { status: 409 });
      if (attempt.status !== "finishing") {
        if (!device || !isDeviceOnline(device)) return NextResponse.json({ error: "Reconnect the connector before freezing the final file." }, { status: 409 });
        await storeDelete("snapshots", attempt.id);
        attempt.status = "finishing";
        await saveAttempt(attempt);
        await enqueueCommand(attempt.id, attempt.deviceId, "freeze.request", {});
        return NextResponse.json({ ok: true, freezing: true });
      }
      const snap = await storeGet<{ source: string; hash: string; language: string; revision: number; freezeId?: string; sessionEpoch?: number }>(
        "snapshots",
        attempt.id
      );
      if (!snap) return NextResponse.json({ ok: true, freezing: true, waiting: true });
      if (snap.hash !== snapshotHash(snap.source, snap.language) || snap.language !== attempt.language) {
        return NextResponse.json({ error: "Snapshot failed integrity check." }, { status: 409 });
      }
      // Generation binding: only the pending freeze's bytes may satisfy this
      // finish — a delayed upload from a cancelled/superseded freeze is
      // rejected even though its hash correctly describes those bytes (F05).
      const pending = await pendingFreeze(attempt.id);
      if (!pending || snap.freezeId !== pending.freezeId || snap.sessionEpoch !== pending.sessionEpoch ||
          pending.sessionEpoch !== attemptEpoch(attempt)) {
        return NextResponse.json({ error: "Snapshot belongs to a superseded freeze. Retry Finish for the current generation." }, { status: 409 });
      }
      const tests = instantiateTests(scenario, attempt.seed);
      const lang = snap.language as Language;
      let results;
      try {
        results = lang === "javascript" ? await runJs(snap.source, scenario.fnName, tests)
          : lang === "c++" ? await runCpp(snap.source, scenario.fnName, tests, scenario.cppReturn ?? "vec")
          : await runPython(snap.source, scenario.fnName, tests);
      } catch (error) {
        // Infrastructure failure banks no verdict and leaves the frozen
        // snapshot in place for an idempotent retry (F12).
        if (isExecutionUnavailable(error)) {
          return NextResponse.json({ error: "Execution is temporarily unavailable — retry Finish in a minute. The frozen snapshot is preserved.", retryable: true }, { status: 503 });
        }
        const message = error instanceof Error ? error.message : "The solution could not run.";
        results = tests.map((test) => ({ ...test, passed: false, actual: message.slice(0, 1000) }));
      }
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
        results: results.map((r) => r.hidden ? { passed: r.passed, hidden: true } : r),
      });
    }

    return NextResponse.json({ error: "Unknown op." }, { status: 400 });
  });
}
