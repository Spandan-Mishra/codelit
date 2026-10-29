import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outputsMatch } from "@/lib/runner";
import { getProblem } from "@/lib/problems";
import type { TestCase } from "@/lib/types";

function toCamel(s: string) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function serializeJs(v: unknown): string {
  if (typeof v === "boolean") return v ? "True" : "False";
  return JSON.stringify(v) ?? String(v);
}

function execTimeout(cmd: string, args: string[], opts: { timeout: number; cwd?: string }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts.timeout, maxBuffer: 256 * 1024, cwd: opts.cwd }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error((stderr || err.message).trim().split("\n").slice(-2).join(" ")));
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
    }).on("error", reject);
  });
}

// Python: candidate code lives in its own module file, the driver imports it.
// Appended test lines can never be swallowed by unfinished brackets/strings
// in the candidate, which was the IndentationError source. Demo-grade
// isolation (timeout, no site access needed); harden before real users.
async function runPython(code: string, fnName: string, tests: TestCase[]) {
  const normalized = code.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\s+$/, "") + "\n";
  const dir = await mkdtemp(join(tmpdir(), "codelit-py-"));
  try {
    await writeFile(join(dir, "solution.py"), normalized);
    const calls = tests
      .map((t) => `try:\n    print(repr(solution.${t.input}), flush=True)\nexcept Exception as e:\n    print("ERROR: " + str(e), flush=True)`)
      .join("\n");
    const { stdout } = await execTimeout("python3", ["-c", `import solution\n${calls}`], { timeout: 8000, cwd: dir });
    const lines = stdout.split("\n");
    return tests.map((t, i) => {
      const actual = (lines[i] ?? "").trim();
      return { input: t.input, expected: t.expected, actual, passed: outputsMatch(actual, t.expected, fnName), hidden: t.hidden };
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Python-style test expr -> C++ expr for our problem set:
// [2,7] -> {2,7}, 's' -> "s", True -> true. String contents in our tests
// hold no brackets, so a flat replace is enough for now.
function pyExprToCpp(expr: string): string {
  return expr.replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/'/g, '"').replace(/\[/g, "{").replace(/\]/g, "}");
}

const CPP_PRELUDE = `#include <bits/stdc++.h>
using namespace std;
string pvec(const vector<int>& v){string s="[";for(size_t i=0;i<v.size();i++){if(i)s+=", ";s+=to_string(v[i]);}return s+"]";}
string pvecvec(const vector<vector<int>>& m){string s="[";for(size_t i=0;i<m.size();i++){if(i)s+=", ";s+=pvec(m[i]);}return s+"]";}
string pgroups(vector<vector<string>> g){for(auto& x:g){sort(x.begin(),x.end());}sort(g.begin(),g.end());string s="groups:";for(size_t i=0;i<g.size();i++){if(i)s+=" | ";for(size_t j=0;j<g[i].size();j++){if(j)s+=",";s+=g[i][j];}}return s;}
`;

async function runCpp(code: string, fnName: string, tests: TestCase[], ret: string) {
  const printer = ret === "vecvec" ? "pvecvec" : ret === "int" ? "to_string" : ret === "groups" ? "pgroups" : "pvec";
  const dir = await mkdtemp(join(tmpdir(), "codelit-cpp-"));
  try {
    const calls = tests
      .map((t) => {
        const expr = pyExprToCpp(t.input);
        const call = ret === "bool" ? `(${expr} ? string("True") : string("False"))` : `${printer}(${expr})`;
        return `try{cout<<${call}<<endl;}catch(...){cout<<"ERROR: exception"<<endl;}`;
      })
      .join("\n");
    await writeFile(join(dir, "solution.cpp"), `${CPP_PRELUDE}${code}\nint main(){${calls}return 0;}\n`);
    await execTimeout("g++", ["-std=c++17", "-O2", "-o", "sol", "solution.cpp"], { timeout: 20000, cwd: dir });
    const { stdout } = await execTimeout("./sol", [], { timeout: 5000, cwd: dir });
    const lines = stdout.split("\n");
    return tests.map((t, i) => {
      const actual = (lines[i] ?? "").trim();
      return { input: t.input, expected: t.expected, actual: actual.startsWith("ERROR") ? actual : actual, passed: outputsMatch(actual, t.expected, fnName), hidden: t.hidden };
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
  const { language, code, fnName, tests, problemId } = body as {
    language: "python" | "javascript" | "c++";
    code: string;
    fnName: string;
    tests: TestCase[];
    problemId?: string;
  };
  if (!code || !fnName || !Array.isArray(tests)) return NextResponse.json({ results: [], error: "Missing code/tests", engine: "none" }, { status: 400 });
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
      error: `Run failed: ${e instanceof Error ? e.message : String(e)}`,
      engine: "local-error",
    });
  }
}
