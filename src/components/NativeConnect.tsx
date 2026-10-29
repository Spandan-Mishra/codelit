// "Connect local agent" — pairs a connector running on the user's own
// computer via a short-lived single-use code. This is distinct from the
// API-key provider cards: no keys are pasted here, and Codelit never sees
// the agent's credentials. Experimental.

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Cable, MonitorDown, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import type { AdapterCapabilities } from "@/lib/native/protocol";

interface Device {
  deviceId: string;
  label: string;
  adapters: AdapterCapabilities[];
  createdAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
}

export default function NativeConnect() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [ticket, setTicket] = useState<{ ticketId: string; code: string; expiresAt: number } | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/native/devices");
      const data = await res.json();
      if (res.ok && Array.isArray(data.devices)) setDevices(data.devices);
    } catch {
      /* device list is best-effort */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => stopPoll, [stopPoll]);

  async function createTicket() {
    setBusy(true);
    setError("");
    setClaimed(false);
    try {
      const res = await fetch("/api/native/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "create" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `Server error ${res.status}`);
        return;
      }
      const t = { ticketId: data.ticketId, code: data.code, expiresAt: data.expiresAt };
      setTicket(t);
      stopPoll();
      pollRef.current = setInterval(async () => {
        try {
          const s = await fetch("/api/native/pair", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ op: "status", ticketId: t.ticketId }),
          });
          const sd = await s.json();
          if (s.ok && sd.claimed) {
            stopPoll();
            setClaimed(true);
            setTicket(null);
            void load();
          }
          if (!s.ok) {
            stopPoll();
            setTicket(null);
          }
        } catch {
          /* keep waiting */
        }
      }, 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(deviceId: string) {
    try {
      const res = await fetch("/api/native/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "revoke", deviceId }),
      });
      if (res.ok) void load();
    } catch {
      /* ignore */
    }
  }

  const live = devices.filter((d) => d.revokedAt === null);

  return (
    <div className="rounded-lg border border-[#e8b33d]/40 bg-[#141613] p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold flex items-center gap-2">
          <Cable className="h-4 w-4 text-[#e8b33d]" /> Connect local agent
        </p>
        <span className="text-xs px-2 py-0.5 rounded-full border border-[#3a3c37] text-[#9a968c]">Experimental</span>
      </div>
      <p className="font-ui text-sm text-[#9a968c] mt-2 leading-6">
        Run your own coding agent (Codex, then Claude) on your computer and solve in Codelit.
        A small connector relays chat, edits, and approvals — your agent login never touches Codelit.
      </p>

      {live.length > 0 && (
        <ul className="mt-4 space-y-2 font-ui text-sm">
          {live.map((d) => (
            <li key={d.deviceId} className="flex flex-wrap items-center gap-2 rounded-md bg-black/40 border border-[#262824] px-3 py-2">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              <span className="font-semibold">{d.label}</span>
              <span className="text-[#9a968c] text-xs">
                {d.adapters.map((a) => `${a.adapter}${a.validated ? "" : " (unvalidated)"}`).join(", ") || "no agents reported"}
              </span>
              <button onClick={() => void revoke(d.deviceId)} className="ml-auto text-xs text-[#9a968c] hover:text-red-300 flex items-center gap-1">
                <Trash2 className="h-3.5 w-3.5" /> Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {ticket && !claimed ? (
        <div className="mt-4 rounded-md bg-black/40 border border-[#262824] p-4 font-ui text-sm">
          <p className="text-[#9a968c]">On your computer, run the connector and enter this one-time code:</p>
          <p className="mt-2 font-code text-3xl tracking-[0.3em] text-[#e8b33d]">{ticket.code}</p>
          <p className="mt-2 text-xs text-[#9a968c] flex items-center gap-1.5">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Waiting for the connector… expires in a few minutes.
          </p>
          <p className="mt-2 text-xs text-[#9a968c] font-code break-all">
codelit-connect pair --relay {typeof window !== "undefined" ? window.location.origin : "<this site>"} --code {ticket.code}</p>
        </div>
      ) : (
        <div className="mt-4">
          <button
            onClick={() => void createTicket()}
            disabled={busy}
            className="px-4 py-2 rounded-md bg-[#e8b33d] text-black font-semibold text-sm disabled:opacity-50 flex items-center gap-2"
          >
            <MonitorDown className="h-4 w-4" /> {busy ? "Creating code…" : "Pair a new device"}
          </button>
        </div>
      )}
      {claimed && <p className="mt-3 font-ui text-sm text-emerald-300">Device paired. Pick it when you start a scenario.</p>}
      {error && <p className="mt-3 font-ui text-sm text-[#e8b33d]">{error}</p>}
    </div>
  );
}
