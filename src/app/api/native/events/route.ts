// Browser event feed: JSON history since a sequence number. The UI polls
// every few seconds (MVP transport — the documented seam for a push relay).
// Deltas are compacted to the latest per turn; finalized messages and
// transitions always survive.

import { NextResponse } from "next/server";
import { limited, clientIp } from "@/lib/ratelimit";
import { getDevice, ownAttempt, readBrowserSession, settleQueuedTurns } from "@/lib/native/registry";
import { readEvents } from "@/lib/native/events";
import type { NativeEvent } from "@/lib/native/protocol";
import { getScenario } from "@/lib/scenarios";
import { publicScenario } from "@/lib/native/context";
import { publicDevice } from "@/lib/native/devices";
import { withNativeLock } from "@/lib/native/lock";
import { storeGet } from "@/lib/native/store";
import { snapshotHash, solutionHash } from "@/lib/native/workspace";

// Deltas accumulate per turn in sequence order (F10): the feed used to keep
// only the latest delta, silently dropping earlier streamed content. Bounded
// at 32k chars with an explicit truncated flag — never silent.
const MAX_ACCUMULATED_DELTA = 32_000;

function compact(events: NativeEvent[]): NativeEvent[] {
  const deltas = new Map<string, NativeEvent[]>();
  const rest: NativeEvent[] = [];
  for (const e of events) {
    if (e.type === "message.delta" && e.turnId) {
      const list = deltas.get(e.turnId) || [];
      list.push(e);
      deltas.set(e.turnId, list);
    } else rest.push(e);
  }
  const merged: NativeEvent[] = [];
  for (const list of deltas.values()) {
    const ordered = [...list].sort((a, b) => a.seq - b.seq);
    let text = "";
    let truncated = false;
    for (const d of ordered) {
      const piece = typeof d.payload.text === "string" ? d.payload.text : "";
      if (text.length + piece.length > MAX_ACCUMULATED_DELTA) {
        text += piece.slice(0, Math.max(0, MAX_ACCUMULATED_DELTA - text.length));
        truncated = true;
        break;
      }
      text += piece;
    }
    const first = ordered[0];
    merged.push({ ...first, payload: { ...first.payload, text, truncated, parts: ordered.length } });
  }
  return [...rest, ...merged].sort((a, b) => a.seq - b.seq);
}

export async function GET(req: Request) {
  if (limited(`native-events:${clientIp(req)}`, 120)) {
    return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
  }
  const sessionId = readBrowserSession(req);
  if (!sessionId) return NextResponse.json({ error: "No browser session." }, { status: 401 });
  const url = new URL(req.url);
  const attempt = await ownAttempt(sessionId, url.searchParams.get("attemptId") || "");
  if (!attempt) return NextResponse.json({ error: "Unknown attempt." }, { status: 404 });
  return withNativeLock(`attempt:${attempt.id}`, async () => {
    await settleQueuedTurns(attempt);
    const since = Math.max(-1, Number(url.searchParams.get("since") || "-1") || 0);
    const events = await readEvents(attempt.id, since);
    const scenario = getScenario(attempt.scenarioId);
    const device = attempt.deviceId ? await getDevice(attempt.deviceId) : null;
    const frozen = attempt.acceptance ? await storeGet<{ source: string; revision: number; hash: string; language: string }>("snapshots", attempt.id) : null;
    if (attempt.acceptance && (!frozen || frozen.hash !== attempt.submissionHash || snapshotHash(frozen.source, frozen.language) !== attempt.submissionHash)) {
      return NextResponse.json({ error: "The saved submission failed its integrity check. A live file cannot replace the evaluated snapshot." }, { status: 409 });
    }
    return NextResponse.json({
      events: compact(events), attempt,
      snapshot: frozen ? { content: frozen.source, rev: frozen.revision, hash: solutionHash(frozen.source) } : null,
      scenario: scenario ? publicScenario(scenario, attempt) : null,
      device: device && device.sessionId === sessionId ? publicDevice(device) : null,
  });
  });
}
