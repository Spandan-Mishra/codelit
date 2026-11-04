// Offline tests for the Muse adapter: event mapping + discovery.
// No network, no real `muse` process.

import assert from "node:assert/strict";
import { createDiscovery, mapRecord, MUSE_MODELS } from "../lib/muse.mjs";

// --- mapRecord: streaming deltas accumulate into message.final text ---
{
  const s = { text: "", started: false, terminal: false };
  assert.deepEqual(mapRecord(s, { payload_type: "run.lifecycle.started", payload: {} }), [["turn.started", {}]]);
  // second started is deduped
  assert.deepEqual(mapRecord(s, { payload_type: "run.lifecycle.started", payload: {} }), []);
  assert.deepEqual(mapRecord(s, { payload_type: "run.output.delta", payload: { text: "Hel" } }), [["message.delta", { text: "Hel", delta: "Hel" }]]);
  assert.deepEqual(mapRecord(s, { payload_type: "run.output.delta", payload: { text: "lo" } }), [["message.delta", { text: "Hello", delta: "lo" }]]);
  const done = mapRecord(s, { payload_type: "run.terminal.completed", payload: { text: "Hello" } });
  assert.deepEqual(done, [["message.final", { text: "Hello" }], ["turn.completed", { status: "completed" }]]);
  assert.equal(s.terminal, true);
  // unknown records are ignored, not errors
  assert.deepEqual(mapRecord(s, { payload_type: "run.usage", payload: { input_tokens: 1 } }), []);
  assert.deepEqual(mapRecord(s, null), []);
}

// --- tool side effects surface as tool.requested ---
{
  const s = { text: "", started: true, terminal: false };
  assert.deepEqual(mapRecord(s, { payload_type: "task.lifecycle.side_effect_intent", payload: { operation: "file_write" } }),
    [["tool.requested", { name: "file_write", summary: "file_write" }]]);
}

console.log("muse adapter: event mapping ok");

// --- discovery: missing / unauthenticated / ready paths, no inference ---
const missing = createDiscovery({ detectRuntime: async () => ({ found: false, hint: "install" }), usageRuntime: async () => "", hasCredential: () => false, env: {} });
assert.equal((await missing()).status, "missing");

const unauth = createDiscovery({ detectRuntime: async () => ({ found: true, version: "1.4.14" }), usageRuntime: async () => "No subscription allowance (no_allowance)", hasCredential: () => false, env: {} });
const unauthResult = await unauth();
assert.equal(unauthResult.status, "unauthenticated");
assert.equal(unauthResult.ready, false);

const keyed = createDiscovery({ detectRuntime: async () => ({ found: true, version: "1.4.14" }), usageRuntime: async () => { throw new Error("usage must not be called when META_API_KEY is set"); }, hasCredential: () => false, env: { META_API_KEY: "test" } });

// Saved credential counts as signed in even when usage says no_allowance
// (verified live: login + turns work while `muse usage` shows no_allowance).
const credentialed = createDiscovery({ detectRuntime: async () => ({ found: true, version: "1.4.14" }), usageRuntime: async () => "No subscription allowance (no_allowance)", hasCredential: () => true, env: {} });
assert.equal((await credentialed()).status, "ready");
const keyedResult = await keyed();
assert.equal(keyedResult.status, "ready");
assert.deepEqual(keyedResult.models, MUSE_MODELS);

const signedIn = createDiscovery({ detectRuntime: async () => ({ found: true, version: "1.4.14" }), usageRuntime: async () => "Plan: Muse Spark allowance remaining 42%", hasCredential: () => false, env: {} });
assert.equal((await signedIn()).status, "ready");

console.log("muse adapter: discovery ok");
