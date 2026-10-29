// Codex adapter: drives `codex app-server` over stdio JSON-RPC and emits
// normalized Codelit events. Protocol pinned against codex app-server
// generate-ts output (tested: 0.164.0 — rerun probe after CLI upgrades).
//
// Adapter contract (same shape as claude.mjs):
//   detect(), capabilities(), probe(), start(), turn(), interrupt(),
//   resume(), decideApproval(), state(), close(), onEvent()
// Auth stays inside Codex (managed ChatGPT/API key login on this machine).
// Codelit never receives tokens. No blanket auto-approve: approvalPolicy is
// inherited from the user's own Codex config; approvals surface in Codelit.

import { execFileSync, spawnSync } from "node:child_process";
import { startRpc } from "./rpc.mjs";

const CLIENT_INFO = { name: "codelit-connect", title: "Codelit connector", version: "0.1.0" };

export const id = "codex";

export async function detect() {
  try {
    const out = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 10000 });
    const version = (out.stdout || out.stderr || "").trim().slice(0, 40) || "unknown";
    if (out.status !== 0) throw new Error("codex --version failed");
    return { found: true, version };
  } catch {
    return { found: false, hint: "Install Codex (https://developers.openai.com/codex) and run `codex login`." };
  }
}

export async function capabilities() {
  const d = await detect();
  return {
    adapter: "codex",
    adapterVersion: d.found ? d.version : "missing",
    textDeltas: true,
    toolArgs: true,
    toolResults: true,
    fileDiffs: false, // app-server streams fileChange items; unified diffs are not exposed
    nativeResume: true,
    usageReporting: false, // token usage is not exposed on turn events; labeled unavailable
    workspaceRestrictions: true, // per-thread cwd; sandbox inherits user config
    approvalKinds: ["command", "file", "permissions"],
    validated: false,
  };
}

/** Read-only validation: handshake + model/list. No turn, no inference. */
export async function probe() {
  const rpc = startRpc("codex", ["app-server"]);
  const done = (v) => { rpc.close(); return v; };
  try {
    await rpc.request("initialize", { clientInfo: CLIENT_INFO });
    await rpc.notify("initialized", {});
    const models = await rpc.request("model/list", {});
    const ids = models && Array.isArray(models.data) ? models.data.map((m) => m.id).filter(Boolean).slice(0, 20) : [];
    return done({ ok: true, models: ids });
  } catch (e) {
    return done({ ok: false, error: e && e.message ? e.message : String(e) });
  }
}

function sessions() {
  if (!globalThis.__codexSessions) globalThis.__codexSessions = new Map();
  return globalThis.__codexSessions;
}

let emit = () => {};
export function onEvent(cb) { emit = cb; }

function ev(session, type, payload = {}, turnId = null) {
  emit({
    type, nativeSessionId: session.threadId, turnId,
    adapter: "codex", model: session.model,
    payload, sourceTime: Date.now(),
  });
}

function summarizeItem(item) {
  if (!item || typeof item !== "object") return {};
  const t = item.type || "";
  if (t === "agentMessage" && typeof item.text === "string") return { text: item.text.slice(0, 4000) };
  if (t === "commandExecution") return { name: item.command || "shell", summary: (item.aggregatedOutput || item.output || "").slice(-500), status: item.status };
  if (t === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    return { name: "edit", summary: changes.map((c) => c.path).filter(Boolean).slice(0, 5).join(", ") };
  }
  if (t === "mcpToolCall") return { name: item.name || item.server || "mcp", summary: (item.result || item.error || "").slice(-300) };
  return { name: t || "tool" };
}

export async function start({ cwd, model }) {
  const rpc = startRpc("codex", ["app-server"]);
  const session = { rpc, threadId: null, model: model || null, state: "starting", pendingApprovals: new Map(), exited: false };

  rpc.on("notification", (msg) => routeNotification(session, msg));
  rpc.on("serverRequest", (msg) => routeServerRequest(session, msg));
  rpc.on("exit", () => {
    session.exited = true;
    if (session.state === "running" || session.state === "waiting_approval") {
      session.state = "failed";
      ev(session, "turn.failed", { error: "codex process exited mid-turn" }, session.turnId);
    }
  });

  await rpc.request("initialize", { clientInfo: CLIENT_INFO });
  await rpc.notify("initialized", {});
  const params = { cwd };
  if (model) params.model = model;
  const res = await rpc.request("thread/start", params);
  session.threadId = res && res.thread && res.thread.id;
  if (!session.threadId) throw new Error("thread/start returned no thread id");
  session.state = "idle";
  sessions().set(session.threadId, session);
  return { nativeSessionId: session.threadId };
}

export async function resume(threadId, { cwd } = {}) {
  const rpc = startRpc("codex", ["app-server"]);
  const session = { rpc, threadId, model: null, state: "starting", pendingApprovals: new Map(), exited: false };
  rpc.on("notification", (msg) => routeNotification(session, msg));
  rpc.on("serverRequest", (msg) => routeServerRequest(session, msg));
  rpc.on("exit", () => { session.exited = true; session.state = "failed"; });
  await rpc.request("initialize", { clientInfo: CLIENT_INFO });
  await rpc.notify("initialized", {});
  await rpc.request("thread/resume", { threadId });
  session.state = "idle";
  sessions().set(threadId, session);
  return { nativeSessionId: threadId };
}

export async function turn(threadId, text, { turnId } = {}) {
  const s = sessions().get(threadId);
  if (!s) throw new Error("unknown native session");
  s.turnId = turnId;
  s.state = "running";
  ev(s, "turn.started", {}, turnId);
  await s.rpc.request("turn/start", { threadId, input: [{ type: "text", text }] });
}

export async function interrupt(threadId) {
  const s = sessions().get(threadId);
  if (!s || s.state === "idle") return;
  await s.rpc.request("turn/interrupt", { threadId }).catch(() => {});
}

/** User decision from Codelit: allow-once -> accept (this request only). */
export async function decideApproval(threadId, key, decision) {
  const s = sessions().get(threadId);
  if (!s) throw new Error("unknown native session");
  const pend = s.pendingApprovals.get(key);
  if (!pend) throw new Error("approval already answered or expired");
  s.pendingApprovals.delete(key);
  if (pend.method === "item/permissions/requestApproval") {
    if (decision === "allow-once") {
      await s.rpc.respond(pend.rpcId, { permissions: pend.requested, scope: "turn" });
    } else {
      await s.rpc.respond(pend.rpcId, { permissions: {}, scope: "turn" });
    }
    return;
  }
  await s.rpc.respond(pend.rpcId, { decision: decision === "allow-once" ? "accept" : "decline" });
}

export function state(threadId) {
  const s = sessions().get(threadId);
  return s ? s.state : "closed";
}

export async function close(threadId) {
  const s = sessions().get(threadId);
  if (!s) return;
  sessions().delete(threadId);
  s.rpc.close();
}

function routeNotification(s, msg) {
  const p = msg.params || {};
  switch (msg.method) {
    case "item/agentMessage/delta":
      if (p.delta && typeof p.delta.text === "string") {
        ev(s, "message.delta", { text: p.delta.text.slice(0, 2000) }, s.turnId);
      }
      break;
    case "item/started": {
      const kind = p.item && p.item.type;
      if (kind === "commandExecution" || kind === "fileChange" || kind === "mcpToolCall") {
        ev(s, "tool.requested", summarizeItem(p.item), s.turnId);
      }
      break;
    }
    case "item/completed": {
      const item = p.item || {};
      const kind = item.type;
      if (kind === "agentMessage") {
        ev(s, "message.final", summarizeItem(item), s.turnId);
      } else if (kind === "commandExecution" || kind === "fileChange" || kind === "mcpToolCall") {
        const st = item.status;
        ev(s, st === "failed" ? "tool.failed" : st === "declined" ? "tool.denied" : "tool.completed", summarizeItem(item), s.turnId);
      }
      break;
    }
    case "turn/completed":
      s.state = "idle";
      ev(s, "turn.completed", { status: (p.turn && p.turn.status) || "completed" }, s.turnId);
      s.turnId = null;
      break;
    case "turn/failed":
      s.state = "idle";
      ev(s, "turn.failed", { error: (p.error && p.error.message) || "turn failed" }, s.turnId);
      s.turnId = null;
      break;
    case "thread/status/changed": {
      const flags = (p.status && p.status.activeFlags) || [];
      if (flags.includes("waitingOnApproval")) s.state = "waiting_approval";
      break;
    }
    default:
      break;
  }
}

function routeServerRequest(s, msg) {
  const p = msg.params || {};
  const key = p.itemId || `${msg.method}:${p.threadId}:${p.turnId}:${Date.now()}`;
  if (msg.method === "item/commandExecution/requestApproval") {
    s.state = "waiting_approval";
    s.pendingApprovals.set(key, { rpcId: msg.id, method: msg.method, requested: null });
    ev(s, "approval.requested", {
      approvalId: key, kind: "command",
      command: p.command || (p.networkApprovalContext ? `network ${p.networkApprovalContext.protocol}://${p.networkApprovalContext.host}` : ""),
      cwd: p.cwd || "", reason: p.reason || "",
      expiresAt: Date.now() + 5 * 60 * 1000,
    }, s.turnId);
  } else if (msg.method === "item/fileChange/requestApproval") {
    s.state = "waiting_approval";
    s.pendingApprovals.set(key, { rpcId: msg.id, method: msg.method, requested: null });
    ev(s, "approval.requested", {
      approvalId: key, kind: "file", path: p.grantRoot || "",
      reason: p.reason || "", expiresAt: Date.now() + 5 * 60 * 1000,
    }, s.turnId);
  } else if (msg.method === "item/permissions/requestApproval") {
    s.state = "waiting_approval";
    s.pendingApprovals.set(key, { rpcId: msg.id, method: msg.method, requested: p.permissions || {} });
    ev(s, "approval.requested", {
      approvalId: key, kind: "permissions", detail: JSON.stringify(p.permissions || {}).slice(0, 300),
      cwd: p.cwd || "", reason: p.reason || "", expiresAt: Date.now() + 5 * 60 * 1000,
    }, s.turnId);
  } else if (msg.method === "item/tool/requestUserInput" || msg.method === "mcpServer/elicitation/request") {
    // MCP elicitation is explicitly unsupported in this MVP: decline safely
    // and say so, rather than guessing an answer schema.
    s.rpc.respond(msg.id, { answers: {} }).catch(() => {});
    ev(s, "message.final", { text: "The agent asked an app-level question this connector cannot relay yet — it was skipped. Ask it to proceed differently." }, s.turnId);
  } else {
    s.rpc.respondError(msg.id, -32601, "unsupported in codelit-connect MVP").catch(() => {});
  }
}
