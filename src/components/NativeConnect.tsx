"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Cable, Check, Circle, RefreshCw, ShieldCheck, X } from "lucide-react";
import type { AdapterCapabilities, NativeAdapterId } from "@/lib/native/protocol";
import NativeSetupGuide from "@/components/NativeSetupGuide";

export interface ReportedAdapter extends AdapterCapabilities {
  installed?: boolean;
  ready?: boolean;
  status?: "ready" | "missing" | "unauthenticated" | "unsupported" | "error";
  message?: string;
  models?: { id: string; label: string }[];
}

export interface NativeDevice {
  deviceId: string;
  label: string;
  adapters: ReportedAdapter[];
  createdAt: number;
  lastSeenAt: number;
  online?: boolean;
  revokedAt: number | null;
}

export function deviceIsOnline(device: NativeDevice, now: number): boolean {
  return device.revokedAt === null && device.online !== false && device.lastSeenAt > 0
    && now - device.lastSeenAt <= 45_000;
}

export type DeviceState = "online" | "stale" | "offline" | "revoked";

// Stale means the relay heard from this computer recently but not right now —
// the connector probably just stopped. Offline means no recent contact at all.
export function deviceState(device: NativeDevice, now: number): DeviceState {
  if (device.revokedAt !== null) return "revoked";
  if (deviceIsOnline(device, now)) return "online";
  if (device.lastSeenAt > 0 && now - device.lastSeenAt <= 10 * 60_000) return "stale";
  return "offline";
}

export function deviceStateHint(state: DeviceState): string {
  if (state === "online") return "Relay connected. This computer can solve now.";
  if (state === "stale") return "Relay went quiet recently. Restart the connector on that computer — no need to pair again.";
  if (state === "offline") return "No relay contact. Start the connector on that computer to solve.";
  return "Access revoked. This computer is blocked; pair it again to reconnect.";
}

export function adapterIsReady(adapter: ReportedAdapter): boolean {
  return adapter.status === "ready" && adapter.ready !== false;
}

export function adapterLabel(adapter: NativeAdapterId): string {
  return adapter === "codex" ? "Codex" : "Muse Code";
}

export function useNativeDevices() {
  const [devices, setDevices] = useState<NativeDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [origin, setOrigin] = useState("");

  const refresh = useCallback(async () => {
    setNow(Date.now());
    setOrigin(window.location.origin);
    try {
      const res = await fetch("/api/native/devices", { cache: "no-store" });
      const data = await res.json();
      // A new browser does not have a pairing session yet.
      if (res.status === 401) {
        setDevices([]);
        setError("");
      } else if (!res.ok || !Array.isArray(data.devices)) {
        throw new Error(data.error || "Could not check your computers.");
      } else {
        setDevices(data.devices);
        setError("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check your computers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const poll = setInterval(() => void refresh(), 10_000);
    return () => { clearTimeout(first); clearInterval(poll); };
  }, [refresh]);

  return { devices, loading, error, now, origin, refresh };
}

function seenAgo(timestamp: number, now: number): string {
  if (!timestamp) return "No relay contact yet";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return "Last contact just now";
  if (seconds < 3600) return `Last contact ${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `Last contact ${Math.floor(seconds / 3600)}h ago`;
  return `Last contact ${Math.floor(seconds / 86400)}d ago`;
}

function ProviderCard({ adapterId, devices, now }: { adapterId: NativeAdapterId; devices: NativeDevice[]; now: number }) {
  const reports = devices.flatMap((device) => {
    const adapter = device.adapters.find((a) => a.adapter === adapterId);
    return adapter ? [{ device, adapter }] : [];
  });
  const available = reports.some(({ device, adapter }) => deviceIsOnline(device, now) && adapterIsReady(adapter));

  return (
    <div className={`rounded-xl border p-4 ${available ? "border-emerald-400/25 bg-emerald-400/[0.03]" : "border-[#30322c] bg-black/15"}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#3a3c37] font-code text-sm">{adapterId === "codex" ? ">_" : "✦"}</span>
        <h3 className="flex-1 font-semibold">{adapterLabel(adapterId)}</h3>
        <span className={`inline-flex items-center gap-1.5 text-xs ${available ? "text-emerald-300" : "text-[#b3afa3]"}`}><Circle className={`h-2 w-2 ${available ? "fill-current" : ""}`} />{available ? "Available" : reports.length ? "Needs attention" : "Not connected"}</span>
      </div>
      {reports.length === 0 ? (
        <p className="mt-4 text-xs leading-6 text-[#b3afa3]">Connect your computer to check installation, local authentication, and available models.</p>
      ) : reports.map(({ device, adapter }) => {
        const online = deviceIsOnline(device, now);
        const state = deviceState(device, now);
        const relay = online ? "Relay online" : state === "stale" ? "Relay stale" : "Relay offline";
        const status = !adapter.status ? "Readiness unknown · update connector"
          : adapter.status === "ready" ? (online ? "Preflight ready" : "Last preflight ready")
          : adapter.status === "unauthenticated" ? "Local sign-in required"
          : adapter.status === "missing" ? "CLI not installed"
          : adapter.status === "unsupported" ? "Solving not supported yet" : "Preflight failed";
        return (
          <div key={device.deviceId} className="mt-4 border-t border-[#30322c] pt-3 text-xs leading-6">
            <div className="flex flex-wrap items-center justify-between gap-x-2"><span className="font-medium">{device.label}</span><span className={online ? "text-emerald-300" : state === "stale" ? "text-[#e8b33d]" : "text-[#b3afa3]"}>{relay}</span></div>
            <p className="text-[#b3afa3]">{adapter.installed === true ? `Installed${adapter.adapterVersion ? ` · ${adapter.adapterVersion}` : ""}` : adapter.installed === false ? "Not installed" : "Installation unknown"} · {status}</p>
            {adapter.message && <p className="mt-1 text-[#b3afa3]">{adapter.message}</p>}
            {!!adapter.models?.length && <details className="mt-2"><summary className="cursor-pointer text-[#e8b33d]">{adapter.models.length} reported model{adapter.models.length === 1 ? "" : "s"}</summary><ul className="mt-1 max-h-40 overflow-y-auto text-[#b3afa3]">{adapter.models.map((model) => <li key={model.id} className="break-words">{model.label || model.id} <span className="font-code text-[11px]">({model.id})</span></li>)}</ul></details>}
          </div>
        );
      })}
    </div>
  );
}

export default function NativeConnect({ continueHref = "/native", inline = false, onConnected }: { continueHref?: string; inline?: boolean; onConnected?: () => void }) {
  const { devices, loading, error: loadError, now, origin, refresh } = useNativeDevices();
  const [step, setStep] = useState<"install" | "pair" | "run" | null>(null);
  const [ticket, setTicket] = useState<{ ticketId: string; code: string; expiresAt: number } | null>(null);
  const [paired, setPaired] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState("");
  const live = devices.filter((device) => device.revokedAt === null);
  const revoked = devices.filter((device) => device.revokedAt !== null);
  const ready = live.some((device) => deviceIsOnline(device, now) && device.adapters.some(adapterIsReady));

  useEffect(() => {
    if (!ticket) return;
    let cancelled = false;
    let checking = false;
    const interval = setInterval(async () => {
      if (checking) return;
      if (Date.now() >= ticket.expiresAt) {
        setTicket(null);
        setError("The one-time code expired. Create another code to continue.");
        return;
      }
      checking = true;
      try {
        const res = await fetch("/api/native/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "status", ticketId: ticket.ticketId }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.claimed) {
          setTicket(null);
          setPaired(true);
          setStep("run");
          setError("");
          void refresh();
          onConnected?.();
        } else if (!res.ok) {
          setTicket(null);
          setError(data.error || "The code is no longer available. Create another code.");
        }
      } catch {
        if (!cancelled) setError("Could not check the pairing code. Retrying…");
      } finally {
        checking = false;
      }
    }, 2500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [ticket, refresh, onConnected]);

  async function createTicket() {
    setBusy(true);
    setError("");
    setPaired(false);
    try {
      const res = await fetch("/api/native/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "create" }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.ticketId !== "string" || typeof data.code !== "string" || typeof data.expiresAt !== "number") throw new Error(data.error || "Could not create a pairing code.");
      setTicket({ ticketId: data.ticketId, code: data.code, expiresAt: data.expiresAt });
      setStep("pair");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a pairing code.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(deviceId: string) {
    setRevoking(deviceId);
    setError("");
    try {
      const res = await fetch("/api/native/devices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "revoke", deviceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not revoke this computer.");
      await refresh();
      onConnected?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke this computer.");
    } finally {
      setRevoking("");
    }
  }

  return (
    <section className="rounded-xl border border-[#30322c] bg-[#141613] p-5 font-ui sm:p-6" aria-label="Local agent connection">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Cable className="h-4 w-4 text-[#e8b33d]" />{inline ? "Connect your agent to continue" : "Your local providers"}</h2>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="flex items-center gap-1.5 rounded text-xs text-[#b3afa3] hover:text-white disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh status</button>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-[#b3afa3]">Your browser cannot launch local programs or read your agent login. The connector runs on your computer and bridges Codelit to your installed agent. Your provider credentials stay local; challenge messages, tool activity, and solution files are sent to Codelit.</p>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <ProviderCard adapterId="codex" devices={live} now={now} />
        <ProviderCard adapterId="muse" devices={live} now={now} />
      </div>
      <p className="mt-3 text-xs leading-5 text-[#9a968c]">Status is reported by your connector. “Preflight ready” checks local authentication and model discovery; it does not guarantee a successful agent turn.</p>

      {step && !(ready && step === "run") ? (
        <div className="mt-5 rounded-lg border border-[#e8b33d]/25 bg-black/20 p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3 text-xs text-[#b3afa3]"><span>One-time connection · step {step === "install" ? 1 : step === "pair" ? 2 : 3} of 3</span><button type="button" aria-label="Close setup guide" onClick={() => { setStep(null); setTicket(null); }} className="rounded p-1 hover:text-white"><X className="h-4 w-4" /></button></div>
          {paired && <p role="status" className="mb-3 flex items-center gap-2 text-sm text-emerald-300"><Check className="h-4 w-4" />Paired. Start the relay below to connect.</p>}
          <NativeSetupGuide step={step} origin={origin} code={ticket?.code} />
          {step === "install" && <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={busy} onClick={() => void createTicket()} className="rounded-md bg-[#e8b33d] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">{busy ? "Creating code…" : "Connector installed · continue"}</button><button type="button" disabled={busy} onClick={() => void createTicket()} className="rounded text-xs text-[#b3afa3] underline underline-offset-4 disabled:opacity-50">Already installed? Pair now</button></div>}
          {step === "pair" && (ticket ? <p role="status" className="mt-4 flex items-center gap-2 text-xs text-[#e8b33d]"><RefreshCw className="h-3.5 w-3.5 animate-spin" />Waiting for confirmation · code expires in 10 minutes from creation.</p> : <button type="button" disabled={busy} onClick={() => void createTicket()} className="mt-4 rounded-md bg-[#e8b33d] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">{busy ? "Creating code…" : "Create another code"}</button>)}
          {step === "run" && <p role="status" className="mt-4 text-xs text-[#e8b33d]">Waiting for the relay and a ready provider. Status refreshes automatically.</p>}
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {ready && !inline && <Link href={continueHref} className="inline-flex items-center gap-2 rounded-md bg-[#e8b33d] px-4 py-2.5 text-sm font-semibold text-black">Continue to workspace<ArrowRight className="h-4 w-4" /></Link>}
          {ready && inline && <p role="status" className="text-sm text-emerald-300">Your agent is available. Choose it above to start.</p>}
          {live.length > 0 && !ready && <button type="button" onClick={() => { setStep("run"); setError(""); }} className="rounded-md bg-[#e8b33d] px-4 py-2.5 text-sm font-semibold text-black">Start existing connector</button>}
          <button type="button" onClick={() => { setStep("install"); setPaired(false); setError(""); }} disabled={loading} className={`rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${live.length ? "border border-[#3a3c37] text-[#ece9e2]" : "bg-[#e8b33d] text-black"}`}>{live.length ? "Connect another computer" : "Connect this computer"}</button>
        </div>
      )}

      {live.length > 0 && <details className="mt-5 border-t border-[#30322c] pt-4 text-xs"><summary className="cursor-pointer text-[#b3afa3]">Manage {live.length} paired computer{live.length === 1 ? "" : "s"} · online, stale, and offline states</summary><ul className="mt-3 space-y-3">{live.map((device) => { const state = deviceState(device, now); return <li key={device.deviceId} className="rounded-lg border border-[#30322c] bg-black/15 p-3"><div className="flex flex-wrap items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#9a968c]" /><span className="font-medium">{device.label}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${state === "online" ? "border-emerald-400/30 text-emerald-300" : state === "stale" ? "border-[#e8b33d]/40 text-[#e8b33d]" : "border-[#3a3c37] text-[#9a968c]"}`}>{state}</span><span className="text-[#9a968c]">· {seenAgo(device.lastSeenAt, now)}</span><button type="button" disabled={!!revoking} onClick={() => void revoke(device.deviceId)} className="ml-auto rounded border border-[#3a3c37] px-2 py-1 text-[#b3afa3] hover:text-red-300 disabled:opacity-50">{revoking === device.deviceId ? "Revoking…" : "Revoke access"}</button></div><p className="mt-2 leading-5 text-[#9a968c]">{deviceStateHint(state)}</p></li>; })}</ul><p className="mt-3 leading-5 text-[#9a968c]">Revoking blocks future connector access. Your attempt history stays available. Stop the connector locally to stop active work.</p></details>}
      {revoked.length > 0 && <details className="mt-4 border-t border-[#30322c] pt-4 text-xs"><summary className="cursor-pointer text-[#b3afa3]">{revoked.length} revoked computer{revoked.length === 1 ? "" : "s"}</summary><ul className="mt-3 space-y-2 text-[#9a968c]">{revoked.map((device) => <li key={device.deviceId} className="flex flex-wrap items-center gap-2"><ShieldCheck className="h-4 w-4" /><span className="font-medium text-[#b3afa3]">{device.label}</span><span className="rounded-full border border-red-400/30 px-2 py-0.5 text-[10px] uppercase tracking-wider text-red-300">revoked</span><span>· revoked {device.revokedAt ? new Date(device.revokedAt).toLocaleDateString() : "previously"}</span></li>)}</ul><p className="mt-3 leading-5 text-[#9a968c]">Revoked computers cannot reach Codelit. Pair the computer again to reconnect it.</p></details>}
      {(error || loadError) && <p role="alert" className="mt-4 text-sm text-[#e8b33d]">{error || loadError}</p>}
    </section>
  );
}
