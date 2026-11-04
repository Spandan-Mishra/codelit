// Muse adapter: drives `muse exec --json` (headless Muse) per
// turn and emits normalized Codelit events. Same contract as codex.mjs:
//   detect(), capabilities(), probe(), start(), turn(), interrupt(),
//   resume(), decideApproval(), state(), close(), onEvent()
// Auth stays inside Muse (`muse login`, or META_API_KEY). Codelit never
// receives tokens. Each turn is one headless exec rooted at the attempt
// workspace via --workspace; conversation continuity comes from the files
// (TASK.md + current solution), so nativeResume is honestly false.
// Approvals are not surfaced in this version (approvalKinds: []): Muse's
// own workspace permission policy governs tool use.

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const id = "muse";

export const MUSE_MODELS = [
  { id: "muse-wonder-1.0", label: "Muse Wonder 1.0" },
  { id: "muse-spark-1.3", label: "Muse Spark 1.3" },
  { id: "muse-spark-1.3-contributor", label: "Muse Spark 1.3 Contributor" },
  { id: "muse-spark-1.2", label: "Muse Spark 1.2" },
  { id: "muse-spark-1.2-contributor", label: "Muse Spark 1.2 Contributor" },
];

export async function detect() {
  try {
    const out = spawnSync("muse", ["--version"], { encoding: "utf8", timeout: 10000 });
    const version = (out.stdout || out.stderr || "").trim().slice(0, 60) || "unknown";
    if (out.status !== 0) throw new Error("muse --version failed");
    return { found: true, version };
  } catch {
    return { found: false, hint: "Install Muse (the `muse` CLI) and run `muse login` first." };
  }
}

function usageOutput() {
  try {
    const out = spawnSync("muse", ["usage"], { encoding: "utf8", timeout: 20000 });
    return `${out.stdout || ""}\n${out.stderr || ""}`;
  } catch {
    return "";
  }
}

// `muse usage` reports subscription allowance, which can read
// "no_allowance" even when `muse login` succeeded and turns work (verified
// live). The saved credential file is the reliable signed-in signal.
export function defaultHasCredential(env = process.env) {
  const configHome = env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return existsSync(path.join(configHome, "muse", "auth.json"));
}

// Injectable discovery keeps protocol regression tests offline, mirroring
// codex.createDiscovery.
export function createDiscovery({ detectRuntime = detect, usageRuntime = usageOutput, hasCredential = defaultHasCredential, env = process.env } = {}) {
  return async function discover() {
    const d = await detectRuntime();
    const base = { installed: d.found, ready: false, models: [] };
    if (!d.found) return { ...base, status: "missing", message: d.hint };
    if (env.META_API_KEY) {
      return { installed: true, ready: true, status: "ready", models: MUSE_MODELS,
        message: "Muse is ready (META_API_KEY configured). Model list is the local Muse catalog." };
    }
    if (hasCredential(env)) {
      return { installed: true, ready: true, status: "ready", models: MUSE_MODELS,
        message: "Muse is ready (signed in). Model list is the local Muse catalog." };
    }
    const usage = await usageRuntime();
    if (usage && !/no_allowance|not logged|no subscription|sign in|log in/i.test(usage)) {
      return { installed: true, ready: true, status: "ready", models: MUSE_MODELS,
        message: "Muse is ready (signed in). Model list is the local Muse catalog." };
    }
    return { ...base, status: "unauthenticated",
      message: "Muse is installed but not signed in. Run `codelit-connect login --provider muse` (or set META_API_KEY), then refresh." };
  };
}

export const discover = createDiscovery();

export async function capabilities() {
  const d = await detect();
  return {
    adapter: "muse", adapterVersion: d.found ? d.version : "missing",
    textDeltas: true, toolArgs: false, toolResults: false, fileDiffs: false,
    traceLimits: { messageJsonChars: 24000, deltaTextJsonChars: 6000, deltaIncrementJsonChars: 500, toolFieldJsonChars: 1800, explicitTruncation: true,
      toolKinds: [], reasoning: false },
    processContainment: process.platform === "win32" ? "direct-child-only" : "process-group",
    nativeResume: false, usageReporting: true, workspaceRestrictions: true,
    approvalKinds: [], validated: false,
    ...await discover(),
  };
}

/** Read-only local preflight. No inference. */
export async function probe() {
  const result = await discover();
  return { ok: result.ready, ...result };
}

function sessions() {
  if (!globalThis.__museSessions) globalThis.__museSessions = new Map();
  return globalThis.__museSessions;
}

let emit = () => {};
export function onEvent(cb) { emit = cb; }

function ev(session, type, payload = {}, turnId = null) {
  emit({
    type, nativeSessionId: session.threadId, turnId,
    adapter: "muse", model: session.model,
    payload, sourceTime: Date.now(),
  });
}

// Map one `muse exec --json` record to zero or more normalized events.
// Pure and exported for offline regression tests.
export function mapRecord(session, record) {
  const type = record?.payload_type;
  const p = record?.payload || {};
  const out = [];
  if (type === "run.lifecycle.started" && !session.started) {
    session.started = true;
    out.push(["turn.started", {}]);
  } else if (type === "run.output.delta" && typeof p.text === "string") {
    session.text = (session.text || "") + p.text;
    out.push(["message.delta", { text: session.text, delta: p.text }]);
  } else if (type === "task.lifecycle.side_effect_intent" && typeof p.operation === "string") {
    out.push(["tool.requested", { name: p.operation, summary: p.operation }]);
  } else if (type === "run.terminal.completed") {
    const text = typeof p.text === "string" ? p.text : session.text || "";
    if (text) out.push(["message.final", { text }]);
    out.push(["turn.completed", { status: "completed" }]);
    session.terminal = true;
  } else if (type === "run.terminal.failed" || type === "run.terminal.error") {
    out.push(["turn.failed", { error: typeof p.reason === "string" ? p.reason : "Muse turn failed; check local authentication, model access and CLI configuration." }]);
    session.terminal = true;
  }
  return out;
}

export async function start({ cwd, model } = {}) {
  const threadId = `muse_${randomUUID()}`;
  sessions().set(threadId, { threadId, cwd, model: model || null, state: "idle", child: null, turnId: null, text: "", started: false, terminal: false });
  return { nativeSessionId: threadId, model: model || null };
}

export async function resume(threadId, { cwd, model } = {}) {
  // No native conversation resume: recreate the session record against the
  // same workspace; TASK.md and the solution file carry the context.
  if (!sessions().has(threadId)) {
    sessions().set(threadId, { threadId, cwd, model: model || null, state: "idle", child: null, turnId: null, text: "", started: false, terminal: false });
  }
  const s = sessions().get(threadId);
  if (cwd) s.cwd = cwd;
  if (model) s.model = model;
  s.state = "idle";
  return { nativeSessionId: threadId, model: s.model };
}

// Starts the turn and returns as soon as the process is spawned — exactly
// like the Codex adapter. Completion streams through onEvent. Awaiting the
// full exec here would block the connector's poll loop past its lease
// deadline and get the connector shut down mid-turn.
export async function turn(threadId, text, { turnId, model } = {}) {
  const s = sessions().get(threadId);
  if (!s) throw new Error("Muse native session is closed; reconnect before sending a turn");
  if (s.state === "running") throw new Error("Muse already has an active turn");
  s.model = model || s.model;
  const active = { turnId, text: "", started: false, terminal: false, interrupted: false };
  s.active = active;
  s.state = "running";
  const args = ["exec", "--json", "--trust-workspace", "--workspace", s.cwd, ...(s.model ? ["--model", s.model] : []), text];
  await new Promise((resolve, reject) => {
    const child = spawn("muse", args, {
      cwd: s.cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    s.child = child;
    let buffer = "";
    let stderr = "";
    let spawned = false;
    child.on("spawn", () => { spawned = true; resolve(); });
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const record = JSON.parse(line);
          for (const [type, payload] of mapRecord(active, record)) ev(s, type, payload, turnId);
        } catch { /* non-JSON noise on stdout is not an event */ }
      }
    });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-2000); });
    child.on("error", (err) => {
      if (!spawned) { s.state = "idle"; s.active = null; s.child = null; reject(new Error(`Could not start Muse: ${err.message}`)); }
    });
    child.on("close", (code) => {
      if (s.active !== active) return; // close() already settled this turn
      s.active = null;
      s.child = null;
      s.state = s.state === "closed" ? "closed" : "idle";
      if (active.terminal) return;
      active.terminal = true;
      if (active.interrupted) {
        ev(s, "turn.interrupted", { reason: "interrupted by user" }, turnId);
      } else if (code === 0 && active.text) {
        ev(s, "message.final", { text: active.text }, turnId);
        ev(s, "turn.completed", { status: "completed" }, turnId);
      } else {
        ev(s, "turn.failed", { error: stderr.trim() ? "Muse exited without completing the turn. Check `muse login` and model access." : "Muse exited without completing the turn; check local authentication, model access and CLI configuration." }, turnId);
      }
    });
  });
}

function killChild(s, signal) {
  const child = s.child;
  if (!child) return;
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch { /* already exited */ }
}

export async function interrupt(threadId) {
  const s = sessions().get(threadId);
  if (!s || s.state !== "running") return;
  if (s.active) s.active.interrupted = true;
  killChild(s, "SIGINT");
  setTimeout(() => killChild(s, "SIGTERM"), 1500).unref?.();
}

export async function decideApproval() {
  throw new Error("Muse turns do not surface connector approvals in this version; Muse's workspace permission policy governs tool use.");
}

export function state(threadId) {
  const s = sessions().get(threadId);
  return s ? s.state : "closed";
}

export async function close(threadId) {
  const s = sessions().get(threadId);
  if (!s) return;
  if (s.child) {
    const active = s.active;
    killChild(s, "SIGTERM");
    s.child = null;
    if (active && !active.terminal) {
      active.terminal = true;
      ev(s, "turn.failed", { completion: "unknown", error: "Native session closed before confirmed turn completion." }, active.turnId);
    }
    s.active = null;
  }
  s.state = "closed";
  sessions().delete(threadId);
}

export async function shutdown() {
  return Promise.all([...sessions().keys()].map(async (threadId) => ({ threadId, ...(await close(threadId), {}) })));
}
