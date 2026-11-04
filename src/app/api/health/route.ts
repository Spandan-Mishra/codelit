import { NextResponse } from "next/server";

// Liveness probe for the deploy pipeline and uptime checks. Deliberately
// dependency-free: it proves the web process is serving, not that a model
// or sandbox call would succeed.
export function GET() {
  return NextResponse.json({ ok: true, service: "codelit", at: new Date().toISOString() });
}
