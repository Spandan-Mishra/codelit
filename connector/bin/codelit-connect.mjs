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
import { configDir } from "../lib/config.mjs";
import { createAttemptRuntime } from "../lib/runtime.mjs";

const ADAPTERS = { codex, claude };

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
const has = (name) => process.argv.includes(name);

function sessionsPath() {
  return path.join(configDir(), "sessions.json");
}
async function loadSessions() {
  try {
    const sessions = JSON.parse(await fs.readFile(sessionsPath(), "utf8"));
    if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) throw new Error("Invalid saved connector sessions");
    return sessions;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error("Cannot read saved connector sessions. Preserve sessions.json and repair it before running; no data was reset.");
  }
}
let sessionWriteTail = Promise.resolve();
function saveSessions(s) {
  const bytes = JSON.stringify(s);
  sessionWriteTail = sessionWriteTail.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(sessionsPath()), { recursive: true, mode: 0o700 });
    const tmp = `${sessionsPath()}.tmp-${process.pid}`;
    await fs.writeFile(tmp, bytes, { mode: 0o600 });
    await fs.rename(tmp, sessionsPath());
  });
  return sessionWriteTail;
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
    console.log(`${name}: ${c.status} | installed=${c.installed} | ready=${c.ready} | ${d.version || "missing"}\n  ${c.message}\n  models: ${c.models.map((m) => `${m.id} (${m.label})`).join(", ") || "none"}`);
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
  // Existing attempts retain their original device identity. Re-pairing is
  // not authorization to transfer an attempt; the browser owns that policy.

  for (const [attemptId, session] of Object.entries(sessions)) {
    if (session?.deviceId && session.deviceId !== cred.deviceId) {
      console.error(`[codelit-connect] command_reconciliation_required (${attemptId}): device changed — approve the transfer in the browser or start a new attempt. Saved identity and events were preserved.`);
    }
  }

  let adapters = [];
  let lastDiscovery = 0;
  const refreshAdapters = async () => {
    if (Date.now() - lastDiscovery >= 30000) {
      adapters = await Promise.all(Object.values(ADAPTERS).map((a) => a.capabilities()));
      lastDiscovery = Date.now();
    }
    return adapters;
  };
  await refreshAdapters();
  const runtime = createAttemptRuntime({
    adapters: ADAPTERS, sessions, deviceId: cred.deviceId,
    queue: client.queue, uploadSnapshot: client.uploadSnapshot, saveSessions,
    getCapabilities: async (name) => (await refreshAdapters()).find((a) => a.adapter === name),
  });
  await runtime.recover();
  await saveSessions(sessions);
  await client.flush();

  console.log(`[codelit-connect] relaying to ${relay} as ${cred.deviceId}. Ctrl-C interrupts (active turns get one interrupt).`);
  let stopping;
  const stop = (reason = "signal", code = 0) => {
    client.stop();
    return stopping ||= (async () => {
      console.log(`\nstopping: ${reason}`);
      process.exitCode = code;
      await runtime.shutdown(reason);
      await client.flush();
      process.exitCode = code;
    })();
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("uncaughtException", (error) => { console.error(error); void stop("uncaughtException", 1); });
  process.on("unhandledRejection", (error) => { console.error(error); void stop("unhandledRejection", 1); });
  await client.runLoop(runtime.onCommand, async () => {
    console.error("[codelit-connect] device revoked or unknown. Re-pair to continue.");
    await stop("device_revoked", 3);
  }, refreshAdapters, { reconcile: runtime.reconcile, onShutdown: (reason) => stop(reason, 3), onLeaseLost: runtime.stopAttempt, onLeaseRenewed: runtime.renewAttempt });
  if (stopping) await stopping;
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
