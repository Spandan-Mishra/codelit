// Outbound-request guard for user-supplied provider endpoints (BYOK).
// Default hosted policy: https to public addresses only. Loopback and
// private ranges are refused, since server-side fetch would otherwise reach
// internal services with the user's key attached (SSRF). Self-hosted / local
// dev can opt back into LAN endpoints with ALLOW_PRIVATE_ENDPOINTS=1.
//
// Residual limits (documented, not solved here): DNS is checked once before
// the request, so a rebinding hostname can still change targets mid-flight
// (TOCTOU); full containment needs isolated egress (audit P0-1 track).

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateAddr(addr: string): boolean {
  if (isIP(addr) === 4) {
    const p = addr.split(".").map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 0) return true;
    return false;
  }
  const h = addr.toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80:") || h.startsWith("fec0:") || h.startsWith("fc00:") || h.startsWith("fd00:")) return true;
  return false;
}

export function allowPrivateEndpoints(): boolean {
  return process.env.ALLOW_PRIVATE_ENDPOINTS === "1";
}

export interface EgressCheck {
  ok: boolean;
  error?: string;
}

/** Validate a user-supplied (or default) provider base URL before fetching. */
export async function checkEgress(rawBase: string): Promise<EgressCheck> {
  let url: URL;
  try {
    url = new URL(rawBase);
  } catch {
    return { ok: false, error: "Invalid base URL." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Credentials in the base URL are not allowed." };
  }
  const allowPrivate = allowPrivateEndpoints();
  if (url.protocol === "http:") {
    if (!allowPrivate) {
      return {
        ok: false,
        error: "Plain HTTP endpoints are disabled on this host. Use an https provider URL.",
      };
    }
  } else if (url.protocol !== "https:") {
    return { ok: false, error: "Base URL must be https." };
  }
  if (!allowPrivate) {
    let addrs: string[];
    try {
      addrs = (await lookup(url.hostname, { all: true })).map((r) => r.address);
    } catch {
      return { ok: false, error: "Could not resolve the endpoint hostname." };
    }
    if (addrs.length === 0 || addrs.some(isPrivateAddr)) {
      return {
        ok: false,
        error: "Local/private endpoints are disabled on this host (self-hosted use: ALLOW_PRIVATE_ENDPOINTS=1).",
      };
    }
  }
  return { ok: true };
}

/** Prompt-sized failure for a redirect we refuse to follow (SSRF guard). */
export function redirectRefused(label: string): string {
  return `${label} redirected the request — refusing to follow (endpoint guard).`;
}
