// Browser sessions + pairing tickets + device registry for the native relay.
// Identity is a server-signed opaque session, never an IP. Pairing tickets
// are short-lived, single-use, and bound to the issuing browser session.

import { randomBytes } from "node:crypto";
import { newId, newPairCode, newToken, sha256, signSession, verifySession } from "./secret";
import { storeGet, storeList, storeSet } from "./store";
import { readEvents, recordServerEvent } from "./events";
import { withNativeLock } from "./lock";
import {
  COMMAND_TTL_MS,
  NATIVE_LEASE_MS,
  PAIR_TTL_MS,
  type AdapterCapabilities,
  type BrowserCommand,
  type BrowserCommandType,
  type DeviceRecord,
  type FreezeBinding,
  type NativeAttempt,
  type PairTicket,
  type SessionLease,
} from "./protocol";

export const NATIVE_SESSION_COOKIE = "codelit_sid";

export function newBrowserSession(): { id: string; signed: string } {
  const id = randomBytes(12).toString("hex");
  return { id, signed: signSession(id) };
}

export function readBrowserSession(req: Request): string | null {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${NATIVE_SESSION_COOKIE}=`));
  if (!m) return null;
  try { return verifySession(decodeURIComponent(m.slice(NATIVE_SESSION_COOKIE.length + 1))); }
  catch { return null; }
}

// --- Pairing tickets (short-lived, in-memory: a restart only cancels pairing) ---

const tickets = new Map<string, PairTicket>(); // by ticketId
const byCode = new Map<string, string>(); // code -> ticketId

export function issueTicket(sessionId: string): PairTicket {
  const now = Date.now();
  const t: PairTicket = {
    code: newPairCode(),
    ticketId: newId("tick"),
    sessionId,
    createdAt: now,
    expiresAt: now + PAIR_TTL_MS,
    deviceId: null,
    claimedAt: null,
  };
  tickets.set(t.ticketId, t);
  byCode.set(t.code, t.ticketId);
  return t;
}

export function ticketStatus(ticketId: string, sessionId: string): PairTicket | null {
  const t = tickets.get(ticketId);
  if (!t || t.sessionId !== sessionId) return null;
  if (Date.now() > t.expiresAt) {
    tickets.delete(ticketId);
    byCode.delete(t.code);
    return null;
  }
  return t;
}

export function claimTicket(code: string): PairTicket | null {
  const id = byCode.get(code.trim().toUpperCase());
  if (!id) return null;
  const t = tickets.get(id);
  if (!t || t.claimedAt !== null || Date.now() > t.expiresAt) return null;
  // Consume synchronously: this function has no awaits, so concurrent claims
  // serialize on the event loop and exactly one caller wins the code (F04).
  // The code stays burned even if device registration fails below — a failed
  // claim can never create an unknown second owner; the user pairs a new code.
  t.claimedAt = Date.now();
  byCode.delete(t.code); // single use
  return t;
}

export function bindTicket(t: PairTicket, deviceId: string): void {
  t.deviceId = deviceId;
}

// --- Devices (file-backed, credential stored as hash only) ---

export async function registerDevice(sessionId: string, label: string, adapters: AdapterCapabilities[]): Promise<{ device: DeviceRecord; token: string }> {
  const token = newToken();
  const now = Date.now();
  const device: DeviceRecord = {
    deviceId: newId("dev"),
    sessionId,
    label: label.slice(0, 80) || "connector",
    credentialHash: sha256(token),
    adapters: adapters.slice(0, 4),
    createdAt: now,
    lastSeenAt: 0, // Paired is not connected; the relay must actually contact us.
    revokedAt: null,
  };
  await storeSet("devices", device.deviceId, device);
  return { device, token };
}

export async function getDevice(deviceId: string): Promise<DeviceRecord | null> {
  return storeGet<DeviceRecord>("devices", deviceId);
}

export async function saveDevice(device: DeviceRecord): Promise<void> {
  await storeSet("devices", device.deviceId, device);
}

export async function authDevice(deviceId: string, token: string): Promise<DeviceRecord | null> {
  const d = await getDevice(deviceId);
  if (!d || d.revokedAt !== null) return null;
  if (d.credentialHash !== sha256(token)) return null;
  d.lastSeenAt = Date.now();
  await storeSet("devices", d.deviceId, d);
  return d;
}

export async function listDevices(sessionId: string): Promise<DeviceRecord[]> {
  const all = await storeList<DeviceRecord>("devices");
  return all
    .filter((d) => d.sessionId === sessionId)
    .map((d) => ({ ...d, credentialHash: "[redacted]" }));
}

export async function revokeDevice(sessionId: string, deviceId: string): Promise<boolean> {
  const d = await getDevice(deviceId);
  if (!d || d.sessionId !== sessionId) return false;
  d.revokedAt = Date.now();
  await storeSet("devices", d.deviceId, d);
  return true;
}

// --- Native attempts (file-backed, stable owned ids) ---

export async function createAttempt(sessionId: string, scenarioId: string, seed: number, language: string): Promise<NativeAttempt> {
  const now = Date.now();
  const a: NativeAttempt = {
    id: newId("nat"),
    sessionId,
    scenarioId,
    seed,
    stage: 1,
    language,
    deviceId: null,
    adapter: null,
    nativeSessionId: null,
    status: "open",
    sessionEpoch: 0,
    turnsUsed: 0,
    turnsReserved: 0,
    createdAt: now,
    updatedAt: now,
    submissionHash: null,
    acceptance: null,
  };
  await storeSet("attempts", a.id, a);
  return a;
}

export async function getAttempt(attemptId: string): Promise<NativeAttempt | null> {
  return storeGet<NativeAttempt>("attempts", attemptId);
}

export async function ownAttempt(sessionId: string, attemptId: string): Promise<NativeAttempt | null> {
  const a = await getAttempt(attemptId);
  if (!a || a.sessionId !== sessionId) return null;
  return a;
}

export async function saveAttempt(a: NativeAttempt): Promise<void> {
  a.updatedAt = Date.now();
  await storeSet("attempts", a.id, a);
}

export async function listAttempts(sessionId: string): Promise<NativeAttempt[]> {
  const all = await storeList<NativeAttempt>("attempts");
  return all.filter((a) => a.sessionId === sessionId).sort((x, y) => y.createdAt - x.createdAt);
}

// Caller holds the attempt lock. A command never delivered to the connector
// cannot have spent inference; expiry/cancel releases its reservation.
export async function settleQueuedTurns(attempt: NativeAttempt, cancel = false): Promise<void> {
  const commands = await storeList<BrowserCommand>("commands");
  for (const command of commands) {
    if (command.attemptId !== attempt.id || command.type !== "turn.send" || command.state !== "queued") continue;
    if (!cancel && command.expiresAt >= Date.now()) continue;
    command.state = "expired";
    await storeSet("commands", command.id, command);
    const turnId = String(command.payload.turnId || command.id);
    if (await storeGet("kv", `terminal:${attempt.id}:${turnId}`)) continue;
    await storeSet("kv", `terminal:${attempt.id}:${turnId}`, true);
    attempt.turnsReserved = Math.max(0, attempt.turnsReserved - 1);
    await saveAttempt(attempt);
    await recordServerEvent(attempt.id, attempt.deviceId || "", attempt.nativeSessionId, turnId, "prompt.rejected", {
      reason: cancel ? "Queued prompt cancelled before it reached your agent. No prompt was spent." : "The queued prompt expired while the connector was offline. It was not resent and no prompt was spent.",
    });
  }
}

// --- Browser command queue (file-backed so restarts reconcile, not resend) ---

export function attemptEpoch(attempt: NativeAttempt): number {
  return typeof attempt.sessionEpoch === "number" ? attempt.sessionEpoch : 0;
}

async function latestRevision(attemptId: string): Promise<{ rev: number; hash: string }> {
  const events = await readEvents(attemptId, -1);
  const file = events.filter((e) => e.type === "file.revision").at(-1);
  const rev = file && typeof file.payload.rev === "number" ? file.payload.rev : 0;
  const hash = file && typeof file.payload.hash === "string" ? file.payload.hash : "";
  return { rev, hash };
}

export async function pendingFreeze(attemptId: string): Promise<FreezeBinding | null> {
  return storeGet<FreezeBinding>("kv", `freeze:${attemptId}`);
}

export async function enqueueCommand(attemptId: string, deviceId: string, type: BrowserCommandType, payload: Record<string, unknown>, id?: string, ttlMs = COMMAND_TTL_MS): Promise<BrowserCommand> {
  const now = Date.now();
  // The server owns the native-session generation. Every session.start opens
  // a new generation and carries it; all other commands carry the current one
  // so the connector can reject stale work after a replacement.
  const attempt = await getAttempt(attemptId);
  const epoch = attempt ? attemptEpoch(attempt) + (type === "session.start" ? 1 : 0) : 0;
  if (attempt && type === "session.start") {
    attempt.sessionEpoch = epoch;
    await saveAttempt(attempt);
  }
  let body = payload;
  if (type === "freeze.request") {
    // Bind the freeze to one generation: the snapshot upload must echo this
    // exact freezeId/epoch/revision/hash, and its bytes must match. Any caller
    // may supply the binding explicitly; otherwise derive it from the latest
    // reviewed revision so old bytes can never satisfy a new freeze.
    const reviewed = await latestRevision(attemptId);
    const binding: FreezeBinding = {
      freezeId: typeof payload.freezeId === "string" && payload.freezeId ? payload.freezeId : newId("freeze"),
      sessionEpoch: epoch,
      expectedRevision: typeof payload.expectedRevision === "number" ? payload.expectedRevision : reviewed.rev,
      expectedHash: typeof payload.expectedHash === "string" ? payload.expectedHash : reviewed.hash,
    };
    await storeSet("kv", `freeze:${attemptId}`, binding);
    body = { ...payload, ...binding };
  }
  const c: BrowserCommand = {
    id: id || newId("cmd"),
    attemptId,
    deviceId,
    type,
    sessionEpoch: epoch,
    issuedAt: now,
    expiresAt: now + ttlMs,
    payload: body,
    state: "queued",
  };
  await storeSet("commands", c.id, c);
  return c;
}

export async function takeCommands(deviceId: string, attemptId?: string): Promise<BrowserCommand[]> {
  const all = await storeList<BrowserCommand>("commands");
  const now = Date.now();
  const out: BrowserCommand[] = [];
  for (const c of all) {
    if (c.deviceId !== deviceId || c.state !== "queued") continue;
    if (attemptId && c.attemptId !== attemptId) continue;
    if (now > c.expiresAt) {
      if (c.type === "turn.send") {
        await withNativeLock(`attempt:${c.attemptId}`, async () => {
          const attempt = await getAttempt(c.attemptId);
          if (attempt) await settleQueuedTurns(attempt);
        });
        continue;
      }
      c.state = "expired";
      await storeSet("commands", c.id, c);
      continue;
    }
    c.state = "delivered";
    await storeSet("commands", c.id, c);
    // Pre-epoch commands predate session generations; 0 fails closed against
    // any established generation instead of executing on the wrong session.
    out.push({ ...c, sessionEpoch: typeof c.sessionEpoch === "number" ? c.sessionEpoch : 0 });
  }
  return out;
}

// ACK is idempotent: the connector acks durable receipt BEFORE effects, and a
// lost ACK response is safely retried — re-acking never re-queues work.
export async function ackCommand(id: string, deviceId: string): Promise<boolean> {
  const c = await storeGet<BrowserCommand>("commands", id);
  if (!c || c.deviceId !== deviceId) return false;
  c.state = "acked";
  await storeSet("commands", id, c);
  return true;
}

// --- Per-session execution leases (never a global boolean) ---

export async function getSessionLeases(deviceId: string, attemptId?: string): Promise<SessionLease[]> {
  const all = await storeList<NativeAttempt>("attempts");
  const now = Date.now();
  return all
    .filter((a) => a.deviceId === deviceId && (!attemptId || a.id === attemptId))
    .sort((x, y) => y.updatedAt - x.updatedAt)
    .slice(0, 50)
    .map((a) => ({
      attemptId: a.id,
      sessionEpoch: attemptEpoch(a),
      // Closed work stays listed with permitWork false so the connector stops
      // any lingering session instead of running it on a stale generation.
      permitWork: a.status !== "done" && !a.archivedAt,
      leaseExpiresAt: now + NATIVE_LEASE_MS,
    }));
}
