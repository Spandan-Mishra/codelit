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

import { spawnSync } from "node:child_process";
import { startRpc } from "./rpc.mjs";

const CLIENT_INFO = { name: "codelit-connect", title: "Codelit connector", version: "0.2.0" };

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

// Injectable transport/version probe keeps protocol regression tests offline.
export function createDiscovery({ detectRuntime = detect, rpcFactory = startRpc } = {}) {
  return async function discover() {
    const d = await detectRuntime();
    const base = { installed: d.found, ready: false, models: [] };
    if (!d.found) return { ...base, status: "missing", message: d.hint };
    let rpc;
    try {
      rpc = rpcFactory("codex", ["app-server"]);
      await rpc.request("initialize", { clientInfo: CLIENT_INFO });
      await rpc.notify("initialized", {});
      const account = await rpc.request("account/read", { refreshToken: false });
      if (!account || typeof account.requiresOpenaiAuth !== "boolean") {
        throw new Error("Unsupported account/read response");
      }
      if (account.requiresOpenaiAuth && !account.account) {
        return { ...base, status: "unauthenticated", message: "Codex requires local authentication. Run `codex login`, then refresh the connector." };
      }
      const models = [];
      let cursor;
      const seen = new Set();
      for (let page = 0; page < 20; page++) {
        const result = await rpc.request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(result?.data)) throw new Error("Unsupported model/list response");
        for (const m of result.data) {
          // `model` is the inference slug; `id` may be a catalog identifier.
          const id = typeof m.model === "string" && m.model ? m.model : m.id;
          if (!m.hidden && typeof id === "string" && id.length <= 120 && !models.some((v) => v.id === id)) {
            models.push({ id, label: typeof m.displayName === "string" ? m.displayName.slice(0, 200) : id });
          }
        }
        cursor = result.nextCursor;
        if (!cursor) break;
        if (seen.has(cursor) || page === 19) throw new Error("Model catalog pagination did not finish");
        seen.add(cursor);
      }
      if (!models.length) throw new Error("Codex returned no visible models");
      return { installed: true, ready: true, status: "ready", models,
        message: "Codex local preflight passed. Model catalog is not an entitlement or inference-health check." };
    } catch {
      // Avoid forwarding raw provider errors containing local config/auth data.
      return { ...base, status: "error", message: "Codex App Server preflight failed. Check `codex --version`, local Codex configuration, and `codex login status`; upgrade Codex if its protocol is unsupported." };
    } finally { await rpc?.close(); }
  };
}

export const discover = createDiscovery();
export async function capabilities() {
  const d = await detect();
  return {
    adapter: "codex", adapterVersion: d.found ? d.version : "missing",
    textDeltas: true, toolArgs: true, toolResults: true, fileDiffs: false,
    traceLimits: { messageJsonChars: 24000, deltaTextJsonChars: 6000, deltaIncrementJsonChars: 500, toolFieldJsonChars: 1800, explicitTruncation: true,
      toolKinds: ["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall"], reasoning: false },
    processContainment: process.platform === "win32" ? "direct-child-only" : "process-group",
    nativeResume: true, usageReporting: false, workspaceRestrictions: true,
    approvalKinds: ["command", "file", "permissions"], validated: false,
    ...await discover(),
  };
}

/** Read-only local preflight. No thread, no turn, no inference. */
export async function probe() {
  const result = await discover();
  return { ok: result.ready, ...result };
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

// Bound encoded JSON, not just characters, so escaped output also fits relay
// limits. Truncated JSON values are an explicit serialized prefix, never a
// deceptively complete object or a tail-only summary.
function bounded(value, limit) {
  const encoded = JSON.stringify(value ?? null);
  if (encoded.length <= limit) return { value, truncated: false };
  const source = typeof value === "string" ? value : encoded;
  let lo = 0, hi = source.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (JSON.stringify(source.slice(0, mid)).length <= limit) lo = mid;
    else hi = mid - 1;
  }
  return { value: source.slice(0, lo), truncated: true, originalChars: source.length,
    retainedChars: lo, encoding: typeof value === "string" ? "text-prefix" : "json-prefix" };
}
function field(name, value, limit = 1800) {
  const result = bounded(value, limit);
  return { [name]: result.value, ...(result.truncated ? { [`${name}Truncation`]: { ...result, value: undefined } } : {}) };
}
function identity(p) {
  const item = p.item || {};
  const itemId = item.id || p.itemId;
  return { nativeTurnId: p.turnId || p.turn?.id, ...(itemId ? { itemId } : {}),
    ...(item.callId || item.call_id || p.callId ? { callId: item.callId || item.call_id || p.callId } : {}) };
}
const TOOL_KINDS = new Set(["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall"]);
function summarizeItem(item) {
  const t = item.type;
  if (t === "agentMessage") return { ...field("text", item.text || "", 24000), nativeMessageId: item.id, phase: item.phase ?? null };
  const base = { callId: item.callId || item.call_id || item.id, status: item.status };
  if (t === "commandExecution") return { ...base, ...field("name", item.command || "shell", 200),
    ...field("args", { command: item.command, cwd: item.cwd }),
    ...field("summary", item.aggregatedOutput ?? item.output ?? "", 500),
    ...field("result", item.aggregatedOutput ?? item.output ?? ""), exitCode: item.exitCode };
  if (t === "fileChange") return { ...base, name: "edit",
    ...field("summary", (item.changes || []).map((c) => c.path).filter(Boolean).join(", "), 500),
    ...field("args", { paths: (item.changes || []).map((c) => c.path) }), ...field("result", item.changes || []) };
  if (t === "mcpToolCall" || t === "dynamicToolCall") return { ...base,
    ...field("name", item.tool || item.name || "mcp", 200), ...field("server", item.server || "", 200),
    ...field("summary", JSON.stringify(item.result ?? item.error ?? item.contentItems ?? ""), 500),
    ...field("args", item.arguments ?? {}), ...field("result", item.result ?? item.error ?? item.contentItems ?? null) };
  return base;
}

function clearApprovals(s) {
  for (const pending of s.pendingApprovals.values()) clearTimeout(pending.timer);
  s.pendingApprovals.clear();
}

function failApprovalResponse(s, pending) {
  if (pending.turnId !== s.turnId || pending.nativeTurnId !== s.nativeTurnId) return;
  const turnId = s.turnId;
  clearApprovals(s);
  s.state = "failed";
  s.turnId = null;
  s.nativeTurnId = null;
  if (turnId) ev(s, "turn.failed", { completion: "unknown", nativeTurnId: pending.nativeTurnId, error: "Could not resolve the native approval request. The agent was closed; reconnect before continuing." }, turnId);
  s.rpc.close();
}

function takeApproval(s, key) {
  const pending = s.pendingApprovals.get(key);
  if (!pending) return null;
  clearTimeout(pending.timer);
  s.pendingApprovals.delete(key);
  if (!s.pendingApprovals.size && s.state === "waiting_approval") s.state = s.turnId ? "running" : "idle";
  return pending;
}

async function answerApproval(s, pending, decision) {
  try {
    const result = pending.method === "item/permissions/requestApproval"
      ? { permissions: decision === "allow-once" ? pending.requested : {}, scope: "turn" }
      : { decision: decision === "allow-once" ? "accept" : "decline" };
    await s.rpc.respond(pending.rpcId, result);
  } catch (error) {
    failApprovalResponse(s, pending);
    throw error;
  }
}

function newSession(rpc, cwd, model, approvalTimeoutMs) {
  if (!Number.isFinite(approvalTimeoutMs) || approvalTimeoutMs <= 0) throw new Error("approvalTimeoutMs must be positive");
  const session = { rpc, cwd, threadId: null, model: model || null, state: "starting", pendingApprovals: new Map(), approvalTimeoutMs, exited: false, closing: false, messages: new Map(), items: new Map(), seenNativeTurns: new Set(), startPending: false, early: [], terminalWaiters: new Set() };
  rpc.on("notification", (msg) => routeNotification(session, msg));
  rpc.on("serverRequest", (msg) => routeServerRequest(session, msg));
  rpc.on("exit", () => {
    clearApprovals(session);
    session.exited = true;
    for (const resolve of session.terminalWaiters) resolve();
    session.terminalWaiters.clear();
    if (session.state === "running" || session.state === "waiting_approval") {
      session.state = "failed";
      ev(session, "turn.failed", { completion: "unknown", nativeTurnId: session.nativeTurnId, error: "Codex process exited mid-turn. Check the local CLI and reconnect; this turn was not retried." }, session.turnId);
      session.turnId = null;
    }
  });
  return session;
}

export async function start({ cwd, model, ephemeral = false, rpcFactory = startRpc, approvalTimeoutMs = 5 * 60 * 1000 }) {
  const rpc = rpcFactory("codex", ["app-server"]);
  const session = newSession(rpc, cwd, model, approvalTimeoutMs);
  try {
    await rpc.request("initialize", { clientInfo: CLIENT_INFO });
    await rpc.notify("initialized", {});
    const res = await rpc.request("thread/start", { cwd, ephemeral, sandbox: "workspace-write", ...(model ? { model } : {}),
      developerInstructions: "You are the Codelit coding agent. Implement requested solutions by editing the solution file in the attempt workspace. A chat reply containing code does not update the submission. Read TASK.md and the current solution before editing. Only released context is available; preserve work from earlier stages." });
    session.threadId = res?.thread?.id;
    if (!session.threadId) throw new Error("thread/start returned no thread id");
    if (res.sandbox?.type !== "workspaceWrite") throw new Error("Codex did not grant workspace-write sandbox capability. Check local Codex policy.");
    session.model = res.model || model || null;
    session.state = "idle";
    sessions().set(session.threadId, session);
    return { nativeSessionId: session.threadId, model: session.model };
  } catch (error) { await rpc.close(); throw error; }
}

export async function resume(threadId, { cwd, model, rpcFactory = startRpc, approvalTimeoutMs = 5 * 60 * 1000 } = {}) {
  const rpc = rpcFactory("codex", ["app-server"]);
  const session = newSession(rpc, cwd, model, approvalTimeoutMs);
  session.threadId = threadId;
  try {
    await rpc.request("initialize", { clientInfo: CLIENT_INFO });
    await rpc.notify("initialized", {});
    const res = await rpc.request("thread/resume", { threadId, cwd, sandbox: "workspace-write", ...(model ? { model } : {}) });
    if (res.sandbox?.type !== "workspaceWrite") throw new Error("Codex resume did not grant workspace-write capability");
    session.model = res.model || model || null;
    session.state = "idle";
    sessions().set(threadId, session);
    return { nativeSessionId: threadId, model: session.model };
  } catch (error) { await rpc.close(); throw error; }
}

export async function turn(threadId, text, { turnId, model, effort } = {}) {
  const s = sessions().get(threadId);
  if (!s || s.exited || s.closing) throw new Error("Codex native session is closed; reconnect before sending a turn");
  if (s.state !== "idle") throw new Error("Codex already has an active turn");
  s.turnId = turnId;
  s.nativeTurnId = null;
  s.started = false;
  s.startPending = true; s.startOverflow = false; s.early = [];
  s.messages.clear(); s.items.clear();
  s.model = model || s.model;
  s.state = "running";
  try {
    const result = await s.rpc.request("turn/start", { threadId, input: [{ type: "text", text, text_elements: [] }],
      cwd: s.cwd, ...(model ? { model } : {}), ...(effort ? { effort } : {}),
      sandboxPolicy: { type: "workspaceWrite", writableRoots: [s.cwd], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } });
    const nativeId = result?.turn?.id;
    if (s.startOverflow || !nativeId || s.seenNativeTurns.has(nativeId)) throw new Error("Invalid or reused native turn/start identity");
    if (s.closing || s.exited) throw new Error("Codex session closed while starting turn");
    s.nativeTurnId = nativeId;
    s.seenNativeTurns.add(nativeId);
    s.startPending = false;
    const early = s.early; s.early = [];
    for (const [kind, msg] of early) {
      if (kind === "request") routeServerRequest(s, msg);
      else routeNotification(s, msg);
    }
  } catch (error) {
    // The command handler owns the single terminal failure event.
    s.state = "idle"; s.turnId = null; s.nativeTurnId = null; s.startPending = false; s.early = [];
    // A timed-out acknowledgement does not prove the native turn never
    // started. Close our child so it cannot keep writing after a failed send.
    await s.rpc.close();
    throw error;
  }
}

export async function interrupt(threadId) {
  const s = sessions().get(threadId);
  if (!s || s.state === "idle") return;
  if (!s.nativeTurnId) throw new Error("Codex has not acknowledged the active turn; retry interrupt shortly");
  await s.rpc.request("turn/interrupt", { threadId, turnId: s.nativeTurnId });
}

/** User decision from Codelit: allow-once -> accept (this request only). */
export async function decideApproval(threadId, key, decision) {
  const s = sessions().get(threadId);
  if (!s) throw new Error("unknown native session");
  const pend = takeApproval(s, key);
  if (!pend) throw new Error("approval already answered or expired");
  await answerApproval(s, pend, decision);
}

export function state(threadId) {
  const s = sessions().get(threadId);
  return s && !s.exited ? s.state : "closed";
}

export async function close(threadId, { interruptTimeoutMs = 250, ...rpcOptions } = {}) {
  const s = sessions().get(threadId);
  if (!s) return;
  if (s.shutdownPromise) return s.shutdownPromise;
  s.closing = true;
  clearApprovals(s);
  s.shutdownPromise = (async () => {
    if (s.turnId && s.nativeTurnId) {
      let timer, terminal;
      const finished = new Promise((resolve) => { terminal = resolve; s.terminalWaiters.add(resolve); });
      try {
        await Promise.race([(async () => {
          await interrupt(threadId);
          if (s.turnId && !s.exited) await finished;
        })(), new Promise((resolve) => {
          timer = setTimeout(resolve, Number.isFinite(interruptTimeoutMs) ? Math.max(0, Math.min(5000, interruptTimeoutMs)) : 250);
        })]);
      } catch { /* process-group close is the bounded fallback */ }
      finally { clearTimeout(timer); s.terminalWaiters.delete(terminal); }
    }
    clearApprovals(s);
    const result = await s.rpc.close(rpcOptions);
    if (s.turnId) {
      ev(s, "turn.failed", { completion: "unknown", error: "Native session closed before confirmed turn completion.", nativeTurnId: s.nativeTurnId }, s.turnId);
      s.turnId = null;
    }
    s.exited = true; s.state = "closed";
    sessions().delete(threadId);
    return result;
  })();
  return s.shutdownPromise;
}

export async function shutdown(reason = "connector shutdown", options = {}) {
  return Promise.all([...sessions().keys()].map(async (threadId) => ({ threadId, reason, ...await close(threadId, options) })));
}

function queueEarly(s, kind, msg) {
  if (!s.startPending) return false;
  if (s.early.length < 512) s.early.push([kind, msg]);
  else { s.startOverflow = true; void s.rpc.close(); }
  return true;
}
function matchesTurn(s, p) {
  if (p.turnId && p.turn?.id && p.turnId !== p.turn.id) return false;
  return !!s.turnId && !!s.nativeTurnId && (p.turnId || p.turn?.id) === s.nativeTurnId;
}
function matchesItem(s, p) {
  const itemId = p.item?.id || p.itemId;
  if (!matchesTurn(s, p) || !itemId || (p.itemId && p.item?.id && p.itemId !== p.item.id)) return false;
  // Native item IDs must stay bound to their item kind within a turn.
  const kind = p.item?.type;
  const previous = s.items.get(itemId);
  if (kind && previous && previous !== kind) return false;
  if (kind) s.items.set(itemId, kind);
  return true;
}

function routeNotification(s, msg) {
  const p = msg.params || {};
  if (s.exited || (p.threadId && p.threadId !== s.threadId)) return;
  if (queueEarly(s, "notification", msg)) return;
  if (!matchesTurn(s, p)) return;
  const ids = identity(p);
  switch (msg.method) {
    case "turn/started":
      if (!s.started) { s.started = true; ev(s, "turn.started", ids, s.turnId); }
      break;
    case "item/agentMessage/delta": {
      if (!matchesItem(s, p) || typeof p.delta !== "string") break;
      const kind = s.items.get(p.itemId);
      if (kind && kind !== "agentMessage") break;
      s.items.set(p.itemId, "agentMessage");
      const previous = s.messages.get(p.itemId) || { text: "", originalChars: 0, phase: null };
      if (previous.final) break;
      const originalChars = previous.originalChars + p.delta.length;
      const captured = bounded(previous.truncated ? previous.text : previous.text + p.delta, 6000);
      const truncated = previous.truncated || captured.truncated;
      const message = { text: captured.value, originalChars, phase: previous.phase, truncated };
      s.messages.set(p.itemId, message);
      ev(s, "message.delta", { ...ids, nativeMessageId: p.itemId, text: message.text,
        ...field("delta", p.delta, 500), phase: message.phase,
        ...(truncated ? { textTruncation: { truncated: true, originalChars, retainedChars: message.text.length, encoding: "text-prefix" } } : {}) }, s.turnId);
      break;
    }
    case "item/started": {
      if (!matchesItem(s, p)) break;
      if (p.item.type === "agentMessage") {
        const previous = s.messages.get(p.item.id);
        if (!previous) s.messages.set(p.item.id, { text: "", originalChars: 0, phase: p.item.phase ?? null });
        else if (!previous.final) previous.phase = p.item.phase ?? previous.phase;
      }
      if (TOOL_KINDS.has(p.item.type)) ev(s, "tool.requested", { ...summarizeItem(p.item), ...ids }, s.turnId);
      break;
    }
    case "item/completed": {
      if (!matchesItem(s, p)) break;
      const item = p.item;
      if (item.type === "agentMessage") {
        if (s.messages.get(item.id)?.final) break;
        s.messages.set(item.id, { final: true });
        ev(s, "message.final", { ...summarizeItem(item), ...ids }, s.turnId);
      } else if (TOOL_KINDS.has(item.type)) {
        const st = item.status;
        ev(s, st === "failed" ? "tool.failed" : st === "declined" ? "tool.denied" : "tool.completed", { ...summarizeItem(item), ...ids }, s.turnId);
      }
      break;
    }
    case "turn/completed":
    case "turn/failed": {
      s.state = "idle";
      clearApprovals(s);
      const status = p.turn?.status;
      const type = msg.method === "turn/failed" ? "turn.failed" : status === "completed" ? "turn.completed" : status === "interrupted" ? "turn.interrupted" : "turn.failed";
      ev(s, type, { ...ids, status, ...(type === "turn.failed" ? { error: p.turn?.error?.message || p.error?.message || "Codex turn failed; check local authentication, model access and CLI configuration." } : {}) }, s.turnId);
      s.turnId = null; s.nativeTurnId = null;
      for (const resolve of s.terminalWaiters) resolve();
      s.terminalWaiters.clear();
      break;
    }
    default: break; // Thread-wide status cannot prove an active turn's state.
  }
}

function routeServerRequest(s, msg) {
  const p = msg.params || {};
  if (!s.exited && (!p.threadId || p.threadId === s.threadId) && queueEarly(s, "request", msg)) return;
  if (s.exited || s.closing || (p.threadId && p.threadId !== s.threadId) || !matchesItem(s, p)) {
    s.rpc.respondError(msg.id, -32600, "Request does not belong to the active native turn/item").catch(() => {});
    return;
  }
  const ids = identity(p);
  const key = `${s.threadId}:${s.turnId}:${msg.method}:${msg.id}:${crypto.randomUUID()}`;
  const approval = (payload, requested = null) => {
    s.state = "waiting_approval";
    const pending = { rpcId: msg.id, method: msg.method, requested, turnId: s.turnId, ...ids };
    const expiresAt = Date.now() + s.approvalTimeoutMs;
    pending.timer = setTimeout(() => {
      if (s.pendingApprovals.get(key) !== pending) return;
      takeApproval(s, key);
      ev(s, "approval.expired", { approvalId: key, ...ids, reason: "Native approval deadline elapsed; request denied." }, pending.turnId);
      void answerApproval(s, pending, "deny").catch(() => {});
    }, s.approvalTimeoutMs);
    pending.timer.unref?.();
    s.pendingApprovals.set(key, pending);
    ev(s, "approval.requested", { approvalId: key, ...ids, ...payload, expiresAt }, s.turnId);
  };
  if (msg.method === "item/commandExecution/requestApproval") {
    approval({
      kind: "command",
      command: p.command || (p.networkApprovalContext ? `network ${p.networkApprovalContext.protocol}://${p.networkApprovalContext.host}` : ""),
      cwd: p.cwd || "", reason: p.reason || "",
    });
  } else if (msg.method === "item/fileChange/requestApproval") {
    approval({ kind: "file", path: p.grantRoot || "", reason: p.reason || "" });
  } else if (msg.method === "item/permissions/requestApproval") {
    approval({ kind: "permissions", detail: JSON.stringify(p.permissions || {}).slice(0, 300),
      cwd: p.cwd || "", reason: p.reason || "" }, p.permissions || {});
  } else if (msg.method === "item/tool/requestUserInput" || msg.method === "mcpServer/elicitation/request") {
    // MCP elicitation is explicitly unsupported in this MVP: decline safely
    // and say so, rather than guessing an answer schema.
    s.rpc.respond(msg.id, msg.method === "mcpServer/elicitation/request" ? { action: "decline", content: null } : { answers: {} }).catch(() => {});
    ev(s, "message.final", { text: "The agent asked an app-level question this connector cannot relay yet — it was skipped. Ask it to proceed differently." }, s.turnId);
  } else {
    s.rpc.respondError(msg.id, -32601, "unsupported in codelit-connect MVP").catch(() => {});
  }
}
