// Tiny in-memory rate limiter for the demo. Per-process (resets on
// redeploy); swap for Upstash/Vercel KV when traffic grows.

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

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
