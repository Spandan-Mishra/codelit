// Paired-device management: list this session's devices, revoke a device.
// Revoke stops future commands; the connector must also cancel or contain
// active work when it observes the revoked credential.

import { NextResponse } from "next/server";
import { limited, clientIp } from "@/lib/ratelimit";
import { listAttempts, listDevices, readBrowserSession, revokeDevice } from "@/lib/native/registry";

export async function GET(req: Request) {
  if (limited(`native-devices:${clientIp(req)}`, 60)) {
    return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
  }
  const sessionId = readBrowserSession(req);
  if (!sessionId) return NextResponse.json({ error: "No browser session." }, { status: 401 });
  const url = new URL(req.url);
  if (url.searchParams.get("attempts") === "1") {
    return NextResponse.json({ attempts: await listAttempts(sessionId) });
  }
  return NextResponse.json({ devices: await listDevices(sessionId) });
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
