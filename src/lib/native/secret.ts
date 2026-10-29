// Small crypto helpers for the native-agent relay: ids, tokens, hashes,
// and HMAC-signed browser sessions. No credentials ever live here.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** Short human-readable pairing code (no ambiguous chars), single use. */
export function newPairCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = randomBytes(6);
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join("");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function serverSecret(): string {
  const s = process.env.NATIVE_SESSION_SECRET;
  if (s && s.length >= 16) return s;
  // Dev fallback: random per process (sessions do not survive restarts).
  if (!process.env.NATIVE_SESSION_SECRET) {
    console.warn("[native] NATIVE_SESSION_SECRET unset — browser sessions are process-local.");
  }
  if (!globalThis.__nativeDevSecret) globalThis.__nativeDevSecret = randomBytes(32).toString("hex");
  return globalThis.__nativeDevSecret as string;
}

export function signSession(sessionId: string): string {
  const sig = createHmac("sha256", serverSecret()).update(sessionId, "utf8").digest("hex");
  return `${sessionId}.${sig}`;
}

export function verifySession(signed: string): string | null {
  if (typeof signed !== "string") return null;
  const i = signed.lastIndexOf(".");
  if (i <= 0) return null;
  const id = signed.slice(0, i);
  const sig = signed.slice(i + 1);
  if (!/^[0-9a-f]{24}$/.test(id) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const expect = createHmac("sha256", serverSecret()).update(id, "utf8").digest("hex");
  try {
    if (timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expect, "hex"))) return id;
  } catch {
    return null;
  }
  return null;
}

declare global {
  var __nativeDevSecret: string | undefined;
}
