import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { outputsMatch } from "@/lib/runner";
import type { TestCase } from "@/lib/types";

function toCamel(s: string) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function serializeJs(v: unknown): string {
  if (typeof v === "boolean") return v ? "True" : "False";
  return JSON.stringify(v) ?? String(v);
}

// Local Python sandbox: runs on this server with a hard timeout.
// Demo-grade isolation (no network in candidate code path); isolate further before real users.
function runPythonLocal(code: string, fnName: string, tests: TestCase[]): Promise<{ actual: string }[]> {
  const harness =
    code +
    "\n" +
    tests
      .map(
        (t) => `try:\n    print(repr(${t.input}), flush=True)\nexcept Exception as e:\n    print("ERROR: " + str(e), flush=True)`
      )
      .join("\n");
  return new Promise((resolve, reject) => {
    const child = execFile("python3", ["-c", harness], { timeout: 8000, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error(stderr.trim() || err.message));
      const lines = stdout.split("\n");
      resolve(tests.map((_, i) => ({ actual: (lines[i] ?? "").trim() })));
    });
    child.on("error", reject);
  });
}

async function runPython(code: string, fnName: string, tests: TestCase[]) {
  const outputs = await runPythonLocal(code, fnName, tests);
  return tests.map((t, i) => {
    const actual = outputs[i]?.actual ?? "";
    return { input: t.input, expected: t.expected, actual, passed: outputsMatch(actual, t.expected, fnName), hidden: t.hidden };
  });
}

function runJs(code: string, fnName: string, tests: TestCase[]) {
  const jsFn = toCamel(fnName);
  return tests.map((t) => {
    const expr = t.input.replaceAll(fnName, jsFn).replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false");
    try {
      // Demo sandbox: runs candidate JS in this route process. Isolate before real users.
      const fn = new Function(`${code}\nreturn (${expr});`);
      const actual = serializeJs(fn());
      return { input: t.input, expected: t.expected, actual, passed: outputsMatch(actual, t.expected, fnName), hidden: t.hidden };
    } catch (e) {
      return { input: t.input, expected: t.expected, actual: `ERROR: ${e instanceof Error ? e.message : String(e)}`, passed: false, hidden: t.hidden };
    }
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { language, code, fnName, tests } = body as { language: "python" | "javascript"; code: string; fnName: string; tests: TestCase[] };
  if (!code || !fnName || !Array.isArray(tests)) return NextResponse.json({ results: [], error: "Missing code/tests", engine: "none" }, { status: 400 });
  try {
    if (language === "javascript") return NextResponse.json({ results: runJs(code, fnName, tests), engine: "local-js" });
    const results = await runPython(code, fnName, tests);
    return NextResponse.json({ results, engine: "local-python" });
  } catch (e) {
    return NextResponse.json({
      results: tests.map((t) => ({ input: t.input, expected: t.expected, actual: "", passed: false, hidden: t.hidden })),
      error: `Python run failed: ${e instanceof Error ? e.message : String(e)}`,
      engine: "local-python-error",
    });
  }
}
