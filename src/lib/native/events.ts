// Normalized event store: per-attempt file-backed log with server-assigned
// sequence numbers. Deltas are stored (bounded); the UI compacts them.
// Connector replays from the last acked sourceSeq; a replay that skips
// numbers emits a connection.gap event instead of inventing continuity.

import { newId } from "./secret";
import { storeGet, storeSet } from "./store";
import { type NativeEvent, type Provenance } from "./protocol";
import { withNativeLock } from "./lock";

interface AttemptLog {
  events: NativeEvent[];
  lastSourceSeq: number; // highest connector sourceSeq seen
  nextSeq: number;
}

async function loadLog(attemptId: string): Promise<AttemptLog> {
  const log = (await storeGet<AttemptLog>("events", attemptId)) || { events: [], lastSourceSeq: -1, nextSeq: 0 };
  if (!Array.isArray(log.events)) log.events = [];
  return log;
}

async function saveLog(attemptId: string, log: AttemptLog): Promise<void> {
  // Deltas are evidence but not replay-critical: keep the last 200 raw
  // deltas per attempt; finalized messages and transitions are never dropped.
  const deltas = log.events.filter((e) => e.type === "message.delta");
  if (deltas.length > 200) {
    const drop = new Set(deltas.slice(0, deltas.length - 200).map((e) => e.id));
    log.events = log.events.filter((e) => !drop.has(e.id));
  }
  await storeSet("events", attemptId, log);
}

export async function appendEvent(
  attemptId: string,
  base: Omit<NativeEvent, "seq" | "serverTime">,
): Promise<{ event: NativeEvent; gap: boolean; replay: boolean }> {
  return withNativeLock(`events:${attemptId}`, async () => {
    const log = await loadLog(attemptId);
    const existing = log.events.find((event) => event.id === base.id);
    if (existing) return { event: existing, gap: false, replay: true };
    const gap = base.source === "connector" && base.sourceSeq > log.lastSourceSeq + 1 && log.lastSourceSeq >= 0;
    const event: NativeEvent = { ...base, seq: log.nextSeq++, serverTime: Date.now() };
    log.events.push(event);
    if (base.source === "connector" && base.sourceSeq > log.lastSourceSeq) log.lastSourceSeq = base.sourceSeq;
    await saveLog(attemptId, log);
    return { event, gap, replay: false };
  });
}

export async function recordServerEvent(
  attemptId: string,
  deviceId: string,
  nativeSessionId: string | null,
  turnId: string | null,
  type: NativeEvent["type"],
  payload: Record<string, unknown>,
  source: Provenance = "codelit",
): Promise<NativeEvent> {
  return withNativeLock(`events:${attemptId}`, async () => {
    const log = await loadLog(attemptId);
    const event: NativeEvent = {
      v: 1,
      id: newId("ev"),
      attemptId,
      deviceId,
      nativeSessionId,
      turnId,
      parentId: null,
      type,
      source,
      seq: log.nextSeq++,
      sourceSeq: -1,
      sourceTime: Date.now(),
      serverTime: Date.now(),
      adapter: null,
      model: null,
      payload,
    };
    log.events.push(event);
    await saveLog(attemptId, log);
    return event;
  });
}

export async function readEvents(attemptId: string, sinceSeq: number): Promise<NativeEvent[]> {
  const log = await loadLog(attemptId);
  return log.events.filter((e) => e.seq > sinceSeq);
}

export async function lastSourceSeq(attemptId: string): Promise<number> {
  const log = await loadLog(attemptId);
  return log.lastSourceSeq;
}
