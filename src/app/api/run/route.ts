import { NextResponse } from "next/server";
import { friendlyRunError } from "@/lib/errors";
import { getProblem } from "@/lib/problems";
import { limited, clientIp } from "@/lib/ratelimit";
import { runPython, runJs, runCpp, isExecutionUnavailable } from "@/lib/exec";
import type { TestCase } from "@/lib/types";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ results: [], error: "Invalid JSON body.", engine: "none" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ results: [], error: "Invalid JSON body.", engine: "none" }, { status: 400 });
  }
  const { language, code, fnName, tests, problemId, cppReturn } = body as {
    language: "python" | "javascript" | "c++";
    code: string;
    fnName: string;
    tests: TestCase[];
    problemId?: string;
    cppReturn?: string;
  };
  // Code execution is the abuse-sensitive path: cap volume and payload size.
  if (limited(`run:${clientIp(req)}`, 30)) {
    return NextResponse.json({ results: [], error: "Rate limited — wait a minute.", engine: "limited" }, { status: 429 });
  }
  if (
    !code || typeof code !== "string" || !fnName || typeof fnName !== "string" ||
    !Array.isArray(tests) ||
    tests.some((t) => !t || typeof t !== "object" || typeof t.input !== "string" || typeof t.expected !== "string")
  ) {
    return NextResponse.json({ results: [], error: "Missing or malformed code/tests", engine: "none" }, { status: 400 });
  }
  if (!["python", "javascript", "c++"].includes(language)) {
    return NextResponse.json({ results: [], error: "Unknown language.", engine: "none" }, { status: 400 });
  }
  if (code.length > 20_000 || tests.length > 10) {
    return NextResponse.json({ results: [], error: "Payload too large (max 20k code chars, 10 tests).", engine: "none" }, { status: 413 });
  }
  try {
    if (language === "javascript") {
      const results = await runJs(code, fnName, tests);
      return NextResponse.json({ results, engine: "local-js" });
    }
    if (language === "c++") {
      const ret = cppReturn || (problemId && getProblem(problemId)?.cppReturn) || "vec";
      return NextResponse.json({ results: await runCpp(code, fnName, tests, ret), engine: "local-cpp" });
    }
    const results = await runPython(code, fnName, tests);
    return NextResponse.json({ results, engine: "local-python" });
  } catch (e) {
    // Infrastructure failure banks no verdict: the caller may retry (F12).
    const unavailable = isExecutionUnavailable(e);
    return NextResponse.json({
      results: tests.map((t) => ({ input: t.input, expected: t.expected, actual: "", passed: false, hidden: t.hidden })),
      error: friendlyRunError(e instanceof Error ? e.message : String(e)),
      retryable: unavailable,
      engine: "local-error",
    }, { status: unavailable ? 503 : 500 });
  }
}
