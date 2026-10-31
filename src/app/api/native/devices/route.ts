// Paired-device management: list this session's devices, revoke a device.
// Revoke stops future commands; the connector must also cancel or contain
// active work when it observes the revoked credential.

import { NextResponse } from "next/server";
import { limited, clientIp } from "@/lib/ratelimit";
import { listAttempts, listDevices, readBrowserSession, revokeDevice } from "@/lib/native/registry";
import { publicDevice } from "@/lib/native/devices";
import { getScenario } from "@/lib/scenarios";
import { readEvents } from "@/lib/native/events";

export async function GET(req: Request) {
  if (limited(`native-devices:${clientIp(req)}`, 60)) {
    return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
  }
  const sessionId = readBrowserSession(req);
  const url = new URL(req.url);
  if (!sessionId) return NextResponse.json(url.searchParams.get("attempts") === "1" ? { attempts: [] } : { devices: [] });
  if (url.searchParams.get("attempts") === "1") {
    const attempts = await Promise.all((await listAttempts(sessionId)).map(async (a) => {
      const scenario = getScenario(a.scenarioId);
      const events = await readEvents(a.id, -1);
      const check = events.filter((e) => e.type === "official.test" && e.payload.scope === "visible").at(-1);
      return {
        ...a, mode: a.mode || "practice", title: a.title || scenario?.title || a.scenarioId,
        scenarioTitle: scenario?.title || a.scenarioId, shortId: a.id.slice(-8), archivedAt: a.archivedAt || null,
        progress: { stage: a.stage, totalStages: 3, turnsUsed: a.turnsUsed, turnsReserved: a.turnsReserved,
          promptLimit: scenario?.promptPar || 0, hasSolution: events.some((e) => e.type === "file.revision" && typeof e.payload.rev === "number" && e.payload.rev > 0),
          lastActivityAt: events.at(-1)?.serverTime || a.updatedAt },
        latestCheck: check ? { passed: check.payload.passedCount, total: check.payload.totalCount, stage: check.payload.stage } : null,
      };
    }));
    return NextResponse.json({ attempts });
  }
  return NextResponse.json({ devices: (await listDevices(sessionId)).map(publicDevice) });
}

export async function POST(req: Request) {
  if (limited(`native-devices:${clientIp(req)}`, 30)) {
    return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
  }
  const sessionId = readBrowserSession(req);
  if (!sessionId) return NextResponse.json({ error: "No browser session." }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (body.op !== "revoke" || typeof body.deviceId !== "string") {
    return NextResponse.json({ error: "Unknown op." }, { status: 400 });
  }
  const ok = await revokeDevice(sessionId, body.deviceId);
  if (!ok) return NextResponse.json({ error: "Unknown device." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
