import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAttemptRuntime } from "../lib/runtime.mjs";
import { initAttempt, readSolution, applyBrowserEdit } from "../lib/workspace.mjs";

const context = { title: "Add", language: "python", stage: 1, brief: "Add inputs", fnName: "add", stub: "def add(a,b):\n    pass\n", visibleTests: [{ input: "add(1,2)", expected: "3" }] };
async function fixture(t, { model = "model-a", envModel, defaultModel = "runtime-default" } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codelit-runtime-test-"));
  const previous = process.env.CODELIT_BASE; process.env.CODELIT_BASE = base;
  const previousModel = process.env.CODELIT_MODEL;
  if (envModel === undefined) delete process.env.CODELIT_MODEL; else process.env.CODELIT_MODEL = envModel;
  t.after(async () => { if (previous === undefined) delete process.env.CODELIT_BASE; else process.env.CODELIT_BASE = previous; if (previousModel === undefined) delete process.env.CODELIT_MODEL; else process.env.CODELIT_MODEL = previousModel; await fs.rm(base, { recursive: true, force: true }); });
  const events = [], calls = [], sessions = {};
  let listener, state = "idle";
  const adapter = { onEvent(cb) { listener = cb; }, async start(p) { calls.push(["start", p]); return { nativeSessionId: "native", model: p.model || defaultModel }; },
    async capabilities() { return { ready: true, models: [{ id: "model-a", label: "A" }, { id: "model-b", label: "B" }, { id: "runtime-default", label: "Default" }] }; },
    state: () => state, async resume(id, opts) { calls.push(["resume", id, opts]); state = "idle"; return { model: opts.model || defaultModel }; }, async turn(id, text, opts) { calls.push(["turn", id, text, opts]); }, async close() {}, async interrupt(id) { calls.push(["interrupt", id]); },
  };
  const runtime = createAttemptRuntime({ adapters: { codex: adapter }, sessions, deviceId: "device", queue: async (e) => events.push(e), uploadSnapshot: async () => ({ status: 200 }), saveSessions: async () => {} });
  const command = (type, payload) => runtime.onCommand({ type, attemptId: "isolated", payload });
  await command("session.start", { adapter: "codex", model, context });
  return { base, events, calls, sessions, adapter, runtime, command, setState: (value) => { state = value; }, send: (type, payload = {}, turnId = "turn-1") => listener({ type, payload, turnId, nativeSessionId: "native" }) };
}

test("a 6000-character heavily escaped prompt reaches inference exactly once with exact text", async (t) => {
  const f = await fixture(t);
  const text = '\u0000'.repeat(6000);
  assert.equal(text.length, 6000);
  assert.ok(JSON.stringify({ text }).length > 8000);
  await f.command("turn.send", { turnId: "escaped-turn", text });
  assert.equal(f.calls.filter((c) => c[0] === "turn").length, 1);
  assert.ok(f.calls.find((c) => c[0] === "turn")[2].endsWith(text));
  assert.equal(f.events.find((e) => e.type === "prompt.forwarded").payload.text, text);
  assert.equal(f.events.some((e) => e.type === "turn.failed"), false);
});

test("native default absent from catalog stays implicit on first turn and resume; events retain actual model", async (t) => {
  const f = await fixture(t, { model: null, defaultModel: "configured-hidden-default" });
  assert.equal(f.calls[0][1].model, null);
  assert.equal(f.sessions.isolated.selectedModel, null);
  await f.command("turn.send", { turnId: "turn-1", text: "explain" });
  assert.equal(f.calls.find((c) => c[0] === "turn")[3].model, null);
  const forwarded = f.events.find((e) => e.type === "prompt.forwarded");
  assert.equal(forwarded.model, "configured-hidden-default");
  assert.equal(forwarded.payload.model, "configured-hidden-default");
  await f.send("turn.completed");
  f.setState("closed");
  await f.command("turn.send", { turnId: "turn-2", text: "again" });
  assert.equal(f.calls.find((c) => c[0] === "resume")[2].model, null);
  assert.equal(f.sessions.isolated.model, "configured-hidden-default");
  await f.send("turn.completed", {}, "turn-2");
  await assert.rejects(f.command("turn.send", { turnId: "turn-3", text: "edit", model: "configured-hidden-default" }), /catalog/);
  assert.equal(f.calls.filter((c) => c[0] === "turn").length, 2);
});

test("environment model selection remains explicit and catalog-validated", async (t) => {
  const f = await fixture(t, { model: null, envModel: "model-b" });
  assert.equal(f.sessions.isolated.selectedModel, "model-b");
  await f.command("turn.send", { turnId: "turn-1", text: "edit" });
  assert.equal(f.calls.find((c) => c[0] === "turn")[3].model, "model-b");
  await f.send("turn.completed");
  process.env.CODELIT_MODEL = "unlisted-env-model";
  await assert.rejects(f.command("session.start", { context }), /catalog/);
  assert.equal(f.calls.filter((c) => c[0] === "start").length, 1);
});

test("terminal republishes full revision even when the tool already recorded identical metadata", async (t) => {
  const f = await fixture(t);
  await f.command("turn.send", { turnId: "turn-1", text: "implement" });
  const content = "def add(a,b): return a+b\n";
  await fs.writeFile(path.join(f.base, "isolated", "solution.py"), content);
  await f.send("tool.completed");
  const toolRevision = f.events.filter((e) => e.type === "file.revision").at(-1);
  await f.send("turn.completed");
  const terminalRevision = f.events.filter((e) => e.type === "file.revision").at(-1);
  assert.notEqual(terminalRevision.id, toolRevision.id);
  assert.deepEqual(terminalRevision.payload, toolRevision.payload);
  assert.equal(terminalRevision.payload.content, content);
  assert.equal(f.events.at(-1).type, "turn.completed");
});

test("crash and idle recovery republish full current bytes without repeating inference", async (t) => {
  const f = await fixture(t);
  await f.command("turn.send", { turnId: "turn-1", text: "implement" });
  await fs.writeFile(path.join(f.base, "isolated", "solution.py"), "saved before crash\n");
  f.events.length = 0;
  await f.runtime.recover();
  assert.equal(f.events[0].type, "file.revision");
  assert.equal(f.events[0].payload.content, "saved before crash\n");
  assert.equal(f.events[0].payload.rev, 1);
  assert.equal(f.events[1].type, "turn.failed");
  assert.equal(f.events[1].payload.code, "connector_restarted");
  assert.equal(f.sessions.isolated.inFlight, null);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.base, "isolated", "meta.json"))).inFlight, null);
  f.events.length = 0;
  await f.runtime.recover();
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].type, "file.revision");
  assert.equal(f.calls.filter((c) => c[0] === "turn").length, 1);
  assert.equal(f.calls.some((c) => c[0] === "resume"), false);
});

test("Stop releases lost delivered turns without a local session or inference", async (t) => {
  const f = await fixture(t);
  delete f.sessions.isolated;
  f.events.length = 0;
  await f.command("turn.interrupt", { pendingTurnIds: ["lost-1", "lost-2", "lost-1"] });
  assert.deepEqual(f.events.map((e) => [e.type, e.turnId]), [["turn.interrupted", "lost-1"], ["turn.interrupted", "lost-2"]]);
  assert.ok(f.events.every((e) => e.payload.reason === "cancelled before local execution / no running native turn"));
  assert.equal(f.calls.some((c) => ["turn", "resume", "interrupt"].includes(c[0])), false);
});

test("Stop releases unmatched reservations and waits for the real native terminal for a matching turn", async (t) => {
  const f = await fixture(t);
  await f.command("turn.interrupt", { pendingTurnIds: ["idle-lost"] });
  assert.equal(f.events.at(-1).turnId, "idle-lost");
  await f.command("turn.send", { turnId: "turn-1", text: "implement" });
  f.events.length = 0;
  await f.command("turn.interrupt", { pendingTurnIds: ["turn-1", "lost-2"] });
  assert.deepEqual(f.calls.at(-1), ["interrupt", "native"]);
  assert.deepEqual(f.events.map((e) => e.turnId), ["lost-2"]);
  assert.equal(f.sessions.isolated.inFlight, "turn-1");
  await f.send("turn.interrupted");
  assert.equal(f.events.at(-1).turnId, "turn-1");
  assert.equal(f.sessions.isolated.inFlight, null);
  assert.equal(f.calls.filter((c) => c[0] === "turn").length, 1);
});

test("initial revision zero, actual turn context/model and unchanged-file warning", async (t) => {
  const f = await fixture(t);
  const initial = f.events.find((e) => e.type === "file.revision");
  assert.equal(initial.payload.rev, 0); assert.equal(initial.payload.content, context.stub);
  await f.command("context.sync", { context: { ...context, stage: 2, brief: "Handle negative values" } });
  await f.command("turn.send", { turnId: "turn-1", text: "implement", model: "model-b", stage: 2 });
  const turn = f.calls.find((c) => c[0] === "turn");
  assert.equal(turn[3].model, "model-b");
  assert.match(turn[2], /solution.py/); assert.match(turn[2], /Add inputs/); assert.match(turn[2], /Handle negative values/); assert.match(turn[2], /add\(1,2\)/);
  await f.send("message.final", { text: "```python\ndef add(a,b): return a+b\n```" });
  await f.send("turn.completed");
  const terminal = f.events.filter((e) => e.type.startsWith("turn."));
  assert.equal(terminal.length, 1); assert.equal(terminal[0].type, "turn.completed"); assert.equal(terminal[0].payload.code, "solution_unchanged");
  assert.equal(f.sessions.isolated.inFlight, null);
  assert.equal(f.events.find((e) => e.type === "prompt.forwarded").payload.text, "implement");
  assert.ok(f.events.some((e) => e.type === "message.final" && e.payload.code === "solution_unchanged"));
});

test("real file bytes become revision before successful terminal and later edits protect unobserved writes", async (t) => {
  const f = await fixture(t);
  await f.command("turn.send", { turnId: "turn-1", text: "implement" });
  await fs.writeFile(path.join(f.base, "isolated", "solution.py"), "def add(a,b): return a+b\n");
  await f.send("turn.completed");
  const completed = f.events.findIndex((e) => e.type === "turn.completed");
  const revision = f.events.findIndex((e) => e.type === "file.revision" && e.payload.rev === 1);
  assert.ok(revision >= 0 && completed > revision);
  await fs.writeFile(path.join(f.base, "isolated", "solution.py"), "def add(a,b): return (a+b)\n");
  const result = await applyBrowserEdit(path.join(f.base, "isolated"), "python", "stale bytes", 1);
  assert.equal(result.conflict, true); assert.equal(result.rev, 2);
  assert.match((await readSolution(path.join(f.base, "isolated"), "python")).content, /return \(a\+b\)/);
});

test("stale browser revision blocks inference and returns one actionable terminal error", async (t) => {
  const f = await fixture(t);
  await f.command("turn.send", { turnId: "turn-1", text: "edit", pendingEdit: { baseRev: 0, code: "browser edit" } });
  assert.equal(f.calls.filter((c) => c[0] === "turn").length, 1);
  await f.send("turn.completed");
  await assert.rejects(f.command("turn.send", { turnId: "turn-2", text: "edit", pendingEdit: { baseRev: 0, code: "stale" } }), /conflict/);
  assert.equal(f.calls.filter((c) => c[0] === "turn").length, 1);
  assert.equal(f.events.filter((e) => e.type === "turn.failed" && e.turnId === "turn-2").length, 1);
});

test("workspace recovery never overwrites an existing solution without metadata", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codelit-recovery-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.writeFile(path.join(base, "solution.py"), "valuable existing bytes");
  await initAttempt(base, context);
  assert.equal((await readSolution(base, "python")).content, "valuable existing bytes");
});

test("provider/model replacement retains existing solution and all released context", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.base, "isolated", "solution.py");
  await fs.writeFile(file, "def add(a,b): return a+b\n");
  await f.command("context.sync", { context: { ...context, stage: 2, brief: "Now support floats" } });
  await f.command("session.start", { adapter: "codex", model: "model-b", context: { ...context, stage: 2, brief: "Now support floats" } });
  assert.match(await fs.readFile(file, "utf8"), /return a\+b/);
  assert.equal(f.sessions.isolated.model, "model-b");
  await f.command("turn.send", { turnId: "replaced-turn", model: "model-b", text: "explain", context: { ...context, stage: 2, brief: "Now support floats" } });
  const turn = f.calls.filter((c) => c[0] === "turn").at(-1);
  assert.equal(turn[3].model, "model-b");
  assert.match(turn[2], /Add inputs/); assert.match(turn[2], /Now support floats/);
});

test("valid large solution revision is complete, oversized sources never publish partial bytes", async (t) => {
  const f = await fixture(t);
  const content = "# saved comment\n".repeat(1800);
  await fs.writeFile(path.join(f.base, "isolated", "solution.py"), content);
  await f.runtime.revision("isolated");
  assert.equal(f.events.at(-1).type, "file.revision");
  assert.equal(f.events.at(-1).payload.content, content);
  await fs.writeFile(path.join(f.base, "isolated", "solution.py"), "x".repeat(60001));
  await f.runtime.revision("isolated");
  assert.equal(f.events.at(-1).type, "message.final");
  assert.equal(f.events.at(-1).payload.code, "solution_too_large");
});

test("deleted solution after completion yields actionable terminal failure instead of stuck running", async (t) => {
  const f = await fixture(t);
  await f.command("turn.send", { turnId: "turn-1", text: "edit" });
  await fs.unlink(path.join(f.base, "isolated", "solution.py"));
  await f.send("turn.completed");
  const terminal = f.events.find((e) => e.type === "turn.failed");
  assert.equal(terminal.payload.code, "solution_read_error");
  assert.equal(f.sessions.isolated.inFlight, null);
});

test("human edits acknowledge base revision without inference and conflicting edit preserves bytes", async (t) => {
  const f = await fixture(t);
  await f.command("human.edit", { editId: "edit-a", baseRev: 0, code: "def add(a,b): return a+b\n" });
  assert.equal(f.events.at(-1).type, "human.edit.ack");
  assert.equal(f.events.at(-1).payload.editId, "edit-a");
  assert.equal(f.events.at(-1).payload.rev, 1);
  await f.command("human.edit", { editId: "edit-b", baseRev: 0, code: "stale" });
  assert.equal(f.events.at(-1).type, "human.edit.conflict");
  assert.match((await readSolution(path.join(f.base, "isolated"), "python")).content, /return a\+b/);
  assert.equal(f.calls.some((c) => c[0] === "turn"), false);
});

test("pre-inference rejection is refundable preflight and old device sessions never rebind", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.command("turn.send", { turnId: "preflight", model: "unavailable", text: "edit" }), /catalog/);
  const failure = f.events.find((e) => e.type === "turn.failed");
  assert.equal(failure.payload.phase, "preflight"); assert.equal(failure.payload.inferenceStarted, false);
  f.sessions.isolated.deviceId = "original-device";
  const before = f.events.length;
  await f.runtime.recover();
  assert.equal(f.events.length, before);
  await assert.rejects(f.command("session.start", { context }), /prior device/);
  assert.equal(f.sessions.isolated.deviceId, "original-device");
});

test("freeze echoes generation, epoch and exact reviewed revision/hash; changed bytes reject upload", async (t) => {
  const f = await fixture(t);
  f.sessions.isolated.sessionEpoch = 7;
  const uploads = [];
  // Construct another runtime against the same mock adapter/session/workspace.
  const runtime = createAttemptRuntime({ adapters: { codex: f.adapter }, sessions: f.sessions, deviceId: "device", queue: async (e) => f.events.push(e), saveSessions: async () => {}, uploadSnapshot: async (id, payload) => { uploads.push([id, payload]); return { status: 200 }; } });
  const sol = await readSolution(path.join(f.base, "isolated"), "python");
  const cmd = { type: "freeze.request", attemptId: "isolated", sessionEpoch: 7, payload: { freezeId: "freeze-b", expectedRevision: sol.rev, expectedHash: sol.hash } };
  await runtime.onCommand(cmd);
  assert.equal(uploads[0][1].freezeId, "freeze-b"); assert.equal(uploads[0][1].sessionEpoch, 7);
  assert.equal(uploads[0][1].expectedHash, sol.hash); assert.equal(uploads[0][1].revision, sol.rev);
  await fs.writeFile(path.join(f.base, "isolated", "solution.py"), "changed locally\n");
  await assert.rejects(runtime.onCommand(cmd), /revision\/hash changed/);
  assert.equal(uploads.length, 1);
});

test("unified shutdown closes mock adapter once, resolves unknown work and blocks future inference", async (t) => {
  const f = await fixture(t);
  await f.command("turn.send", { turnId: "turn-1", text: "edit" });
  let shutdowns = 0;
  f.adapter.shutdown = async () => { shutdowns++; };
  await Promise.all([f.runtime.shutdown("lease expired"), f.runtime.shutdown("SIGTERM")]);
  assert.equal(shutdowns, 1); assert.equal(f.sessions.isolated.inFlight, null);
  const failure = f.events.find((e) => e.type === "turn.failed");
  assert.equal(failure.payload.completion, "unknown");
  await assert.rejects(f.command("turn.send", { turnId: "later", text: "edit" }), /shutting down/);
  assert.equal(f.calls.filter((c) => c[0] === "turn").length, 1);
});

test("session lease loss closes only the matching session; renewal permits its next user turn", async (t) => {
  const f = await fixture(t);
  f.sessions.isolated.sessionEpoch = 1;
  const closed = [];
  f.adapter.close = async (thread) => { closed.push(thread); };
  await f.runtime.stopAttempt("isolated", 0, "stale lease");
  assert.deepEqual(closed, []);
  await f.runtime.stopAttempt("isolated", 1, "browser closed");
  assert.deepEqual(closed, ["native"]);
  await assert.rejects(f.runtime.onCommand({ type: "turn.send", attemptId: "isolated", sessionEpoch: 1, payload: { text: "edit", turnId: "denied" } }), /lease ended/);
  assert.equal(f.calls.filter((c) => c[0] === "turn").length, 0);
  await f.runtime.renewAttempt("isolated", 1);
  await f.runtime.onCommand({ type: "turn.send", attemptId: "isolated", sessionEpoch: 1, payload: { text: "edit", turnId: "allowed" } });
  assert.equal(f.calls.filter((c) => c[0] === "turn").length, 1);
});

test("escaped oversized human edit rejects before changing saved bytes and reports conflict", async (t) => {
  const f = await fixture(t);
  const before = await readSolution(path.join(f.base, "isolated"), "python");
  await assert.rejects(f.command("human.edit", { editId: "too-large", baseRev: 0, code: "\u0000".repeat(20000) }), /revision limit/);
  assert.equal((await readSolution(path.join(f.base, "isolated"), "python")).hash, before.hash);
  assert.ok(f.events.some((e) => e.type === "human.edit.conflict" && e.payload.editId === "too-large"));
});

test("explicit server-granted same-owner transfer preserves source and rejects mismatched grant", async (t) => {
  const f = await fixture(t);
  f.sessions.isolated.deviceId = "prior-device";
  await assert.rejects(f.command("session.start", { context, transferFromDeviceId: "other-device" }), /prior device/);
  assert.equal(f.sessions.isolated.deviceId, "prior-device");
  await f.command("session.start", { context, transferFromDeviceId: "prior-device" });
  assert.equal(f.sessions.isolated.deviceId, "device");
  assert.equal((await readSolution(path.join(f.base, "isolated"), "python")).content, context.stub);
  const replaced = f.events.filter((e) => e.type === "session.replaced").at(-1);
  assert.equal(replaced.payload.transferFromDeviceId, "prior-device");
});
