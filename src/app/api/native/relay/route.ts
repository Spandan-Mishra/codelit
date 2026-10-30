// Connector relay: the paired local connector long-polls for browser
// commands, uploads normalized events, acks commands, and uploads frozen
// snapshots. Auth is the per-device token issued at pairing (revocable).
// The relay never executes connector instructions — it only routes typed
// commands the browser explicitly issued for an owned attempt.

import { NextResponse } from "next/server";
import { limited, clientIp } from "@/lib/ratelimit";
import { authDevice, saveAttempt, saveDevice } from "@/lib/native/registry";
import { appendEvent, lastSourceSeq, recordServerEvent } from "@/lib/native/events";
import { attemptEpoch, getAttempt, getSessionLeases, pendingFreeze } from "@/lib/native/registry";
import { sanitizeConnectorEvent } from "@/lib/native/protocol";
import { checkAttemptPath, checkSnapshot, snapshotHash, solutionHash } from "@/lib/native/workspace";
import { storeGet, storeSet } from "@/lib/native/store";
import { ackCommand, takeCommands } from "@/lib/native/registry";
import { cleanAdapters } from "@/lib/native/devices";
import { withNativeLock } from "@/lib/native/lock";

async function authed(req: Request) {
  const deviceId = req.headers.get("x-device-id") || "";
  const token = req.headers.get("x-device-token") || "";
  if (!deviceId || !token) return null;
  return authDevice(deviceId, token);
}

export async function POST(req: Request) {
  if (limited(`native-relay:${clientIp(req)}`, 120)) {
    return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
  }
  const device = await authed(req);
  if (!device) return NextResponse.json({ error: "Unknown device or revoked credential." }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const op = String(body.op || "");

  // Long-poll inbox: typed browser commands plus a per-session execution
  // lease for every native session on this device. There is intentionally no
  // global permitWork: each lease {attemptId, sessionEpoch, permitWork,
  // leaseExpiresAt} scopes one session, and the connector must re-contact
  // within 29s and contain a lapsed session within 1s (see transport-contract.md).
  if (op === "poll") {
    if (Array.isArray(body.adapters)) {
      device.adapters = cleanAdapters(body.adapters);
      await saveDevice(device);
    }
    const attemptId = typeof body.attemptId === "string" ? body.attemptId : undefined;
    const commands = await takeCommands(device.deviceId, attemptId);
    const leases = await getSessionLeases(device.deviceId, attemptId);
    return NextResponse.json({ commands, leases });
  }

  if (op === "ack") {
    const ok = await ackCommand(String(body.id || ""), device.deviceId);
    return NextResponse.json({ ok });
  }

  // Normalized event upload with replay-gap detection.
  if (op === "events") {
    if (!Array.isArray(body.events) || body.events.length > 50) {
      return NextResponse.json({ error: "Provide 1-50 events." }, { status: 400 });
    }
    const accepted: string[] = [];
    for (const raw of body.events) {
      const s = sanitizeConnectorEvent(raw);
      if (!s.ok || !s.event) return NextResponse.json({ error: s.error, accepted }, { status: 400 });
      if (s.event.deviceId !== device.deviceId) {
        return NextResponse.json({ error: "Event device mismatch.", accepted }, { status: 403 });
      }
      const event = s.event;
      const rejection = await withNativeLock(`attempt:${event.attemptId}`, async () => {
        const attempt = await getAttempt(event.attemptId);
        if (!attempt || attempt.deviceId !== device.deviceId) {
          return NextResponse.json({ error: "Unknown attempt for this device.", accepted }, { status: 404 });
        }
        // Stale-epoch rejection: the epoch is bumped when a session.start is
        // enqueued, so in-flight events from the replaced session (current-1)
        // are still evidence, but anything older — or from an unknown future
        // generation — conflicts with the current session and is quarantined
        // by the connector as a visible gap instead of joining this log.
        const expected = attemptEpoch(attempt);
        const epoch = event.sessionEpoch;
        if (epoch !== undefined && (epoch < expected - 1 || epoch > expected)) {
          return NextResponse.json({ error: "Stale session epoch for this attempt.", accepted }, { status: 409 });
        }
        // Issued-turn validation: turn lifecycle events must reference a turn
        // this server reserved, so a replayed/foreign terminal cannot move
        // budgets or state (F06). Terminal dedupe stays keyed per turn below.
        if ((event.type === "turn.started" || event.type === "turn.completed" || event.type === "turn.failed" || event.type === "turn.interrupted") &&
            (!event.turnId || !await storeGet("kv", `issuedturn:${event.attemptId}:${event.turnId}`))) {
          return NextResponse.json({ error: "Unknown turn id for this attempt.", accepted }, { status: 409 });
        }
        const current = epoch === undefined || epoch === expected;
        const { gap, replay } = await appendEvent(event.attemptId, event);
        accepted.push(event.id);
        if (replay) return null;
        // Turn lifecycle bookkeeping owns the prompt budget and attempt state.
        // Previous-generation terminals still release their own reservation
        // (terminal keys are per turn), but only the current generation may
        // move attempt state or rebind the native session.
        if (current && (!attempt.nativeSessionId || event.type === "session.replaced") && event.nativeSessionId) {
          attempt.nativeSessionId = event.nativeSessionId;
        }
        if (current && event.type === "turn.started" && attempt.status !== "done" && attempt.status !== "finishing") attempt.status = "running";
        if (current && event.type === "approval.requested" && attempt.status !== "done" && attempt.status !== "finishing") attempt.status = "waiting_approval";
        if (current && (event.type === "approval.decided" || event.type === "approval.expired") && attempt.status === "waiting_approval") attempt.status = "running";
        if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "turn.interrupted") {
          const terminalKey = `terminal:${attempt.id}:${event.turnId || event.id}`;
          if (!await storeGet("kv", terminalKey)) {
            await storeSet("kv", terminalKey, true);
            attempt.turnsReserved = Math.max(0, attempt.turnsReserved - 1);
            attempt.turnsUsed += 1;
            if (current && attempt.status !== "done" && attempt.status !== "finishing") attempt.status = "open";
          }
        }
        await saveAttempt(attempt);
        if (gap) {
          await recordServerEvent(
            event.attemptId, device.deviceId, event.nativeSessionId, event.turnId,
            "connection.gap", { afterSourceSeq: await lastSourceSeq(event.attemptId) }
          );
        }
        return null;
      });
      if (rejection) return rejection;
    }
    return NextResponse.json({ accepted });
  }

  // Frozen snapshot upload (single solution file, bound to one freeze
  // generation: the upload must echo the pending freezeId/epoch/revision/hash
  // and its bytes must match, so old bytes can never satisfy a new freeze).
  if (op === "snapshot") {
    const attemptId = String(body.attemptId || "");
    return withNativeLock(`attempt:${attemptId}`, async () => {
      const attempt = await getAttempt(attemptId);
      if (!attempt || attempt.deviceId !== device.deviceId) {
        return NextResponse.json({ error: "Unknown attempt for this device." }, { status: 404 });
      }
      if (attempt.status !== "finishing") return NextResponse.json({ error: "No final snapshot is currently requested." }, { status: 409 });
      const language = String(body.language || "");
      if (language !== attempt.language) return NextResponse.json({ error: "Snapshot language mismatch." }, { status: 400 });
      const pathCheck = checkAttemptPath(body.path, language);
      if (!pathCheck.ok) return NextResponse.json({ error: pathCheck.error }, { status: 400 });
      const snap = checkSnapshot(body.source);
      if (!snap.ok) return NextResponse.json({ error: snap.error }, { status: 400 });
      const source = snap.source as string;
      const pending = await pendingFreeze(attemptId);
      if (!pending) return NextResponse.json({ error: "No freeze generation is pending for this attempt." }, { status: 409 });
      if (body.freezeId !== pending.freezeId) {
        return NextResponse.json({ error: "Snapshot freezeId does not match the pending freeze. Retry Finish for the current generation." }, { status: 409 });
      }
      if (body.sessionEpoch !== pending.sessionEpoch || pending.sessionEpoch !== attemptEpoch(attempt)) {
        return NextResponse.json({ error: "Snapshot session epoch is stale. Retry Finish after the current session settles." }, { status: 409 });
      }
      if (body.expectedRevision !== pending.expectedRevision || body.expectedHash !== pending.expectedHash) {
        return NextResponse.json({ error: "Snapshot does not echo the frozen revision/hash. Retry Finish for the current generation." }, { status: 409 });
      }
      const revision = typeof body.revision === "number" ? body.revision : -1;
      if (revision !== pending.expectedRevision) {
        return NextResponse.json({ error: "Uploaded revision does not match the frozen generation." }, { status: 409 });
      }
      if (pending.expectedHash && solutionHash(source) !== pending.expectedHash) {
        return NextResponse.json({ error: "Uploaded bytes do not match the frozen generation." }, { status: 409 });
      }
      if (typeof body.hash === "string" && body.hash !== solutionHash(source)) {
        return NextResponse.json({ error: "Snapshot hash does not match its bytes." }, { status: 400 });
      }
      const hash = snapshotHash(source, language);
      await storeSet("snapshots", attemptId, {
        source,
        hash,
        language,
        revision,
        at: Date.now(),
        freezeId: pending.freezeId,
        sessionEpoch: pending.sessionEpoch,
        expectedRevision: pending.expectedRevision,
        expectedHash: pending.expectedHash,
      });
      await recordServerEvent(attemptId, device.deviceId, attempt.nativeSessionId, null, "file.snapshot", {
        freezeId: pending.freezeId,
        sessionEpoch: pending.sessionEpoch,
        expectedRevision: pending.expectedRevision,
        expectedHash: pending.expectedHash,
        revision,
        hash,
      });
      return NextResponse.json({
        ok: true,
        freezeId: pending.freezeId,
        sessionEpoch: pending.sessionEpoch,
        expectedRevision: pending.expectedRevision,
        expectedHash: pending.expectedHash,
        revision,
        hash,
      });
    });
  }

  return NextResponse.json({ error: "Unknown op." }, { status: 400 });
}
