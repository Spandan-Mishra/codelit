// Browser sessions + pairing tickets + device registry for the native relay.
// Identity is a server-signed opaque session, never an IP. Pairing tickets
// are short-lived, single-use, and bound to the issuing browser session.

import { randomBytes } from "node:crypto";
import { newId, newPairCode, newToken, sha256, signSession, verifySession } from "./secret";
import { storeGet, storeList, storeSet } from "./store";
import {
  COMMAND_TTL_MS,
  PAIR_TTL_MS,
  type AdapterCapabilities,
  type BrowserCommand,
  type BrowserCommandType,
  type DeviceRecord,
  type NativeAttempt,
  type PairTicket,
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
  return verifySession(decodeURIComponent(m.slice(NATIVE_SESSION_COOKIE.length + 1)));
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
  return t;
}

export function bindTicket(t: PairTicket, deviceId: string): void {
  t.deviceId = deviceId;
  t.claimedAt = Date.now();
  byCode.delete(t.code); // single use
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
    lastSeenAt: now,
    revokedAt: null,
  };
  await storeSet("devices", device.deviceId, device);
  return { device, token };
}

export async function getDevice(deviceId: string): Promise<DeviceRecord | null> {
  return storeGet<DeviceRecord>("devices", deviceId);
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

// --- Browser command queue (file-backed so restarts reconcile, not resend) ---

export async function enqueueCommand(attemptId: string, deviceId: string, type: BrowserCommandType, payload: Record<string, unknown>, id?: string, ttlMs = COMMAND_TTL_MS): Promise<BrowserCommand> {
  const now = Date.now();
  const c: BrowserCommand = {
    id: id || newId("cmd"),
    attemptId,
    deviceId,
    type,
    issuedAt: now,
    expiresAt: now + ttlMs,
    payload,
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
      c.state = "expired";
      await storeSet("commands", c.id, c);
      continue;
    }
    c.state = "delivered";
    await storeSet("commands", c.id, c);
    out.push(c);
  }
  return out;
}

export async function ackCommand(id: string, deviceId: string): Promise<boolean> {
  const c = await storeGet<BrowserCommand>("commands", id);
  if (!c || c.deviceId !== deviceId) return false;
  c.state = "acked";
  await storeSet("commands", id, c);
  return true;
}
