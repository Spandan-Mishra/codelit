import { NextResponse } from "next/server";
import { nextQuestion, gradeAnswer, allQuestions, gradeAll } from "@/lib/meta";
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
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  const code = String(body.code || "");
  if (code.length > MAX_CODE) return NextResponse.json({ error: "Code too long — keep it under 12k characters." }, { status: 413 });
  const problem = typeof body.problemId === "string" ? getProblem(body.problemId) : undefined;
  const traceSummary = typeof body.traceSummary === "string" && body.traceSummary ? body.traceSummary.slice(0, 300) : undefined;
  if (body.action === "questions") {
    const out = await allQuestions({
      problemTitle: String(body.problemTitle || problem?.title || "Problem").slice(0, 200),
      statement: String(body.statement || problem?.statement || "").slice(0, 2000),
      code,
      fnName: String(body.fnName || problem?.fnName || "solve").slice(0, 64),
      traceSummary,
    });
    return NextResponse.json(out);
  }
  if (body.action === "gradeAll") {
    const items = (Array.isArray(body.items) ? body.items : [])
      .filter((h): h is { question: string; answer: string } =>
        Boolean(h) && typeof h === "object" &&
        typeof (h as { question?: unknown }).question === "string" &&
        typeof (h as { answer?: unknown }).answer === "string")
      .slice(0, 3)
      .map((h) => ({ question: h.question.slice(0, 1000), answer: h.answer.slice(0, MAX_ANSWER) }));
    if (items.length === 0) return NextResponse.json({ error: "No answers to grade." }, { status: 400 });
    const out = await gradeAll({ items, code, traceSummary });
    return NextResponse.json(out);
  }
  if (body.action === "question") {
    const history = (Array.isArray(body.history) ? body.history : [])
      .filter((h): h is { question: string; answer: string } =>
        Boolean(h) && typeof h === "object" &&
        typeof (h as { question?: unknown }).question === "string" &&
        typeof (h as { answer?: unknown }).answer === "string")
      .slice(-MAX_HISTORY);
    const lensRaw = String(body.lens || "");
    const lens = lensRaw === "code" || lensRaw === "design" || lensRaw === "prompts" ? lensRaw : undefined;
    const out = await nextQuestion({
      round: Math.min(2, Math.max(0, Number(body.round) || 0)),
      problemTitle: String(body.problemTitle || problem?.title || "Problem").slice(0, 200),
      statement: String(body.statement || problem?.statement || "").slice(0, 2000),
      code,
      fnName: String(body.fnName || problem?.fnName || "solve").slice(0, 64),
      history,
      traceSummary,
      lens,
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
