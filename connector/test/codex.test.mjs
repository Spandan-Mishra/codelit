import test from "node:test";
import assert from "node:assert/strict";
import * as codex from "../lib/codex.mjs";

function mockRpc(responses = {}) {
  const calls = [], handlers = {};
  return { calls, handlers, closed: false,
    async request(method, params) {
      calls.push({ method, params });
      const result = responses[method];
      if (typeof result === "function") return result(params);
      if (result instanceof Error) throw result;
      return result ?? {};
    },
    async notify() {}, on(name, cb) { handlers[name] = cb; },
    async respond(id, result) { calls.push({ id, result }); },
    async respondError(id, code, message) { calls.push({ id, error: { code, message } }); }, close() { this.closed = true; },
    notifyServer(method, params) { handlers.notification({ method, params }); },
  };
}
const found = async () => ({ found: true, version: "test-runtime" });

test("discovery distinguishes missing, unauthenticated and protocol failure without leaking account", async () => {
  const missing = await codex.createDiscovery({ detectRuntime: async () => ({ found: false, hint: "install" }), rpcFactory: () => { throw Error("must not spawn"); } })();
  assert.equal(missing.status, "missing"); assert.equal(missing.installed, false);
  const rpc = mockRpc({ "account/read": { requiresOpenaiAuth: true, account: null } });
  const unauth = await codex.createDiscovery({ detectRuntime: found, rpcFactory: () => rpc })();
  assert.equal(unauth.status, "unauthenticated"); assert.equal(unauth.ready, false); assert.equal(rpc.closed, true);
  assert.equal(rpc.calls.some((c) => c.method === "model/list"), false);
  const bad = await codex.createDiscovery({ detectRuntime: found, rpcFactory: () => mockRpc({ initialize: Error("token=SECRET") }) })();
  assert.equal(bad.status, "error"); assert.doesNotMatch(JSON.stringify(bad), /SECRET/);
});

test("discovery uses paged runtime model slugs/labels, hides hidden entries and never returns identity", async () => {
  const rpc = mockRpc({
    "account/read": { requiresOpenaiAuth: true, account: { email: "private@example.test", token: "SECRET" } },
    "model/list": (p) => p.cursor ? { data: [{ id: "second", model: "slug-2", displayName: "Second" }], nextCursor: null } : { data: [{ id: "catalog-id", model: "slug-1", displayName: "First" }, { id: "hidden", hidden: true }], nextCursor: "page-2" },
  });
  const result = await codex.createDiscovery({ detectRuntime: found, rpcFactory: () => rpc })();
  assert.equal(result.ready, true);
  assert.deepEqual(result.models, [{ id: "slug-1", label: "First" }, { id: "slug-2", label: "Second" }]);
  assert.doesNotMatch(JSON.stringify(result), /private|SECRET/);
  assert.deepEqual(rpc.calls.find((c) => c.method === "account/read").params, { refreshToken: false });
});

test("Codex sends selected model and write sandbox, routes string deltas/status, interrupts native turn", async () => {
  let sequence = 0;
  const rpc = mockRpc({ "thread/start": { thread: { id: "test-thread" }, model: "selected", sandbox: { type: "workspaceWrite" } }, "turn/start": () => ({ turn: { id: ++sequence === 1 ? "native-turn" : "native-turn-2" } }) });
  const events = []; codex.onEvent((e) => events.push(e));
  const start = await codex.start({ cwd: "/tmp/isolated", model: "selected", rpcFactory: () => rpc });
  try {
    assert.equal(start.model, "selected");
    assert.equal(rpc.calls.find((c) => c.method === "thread/start").params.sandbox, "workspace-write");
    await codex.turn(start.nativeSessionId, "edit", { turnId: "browser-turn", model: "changed" });
    const turn = rpc.calls.find((c) => c.method === "turn/start").params;
    assert.equal(turn.model, "changed"); assert.equal(turn.sandboxPolicy.type, "workspaceWrite");
    assert.deepEqual(turn.sandboxPolicy.writableRoots, ["/tmp/isolated"]);
    rpc.notifyServer("item/agentMessage/delta", { threadId: "test-thread", turnId: "native-turn", itemId: "message-1", delta: "hello" });
    assert.equal(events.at(-1).payload.text, "hello");
    await codex.interrupt("test-thread");
    assert.deepEqual(rpc.calls.at(-1), { method: "turn/interrupt", params: { threadId: "test-thread", turnId: "native-turn" } });
    rpc.notifyServer("turn/completed", { turn: { id: "native-turn", status: "interrupted" } });
    assert.equal(events.at(-1).type, "turn.interrupted"); assert.equal(events.at(-1).turnId, "browser-turn");
    await codex.turn("test-thread", "edit", { turnId: "browser-2" });
    rpc.notifyServer("turn/completed", { turn: { id: "native-turn-2", status: "failed", error: { message: "no access" } } });
    assert.equal(events.at(-1).type, "turn.failed");
    const count = events.length;
    rpc.notifyServer("turn/completed", { turn: { id: "native-turn-2", status: "failed" } });
    assert.equal(events.length, count);
  } finally { await codex.close(start.nativeSessionId); }
});

test("read-only thread response fails instead of claiming executable readiness", async () => {
  const rpc = mockRpc({ "thread/start": { thread: { id: "read-only" }, sandbox: { type: "readOnly" } } });
  await assert.rejects(codex.start({ cwd: "/tmp/isolated", rpcFactory: () => rpc }), /workspace-write/);
  assert.equal(rpc.closed, true);
});

test("Codex native default stays implicit on turn/start while events report the resolved model", async () => {
  const rpc = mockRpc({ "thread/start": { thread: { id: "default-thread" }, model: "hidden-configured-default", sandbox: { type: "workspaceWrite" } }, "turn/start": { turn: { id: "native-turn" } } });
  const events = []; codex.onEvent((e) => events.push(e));
  const started = await codex.start({ cwd: "/tmp/isolated", rpcFactory: () => rpc });
  try {
    assert.equal(started.model, "hidden-configured-default");
    assert.equal(Object.hasOwn(rpc.calls.find((c) => c.method === "thread/start").params, "model"), false);
    await codex.turn(started.nativeSessionId, "edit", { turnId: "browser-turn", model: null });
    assert.equal(Object.hasOwn(rpc.calls.find((c) => c.method === "turn/start").params, "model"), false);
    rpc.notifyServer("turn/started", { turn: { id: "native-turn" } });
    assert.equal(events.at(-1).model, "hidden-configured-default");
  } finally { await codex.close(started.nativeSessionId); }
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function approvalFixture(t, id, timeout = 15) {
  let sequence = 0;
  let nativeTurnId;
  const rpc = mockRpc({ "thread/start": { thread: { id }, model: "chosen", sandbox: { type: "workspaceWrite" } }, "turn/start": () => ({ turn: { id: nativeTurnId = ++sequence === 1 ? "native-turn" : `native-turn-${sequence}` } }) });
  const events = []; codex.onEvent((e) => events.push(e));
  await codex.start({ cwd: "/tmp/isolated", rpcFactory: () => rpc, approvalTimeoutMs: timeout });
  t.after(() => codex.close(id));
  await codex.turn(id, "edit", { turnId: "browser-turn" });
  const request = (rpcId, method, extra = {}) => {
    rpc.handlers.serverRequest({ id: rpcId, method, params: { threadId: id, turnId: nativeTurnId, itemId: "reused-item", ...extra } });
    return events.at(-1).payload.approvalId;
  };
  return { rpc, events, request };
}

test("command, file and permissions approval expiry answers native RPC once and leaves the turn running", async (t) => {
  const id = "expiry-thread", f = await approvalFixture(t, id);
  const keys = [
    f.request(11, "item/commandExecution/requestApproval", { command: "test" }),
    f.request(12, "item/fileChange/requestApproval"),
    f.request(13, "item/permissions/requestApproval", { permissions: { network: { enabled: true } } }),
  ];
  assert.equal(new Set(keys).size, 3);
  assert.equal(codex.state(id), "waiting_approval");
  assert.ok(f.events.filter((e) => e.type === "approval.requested").every((e) => e.payload.expiresAt <= Date.now() + 15));
  await delay(40);
  assert.deepEqual(f.rpc.calls.filter((c) => c.id), [
    { id: 11, result: { decision: "decline" } },
    { id: 12, result: { decision: "decline" } },
    { id: 13, result: { permissions: {}, scope: "turn" } },
  ]);
  const expired = f.events.filter((e) => e.type === "approval.expired");
  assert.deepEqual(expired.map((e) => e.payload.approvalId), keys);
  assert.ok(expired.every((e) => e.turnId === "browser-turn"));
  assert.equal(codex.state(id), "running");
  await assert.rejects(codex.decideApproval(id, keys[0], "allow-once"), /expired/);
  assert.equal(f.rpc.calls.filter((c) => c.id).length, 3);
});

test("approval decisions clear deadlines and retain waiting state until every request is answered", async (t) => {
  const id = "decision-thread", f = await approvalFixture(t, id);
  const first = f.request("allow", "item/commandExecution/requestApproval");
  const second = f.request("deny", "item/permissions/requestApproval");
  await codex.decideApproval(id, first, "allow-once");
  assert.equal(codex.state(id), "waiting_approval");
  await codex.decideApproval(id, second, "deny");
  assert.equal(codex.state(id), "running");
  await delay(40);
  assert.deepEqual(f.rpc.calls.filter((c) => c.id), [
    { id: "allow", result: { decision: "accept" } },
    { id: "deny", result: { permissions: {}, scope: "turn" } },
  ]);
  assert.equal(f.events.some((e) => e.type === "approval.expired"), false);
});

test("closing, native exit and terminal notification clear approval timers", async (t) => {
  for (const action of ["close", "exit", "terminal"]) {
    const id = `cleanup-${action}`, f = await approvalFixture(t, id);
    f.request("pending", "item/fileChange/requestApproval");
    if (action === "close") await codex.close(id);
    else if (action === "exit") f.rpc.handlers.exit();
    else f.rpc.notifyServer("turn/completed", { turn: { id: "native-turn", status: "completed" } });
    await delay(40);
    assert.equal(f.events.some((e) => e.type === "approval.expired"), false, action);
    assert.equal(f.rpc.calls.some((c) => c.id === "pending"), false, action);
    assert.equal(codex.state(id), action === "terminal" ? "idle" : "closed");
  }
});

test("failed native expiry response closes the agent and emits a terminal failure", async (t) => {
  const id = "expiry-failure", f = await approvalFixture(t, id);
  f.rpc.respond = async () => { throw new Error("closed transport"); };
  f.request("pending", "item/commandExecution/requestApproval");
  await delay(40);
  assert.equal(f.events.filter((e) => e.type === "approval.expired").length, 1);
  assert.equal(f.events.filter((e) => e.type === "turn.failed").length, 1);
  assert.equal(f.events.at(-1).turnId, "browser-turn");
  assert.equal(f.rpc.closed, true);
  assert.equal(codex.state(id), "failed");
});

test("native approval IDs remain unique when RPC IDs repeat across turns and reconnects", async (t) => {
  const id = "approval-reuse", first = await approvalFixture(t, id, 10000);
  const oldKey = first.request(42, "item/fileChange/requestApproval");
  first.rpc.notifyServer("turn/completed", { turn: { id: "native-turn", status: "completed" } });
  await codex.turn(id, "next edit", { turnId: "next-browser-turn" });
  const nextKey = first.request(42, "item/fileChange/requestApproval");
  assert.notEqual(nextKey, oldKey);
  await assert.rejects(codex.decideApproval(id, oldKey, "allow-once"), /expired/);
  await codex.close(id);
  const reconnected = await approvalFixture(t, id, 10000);
  const reconnectKey = reconnected.request(42, "item/fileChange/requestApproval");
  assert.notEqual(reconnectKey, oldKey);
  assert.notEqual(reconnectKey, nextKey);
  await codex.decideApproval(id, reconnectKey, "allow-once");
  assert.equal(reconnected.rpc.calls.filter((call) => call.id === 42).length, 1);
});

async function nativeFixture(t, id, startTurn) {
  let n = 0;
  const rpc = mockRpc({ "thread/start": { thread: { id }, sandbox: { type: "workspaceWrite" } },
    "turn/start": startTurn || (() => ({ turn: { id: `native-${++n}` } })) });
  const events = []; codex.onEvent((e) => events.push(e));
  await codex.start({ cwd: "/tmp/isolated", rpcFactory: () => rpc, approvalTimeoutMs: 10000 });
  t.after(() => codex.close(id, { interruptTimeoutMs: 0 }));
  return { rpc, events, send: (method, turnId, rest = {}) => rpc.notifyServer(method, { threadId: id, turnId, ...rest }) };
}

test("exact delayed turn1 completion cannot complete logical turn2 or route stale messages/tools/approvals", async (t) => {
  const id = "delayed-native", f = await nativeFixture(t, id);
  await codex.turn(id, "one", { turnId: "logical-1" });
  f.send("turn/completed", "native-1", { turn: { id: "native-1", status: "completed" } });
  await codex.turn(id, "two", { turnId: "logical-2" });
  const count = f.events.length;
  f.send("turn/completed", "native-1", { turn: { id: "native-1", status: "completed" } });
  f.send("turn/started", "native-1", { turn: { id: "native-1" } });
  f.send("turn/failed", "native-1", { error: { message: "old failure" } });
  f.send("item/agentMessage/delta", "native-1", { itemId: "old-message", delta: "stale" });
  f.send("item/completed", "native-1", { item: { id: "old-tool", type: "commandExecution", command: "old" } });
  f.rpc.handlers.serverRequest({ id: "stale-approval", method: "item/commandExecution/requestApproval", params: { threadId: id, turnId: "native-1", itemId: "old-tool" } });
  assert.equal(f.events.length, count);
  assert.equal(codex.state(id), "running");
  assert.equal(f.rpc.calls.at(-1).error.code, -32600);
  await codex.interrupt(id);
  assert.equal(f.rpc.calls.at(-1).params.turnId, "native-2");
  f.send("turn/completed", "native-2", { turn: { id: "native-2", status: "completed" } });
  f.send("turn/completed", "native-2", { turn: { id: "native-2", status: "completed" } });
  assert.deepEqual(f.events.filter((e) => e.type === "turn.completed").map((e) => e.turnId), ["logical-1", "logical-2"]);
  assert.equal(codex.state(id), "idle");
});

test("started, items, approvals and completion before start response reconcile only to acknowledged native ID", async (t) => {
  let resolveStart;
  const id = "before-response", f = await nativeFixture(t, id, () => new Promise((resolve) => { resolveStart = resolve; }));
  const sending = codex.turn(id, "one", { turnId: "logical" });
  f.send("turn/started", "stale", { turn: { id: "stale" } });
  f.send("turn/started", "actual", { turn: { id: "actual" } });
  f.send("item/agentMessage/delta", "actual", { itemId: "m", delta: "early" });
  f.rpc.handlers.serverRequest({ id: 7, method: "item/fileChange/requestApproval", params: { threadId: id, turnId: "actual", itemId: "edit" } });
  assert.equal(f.events.length, 0);
  resolveStart({ turn: { id: "actual" } }); await sending;
  assert.deepEqual(f.events.map((e) => e.type), ["turn.started", "message.delta", "approval.requested"]);
  assert.ok(f.events.every((e) => e.turnId === "logical" && e.payload.nativeTurnId === "actual"));
  await codex.decideApproval(id, f.events.at(-1).payload.approvalId, "deny");
  f.send("turn/completed", "actual", { turn: { id: "actual", status: "completed" } });
  assert.equal(codex.state(id), "idle");
});

test("completion before response is processed once and later native IDs cannot claim it", async (t) => {
  let resolveStart;
  const id = "early-complete", f = await nativeFixture(t, id, () => new Promise((resolve) => { resolveStart = resolve; }));
  const sending = codex.turn(id, "one", { turnId: "logical" });
  f.send("turn/completed", "actual", { turn: { id: "actual", status: "completed" } });
  resolveStart({ turn: { id: "actual" } }); await sending;
  assert.equal(codex.state(id), "idle");
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].turnId, "logical");
});

test("ordinary text is cumulative per native message, commentary does not suppress final, reasoning stays absent", async (t) => {
  const id = "text-capture", f = await nativeFixture(t, id);
  await codex.turn(id, "one", { turnId: "logical" });
  f.send("item/started", "native-1", { item: { type: "agentMessage", id: "commentary", phase: "commentary" } });
  for (const delta of ["Hello, ", "this is ", "the last delta."]) f.send("item/agentMessage/delta", "native-1", { itemId: "commentary", delta });
  const deltas = f.events.filter((e) => e.type === "message.delta");
  assert.deepEqual(deltas.map((e) => e.payload.text), ["Hello, ", "Hello, this is ", "Hello, this is the last delta."]);
  // The latest persisted event is sufficient to recover ordinary text mid-stream.
  assert.equal(deltas.at(-1).payload.nativeMessageId, "commentary");
  assert.equal(deltas.at(-1).payload.phase, "commentary");
  f.send("item/completed", "native-1", { item: { type: "agentMessage", id: "commentary", phase: "commentary", text: deltas.at(-1).payload.text } });
  f.send("item/started", "native-1", { item: { type: "reasoning", id: "hidden", summary: ["PRIVATE"], content: ["PRIVATE"] } });
  f.send("item/reasoning/textDelta", "native-1", { itemId: "hidden", delta: "PRIVATE" });
  f.send("item/completed", "native-1", { item: { type: "reasoning", id: "hidden", content: ["PRIVATE"] } });
  const long = "final ".repeat(1000);
  f.send("item/started", "native-1", { item: { type: "agentMessage", id: "final", phase: "final_answer" } });
  f.send("item/agentMessage/delta", "native-1", { itemId: "final", delta: "More" });
  assert.equal(f.events.at(-1).payload.text, "More");
  f.send("item/completed", "native-1", { item: { type: "agentMessage", id: "final", phase: "final_answer", text: long } });
  assert.equal(f.events.at(-1).payload.text, long);
  assert.equal(f.events.at(-1).payload.nativeMessageId, "final");
  assert.equal(f.events.at(-1).payload.phase, "final_answer");
  assert.doesNotMatch(JSON.stringify(f.events), /PRIVATE/);
});

test("tool IDs, JSON arguments/results retained and oversized captures explicitly marked within encoded limits", async (t) => {
  const id = "tool-capture", f = await nativeFixture(t, id);
  await codex.turn(id, "one", { turnId: "logical" });
  const item = { type: "mcpToolCall", id: "item-1", callId: "call-1", server: "fixture", tool: "lookup", arguments: { query: "first" }, result: { content: [{ text: "found" }] }, status: "completed" };
  f.send("item/started", "native-1", { item });
  f.send("item/completed", "native-1", { item });
  assert.deepEqual(f.events.at(-1).payload.args, item.arguments);
  assert.deepEqual(f.events.at(-1).payload.result, item.result);
  assert.equal(f.events.at(-1).payload.itemId, "item-1");
  assert.equal(f.events.at(-1).payload.callId, "call-1");
  assert.equal(f.events.at(-1).payload.name, "lookup");
  f.send("item/completed", "native-1", { item: { ...item, id: "item-2", callId: "call-2", arguments: { query: "\u0000".repeat(5000) }, result: { text: "huge".repeat(10000) } } });
  const payload = f.events.at(-1).payload;
  assert.equal(payload.callId, "call-2");
  assert.equal(payload.argsTruncation.truncated, true);
  assert.equal(payload.argsTruncation.encoding, "json-prefix");
  assert.equal(payload.resultTruncation.truncated, true);
  assert.ok(JSON.stringify(payload).length < 8000);
  f.send("item/completed", "native-1", { item: { type: "agentMessage", id: "huge", phase: "final_answer", text: "\u0000".repeat(30000) } });
  const final = f.events.at(-1).payload;
  assert.equal(final.textTruncation.truncated, true);
  assert.equal(final.textTruncation.originalChars, 30000);
  assert.ok(JSON.stringify(final).length < 32000);
});

test("shutdown bounds hung interrupt and awaits process close without claiming successful completion", async (t) => {
  const id = "shutdown-hung", f = await nativeFixture(t, id);
  await codex.turn(id, "one", { turnId: "logical" });
  f.rpc.request = async () => new Promise(() => {});
  let finished = false;
  f.rpc.close = async () => { await delay(15); finished = true; };
  const started = Date.now();
  const results = await codex.shutdown("fixture", { interruptTimeoutMs: 15 });
  assert.ok(Date.now() - started < 1000);
  assert.equal(finished, true);
  assert.equal(results.find((r) => r.threadId === id).reason, "fixture");
  assert.equal(codex.state(id), "closed");
  assert.equal(f.events.at(-1).type, "turn.failed");
  assert.equal(f.events.at(-1).payload.completion, "unknown");
  assert.deepEqual(await codex.shutdown(), []);
});

test("stale asynchronous approval response failure cannot fail the next native turn", async (t) => {
  const id = "old-approval-response", f = await nativeFixture(t, id);
  await codex.turn(id, "one", { turnId: "logical-1" });
  f.rpc.handlers.serverRequest({ id: 8, method: "item/fileChange/requestApproval", params: { threadId: id, turnId: "native-1", itemId: "edit" } });
  const key = f.events.at(-1).payload.approvalId;
  let rejectReply;
  f.rpc.respond = () => new Promise((resolve, reject) => { rejectReply = reject; });
  const reply = codex.decideApproval(id, key, "deny");
  const rejected = assert.rejects(reply, /late write failure/);
  f.send("turn/completed", "native-1", { turn: { id: "native-1", status: "completed" } });
  await codex.turn(id, "two", { turnId: "logical-2" });
  rejectReply(new Error("late write failure")); await rejected;
  assert.equal(codex.state(id), "running");
  assert.equal(f.rpc.closed, false);
  assert.equal(f.events.some((e) => e.type === "turn.failed"), false);
});

test("large cumulative delta fits existing relay limit and explicitly reports lost prefix tail", async (t) => {
  const id = "bounded-stream", f = await nativeFixture(t, id);
  await codex.turn(id, "one", { turnId: "logical" });
  f.send("item/agentMessage/delta", "native-1", { itemId: "message", delta: "x".repeat(10000) });
  const first = f.events.at(-1).payload;
  assert.ok(JSON.stringify(first).length < 8000);
  assert.equal(first.textTruncation.originalChars, 10000);
  assert.equal(first.deltaTruncation.truncated, true);
  f.send("item/started", "native-1", { item: { id: "message", type: "agentMessage", phase: "final_answer" } });
  f.send("item/agentMessage/delta", "native-1", { itemId: "message", delta: "later" });
  const last = f.events.at(-1).payload;
  assert.equal(last.text, first.text, "later chunks must not be spliced across an omitted range");
  assert.equal(last.textTruncation.originalChars, 10005);
  assert.equal(last.phase, "final_answer");
  assert.ok(JSON.stringify(last).length < 8000);
});

test("close awaits matching native terminal after interrupt ACK and preserves confirmed outcome", async (t) => {
  const id = "shutdown-confirmed", f = await nativeFixture(t, id);
  await codex.turn(id, "one", { turnId: "logical" });
  const original = f.rpc.request;
  f.rpc.request = async (method, params) => {
    if (method === "turn/interrupt") {
      setTimeout(() => f.send("turn/completed", "native-1", { turn: { id: "native-1", status: "interrupted" } }), 5);
      return {};
    }
    return original(method, params);
  };
  await codex.close(id, { interruptTimeoutMs: 100 });
  assert.deepEqual(f.events.map((e) => e.type), ["turn.interrupted"]);
  assert.equal(f.rpc.closed, true);
  assert.equal(codex.state(id), "closed");
});
