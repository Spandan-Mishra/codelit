import type { AdapterCapabilities, DeviceRecord } from "./protocol";

export const DEVICE_ONLINE_MS = 45_000;

export function cleanAdapters(value: unknown): AdapterCapabilities[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 4).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const o = raw as Record<string, unknown>;
    if ((o.adapter !== "codex" && o.adapter !== "muse") || seen.has(o.adapter)) return [];
    seen.add(o.adapter);
    const statuses = ["ready", "missing", "unauthenticated", "unsupported", "error"] as const;
    const status = statuses.find((s) => s === o.status);
    const models = Array.isArray(o.models) ? o.models.slice(0, 100).flatMap((m) => {
      if (!m || typeof m !== "object") return [];
      const model = m as Record<string, unknown>;
      if (typeof model.id !== "string" || !/^[a-zA-Z0-9._:/-]{1,160}$/.test(model.id)) return [];
      return [{ id: model.id, label: String(model.label || model.id).slice(0, 160) }];
    }) : [];
    return [{
      adapter: o.adapter, adapterVersion: String(o.adapterVersion || "").slice(0, 40),
      textDeltas: o.textDeltas === true, toolArgs: o.toolArgs === true,
      toolResults: o.toolResults === true, fileDiffs: o.fileDiffs === true,
      nativeResume: o.nativeResume === true, usageReporting: o.usageReporting === true,
      workspaceRestrictions: o.workspaceRestrictions === true,
      approvalKinds: Array.isArray(o.approvalKinds) ? o.approvalKinds.map(String).slice(0, 8) : [],
      validated: false, ...(typeof o.installed === "boolean" ? { installed: o.installed } : {}),
      ready: status === "ready" && o.ready === true, ...(status ? { status } : {}),
      message: typeof o.message === "string" ? o.message.slice(0, 500) : "Update and restart the connector to check provider readiness.",
      models,
    } satisfies AdapterCapabilities];
  });
}

export function isDeviceOnline(device: DeviceRecord, now = Date.now()): boolean {
  return device.revokedAt === null && device.lastSeenAt > 0 && now - device.lastSeenAt < DEVICE_ONLINE_MS;
}

export function publicDevice(device: DeviceRecord) {
  return {
    deviceId: device.deviceId, label: device.label, adapters: device.adapters,
    createdAt: device.createdAt, lastSeenAt: device.lastSeenAt, revokedAt: device.revokedAt,
    online: isDeviceOnline(device),
  };
}
