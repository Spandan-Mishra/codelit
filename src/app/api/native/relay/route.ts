// Connector relay: the paired local connector long-polls for browser
// commands, uploads normalized events, acks commands, and uploads frozen
// snapshots. Auth is the per-device token issued at pairing (revocable).
// The relay never executes connector instructions — it only routes typed
// commands the browser explicitly issued for an owned attempt.

import { NextResponse } from "next/server";
import { limited, clientIp } from "@/lib/ratelimit";
import { authDevice, saveAttempt } from "@/lib/native/registry";
import { appendEvent, lastSourceSeq, recordServerEvent } from "@/lib/native/events";
import { getAttempt } from "@/lib/native/registry";
import { sanitizeConnectorEvent } from "@/lib/native/protocol";
import { checkAttemptPath, checkSnapshot, snapshotHash } from "@/lib/native/workspace";
import { storeSet } from "@/lib/native/store";
import { ackCommand, takeCommands } from "@/lib/native/registry";

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

  // Long-poll inbox: typed browser commands for this device.
  if (op === "poll") {
    const attemptId = typeof body.attemptId === "string" ? body.attemptId : undefined;
    const commands = await takeCommands(device.deviceId, attemptId);
    return NextResponse.json({ commands });
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
      const attempt = await getAttempt(s.event.attemptId);
      if (!attempt || attempt.deviceId !== device.deviceId) {
        return NextResponse.json({ error: "Unknown attempt for this device.", accepted }, { status: 404 });
      }
      const { gap } = await appendEvent(s.event.attemptId, s.event);
      accepted.push(s.event.id);
      // Turn lifecycle bookkeeping owns the prompt budget and attempt state.
      if (!attempt.nativeSessionId && s.event.nativeSessionId) {
        attempt.nativeSessionId = s.event.nativeSessionId;
      }
      if (s.event.type === "turn.started" && attempt.status !== "done") attempt.status = "running";
      if (s.event.type === "approval.requested" && attempt.status !== "done") attempt.status = "waiting_approval";
      if (s.event.type === "approval.decided" && attempt.status === "waiting_approval") attempt.status = "running";
      if (s.event.type === "turn.completed" || s.event.type === "turn.failed" || s.event.type === "turn.interrupted") {
        attempt.turnsReserved = Math.max(0, attempt.turnsReserved - 1);
        attempt.turnsUsed += 1;
        if (attempt.status !== "done" && attempt.status !== "finishing") attempt.status = "open";
      }
      await saveAttempt(attempt);
      if (gap) {
        await recordServerEvent(
          s.event.attemptId, device.deviceId, s.event.nativeSessionId, s.event.turnId,
          "connection.gap", { afterSourceSeq: await lastSourceSeq(s.event.attemptId) }
        );
      }
    }
    return NextResponse.json({ accepted });
  }

  // Frozen snapshot upload (single solution file, hash-verified at finish).
  if (op === "snapshot") {
    const attemptId = String(body.attemptId || "");
    const attempt = await getAttempt(attemptId);
    if (!attempt || attempt.deviceId !== device.deviceId) {
      return NextResponse.json({ error: "Unknown attempt for this device." }, { status: 404 });
    }
    const language = String(body.language || "");
    const pathCheck = checkAttemptPath(body.path, language);
    if (!pathCheck.ok) return NextResponse.json({ error: pathCheck.error }, { status: 400 });
    const snap = checkSnapshot(body.source);
    if (!snap.ok) return NextResponse.json({ error: snap.error }, { status: 400 });
    const revision = typeof body.revision === "number" ? body.revision : 0;
    await storeSet("snapshots", attemptId, {
      source: snap.source,
      hash: snapshotHash(snap.source as string, language),
      language,
      revision,
      at: Date.now(),
    });
    await recordServerEvent(attemptId, device.deviceId, attempt.nativeSessionId, null, "file.snapshot", {
      hash: snapshotHash(snap.source as string, language),
      revision,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown op." }, { status: 400 });
}
