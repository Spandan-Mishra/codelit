// Native pairing: browser creates a short-lived ticket, the local connector
// claims it with the display code after explicit local confirmation.
// Claim is strictly rate-limited; tickets are single-use and session-bound.

import { NextResponse } from "next/server";
import { limited, clientIp } from "@/lib/ratelimit";
import {
  NATIVE_SESSION_COOKIE,
  bindTicket,
  claimTicket,
  getDevice,
  issueTicket,
  newBrowserSession,
  readBrowserSession,
  registerDevice,
  ticketStatus,
} from "@/lib/native/registry";
import type { AdapterCapabilities } from "@/lib/native/protocol";

function withSessionCookie(res: NextResponse, signed: string): NextResponse {
  res.headers.append(
    "Set-Cookie",
    `${NATIVE_SESSION_COOKIE}=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`
  );
  return res;
}

function cleanAdapters(v: unknown): AdapterCapabilities[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 4).map((a) => {
    const o = (typeof a === "object" && a !== null ? a : {}) as Record<string, unknown>;
    const b = (k: string) => o[k] === true;
    return {
      adapter: o.adapter === "claude" ? "claude" : "codex",
      adapterVersion: String(o.adapterVersion || "").slice(0, 40),
      textDeltas: b("textDeltas"),
      toolArgs: b("toolArgs"),
      toolResults: b("toolResults"),
      fileDiffs: b("fileDiffs"),
      nativeResume: b("nativeResume"),
      usageReporting: b("usageReporting"),
      workspaceRestrictions: b("workspaceRestrictions"),
      approvalKinds: Array.isArray(o.approvalKinds) ? (o.approvalKinds as unknown[]).map(String).slice(0, 8) : [],
      validated: false, // the relay never trusts a self-reported validated flag
    } satisfies AdapterCapabilities;
  });
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
    if (setCookie) withSessionCookie(res, setCookie);
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
