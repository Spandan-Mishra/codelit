// Explicit opt-in: one small real inference, ephemeral native session and
// disposable workspace; never reads or modifies Codelit's saved attempts.
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as codex from "../lib/codex.mjs";
import { createAttemptRuntime } from "../lib/runtime.mjs";

test("isolated Codex actually edits the solution artifact", { skip: process.env.CODELIT_LIVE_TEST !== "1", timeout: 90000 }, async (t) => {
  const preflight = await codex.probe();
  assert.equal(preflight.ready, true, preflight.message);
  // Use only a model advertised by this machine's installed runtime.
  const model = preflight.models.find((m) => /luna/i.test(m.id))?.id || preflight.models[0].id;
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codelit-live-"));
  const previous = process.env.CODELIT_BASE;
  process.env.CODELIT_BASE = base;
  const sessions = {}, events = [];
  let timer, resolveTerminal;
  const terminal = new Promise((resolve, reject) => {
    resolveTerminal = resolve;
    timer = setTimeout(() => reject(new Error("Codex did not finish within the 60-second inference bound")), 60000);
  });
  // Install rejection handler immediately while session startup is in progress.
  terminal.catch(() => {});
  t.after(async () => {
    clearTimeout(timer);
    if (sessions.live?.threadId) {
      await codex.interrupt(sessions.live.threadId).catch(() => {});
      await codex.close(sessions.live.threadId);
    }
    if (previous === undefined) delete process.env.CODELIT_BASE; else process.env.CODELIT_BASE = previous;
    await fs.rm(base, { recursive: true, force: true });
  });
  const adapter = { ...codex,
    start: (args) => codex.start({ ...args, ephemeral: true }),
    turn: (id, text, opts) => codex.turn(id, text, { ...opts, effort: "low" }),
  };
  const runtime = createAttemptRuntime({ adapters: { codex: adapter }, sessions, deviceId: "isolated-live-test",
    queue: async (e) => { events.push(e); if (["turn.completed", "turn.failed", "turn.interrupted"].includes(e.type)) resolveTerminal(e); },
    getCapabilities: async () => preflight, saveSessions: async () => {}, uploadSnapshot: async () => { throw Error("No uploads in isolated live test"); },
  });
  await runtime.onCommand({ type: "session.start", attemptId: "live", payload: { adapter: "codex", model,
    context: { title: "Isolated add smoke test", language: "python", fnName: "add", stage: 1, brief: "Implement add(a, b) returning the sum of two integers.", stub: "def add(a, b):\n    pass\n", visibleTests: [{ input: "add(2, 3)", expected: "5" }] },
  } });
  await runtime.onCommand({ type: "turn.send", attemptId: "live", payload: { turnId: "isolated-turn", model, text: "Implement add now. Make the smallest direct edit to solution.py using your tools. No planning, research, extra files, or delegation." } });
  const end = await terminal;
  await runtime.drain();
  assert.equal(end.type, "turn.completed", JSON.stringify(end.payload));
  const solution = await fs.readFile(path.join(base, "live", "solution.py"), "utf8");
  assert.match(solution, /return\s+.*a\s*\+\s*b/);
  assert.ok(events.some((e) => e.type === "file.revision" && e.payload.rev > 0));
  assert.equal(end.model, model);
  console.log(JSON.stringify({ model, terminal: end.type, solutionChanged: true, toolEvents: events.filter((e) => e.type.startsWith("tool.")).length }));
});
