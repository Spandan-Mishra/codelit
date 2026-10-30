// Candidate code runs exclusively in disposable OS namespaces; never in the web process.
import { outputsMatch } from "./runner";
import type { TestCase } from "./types";
import { runSandbox, type SandboxResult } from "./execution/sandbox";
export { ExecutionUnavailableError, isExecutionUnavailable } from "./execution/sandbox";

export interface ExecResult {
  input: string;
  expected: string;
  actual: string;
  passed: boolean;
  hidden?: boolean;
}

function results(output: SandboxResult, fnName: string, tests: TestCase[]): ExecResult[] {
  const lines = output.stdout.split("\n");
  return tests.map((t, i) => {
    const tag = `@@${i}@@`;
    const line = [...lines].reverse().find(l => l.startsWith(tag));
    const actual = output.failure ? `ERROR: ${output.failure}` : line?.slice(tag.length).trim() ?? "ERROR: no result returned";
    return { input: t.input, expected: t.expected, actual, passed: !output.failure && outputsMatch(actual, t.expected, fnName), hidden: t.hidden };
  });
}

export async function runPython(code: string, fnName: string, tests: TestCase[]): Promise<ExecResult[]> {
  const normalized = code.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\s+$/, "") + "\n";
  const calls = tests.map((t, i) =>
    `try:\n    with contextlib.redirect_stdout(io.StringIO()):\n        _r=solution.${t.input}\n    print("@@${i}@@" + repr(_r), flush=True)\nexcept Exception as e:\n    print("@@${i}@@ERROR: " + str(e), flush=True)`
  ).join("\n");
  const driver = `import sys, io, contextlib\nsys.path.insert(0, "/submission")\nwith contextlib.redirect_stdout(io.StringIO()):\n    import solution\n${calls}\n`;
  return results(await runSandbox("python", { "solution.py": normalized, "driver.py": driver }), fnName, tests);
}

function pyExprToCpp(expr: string): string {
  return expr.replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/'/g, '"').replace(/\[/g, "{").replace(/\]/g, "}");
}

const CPP_PRELUDE = `#include <bits/stdc++.h>
using namespace std;
string pvec(const vector<int>& v){string s="[";for(size_t i=0;i<v.size();i++){if(i)s+=", ";s+=to_string(v[i]);}return s+"]";}
string pvecvec(const vector<vector<int>>& m){string s="[";for(size_t i=0;i<m.size();i++){if(i)s+=", ";s+=pvec(m[i]);}return s+"]";}
string pgroups(vector<vector<string>> g){for(auto& x:g){sort(x.begin(),x.end());}sort(g.begin(),g.end());string s="groups:";for(size_t i=0;i<g.size();i++){if(i)s+=" | ";for(size_t j=0;j<g[i].size();j++){if(j)s+=",";s+=g[i][j];}}return s;}
string pstr(const string& s){ostringstream o;o<<quoted(s);return o.str();}
`;

export async function runCpp(code: string, fnName: string, tests: TestCase[], ret: string): Promise<ExecResult[]> {
  const printer = ret === "vecvec" ? "pvecvec" : ret === "int" ? "to_string" : ret === "groups" ? "pgroups" : ret === "str" ? "pstr" : "pvec";
  const calls = tests.map((t, i) => {
    const expr = pyExprToCpp(t.input);
    const call = ret === "bool" ? `(${expr} ? string("True") : string("False"))` : `${printer}(${expr})`;
    return `try{string _a${i}=${call};cout<<"@@${i}@@"<<_a${i}<<endl;}catch(...){cout<<"@@${i}@@ERROR: exception"<<endl;}`;
  }).join("\n");
  return results(await runSandbox("cpp", { "solution.cpp": `${CPP_PRELUDE}${code}\nint main(){${calls}return 0;}\n` }), fnName, tests);
}

export async function runJs(code: string, fnName: string, tests: TestCase[]): Promise<ExecResult[]> {
  const jsFn = fnName.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const calls = tests.map((t, i) => {
    const expr = t.input.replaceAll(fnName, jsFn).replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false");
    // Preserve the old per-test function scope and return-value serialization.
    return `try { const value = (() => { ${code}\nreturn (${expr}); })(); const actual = typeof value === "boolean" ? (value ? "True" : "False") : JSON.stringify(value) ?? String(value); console.log("@@${i}@@" + actual); } catch(e) { console.log("@@${i}@@ERROR: " + e.message); }`;
  }).join("\n");
  return results(await runSandbox("js", { "driver.cjs": calls }), fnName, tests);
}
