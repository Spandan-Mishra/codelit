// Claude adapter: Phase-2 placeholder behind the SAME interface as codex.mjs.
// It detects the CLI and reports capabilities honestly (validated: false),
// but refuses turns until the Agent SDK embedding is validated against a
// pinned version. Missing capability is explicit — never a silent fallback.

import { spawnSync } from "node:child_process";

export const id = "claude";

export async function detect() {
  try {
    const out = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 10000 });
    const version = (out.stdout || out.stderr || "").trim().slice(0, 40) || "unknown";
    if (out.status !== 0) throw new Error("claude --version failed");
    return { found: true, version };
  } catch {
    return { found: false, hint: "Install Claude Code and run `claude login` (subscription) first." };
  }
}

export async function capabilities() {
  const d = await detect();
  return {
    adapter: "claude",
    adapterVersion: d.found ? d.version : "missing",
    textDeltas: false,
    toolArgs: false,
    toolResults: false,
    fileDiffs: false,
    nativeResume: false,
    usageReporting: false,
    workspaceRestrictions: false,
    approvalKinds: [],
    validated: false,
    installed: d.found,
    ready: false,
    status: d.found ? "unsupported" : "missing",
    message: d.found ? UNREADY : d.hint,
    models: [],
  };
}

const UNREADY = "Claude Code is installed, but this connector has no supported Claude execution adapter. CLI installation does not enable solving. Select a ready Codex adapter.";

export async function probe() {
  const d = await detect();
  return d.found
    ? { ok: false, error: UNREADY }
    : { ok: false, error: d.hint };
}

export async function start() { throw new Error(UNREADY); }
export async function resume() { throw new Error(UNREADY); }
export async function turn() { throw new Error(UNREADY); }
export async function interrupt() {}
export async function decideApproval() { throw new Error(UNREADY); }
export function state() { return "closed"; }
export async function close() {}
export function onEvent() {}
