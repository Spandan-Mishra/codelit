import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// Issues the signed anonymous browser identity consumed by
// src/lib/ratelimit.ts. The proxy always overwrites any caller-supplied
// x-codelit-client-id, so a spoofed forwarding header cannot select or
// steal another browser's legacy duels, credits, attempts, or rate bucket.

const COOKIE = "codelit_anon";
const ID_RE = /^[a-f0-9]{24}$/;
const SIG_RE = /^[a-f0-9]{64}$/;

function secret(): string {
  return (
    process.env.CODELIT_ANON_SECRET ||
    process.env.NATIVE_SESSION_SECRET ||
    (process.env.NODE_ENV === "production" ? "codelit-production-anon-fallback" : "codelit-local-anon-secret")
  );
}

function sign(id: string): string {
  return createHmac("sha256", secret()).update(id).digest("hex");
}

function verifiedId(req: NextRequest): string | null {
  const raw = req.cookies.get(COOKIE)?.value;
  if (!raw) return null;
  const [id, sig] = raw.split(".");
  if (!id || !sig || !ID_RE.test(id) || !SIG_RE.test(sig)) return null;
  const expected = sign(id);
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null;
}

export function proxy(req: NextRequest) {
  const existing = verifiedId(req);
  const id = existing ?? randomBytes(12).toString("hex");
  const headers = new Headers(req.headers);
  headers.set("x-codelit-client-id", `anon:${id}`);
  const res = NextResponse.next({ request: { headers } });
  if (!existing) {
    res.cookies.set(COOKIE, `${id}.${sign(id)}`, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      secure: req.nextUrl.protocol === "https:",
    });
  }
  return res;
}

export const config = {
  matcher: [
    "/api/run/:path*",
    "/api/interrogate/:path*",
    "/api/agent-run/:path*",
    "/api/duel/:path*",
    "/api/leaderboard/:path*",
  ],
};
