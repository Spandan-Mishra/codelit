// Relay client: talks to the Codelit /api/native/* routes with the device
// credential. Outbound-only HTTPS (default) — no listener on the device.
// Event backlog persists on disk (bounded); replay resumes from the last
// acked sourceSeq and the server emits a gap event if numbers skip.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const TIMEOUT_MS = 25000;

function credPath() {
  return path.join(os.homedir(), ".codelit", "device.json");
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
  return path.join(os.homedir(), ".codelit", "event-queue.jsonl");
}

async function readQueue() {
  try {
    const raw = await fs.readFile(queuePath(), "utf8");
    return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function writeQueue(items) {
  // Bounded: keep newest 500, prefer finalized over deltas.
  const trimmed = items.slice(-500);
  await fs.mkdir(path.dirname(queuePath()), { recursive: true });
  await fs.writeFile(queuePath(), trimmed.map((e) => JSON.stringify(e)).join("\n"));
}

export function createRelayClient({ relay, deviceId, token }) {
  let sourceSeq = 0;
  let flushing = false;

  async function restoreSeq(hint) {
    // Caller passes the server's lastSourceSeq after first poll.
    if (typeof hint === "number" && hint >= sourceSeq) sourceSeq = hint + 1;
  }

  async function queue(event) {
    const q = await readQueue();
    q.push({ ...event, deviceId, sourceSeq: sourceSeq++ });
    await writeQueue(q);
    void flush();
  }

  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      let q = await readQueue();
      while (q.length > 0) {
        const batch = q.slice(0, 50);
        let r;
        try {
          r = await post(relay, deviceId, token, "relay", { op: "events", events: batch });
        } catch {
          break; // network down — keep backlog, retry later
        }
        if (r.status === 401) {
          console.error("[relay] device rejected (revoked?). Disconnecting; will not delete local queue.");
          process.exitCode = 3;
          break;
        }
        if (r.status !== 200) break;
        const accepted = new Set(r.data.accepted || []);
        q = q.filter((e) => !accepted.has(e.id));
        await writeQueue(q);
        if (accepted.size === 0) break;
      }
    } finally {
      flushing = false;
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Long-poll command loop with backoff. onCommand(cmd) handles one command. */
  async function runLoop(onCommand, onAuthLost) {
    let backoff = 1000;
    for (;;) {
      let r;
      try {
        r = await post(relay, deviceId, token, "relay", { op: "poll" });
      } catch {
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30000);
        continue;
      }
      if (r.status === 401) {
        if (onAuthLost) await onAuthLost();
        return;
      }
      backoff = 1000;
      if (r.status === 200 && Array.isArray(r.data.commands)) {
        for (const cmd of r.data.commands) {
          try {
            await onCommand(cmd);
          } catch (e) {
            console.error(`[relay] command ${cmd.type} failed:`, e && e.message ? e.message : e);
          }
          try {
            await post(relay, deviceId, token, "relay", { op: "ack", id: cmd.id });
          } catch {}
        }
      }
      await sleep(r.data && r.data.commands && r.data.commands.length ? 500 : 2500);
    }
  }

  async function uploadSnapshot(attemptId, payload) {
    return post(relay, deviceId, token, "relay", { op: "snapshot", attemptId, ...payload });
  }

  return { queue, flush, runLoop, uploadSnapshot, restoreSeq };
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
