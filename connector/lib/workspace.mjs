// Challenge workspace: one connector-managed directory per attempt under a
// local base dir. Only released task files live here — hidden tests, future
// stages, and credentials never sync down. All paths are traversal-checked
// (resolve + prefix + realpath); writes are atomic (tmp + rename).

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

export function baseDir() {
  return process.env.CODELIT_BASE || path.join(os.homedir(), ".codelit", "attempts");
}

export function attemptDir(attemptId) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(attemptId)) throw new Error("bad attempt id");
  return path.join(baseDir(), attemptId);
}

export function extFor(language) {
  return language === "python" ? ".py" : language === "c++" ? ".cpp" : ".js";
}

export function solutionName(language) {
  return `solution${extFor(language)}`;
}

/** Resolve a workspace-relative name; throws on traversal/symlink escape. */
export async function safeJoin(dir, name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 120) throw new Error("bad path");
  const p = path.resolve(dir, name);
  const realDir = await fs.realpath(dir).catch(() => dir);
  const realP = await fs.realpath(p).catch(() => p);
  if (p !== path.join(dir, path.basename(name)) || !realP.startsWith(realDir + path.sep)) {
    throw new Error("path escapes workspace");
  }
  return p;
}

export function hashOf(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function readMeta(dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
  } catch {
    return { rev: -1 };
  }
}

async function writeMeta(dir, meta) {
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta));
}

async function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, file);
}

/** Ensure the attempt dir exists with starter files. Returns {rev}. */
export async function initAttempt(dir, context) {
  await fs.mkdir(dir, { recursive: true });
  const meta = await readMeta(dir);
  if (meta.rev !== undefined && meta.rev >= 0) return { rev: meta.rev };
  const sol = await safeJoin(dir, solutionName(context.language));
  await atomicWrite(sol, context.stub || "");
  await atomicWrite(await safeJoin(dir, "TASK.md"), `# ${context.title} (stage ${context.stage})\n\n${context.brief}\n`);
  const next = { rev: 0, language: context.language, hash: hashOf(context.stub || ""), inFlight: null };
  await writeMeta(dir, next);
  return { rev: 0 };
}

export async function readSolution(dir, language) {
  const sol = await safeJoin(dir, solutionName(language));
  const content = await fs.readFile(sol, "utf8").catch(() => "");
  const meta = await readMeta(dir);
  return { content, rev: typeof meta.rev === "number" ? meta.rev : -1, hash: hashOf(content) };
}

/**
 * Apply a browser-flushed edit only when baseRev matches the current rev;
 * otherwise report a conflict and keep the agent's bytes. Never overwrite
 * silently. Returns {applied, rev} or {conflict:true, rev}.
 */
export async function applyBrowserEdit(dir, language, code, baseRev) {
  const meta = await readMeta(dir);
  const cur = typeof meta.rev === "number" ? meta.rev : -1;
  if (baseRev !== cur) return { conflict: true, rev: cur };
  const sol = await safeJoin(dir, solutionName(language));
  await atomicWrite(sol, code);
  const next = { ...meta, rev: cur + 1, hash: hashOf(code), language };
  await writeMeta(dir, next);
  return { applied: true, rev: next.rev };
}

/** Record an agent-side file change observed after a turn/tool. */
export async function recordAgentWrite(dir, language) {
  const { content } = await readSolution(dir, language);
  const meta = await readMeta(dir);
  const cur = typeof meta.rev === "number" ? meta.rev : -1;
  const h = hashOf(content);
  if (meta.hash === h) return { rev: cur, content, changed: false };
  const next = { ...meta, rev: cur + 1, hash: h, language };
  await writeMeta(dir, next);
  return { rev: next.rev, content, changed: true };
}

export function setInFlight(dir, turnId) {
  return readMeta(dir).then((m) => writeMeta(dir, { ...m, inFlight: turnId }));
}

/** Run RELEASED visible tests locally (python + javascript; c++ best-effort).
 *  Returns {passed, total, summary}. Never touches hidden tests. */
export async function runVisible(dir, language, tests, fnName) {
  const visible = tests.filter((t) => !t.hidden).slice(0, 12);
  if (language === "python") {
    const calls = visible.map((t, i) =>
      `try:\n    _b=io.StringIO()\n    with contextlib.redirect_stdout(_b):\n        _r=solution.${t.input}\n    print("@@${i}@@"+repr(_r),flush=True)\nexcept Exception as e:\n    print("@@${i}@@ERROR: "+str(e),flush=True)`).join("\n");
    const driver = `import solution,io,contextlib\n${calls}\n`;
    const r = spawnSync("python3", ["-c", driver], { cwd: dir, timeout: 20000, encoding: "utf8" });
    return compareMarked(r.stdout || "", visible);
  }
  if (language === "javascript") {
    const camel = String(fnName || "").replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const src = await fs.readFile(await safeJoin(dir, solutionName("javascript")), "utf8").catch(() => "");
    const shim = visible.map((t, i) => {
      const expr = t.input.replace(fnName, camel).replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false");
      return `try{console.log("@@"+"${i}"+"@@"+JSON.stringify((${expr})))}catch(e){console.log("@@"+"${i}"+"@@ERROR: "+e.message)}`;
    }).join("\n");
    const r = spawnSync("node", ["-e", `${src}\n${shim}\n`], { cwd: dir, timeout: 20000, encoding: "utf8" });
    return compareMarked(r.stdout || "", visible);
  }
  return { passed: 0, total: visible.length, summary: "c++ local checks need g++; ask the agent to verify instead" };
}

function compareMarked(stdout, tests) {
  const lines = stdout.split("\n");
  let passed = 0;
  for (let i = 0; i < tests.length; i++) {
    const tag = `@@${i}@@`;
    const line = [...lines].reverse().find((l) => l.startsWith(tag)) || "";
    if (line.slice(tag.length).trim() === tests[i].expected.trim()) passed++;
  }
  return { passed, total: tests.length, summary: `${passed}/${tests.length} visible green (local, not official)` };
}
