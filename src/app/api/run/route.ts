import { NextResponse } from "next/server";
import { friendlyRunError } from "@/lib/errors";
import { getProblem } from "@/lib/problems";
import { limited, clientIp } from "@/lib/ratelimit";
import { runPython, runJs, runCpp } from "@/lib/exec";
import type { TestCase } from "@/lib/types";

export async function POST(req: Request) {
  const body = await req.json();
  const { language, code, fnName, tests, problemId } = body as {
    language: "python" | "javascript" | "c++";
    code: string;
    fnName: string;
    tests: TestCase[];
    problemId?: string;
  };
  // Code execution is the abuse-sensitive path: cap volume and payload size.
  if (limited(`run:${clientIp(req)}`, 30)) {
    return NextResponse.json({ results: [], error: "Rate limited — wait a minute.", engine: "limited" }, { status: 429 });
  }
  if (!code || !fnName || !Array.isArray(tests)) return NextResponse.json({ results: [], error: "Missing code/tests", engine: "none" }, { status: 400 });
  if (code.length > 20_000 || tests.length > 10) {
    return NextResponse.json({ results: [], error: "Payload too large (max 20k code chars, 10 tests).", engine: "none" }, { status: 413 });
  }
  try {
    if (language === "javascript") return NextResponse.json({ results: runJs(code, fnName, tests), engine: "local-js" });
    if (language === "c++") {
      const ret = (problemId && getProblem(problemId)?.cppReturn) || "vec";
      return NextResponse.json({ results: await runCpp(code, fnName, tests, ret), engine: "local-cpp" });
    }
    const results = await runPython(code, fnName, tests);
    return NextResponse.json({ results, engine: "local-python" });
  } catch (e) {
    return NextResponse.json({
      results: tests.map((t) => ({ input: t.input, expected: t.expected, actual: "", passed: false, hidden: t.hidden })),
      error: friendlyRunError(e instanceof Error ? e.message : String(e)),
      engine: "local-error",
    });
  }
}
