import { NextResponse } from "next/server";
import { debugHint } from "@/lib/meta";
import { getDebug } from "@/lib/problems";
import { limited, clientIp } from "@/lib/ratelimit";

export async function POST(req: Request) {
  if (limited(`hint:${clientIp(req)}`, 20)) {
    return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
  }
  const body = await req.json();
  const ch = getDebug(String(body.challengeId || ""));
  if (!ch) return NextResponse.json({ error: "Unknown challenge" }, { status: 404 });
  const code = String(body.code || "");
  if (code.length > 12_000) return NextResponse.json({ error: "Code too long." }, { status: 413 });
  const out = await debugHint({ title: ch.title, buggy: ch.buggyPy, code, promptsUsed: Math.min(99, Number(body.promptsUsed) || 0) });
  return NextResponse.json(out);
}
