#!/usr/bin/env node
// codelit-connect: pair this machine, then run the relay loop.
//   pair --relay <https://codelit-host> --code <CODE> [--label NAME] [--yes]
//   run  --relay <https://codelit-host>
//   status | probe-codex
// Auth model: your agent login stays in your own tools (~/.codex, claude
// login). Codelit gets a revocable device token only — never your tokens.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import * as codex from "../lib/codex.mjs";
import * as claude from "../lib/claude.mjs";
import { claimPairingCode, createRelayClient, loadCred, saveCred } from "../lib/relay.mjs";
import {
  applyBrowserEdit, attemptDir, initAttempt, readSolution,
  recordAgentWrite, runVisible, safeJoin, setInFlight,
} from "../lib/workspace.mjs";

const ADAPTERS = { codex, claude };
const PROTOCOL_V = 1;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
const has = (name) => process.argv.includes(name);

function sessionsPath() {
  return path.join(os.homedir(), ".codelit", "sessions.json");
}
async function loadSessions() {
  try { return JSON.parse(await fs.readFile(sessionsPath(), "utf8")); } catch { return {}; }
}
async function saveSessions(s) {
  await fs.mkdir(path.dirname(sessionsPath()), { recursive: true });
  await fs.writeFile(sessionsPath(), JSON.stringify(s));
}

async function confirm(question) {
  if (has("--yes")) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise((r) => rl.question(`${question} [y/N] `, r));
  rl.close();
  return ans.trim().toLowerCase() === "y";
}

async function cmdStatus() {
  for (const [name, a] of Object.entries(ADAPTERS)) {
    const d = await a.detect();
    const c = await a.capabilities();
    console.log(`${name}: ${d.found ? `found (${d.version})` : `missing — ${d.hint}`} | validated=${c.validated}`);
  }
}

async function cmdProbeCodex() {
  const r = await codex.probe();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}

async function cmdPair() {
  const relay = arg("--relay");
  const code = arg("--code");
  if (!relay || !code) {
    console.error("usage: codelit-connect pair --relay <https://host> --code <CODE> [--label NAME] [--yes]");
    process.exit(2);
  }
  const adapters = [];
  for (const a of Object.values(ADAPTERS)) {
    try { adapters.push(await a.capabilities()); } catch {}
  }
  console.log("This pairs THIS machine with your Codelit browser session.");
  console.log("Shared with Codelit: challenge messages, agent replies, tool activity, file revisions.");
  console.log("Never shared: your agent login, tokens, or unrelated files/chats.");
  if (!await confirm("Pair this machine?")) process.exit(1);
  const label = arg("--label") || os.hostname().slice(0, 40);
  const r = await claimPairingCode(relay.replace(/\/+$/, ""), code, label, adapters);
  if (r.status !== 200 || !r.data.deviceId) {
    console.error("pairing failed:", r.data.error || r.status);
    process.exit(1);
  }
  await saveCred({ relay: relay.replace(/\/+$/, ""), deviceId: r.data.deviceId, token: r.data.token });
  console.log(`paired as device ${r.data.deviceId}. Credential stored with mode 0600. Now run: codelit-connect run --relay ${relay}`);
}

function wrapEvent(ev, ctx) {
  return {
    v: PROTOCOL_V,
    id: `ev_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`,
    attemptId: ctx.attemptId,
    deviceId: ctx.deviceId,
    nativeSessionId: ctx.threadId,
    turnId: ev.turnId || ctx.turnId || null,
    parentId: null,
    type: ev.type,
    source: "connector",
    sourceSeq: -1, // relay client assigns
    sourceTime: ev.sourceTime || Date.now(),
    adapter: ev.adapter || ctx.adapter,
    model: ev.model || null,
    payload: ev.payload || {},
  };
}

async function cmdRun() {
  const relayFlag = arg("--relay");
  const cred = await loadCred();
  const relay = (relayFlag || (cred && cred.relay) || "").replace(/\/+$/, "");
  if (!relay || !cred) {
    console.error("no pairing found. Run: codelit-connect pair --relay <https://host> --code <CODE>");
    process.exit(2);
  }
  const client = createRelayClient({ relay, deviceId: cred.deviceId, token: cred.token });
  const sessions = await loadSessions();

  // Crash recovery: any turn left in-flight was NOT auto-resent. Report it.
  for (const [attemptId, s] of Object.entries(sessions)) {
    if (s && s.inFlight) {
      await client.queue(wrapEvent({ type: "turn.failed", payload: { error: "connector restarted mid-turn; the prompt was not auto-resent" }, turnId: s.inFlight }, { attemptId, deviceId: cred.deviceId, adapter: s.adapter, threadId: s.threadId }));
      s.inFlight = null;
    }
  }
  await saveSessions(sessions);
  await client.flush();

  const ctxFor = (attemptId) => {
    const s = sessions[attemptId] || {};
    return { attemptId, deviceId: cred.deviceId, adapter: s.adapter || "codex", threadId: s.threadId || null, turnId: s.inFlight || null };
  };

  for (const a of Object.values(ADAPTERS)) {
    a.onEvent((ev) => {
      // Route adapter events to their attempt via threadId.
      for (const [attemptId, s] of Object.entries(sessions)) {
        if (s && s.threadId === ev.nativeSessionId) {
          if (ev.type === "turn.completed" || ev.type === "turn.failed" || ev.type === "turn.interrupted") s.inFlight = null;
          void client.queue(wrapEvent(ev, ctxFor(attemptId)));
          void saveSessions(sessions);
        }
      }
    });
  }

  async function emitFileRevision(attemptId, dir, language, extra = {}) {
    const r = await readSolution(dir, language);
    await client.queue({ ...wrapEvent({ type: "file.revision", payload: { rev: r.rev, hash: r.hash, content: r.content.slice(0, 8000), ...extra } }, ctxFor(attemptId)) });
  }

  async function onCommand(cmd) {
    const p = cmd.payload || {};
    const attemptId = cmd.attemptId;
    const dir = attemptDir(attemptId);

    if (cmd.type === "session.start") {
      const context = p.context || {};
      const adapter = ADAPTERS[p.adapter] || codex;
      await initAttempt(dir, context);
      const { nativeSessionId } = await adapter.start({ cwd: dir, model: process.env.CODELIT_MODEL || null });
      sessions[attemptId] = { deviceId: cred.deviceId, adapter: p.adapter || "codex", threadId: nativeSessionId, context, inFlight: null };
      await saveSessions(sessions);
      await emitFileRevision(attemptId, dir, context.language);
      return;
    }

    const s = sessions[attemptId];
    if (!s) throw new Error("no local session for attempt (restarted? ask for a new session)");
    const adapter = ADAPTERS[s.adapter] || codex;
    const context = s.context || {};

    if (cmd.type === "turn.send") {
      if (p.pendingEdit) {
        const r = await applyBrowserEdit(dir, context.language, p.pendingEdit.code, p.pendingEdit.baseRev);
        if (r.conflict) {
          await client.queue(wrapEvent({ type: "file.revision", payload: { rev: r.rev, conflict: true } }, ctxFor(attemptId)));
          await client.queue(wrapEvent({ type: "message.final", payload: { text: "Your editor was behind the agent's latest revision, so the flushed edit was not applied. The agent revision stands." } }, ctxFor(attemptId)));
        } else {
          await emitFileRevision(attemptId, dir, context.language);
        }
      }
      s.inFlight = p.turnId || null;
      await saveSessions(sessions);
      await setInFlight(dir, s.inFlight).catch(() => {});
      await adapter.turn(s.threadId, String(p.text || ""), { turnId: p.turnId });
      return;
    }
    if (cmd.type === "turn.interrupt") {
      await adapter.interrupt(s.threadId);
      return;
    }
    if (cmd.type === "approval.decide") {
      await adapter.decideApproval(s.threadId, String(p.approvalId || ""), String(p.decision || "deny"));
      return;
    }
    if (cmd.type === "context.sync") {
      const context2 = p.context || context;
      s.context = { ...context, ...context2 };
      await saveSessions(sessions);
      await fs.writeFile(await safeJoin(dir, "TASK.md"), `# ${s.context.title} (stage ${s.context.stage})\n\n${s.context.brief}\n`);
      return;
    }
    if (cmd.type === "test.run") {
      const ctx = s.context || {};
      const r = await runVisible(dir, ctx.language, ctx.visibleTests || [], ctx.fnName);
      await client.queue(wrapEvent({ type: "local.command", payload: { cmd: "visible checks", passed: r.passed === r.total, summary: r.summary } }, ctxFor(attemptId)));
      return;
    }
    if (cmd.type === "freeze.request") {
      const deadline = Date.now() + 30000;
      let st = adapter.state(s.threadId);
      if (st === "running" || st === "waiting_approval") {
        await adapter.interrupt(s.threadId).catch(() => {});
        await new Promise((r) => setTimeout(r, 8000));
        st = adapter.state(s.threadId);
      }
      while ((st === "running" || st === "waiting_approval") && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        st = adapter.state(s.threadId);
      }
      const wr = await recordAgentWrite(dir, (s.context || {}).language || "python");
      const sol = await readSolution(dir, (s.context || {}).language || "python");
      if (!sol.content.trim()) {
        await client.queue(wrapEvent({ type: "message.final", payload: { text: "Nothing to submit — the solution file is empty." } }, ctxFor(attemptId)));
        return;
      }
      if (wr.rev === 0) {
        // The file never changed since the starter: the agent likely answered
        // in chat without editing. Freeze anyway (honest evaluation), but say so.
        await client.queue(wrapEvent({ type: "message.final", payload: { text: "Heads up: solution file unchanged since the starter — the agent never edited it. Freezing these bytes; they will likely fail acceptance." } }, ctxFor(attemptId)));
      }
      await emitFileRevision(attemptId, dir, (s.context || {}).language || "python");
      const up = await client.uploadSnapshot(attemptId, {
        path: `solution${(s.context || {}).language === "python" ? ".py" : (s.context || {}).language === "c++" ? ".cpp" : ".js"}`,
        source: sol.content,
        language: (s.context || {}).language || "python",
        revision: wr.rev,
      });
      if (up.status !== 200) {
        await client.queue(wrapEvent({ type: "message.final", payload: { text: `Snapshot upload failed (${up.status}); retry Finish.` } }, ctxFor(attemptId)));
      }
      return;
    }
    throw new Error(`unknown command ${cmd.type}`);
  }

  console.log(`[codelit-connect] relaying to ${relay} as ${cred.deviceId}. Ctrl-C interrupts (active turns get one interrupt).`);
  const stop = async () => {
    console.log("\nstopping: interrupting active turns…");
    for (const s of Object.values(sessions)) {
      if (s && s.inFlight) {
        try { await ADAPTERS[s.adapter || "codex"].interrupt(s.threadId); } catch {}
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  await client.runLoop(onCommand, async () => {
    console.error("[codelit-connect] device revoked or unknown. Re-pair to continue.");
    process.exit(3);
  });
}

const cmd = process.argv[2];
if (cmd === "pair") await cmdPair();
else if (cmd === "run") await cmdRun();
else if (cmd === "status") await cmdStatus();
else if (cmd === "probe-codex") await cmdProbeCodex();
else {
  console.error("usage: codelit-connect <pair|run|status|probe-codex> [options]");
  process.exit(2);
}
