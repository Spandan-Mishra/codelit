import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRelayClient, saveCred, loadCred } from "../lib/relay.mjs";
import { createAttemptRuntime } from "../lib/runtime.mjs";

test("isolated connector state, concurrent queue/flush and durable per-attempt sequence", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codelit-relay-test-"));
  const previousDir = process.env.CODELIT_CONFIG_DIR;
  const previousFetch = globalThis.fetch;
  process.env.CODELIT_CONFIG_DIR = dir;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    if (previousDir === undefined) delete process.env.CODELIT_CONFIG_DIR; else process.env.CODELIT_CONFIG_DIR = previousDir;
    await fs.rm(dir, { recursive: true, force: true });
  });
  await saveCred({ relay: "https://test.invalid", deviceId: "test-device", token: "fixture-only" });
  assert.equal((await loadCred()).deviceId, "test-device");
  assert.equal((await fs.stat(path.join(dir, "device.json"))).mode & 0o777, 0o600);
  const received = [];
  let releaseFirst, startedFirst;
  const first = new Promise((r) => { startedFirst = r; });
  const gate = new Promise((r) => { releaseFirst = r; });
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.op, "events");
    if (!received.length) { startedFirst(); await gate; }
    received.push(...body.events);
    return { status: 200, async json() { return { accepted: body.events.map((e) => e.id) }; } };
  };
  const options = { relay: "https://test.invalid", deviceId: "test-device", token: "fixture-only" };
  const client = createRelayClient(options);
  await client.queue({ id: "event-1", attemptId: "one" });
  await first;
  await Promise.all([
    client.queue({ id: "event-2", attemptId: "one" }),
    client.queue({ id: "event-3", attemptId: "two" }),
  ]);
  releaseFirst();
  await client.flush();
  assert.deepEqual(received.map((e) => e.id), ["event-1", "event-2", "event-3"]);
  assert.deepEqual(received.map((e) => e.sourceSeq), [0, 1, 0]);
  assert.equal(await fs.readFile(path.join(dir, "event-queue.jsonl"), "utf8"), "");
  const restarted = createRelayClient(options);
  await restarted.queue({ id: "event-4", attemptId: "one" });
  await restarted.flush();
  assert.equal(received.at(-1).sourceSeq, 2);
});

test("offline backlog bounds deltas but preserves latest per-attempt revisions and all critical replay across restart", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codelit-backlog-test-"));
  const previousDir = process.env.CODELIT_CONFIG_DIR;
  const previousFetch = globalThis.fetch;
  process.env.CODELIT_CONFIG_DIR = dir;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    if (previousDir === undefined) delete process.env.CODELIT_CONFIG_DIR; else process.env.CODELIT_CONFIG_DIR = previousDir;
    await fs.rm(dir, { recursive: true, force: true });
  });
  globalThis.fetch = async () => ({ status: 503, async json() { return {}; } });
  const options = { relay: "https://test.invalid", deviceId: "device", token: "fixture-only" };
  const client = createRelayClient(options);
  const enqueue = (id, type, attemptId = "one", payload = {}) => client.queue({ id, type, attemptId, payload });
  await enqueue("old-revision", "file.revision", "one", { rev: 0, content: "old" });
  await enqueue("current-revision", "file.revision", "one", { rev: 1, content: "authoritative full bytes" });
  await enqueue("other-attempt-revision", "file.revision", "two", { rev: 0, content: "other bytes" });
  await enqueue("prompt", "prompt.forwarded", "one", { text: "implement" });
  await enqueue("approval", "approval.requested", "one", { approvalId: "approval-1" });
  for (let i = 0; i < 501; i++) await enqueue(`delta-${i}`, "message.delta", "one", { text: "delta" });
  for (let i = 0; i < 505; i++) await enqueue(`terminal-${i}`, "turn.completed");
  await enqueue("expired", "approval.expired", "one", { approvalId: "approval-1" });
  await client.flush();
  const backlog = (await fs.readFile(path.join(dir, "event-queue.jsonl"), "utf8")).split("\n").map(JSON.parse);
  assert.equal(backlog.filter((e) => e.type === "message.delta").length, 500);
  assert.equal(backlog.some((e) => ["old-revision", "delta-0"].includes(e.id)), false);
  assert.deepEqual(backlog.filter((e) => e.type === "file.revision").map((e) => e.id), ["current-revision", "other-attempt-revision"]);
  assert.equal(backlog.filter((e) => e.type === "turn.completed").length, 505);
  assert.ok(["prompt", "approval", "expired"].every((id) => backlog.some((e) => e.id === id)));
  const received = [];
  globalThis.fetch = async (url, opts) => {
    const { events } = JSON.parse(opts.body);
    received.push(...events);
    return { status: 200, async json() { return { accepted: events.map((e) => e.id) }; } };
  };
  await createRelayClient(options).flush();
  assert.deepEqual(received, backlog);
  assert.equal(received.find((e) => e.id === "current-revision").payload.content, "authoritative full bytes");
  const one = received.filter((e) => e.attemptId === "one");
  assert.ok(one.every((e, i) => !i || one[i - 1].sourceSeq < e.sourceSeq));
  assert.equal(await fs.readFile(path.join(dir, "event-queue.jsonl"), "utf8"), "");
});

test("polled session.start then turn.send reaches runtime once and duplicate command is only acknowledged", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codelit-command-test-"));
  const previousDir = process.env.CODELIT_CONFIG_DIR, previousBase = process.env.CODELIT_BASE;
  const previousFetch = globalThis.fetch;
  process.env.CODELIT_CONFIG_DIR = path.join(dir, "state");
  process.env.CODELIT_BASE = path.join(dir, "attempts");
  t.after(async () => {
    globalThis.fetch = previousFetch;
    if (previousDir === undefined) delete process.env.CODELIT_CONFIG_DIR; else process.env.CODELIT_CONFIG_DIR = previousDir;
    if (previousBase === undefined) delete process.env.CODELIT_BASE; else process.env.CODELIT_BASE = previousBase;
    await fs.rm(dir, { recursive: true, force: true });
  });
  const commands = [
    { id: "start", sessionEpoch: 1, type: "session.start", attemptId: "one", payload: { adapter: "codex", model: "chosen", context: { language: "python", stage: 1, stub: "pass\n" } } },
    { id: "send", sessionEpoch: 1, type: "turn.send", attemptId: "one", payload: { turnId: "turn-1", text: "implement", model: "chosen" } },
  ];
  const acked = [], received = [], turns = [];
  let polls = 0;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.op === "events") { received.push(...body.events); return { status: 200, async json() { return { accepted: body.events.map((e) => e.id) }; } }; }
    if (body.op === "ack") { acked.push(body.id); return { status: 200, async json() { return {}; } }; }
    assert.equal(body.op, "poll");
    return { status: polls++ ? 401 : 200, async json() { return { commands: [...commands, commands[1]], leases: [{ attemptId: "one", sessionEpoch: 1, permitWork: true, leaseExpiresAt: Date.now() + 30000 }] }; } };
  };
  const client = createRelayClient({ relay: "https://test.invalid", deviceId: "device", token: "fixture-only" });
  const adapter = {
    onEvent() {}, async capabilities() { return { ready: true, models: [{ id: "chosen" }] }; },
    async start() { return { nativeSessionId: "native", model: "chosen" }; }, state() { return "idle"; },
    async turn(id, text, opts) { turns.push({ id, text, opts }); },
  };
  const runtime = createAttemptRuntime({ adapters: { codex: adapter }, sessions: {}, deviceId: "device", queue: client.queue, saveSessions: async () => {} });
  await client.runLoop(runtime.onCommand);
  await client.flush();
  assert.deepEqual(acked, ["start", "send", "send"]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].opts.turnId, "turn-1");
  assert.ok(turns[0].text.endsWith("implement"));
  assert.equal(received.filter((e) => e.type === "prompt.forwarded").length, 1);
  assert.equal(received.some((e) => e.type === "turn.failed"), false);
});

async function isolatedRelay(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codelit-durable-"));
  const previous = process.env.CODELIT_CONFIG_DIR;
  process.env.CODELIT_CONFIG_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.CODELIT_CONFIG_DIR; else process.env.CODELIT_CONFIG_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("durable receipt and ACK precede effects; lost ACK retries once across restart", async (t) => {
  const dir = await isolatedRelay(t);
  const cmd = { id: "stable", type: "turn.send", attemptId: "attempt", payload: { turnId: "turn" } };
  let effects = 0, lose = true;
  const options = { deviceId: "device", request: async (_r, _d, _t, _route, body) => {
    assert.equal(body.op, "ack");
    const ledger = JSON.parse(await fs.readFile(path.join(dir, "command-ledger.json")));
    assert.ok(ledger["device:stable"]);
    if (lose) throw new Error("ACK response lost");
    return { status: 200, data: {} };
  } };
  const execute = async () => {
    const entry = JSON.parse(await fs.readFile(path.join(dir, "command-ledger.json")))["device:stable"];
    assert.equal(entry.state, "executing"); assert.ok(entry.acknowledgedAt);
    effects++;
  };
  await assert.rejects(createRelayClient(options).processCommand(cmd, execute), /lost/);
  assert.equal(effects, 0);
  lose = false;
  await createRelayClient(options).processCommand(cmd, execute);
  await createRelayClient(options).processCommand(cmd, execute);
  assert.equal(effects, 1);
});

test("uncertain executing command reconciles after restart without repeating inference", async (t) => {
  const dir = await isolatedRelay(t);
  const cmd = { id: "uncertain", type: "turn.send", attemptId: "attempt", payload: { turnId: "turn" } };
  await fs.writeFile(path.join(dir, "command-ledger.json"), JSON.stringify({ "device:uncertain": { state: "executing", command: cmd } }));
  let effects = 0, reconciled = 0;
  const options = { deviceId: "device", request: async () => ({ status: 200, data: {} }) };
  await createRelayClient(options).processCommand(cmd, async () => { effects++; }, async (c) => { assert.equal(c.id, cmd.id); reconciled++; });
  await createRelayClient(options).processCommand(cmd, async () => { effects++; });
  assert.equal(effects, 0); assert.equal(reconciled, 1);
});

test("partial 400 ACK removes accepted prefix, quarantines offender and syncs later attempt", async (t) => {
  const dir = await isolatedRelay(t);
  const records = [
    { id: "old-good", attemptId: "old", deviceId: "old-device", sourceSeq: 0 },
    { id: "bad", attemptId: "old", deviceId: "old-device", sourceSeq: 1 },
    { id: "new-good", attemptId: "new", deviceId: "new-device", sourceSeq: 0 },
  ];
  await fs.writeFile(path.join(dir, "event-queue.jsonl"), records.map(JSON.stringify).join("\n"));
  const uploads = [];
  const client = createRelayClient({ deviceId: "new-device", request: async (_r, _d, _t, _route, body) => {
    uploads.push(body.events);
    return uploads.length === 1 ? { status: 400, data: { accepted: ["old-good"], error: "stale event" } } : { status: 200, data: { accepted: body.events.map((e) => e.id) } };
  } });
  await client.flush();
  assert.deepEqual(uploads[1].map((e) => e.id), ["new-good"]);
  assert.equal(await fs.readFile(path.join(dir, "event-queue.jsonl"), "utf8"), "");
  const quarantine = JSON.parse(await fs.readFile(path.join(dir, "event-quarantine.jsonl"), "utf8"));
  assert.equal(quarantine.event.deviceId, "old-device"); assert.equal(quarantine.gap, true);
});

test("contact watchdog closes work while poll is pending; late response cannot start commands", async (t) => {
  await isolatedRelay(t);
  let release, effects = 0, shutdowns = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const client = createRelayClient({ deviceId: "device", leaseMs: 40, request: async () => pending });
  const loop = client.runLoop(async () => { effects++; }, null, null, { onShutdown: async (reason) => { assert.equal(reason, "execution_lease_expired"); shutdowns++; } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(shutdowns, 1);
  release({ status: 200, data: { commands: [{ id: "late" }] } });
  await loop;
  assert.equal(effects, 0);
});

test("denied browser lease stops only its own session and permits another attempt", async (t) => {
  await isolatedRelay(t);
  const effects = [], stopped = [];
  const client = createRelayClient({ deviceId: "device", request: async (_r, _d, _t, _route, body) => {
    if (body.op === "ack") return { status: 200, data: {} };
    return { status: 200, data: { leases: [
      { attemptId: "denied", sessionEpoch: 1, permitWork: false, leaseExpiresAt: 0 },
      { attemptId: "allowed", sessionEpoch: 2, permitWork: true, leaseExpiresAt: Date.now() + 30000 },
    ], commands: [
      { id: "denied-cmd", attemptId: "denied", sessionEpoch: 1 },
      { id: "allowed-cmd", attemptId: "allowed", sessionEpoch: 2 },
    ] } };
  } });
  await client.runLoop(async (cmd) => { effects.push(cmd.id); client.stop(); }, null, null, { onLeaseLost: async (id, epoch) => { stopped.push([id, epoch]); } });
  assert.deepEqual(stopped, [["denied", 1]]); assert.deepEqual(effects, ["allowed-cmd"]);
});

test("missing execution lease fails closed and receipt ACK crossing lease cannot execute", async (t) => {
  await isolatedRelay(t);
  let effects = 0, polls = 0;
  const client = createRelayClient({ deviceId: "device", request: async (_r, _d, _t, _route, body) => {
    if (body.op === "ack") return { status: 200, data: {} };
    return { status: polls++ ? 401 : 200, data: { commands: [{ id: "unleased", attemptId: "one", sessionEpoch: 1 }] } };
  } });
  await client.runLoop(async () => { effects++; });
  assert.equal(effects, 0);
  const permitted = { value: true };
  const ackClient = createRelayClient({ deviceId: "device", request: async () => { permitted.value = false; return { status: 200, data: {} }; } });
  await ackClient.processCommand({ id: "ack-expired", type: "turn.send" }, async () => { effects++; }, null, () => permitted.value);
  assert.equal(effects, 0);
});

test("expired received work reconciles as preflight instead of executing an old prompt", async (t) => {
  await isolatedRelay(t);
  let effects = 0, outcome;
  const client = createRelayClient({ deviceId: "device", request: async () => ({ status: 200, data: {} }) });
  await client.processCommand({ id: "expired", type: "turn.send", expiresAt: Date.now() - 1 }, async () => { effects++; }, async (_cmd, value) => { outcome = value; });
  assert.equal(effects, 0); assert.deepEqual(outcome, { reason: "expired", inferenceStarted: false });
});

test("ACKed received command recovers locally when server no longer redelivers it", async (t) => {
  const dir = await isolatedRelay(t);
  const cmd = { id: "receipt-only", sessionEpoch: 1, type: "turn.send", attemptId: "one" };
  await fs.writeFile(path.join(dir, "command-ledger.json"), JSON.stringify({ "device:receipt-only": { state: "received", acknowledgedAt: Date.now(), command: cmd } }));
  let effects = 0, acknowledgements = 0;
  const client = createRelayClient({ deviceId: "device", request: async (_r, _d, _t, _route, body) => {
    if (body.op === "ack") { acknowledgements++; return { status: 200, data: {} }; }
    return { status: 200, data: { commands: [], leases: [{ attemptId: "one", sessionEpoch: 1, permitWork: true, leaseExpiresAt: Date.now() + 30000 }] } };
  } });
  await client.runLoop(async (actual) => { assert.equal(actual.id, cmd.id); effects++; client.stop(); });
  assert.equal(effects, 1); assert.equal(acknowledgements, 1);
});

test("per-session expiry watchdog closes expired thread without halting another lease", async (t) => {
  await isolatedRelay(t);
  const closed = [], globalStops = [];
  const client = createRelayClient({ deviceId: "device", leaseMs: 1000, request: async () => ({ status: 200, data: { commands: [], leases: [
    { attemptId: "short", sessionEpoch: 1, permitWork: true, leaseExpiresAt: Date.now() + 30 },
    { attemptId: "long", sessionEpoch: 2, permitWork: true, leaseExpiresAt: Date.now() + 2000 },
  ] } }) });
  await client.runLoop(async () => {}, null, null, { onLeaseLost: async (id) => { closed.push(id); client.stop(); }, onShutdown: async (reason) => { globalStops.push(reason); } });
  assert.deepEqual(closed, ["short"]); assert.deepEqual(globalStops, []);
});

test("failed receipt persistence cannot be bypassed by the in-memory ledger on retry", async (t) => {
  const dir = await isolatedRelay(t);
  const ledger = path.join(dir, "command-ledger.json");
  await fs.mkdir(ledger);
  let acks = 0, effects = 0;
  const client = createRelayClient({ deviceId: "device", request: async () => {
    const saved = JSON.parse(await fs.readFile(ledger, "utf8"));
    assert.equal(saved["device:disk-retry"].state, "received");
    acks++; return { status: 200, data: {} };
  } });
  const cmd = { id: "disk-retry", type: "turn.send" };
  await assert.rejects(client.processCommand(cmd, async () => { effects++; }));
  assert.equal(acks, 0); assert.equal(effects, 0);
  await fs.rm(ledger, { recursive: true });
  await client.processCommand(cmd, async () => { effects++; });
  assert.equal(acks, 1); assert.equal(effects, 1);
});

test("corrupt ledger shape fails closed without receipt ACK or effects", async (t) => {
  const dir = await isolatedRelay(t);
  await fs.writeFile(path.join(dir, "command-ledger.json"), "[]");
  let acks = 0, effects = 0;
  const client = createRelayClient({ deviceId: "device", request: async () => { acks++; return { status: 200, data: {} }; } });
  await assert.rejects(client.processCommand({ id: "never-run" }, async () => { effects++; }), /Invalid command ledger/);
  assert.equal(acks, 0); assert.equal(effects, 0);
});
