import { NextResponse } from "next/server";
import { nextQuestion, gradeAnswer } from "@/lib/meta";
import { getProblem } from "@/lib/problems";

// Simple in-memory rate limit (per IP, demo-grade)
const hits = new Map<string, { n: number; reset: number }>();
function limited(ip: string) {
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || now > cur.reset) { hits.set(ip, { n: 1, reset: now + 60_000 }); return false; }
  cur.n += 1;
  return cur.n > 40;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "local";
  if (limited(ip)) return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
  const body = await req.json();
  const problem = body.problemId ? getProblem(body.problemId) : undefined;
  if (body.action === "question") {
    const out = await nextQuestion({
      round: Number(body.round) || 0,
      problemTitle: body.problemTitle || problem?.title || "Problem",
      statement: body.statement || problem?.statement || "",
      code: String(body.code || ""),
      fnName: body.fnName || problem?.fnName || "solve",
      history: Array.isArray(body.history) ? body.history : [],
    });
    return NextResponse.json(out);
  }
  if (body.action === "grade") {
    const out = await gradeAnswer({ round: Number(body.round) || 0, question: String(body.question || ""), answer: String(body.answer || ""), code: String(body.code || "") });
    return NextResponse.json(out);
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
