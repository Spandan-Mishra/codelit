// Embedded native-agent protocol (v1). Shared vocabulary for the browser UI,
// the Next.js relay/session routes, and the local connector. JSON-serializable
// throughout; every envelope carries provenance so the UI can never mistake a
// connector report for an independent Codelit verdict.

export const NATIVE_PROTOCOL_VERSION = 1;

/** Where an event was established. Connector reports are evidence, never proof. */
export type Provenance = "codelit" | "connector" | "imported";

export type NativeAdapterId = "codex" | "claude";

export type AdapterStatus = "ready" | "missing" | "unauthenticated" | "unsupported" | "error";
export interface NativeModel { id: string; label: string }

export interface AdapterCapabilities {
  adapter: NativeAdapterId;
  adapterVersion: string;
  textDeltas: boolean;
  toolArgs: boolean;
  toolResults: boolean;
  fileDiffs: boolean;
  nativeResume: boolean;
  usageReporting: boolean;
  workspaceRestrictions: boolean;
  approvalKinds: string[];
  validated: boolean; // true only after a live validation run, never claimed
  installed?: boolean;
  ready?: boolean; // local preflight only; does not prove model entitlement or inference health
  status?: AdapterStatus;
  message?: string;
  models?: NativeModel[]; // catalog from the installed runtime, never a hardcoded list
}

export type NativeEventType =
  | "prompt.accepted"
  | "prompt.forwarded"
  | "prompt.rejected"
  | "turn.started"
  | "turn.completed"
  | "turn.interrupted"
  | "turn.failed"
  | "message.delta"
  | "message.final"
  | "tool.requested"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "tool.denied"
  | "approval.requested"
  | "approval.decided"
  | "approval.expired"
  | "file.revision"
  | "file.snapshot"
  | "context.delivered"
  | "local.command"
  | "official.test"
  | "official.submission"
  | "connection.gap"
  | "session.replaced"
  | "human.edit.ack"
  | "human.edit.conflict";

export interface NativeEvent {
  v: number; // protocol version
  id: string; // unique event id (connector or server generated)
  attemptId: string;
  deviceId: string;
  nativeSessionId: string | null;
  turnId: string | null;
  parentId: string | null;
  type: NativeEventType;
  sessionEpoch?: number; // native-session generation, top-level; connector events only
  source: Provenance;
  seq: number; // server receipt order per attempt (assigned by relay)
  sourceSeq: number; // connector-local order (gap detection)
  sourceTime: number; // connector clock, epoch ms
  serverTime: number; // relay receipt, epoch ms (assigned by relay)
  adapter: NativeAdapterId | null;
  model: string | null;
  payload: Record<string, unknown>; // bounded, typed per type; secrets never
}

export type BrowserCommandType =
  | "session.start"
  | "turn.send"
  | "turn.interrupt"
  | "approval.decide"
  | "context.sync"
  | "test.run"
  | "human.edit"
  | "freeze.request";

export interface BrowserCommand {
  id: string; // stable request id — retries reuse it, never duplicate work
  attemptId: string;
  deviceId: string;
  type: BrowserCommandType;
  sessionEpoch: number; // native-session generation; stamped at enqueue (see transport-contract.md)
  issuedAt: number;
  expiresAt: number;
  payload: Record<string, unknown>;
  state: "queued" | "delivered" | "acked" | "expired";
}

/** Per-session execution lease carried on every poll response (never global). */
export interface SessionLease {
  attemptId: string;
  sessionEpoch: number;
  permitWork: boolean; // false stops that session's work; the loop keeps relaying others
  leaseExpiresAt: number; // server clock, epoch ms; contact cap still applies
}

/** Freeze generation binding: exactly what the connector must echo on upload. */
export interface FreezeBinding {
  freezeId: string;
  sessionEpoch: number;
  expectedRevision: number;
  expectedHash: string; // content sha256 (matches file.revision payloads)
}

export interface AttemptSnapshot {
  source: string;
  hash: string; // snapshotHash(source, language) — integrity at finish
  language: string;
  revision: number;
  at: number;
  freezeId: string;
  sessionEpoch: number;
  expectedRevision: number;
  expectedHash: string;
}

export type AttemptStatus = "open" | "running" | "waiting_approval" | "finishing" | "done";

export interface NativeAttempt {
  id: string; // stable owned attempt id (never an IP)
  sessionId: string; // owning browser session (signed, opaque)
  scenarioId: string;
  seed: number;
  stage: number;
  language: string;
  deviceId: string | null;
  adapter: NativeAdapterId | null;
  model?: string | null;
  title?: string;
  archivedAt?: number | null;
  nativeSessionId: string | null;
  status: AttemptStatus;
  sessionEpoch: number; // native-session generation; bumped on every session.start
  turnsUsed: number;
  turnsReserved: number;
  createdAt: number;
  updatedAt: number;
  submissionHash: string | null;
  acceptance: { passed: boolean; passedCount: number; totalCount: number; at: number } | null;
}

export interface DeviceRecord {
  deviceId: string;
  sessionId: string; // pairing browser session
  label: string;
  credentialHash: string; // sha256 of the device token (token itself never stored)
  adapters: AdapterCapabilities[];
  createdAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
}

export interface PairTicket {
  code: string; // short display code, single use
  ticketId: string;
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  deviceId: string | null; // set on claim
  claimedAt: number | null;
}

export const MAX_EVENT_PAYLOAD_CHARS = 8000;
export const PAIR_TTL_MS = 10 * 60 * 1000;
export const COMMAND_TTL_MS = 2 * 60 * 1000;
export const APPROVAL_TTL_MS = 5 * 60 * 1000;
// Lease timing (see docs/plans/transport-contract.md): the server grants 30s;
// the connector must re-contact within 29s and contain a lapsed session in 1s.
export const NATIVE_LEASE_MS = 30 * 1000;
export const NATIVE_CONTACT_CAP_MS = 29 * 1000;
export const NATIVE_CLOSE_MS = 1 * 1000;

const EVENT_TYPES = new Set<string>([
  "prompt.accepted", "prompt.forwarded", "prompt.rejected",
  "turn.started", "turn.completed", "turn.interrupted", "turn.failed",
  "message.delta", "message.final",
  "tool.requested", "tool.started", "tool.completed", "tool.failed", "tool.denied",
  "approval.requested", "approval.decided", "approval.expired",
  "file.revision", "file.snapshot", "context.delivered",
  "local.command", "official.test", "official.submission",
  "connection.gap", "session.replaced",
  "human.edit.ack", "human.edit.conflict",
]);

export function isNativeEventType(t: unknown): t is NativeEventType {
  return typeof t === "string" && EVENT_TYPES.has(t);
}

/** Connector-submitted event shape check (before the relay adds seq/serverTime). */
export function sanitizeConnectorEvent(v: unknown): { ok: boolean; error?: string; event?: Omit<NativeEvent, "seq" | "serverTime"> } {
  if (typeof v !== "object" || v === null) return { ok: false, error: "Event must be an object." };
  const o = v as Record<string, unknown>;
  if (o.v !== NATIVE_PROTOCOL_VERSION) return { ok: false, error: "Unsupported protocol version." };
  if (!isNativeEventType(o.type)) return { ok: false, error: "Unknown event type." };
  // Server verdicts are never connector-submitted: official.* and
  // prompt.accepted are recorded only by the backend (F06).
  if (o.type === "official.test" || o.type === "official.submission" || o.type === "prompt.accepted") {
    return { ok: false, error: "Reserved for server verdicts." };
  }
  for (const k of ["id", "attemptId", "deviceId"] as const) {
    if (typeof o[k] !== "string" || (o[k] as string).length === 0 || (o[k] as string).length > 200) {
      return { ok: false, error: `Bad ${k}.` };
    }
  }
  if (typeof o.sourceSeq !== "number" || !Number.isInteger(o.sourceSeq) || o.sourceSeq < 0) {
    return { ok: false, error: "Bad sourceSeq." };
  }
  if (typeof o.sourceTime !== "number" || !Number.isFinite(o.sourceTime)) {
    return { ok: false, error: "Bad sourceTime." };
  }
  if (o.sessionEpoch !== undefined && (!Number.isInteger(o.sessionEpoch) || (o.sessionEpoch as number) < 0)) {
    return { ok: false, error: "Bad sessionEpoch." };
  }
  const payload = (typeof o.payload === "object" && o.payload !== null ? o.payload : {}) as Record<string, unknown>;
  const maxPayload = o.type === "file.revision" ? 70_000 : o.type === "prompt.forwarded" ? 40_000 : o.type === "message.final" ? 32_000 : MAX_EVENT_PAYLOAD_CHARS;
  if (JSON.stringify(payload).length > maxPayload) {
    return { ok: false, error: "Event payload too large." };
  }
  return {
    ok: true,
    event: {
      v: NATIVE_PROTOCOL_VERSION,
      id: o.id as string,
      attemptId: o.attemptId as string,
      deviceId: o.deviceId as string,
      nativeSessionId: typeof o.nativeSessionId === "string" ? o.nativeSessionId : null,
      turnId: typeof o.turnId === "string" ? o.turnId : null,
      parentId: typeof o.parentId === "string" ? o.parentId : null,
      type: o.type,
      ...(typeof o.sessionEpoch === "number" ? { sessionEpoch: o.sessionEpoch } : {}),
      source: "connector",
      sourceSeq: o.sourceSeq as number,
      sourceTime: o.sourceTime as number,
      adapter: o.adapter === "codex" || o.adapter === "claude" ? o.adapter : null,
      model: typeof o.model === "string" ? (o.model as string).slice(0, 120) : null,
      payload,
    },
  };
}
