import { NextResponse } from "next/server";
import { nextQuestion, gradeAnswer } from "@/lib/meta";
import { getProblem } from "@/lib/problems";
import { limited, clientIp } from "@/lib/ratelimit";

// Cost guards: model calls are the expensive path, so inputs are capped
// before any token is spent. 40 Q&A calls/min per IP is generous for one
// human and stops prompt-loop abuse.
const MAX_CODE = 12_000;
const MAX_ANSWER = 3_000;
const MAX_HISTORY = 6;

export async function POST(req: Request) {
  if (limited(`interrogate:${clientIp(req)}`, 40)) {
    return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
  }
  const body = await req.json();
  const code = String(body.code || "");
  if (code.length > MAX_CODE) return NextResponse.json({ error: "Code too long — keep it under 12k characters." }, { status: 413 });
  const problem = body.problemId ? getProblem(body.problemId) : undefined;
  const traceSummary = typeof body.traceSummary === "string" && body.traceSummary ? body.traceSummary.slice(0, 300) : undefined;
  if (body.action === "question") {
    const history = (Array.isArray(body.history) ? body.history : []).slice(-MAX_HISTORY);
    const out = await nextQuestion({
      round: Math.min(2, Math.max(0, Number(body.round) || 0)),
      problemTitle: String(body.problemTitle || problem?.title || "Problem").slice(0, 200),
      statement: String(body.statement || problem?.statement || "").slice(0, 2000),
      code,
      fnName: String(body.fnName || problem?.fnName || "solve").slice(0, 64),
      history,
      traceSummary,
    });
    return NextResponse.json(out);
  }
  if (body.action === "grade") {
    const answer = String(body.answer || "");
    if (answer.length > MAX_ANSWER) return NextResponse.json({ error: "Answer too long — keep it under 3000 characters." }, { status: 413 });
    const out = await gradeAnswer({
      round: Math.min(2, Math.max(0, Number(body.round) || 0)),
      question: String(body.question || "").slice(0, 1000),
      answer,
      code,
      traceSummary,
    });
    return NextResponse.json(out);
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
