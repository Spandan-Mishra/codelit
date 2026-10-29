// Browser event feed: JSON history since a sequence number. The UI polls
// every few seconds (MVP transport — the documented seam for a push relay).
// Deltas are compacted to the latest per turn; finalized messages and
// transitions always survive.

import { NextResponse } from "next/server";
import { limited, clientIp } from "@/lib/ratelimit";
import { ownAttempt, readBrowserSession } from "@/lib/native/registry";
import { readEvents } from "@/lib/native/events";
import type { NativeEvent } from "@/lib/native/protocol";

function compact(events: NativeEvent[]): NativeEvent[] {
  const latestDelta = new Map<string, NativeEvent>();
  const rest: NativeEvent[] = [];
  for (const e of events) {
    if (e.type === "message.delta" && e.turnId) latestDelta.set(e.turnId, e);
    else rest.push(e);
  }
  return [...rest, ...latestDelta.values()].sort((a, b) => a.seq - b.seq);
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
  const since = Math.max(-1, Number(url.searchParams.get("since") || "-1") || 0);
  const events = await readEvents(attempt.id, since);
  return NextResponse.json({ events: compact(events), attempt });
}
