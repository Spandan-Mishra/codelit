import { NextResponse } from "next/server";
import { debugHint } from "@/lib/meta";
import { getDebug } from "@/lib/problems";

export async function POST(req: Request) {
  const body = await req.json();
  const ch = getDebug(String(body.challengeId || ""));
  if (!ch) return NextResponse.json({ error: "Unknown challenge" }, { status: 404 });
  const out = await debugHint({ title: ch.title, buggy: ch.buggyPy, code: String(body.code || ""), promptsUsed: Number(body.promptsUsed) || 0 });
  return NextResponse.json(out);
}
