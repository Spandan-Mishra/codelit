import { NextResponse } from "next/server";
import { limited, clientIp } from "@/lib/ratelimit";
import { verifySession } from "@/lib/native/secret";
import { sessionCookie } from "@/lib/native/registry";

// Demo entry links. Codelit has no passwords: identity is the signed
// browser-session cookie. A demo link carries one prepared session's
// signed value (the same credential the cookie itself holds), sets it,
// and lands on an allowlisted page. Possession of the link is possession
// of that demo session — treat demo links as demo-only credentials.
const TARGETS = new Set(["/native", "/scenarios", "/passport", "/duels"]);

export function GET(req: Request) {
  if (limited(`demo-enter:${clientIp(req)}`, 30)) {
    return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
  }
  const url = new URL(req.url);
  const sid = url.searchParams.get("sid") || "";
  const sessionId = verifySession(sid);
  if (!sessionId) return NextResponse.json({ error: "Invalid or expired demo link." }, { status: 400 });
  const to = url.searchParams.get("to") || "/native";
  const target = TARGETS.has(to) ? to : "/native";
  // Relative Location: the app is served on a bare IP:port internally, so
  // req.url's origin can be localhost — never leak that to the browser.
  const res = new NextResponse(null, { status: 302, headers: { Location: target } });
  res.headers.append("Set-Cookie", sessionCookie(req, sid));
  return res;
}
