// Relay client: talks to the Codelit /api/native/* routes with the device
// credential. Outbound-only HTTPS (default) — no listener on the device.
// Event backlog persists on disk (deltas bounded); replay resumes from the last
// acked sourceSeq and the server emits a gap event if numbers skip.

import { promises as fs } from "node:fs";
import { configDir } from "./config.mjs";
import path from "node:path";

const TIMEOUT_MS = 25000;

function credPath() {
  return path.join(configDir(), "device.json");
}

export async function loadCred() {
  try {
    const c = JSON.parse(await fs.readFile(credPath(), "utf8"));
    if (c.relay && c.deviceId && c.token) return c;
  } catch {}
  return null;
}

export async function saveCred(cred) {
  const dir = path.dirname(credPath());
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(credPath(), JSON.stringify(cred), { mode: 0o600 });
}

async function post(relay, deviceId, token, route, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${relay}/api/native/${route}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "x-device-id": deviceId,
        "x-device-token": token,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

function queuePath() {
  return path.join(configDir(), "event-queue.jsonl");
}

async function readQueue() {
  try {
    const raw = await fs.readFile(queuePath(), "utf8");
    return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("Cannot read connector event backlog; preserve the file and repair it before relaying.");
  }
}

async function writeQueue(items) {
  // Only expendable streaming deltas may be dropped. Revisions are full
  // snapshots, so retain the latest per device/attempt; keep every other
  // event until acknowledged (terminal, prompt and approval replay matters).
  // An outage may grow critical history beyond 500: never silently trade
  // correctness for a total event count limit.
  const revisions = new Set();
  let deltas = 0;
  const trimmed = [...items].reverse().filter((event) => {
    if (event.type === "message.delta") return ++deltas <= 500;
    if (event.type === "file.revision") {
      const key = JSON.stringify([event.deviceId, event.attemptId]);
      if (revisions.has(key)) return false;
      revisions.add(key);
    }
    return true;
  }).reverse();
  await fs.mkdir(path.dirname(queuePath()), { recursive: true });
  const tmp = `${queuePath()}.tmp-${process.pid}`;
  await fs.writeFile(tmp, trimmed.map((e) => JSON.stringify(e)).join("\n"), { mode: 0o600 });
  await fs.rename(tmp, queuePath());
}

export function createRelayClient({ relay, deviceId, token, request = post, leaseMs = 30000 }) {
  const send = (route, body) => request(relay, deviceId, token, route, body);
  let sequences;
  const seqPath = () => path.join(configDir(), "event-sequences.json");
  async function loadSequences() {
    if (sequences) return;
    try { sequences = JSON.parse(await fs.readFile(seqPath(), "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; sequences = {}; }
  }
  async function saveSequences() {
    await fs.mkdir(configDir(), { recursive: true, mode: 0o700 });
    const tmp = `${seqPath()}.tmp-${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(sequences), { mode: 0o600 });
    await fs.rename(tmp, seqPath());
  }
  let flushPending;
  let mutationTail = Promise.resolve();
  const mutate = (fn) => {
    const result = mutationTail.then(fn);
    mutationTail = result.catch(() => {});
    return result;
  };
  async function restoreSeq(hint, attemptId) {
    if (!attemptId || !Number.isInteger(hint)) return;
    await mutate(async () => {
      await loadSequences();
      const key = `${deviceId}:${attemptId}`;
      sequences[key] = Math.max(sequences[key] || 0, hint + 1);
      await saveSequences();
    });
  }
  async function queue(event) {
    await mutate(async () => {
      const q = await readQueue();
      await loadSequences();
      const eventDeviceId = event.deviceId || deviceId;
      const key = `${eventDeviceId}:${event.attemptId}`;
      const sourceSeq = Math.max(sequences[key] || 0, ...q.filter((e) => e.deviceId === eventDeviceId && e.attemptId === event.attemptId).map((e) => (e.sourceSeq ?? -1) + 1));
      sequences[key] = sourceSeq + 1;
      // Reserve durably before queue append: crashes may create a reported
      // gap, but never silently reuse an already uploaded sequence number.
      await saveSequences();
      q.push({ ...event, deviceId: eventDeviceId, sourceSeq });
      await writeQueue(q);
    });
    void flush().catch((error) => console.error("[relay] flush failed:", error.message));
  }
  function flush() {
    if (flushPending) return flushPending;
    flushPending = (async () => {
      for (;;) {
        const batch = await mutate(async () => (await readQueue()).slice(0, 50));
        if (!batch.length) break;
        let r;
        try { r = await send("relay", { op: "events", events: batch }); }
        catch { break; }
        const accepted = new Set(Array.isArray(r.data.accepted) ? r.data.accepted : []);
        // Partial acceptance is authoritative even when a later event failed.
        await mutate(async () => writeQueue((await readQueue()).filter((e) => !accepted.has(e.id))));
        if (r.status === 401) {
          console.error("[relay] device rejected; local event backlog was preserved.");
          break;
        }
        if ([400, 403, 404, 409, 410, 413, 422].includes(r.status)) {
          const rejected = batch.find((e) => !accepted.has(e.id));
          if (!rejected) continue;
          await mutate(async () => {
            // Keep original identity and bytes as evidence; never reattribute on pairing.
            await fs.appendFile(path.join(configDir(), "event-quarantine.jsonl"), JSON.stringify({ event: rejected, status: r.status, error: r.data.error, quarantinedAt: Date.now(), gap: true }) + "\n", { mode: 0o600 });
            await writeQueue((await readQueue()).filter((e) => e.id !== rejected.id));
          });
          console.error(`[relay] visible sync gap: quarantined ${rejected.id} (${r.status}); inspect event-quarantine.jsonl`);
          continue;
        }
        if (r.status !== 200 || !accepted.size) break;
      }
    })().finally(() => { flushPending = null; });
    return flushPending;
  }

  const ledgerPath = () => path.join(configDir(), "command-ledger.json");
  let ledger;
  async function loadLedger() {
    if (ledger) return;
    try {
      const loaded = JSON.parse(await fs.readFile(ledgerPath(), "utf8"));
      if (!loaded || Array.isArray(loaded) || typeof loaded !== "object" || Object.values(loaded).some((entry) => !entry || !["received", "executing", "completed"].includes(entry.state) || typeof entry.command?.id !== "string")) throw new Error("Invalid command ledger; preserve and repair it before executing commands");
      ledger = loaded;
    } catch (error) { if (error.code !== "ENOENT") throw error; ledger = {}; }
  }
  async function persistLedger() {
    await fs.mkdir(configDir(), { recursive: true, mode: 0o700 });
    const tmp = `${ledgerPath()}.tmp-${process.pid}`;
    const file = await fs.open(tmp, "w", 0o600);
    try { await file.writeFile(JSON.stringify(ledger)); await file.sync(); } finally { await file.close(); }
    await fs.rename(tmp, ledgerPath());
    const dir = await fs.open(configDir(), "r");
    try { await dir.sync(); } finally { await dir.close(); }
  }
  let commandTail = Promise.resolve();
  function processCommand(cmd, onCommand, reconcile, permit = () => true) {
    const operation = commandTail.then(async () => {
      if (!cmd || typeof cmd.id !== "string" || !cmd.id || cmd.id.length > 200) throw new Error("Invalid command identity");
      await loadLedger();
      const key = `${deviceId}:${cmd.id}`;
      let entry = ledger[key];
      if (entry && JSON.stringify([entry.command.type, entry.command.attemptId, entry.command.sessionEpoch, entry.command.payload]) !== JSON.stringify([cmd.type, cmd.attemptId, cmd.sessionEpoch, cmd.payload])) throw new Error("Command ID reused with different payload; reconciliation required");
      if (!entry) {
        entry = ledger[key] = { command: cmd, state: "received", receivedAt: Date.now() };
      }
      // Retry persistence even for cached entries: an earlier disk write may
      // have failed after updating memory. Never ACK that undurable receipt.
      await persistLedger();
      // ACK durable receipt BEFORE effects. A lost ACK response cannot execute.
      const ack = await send("relay", { op: "ack", id: cmd.id });
      if (ack.status !== 200) throw new Error(`Command receipt ACK failed (${ack.status})`);
      entry.acknowledgedAt = Date.now();
      await persistLedger();
      if (entry.state === "completed") return;
      const expired = Number.isFinite(cmd.expiresAt) && Date.now() >= cmd.expiresAt;
      if (!permit() && !expired) return;
      if (expired) {
        if (!reconcile) throw new Error("Expired command requires reconciliation");
        await reconcile(entry.command, { reason: "expired", inferenceStarted: entry.state === "executing" });
      } else if (entry.state === "executing") {
        // Never resend uncertain inference/session creation after restart.
        if (!reconcile) throw new Error("Uncertain command requires explicit reconciliation");
        await reconcile(entry.command);
      } else {
        entry.state = "executing";
        await persistLedger();
        if (!permit()) { entry.state = "received"; await persistLedger(); return; }
        try { await onCommand(entry.command); }
        catch (error) { entry.error = error.message; }
      }
      entry.state = "completed";
      entry.completedAt = Date.now();
      await persistLedger();
    });
    commandTail = operation.catch(() => {});
    return operation;
  }
  let stopped = false;
  let wake;
  const stop = () => { stopped = true; wake?.(); };
  const sleep = (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => { clearTimeout(timer); resolve(); };
  });
  /** Contact/presence leases bound active work; remote revocation is not instantaneous offline. */
  async function runLoop(onCommand, onAuthLost, getAdapters, options = {}) {
    let lastReported = 0;
    let backoff = 1000;
    let deadline = Date.now() + Math.min(leaseMs, 29000);
    let shuttingDown;
    const leases = new Map();
    const leaseStops = new Set();
    const stopLease = (lease, reason) => {
      if (lease.stopped) return;
      lease.stopped = true;
      const pending = Promise.resolve(options.onLeaseLost?.(lease.attemptId, lease.sessionEpoch, reason));
      leaseStops.add(pending);
      void pending.catch((error) => console.error("[relay] session shutdown failed:", error.message)).finally(() => leaseStops.delete(pending));
    };
    const permits = (cmd) => {
      const lease = leases.get(cmd.attemptId);
      return !stopped && Date.now() < deadline && !!lease && !lease.stopped && lease.permitWork === true && lease.sessionEpoch === (cmd.sessionEpoch ?? cmd.payload?.sessionEpoch) && Date.now() < lease.leaseExpiresAt;
    };
    const shutdown = (reason) => {
      stop();
      return shuttingDown ||= Promise.resolve(options.onShutdown?.(reason));
    };
    const watchdog = setInterval(() => {
      if (Date.now() >= deadline) void shutdown("execution_lease_expired");
      else for (const lease of leases.values()) if (Date.now() >= lease.leaseExpiresAt) stopLease(lease, "browser_execution_lease_expired");
    }, Math.min(250, leaseMs));
    try {
      while (!stopped) {
        let r;
        try {
          const body = { op: "poll" };
          if (getAdapters && Date.now() - lastReported >= 30000) {
            body.adapters = await getAdapters(); lastReported = Date.now();
          }
          r = await send("relay", body);
        } catch {
          if (!stopped) await sleep(backoff);
          backoff = Math.min(backoff * 2, 5000);
          continue;
        }
        if (stopped) break;
        if (r.status === 401 || r.status === 403) {
          await shutdown("device_revoked");
          await onAuthLost?.(); break;
        }
        if (r.status !== 200) { await sleep(backoff); continue; }
        deadline = Date.now() + Math.min(leaseMs, 29000);
        const incoming = Array.isArray(r.data.leases) ? r.data.leases : [];
        const seen = new Set();
        for (const value of incoming) {
          if (typeof value.attemptId !== "string") continue;
          seen.add(value.attemptId);
          const previous = leases.get(value.attemptId);
          if (previous && previous.sessionEpoch !== value.sessionEpoch) stopLease(previous, "session_epoch_changed");
          const valid = value.permitWork === true && typeof value.leaseExpiresAt === "number" && Number.isFinite(value.leaseExpiresAt) && value.leaseExpiresAt > Date.now() && value.sessionEpoch !== undefined;
          const lease = { ...value, permitWork: valid, leaseExpiresAt: valid ? value.leaseExpiresAt : 0, stopped: false };
          leases.set(value.attemptId, lease);
          if (!valid) stopLease(lease, "browser_execution_lease_expired");
          else {
            await Promise.allSettled([...leaseStops]);
            await options.onLeaseRenewed?.(lease.attemptId, lease.sessionEpoch);
          }
        }
        // A missing session lease fails closed for that session only.
        for (const [id, lease] of leases) if (!seen.has(id)) stopLease(lease, "browser_execution_lease_missing");
        backoff = 1000;
        if (typeof r.data.lastSourceSeq === "number") await restoreSeq(r.data.lastSourceSeq, r.data.attemptId);
        await flush();
        await loadLedger();
        // ACKed receipt may have been lost locally before execution; recover it
        // even though the server correctly stopped redelivering after receipt.
        const pending = Object.entries(ledger).filter(([key, e]) => key.startsWith(deviceId + ":") && e.state !== "completed").map(([, e]) => e.command);
        const commands = [...pending, ...(r.data.commands || [])];
        for (const cmd of commands) {
          if (stopped || Date.now() >= deadline) break;
          try { await processCommand(cmd, onCommand, options.reconcile, () => permits(cmd)); }
          catch (error) { console.error(`[relay] command ${cmd.type}: ${error.message}`); }
        }
        if (!stopped) await sleep(commands.length ? 500 : 2500);
      }
      if (shuttingDown) await shuttingDown;
      await Promise.allSettled([...leaseStops]);
    } finally { clearInterval(watchdog); }
  }

  async function uploadSnapshot(attemptId, payload) {
    return send("relay", { op: "snapshot", attemptId, ...payload });
  }

  return { queue, flush, runLoop, uploadSnapshot, restoreSeq, processCommand, stop };
}

export async function claimPairingCode(relay, code, label, adapters) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${relay}/api/native/pair`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "claim", code, label, adapters }),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } finally {
    clearTimeout(t);
  }
}
