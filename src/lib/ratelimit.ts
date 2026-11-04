// Legacy browser flows (duels, local agent runs, leaderboard, and the
// abuse-sensitive run/interrogate endpoints) need a stable per-browser
// identity. A caller-supplied X-Forwarded-For is not one: anyone can spoof
// it and inherit another browser's duels, credits, attempts, or rate bucket.
//
// src/proxy.ts issues a signed, HttpOnly `codelit_anon` cookie and injects
// the verified identity as `x-codelit-client-id` on the routes below.
// clientIp() consumes that header (the proxy always overwrites it), then a
// directly verified cookie, and only trusts forwarding headers when the
// deployment explicitly sits behind a trusted proxy.

import { createHmac, timingSafeEqual } from "node:crypto";

const buckets = new Map<string, { n: number; reset: number }>();

export function limited(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now > cur.reset) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  cur.n += 1;
  return cur.n > max;
}

function identitySecret(): string {
  // Must match src/proxy.ts. Production deployments set NATIVE_SESSION_SECRET
  // (see .env.example); the constant only keeps local/dev flows working.
  return (
    process.env.CODELIT_ANON_SECRET ||
    process.env.NATIVE_SESSION_SECRET ||
    (process.env.NODE_ENV === "production" ? "codelit-production-anon-fallback" : "codelit-local-anon-secret")
  );
}

function validSignature(id: string, sig: string): boolean {
  const secret = identitySecret();
  const expected = createHmac("sha256", secret).update(id).digest("hex");
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function cookieValue(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export function clientIp(req: Request): string {
  const injected = req.headers.get("x-codelit-client-id");
  if (injected && /^anon:[a-f0-9]{24}$/.test(injected)) return injected;

  const anon = cookieValue(req, "codelit_anon");
  const match = anon?.match(/^([a-f0-9]{24})\.([a-f0-9]{64})$/);
  if (match && validSignature(match[1], match[2])) return `anon:${match[1]}`;

  // Native browser sessions are already signed; reuse them when present.
  const native = cookieValue(req, "codelit_sid");
  const nativeMatch = native?.match(/^([a-f0-9]{24})\.([a-f0-9]{64})$/);
  if (nativeMatch && validSignature(nativeMatch[1], nativeMatch[2])) return `session:${nativeMatch[1]}`;

  if (process.env.CODELIT_TRUST_PROXY_HEADERS === "1") {
    return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  }
  return "local";
}
