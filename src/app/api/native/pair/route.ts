// Native pairing: browser creates a short-lived ticket, the local connector
// claims it with the display code after explicit local confirmation.
// Claim is strictly rate-limited; tickets are single-use and session-bound.

import { NextResponse } from "next/server";
import { limited, clientIp } from "@/lib/ratelimit";
import {
  sessionCookie,
  bindTicket,
  claimTicket,
  getDevice,
  issueTicket,
  newBrowserSession,
  readBrowserSession,
  registerDevice,
  ticketStatus,
} from "@/lib/native/registry";
import { cleanAdapters } from "@/lib/native/devices";

function withSessionCookie(res: NextResponse, signed: string, req: Request): NextResponse {
  res.headers.append("Set-Cookie", sessionCookie(req, signed));
  return res;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const op = String(body.op || "");

  if (op === "create") {
    if (limited(`native-pair:${ip}`, 10)) {
      return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
    }
    let sessionId = readBrowserSession(req);
    let setCookie = "";
    if (!sessionId) {
      const s = newBrowserSession();
      sessionId = s.id;
      setCookie = s.signed;
    }
    const t = issueTicket(sessionId);
    const res = NextResponse.json({ ticketId: t.ticketId, code: t.code, expiresAt: t.expiresAt });
    if (setCookie) withSessionCookie(res, setCookie, req);
    return res;
  }

  if (op === "status") {
    const sessionId = readBrowserSession(req);
    if (!sessionId) return NextResponse.json({ error: "No browser session." }, { status: 401 });
    const t = ticketStatus(String(body.ticketId || ""), sessionId);
    if (!t) return NextResponse.json({ error: "Unknown or expired ticket." }, { status: 404 });
    if (!t.deviceId) return NextResponse.json({ claimed: false });
    const d = await getDevice(t.deviceId);
    return NextResponse.json({ claimed: true, deviceId: t.deviceId, adapters: d?.adapters || [] });
  }

  if (op === "claim") {
    if (limited(`native-claim:${ip}`, 10)) {
      return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
    }
    const t = claimTicket(String(body.code || ""));
    if (!t) return NextResponse.json({ error: "Unknown, expired, or already-used code." }, { status: 404 });
    const label = typeof body.label === "string" ? body.label : "connector";
    const { device, token } = await registerDevice(t.sessionId, label, cleanAdapters(body.adapters));
    bindTicket(t, device.deviceId);
    // The token is shown once, to the local connector that just proved
    // possession of the single-use code. It is never stored server-side.
    return NextResponse.json({ deviceId: device.deviceId, token });
  }

  return NextResponse.json({ error: "Unknown op." }, { status: 400 });
}
