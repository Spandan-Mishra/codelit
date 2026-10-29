// Start a native-agent attempt: pick scenario, language, paired device, and
// the agent on that device. Creates the owned attempt, then hands off to the
// session view. Experimental.

"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { NativeAdapterId } from "@/lib/native/protocol";

interface Device {
  deviceId: string;
  label: string;
  adapters: { adapter: NativeAdapterId; adapterVersion: string; validated: boolean }[];
  revokedAt: number | null;
}

interface Attempt {
  id: string;
  scenarioId: string;
  status: string;
  createdAt: number;
}

export default function NativeStart({ scenarios }: { scenarios: { id: string; title: string }[] }) {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id || "");
  const [language, setLanguage] = useState("python");
  const [deviceId, setDeviceId] = useState("");
  const [adapter, setAdapter] = useState("codex");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/native/devices");
        const data = await res.json();
        if (res.ok && Array.isArray(data.devices)) {
          const live = (data.devices as Device[]).filter((d) => d.revokedAt === null);
          setDevices(live);
          if (live[0]) {
            setDeviceId(live[0].deviceId);
            if (live[0].adapters[0]) setAdapter(live[0].adapters[0].adapter);
          }
        }
      } catch {
        /* ignore */
      }
      try {
        const res = await fetch("/api/native/devices?attempts=1");
        const data = await res.json();
        if (res.ok && Array.isArray(data.attempts)) setAttempts(data.attempts);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const device = devices.find((d) => d.deviceId === deviceId);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/native/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "start", scenarioId, language, deviceId, adapter }),
      });
      const data = await res.json();
      if (!res.ok || !data.attempt?.id) {
        setError(typeof data.error === "string" ? data.error : `Server error ${res.status}`);
        return;
      }
      router.push(`/native/${data.attempt.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl tracking-tight">Solve with my agent</h1>
      <p className="font-ui text-sm text-[#9a968c] mt-2 leading-6">
        Your paired agent works in an isolated challenge folder on your computer. Chat, approvals, and
        edits stay in Codelit; only the frozen snapshot is graded.{" "}
        <span className="px-2 py-0.5 rounded-full border border-[#e8b33d]/40 text-[#e8b33d] text-xs">Experimental</span>
      </p>

      {devices.length === 0 ? (
        <div className="mt-6 rounded-lg border border-[#262824] bg-[#141613] p-5 font-ui text-sm">
          No paired device yet. <a href="/agents" className="text-[#e8b33d] hover:underline">Pair your connector first →</a>
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-[#262824] bg-[#141613] p-5 font-ui text-sm space-y-3">
          <label className="block">
            <span className="text-xs text-[#9a968c]">Scenario</span>
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} className="mt-1 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2 outline-none">
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs text-[#9a968c]">Language</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="mt-1 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2 outline-none">
                <option value="python">Python</option>
                <option value="javascript">JavaScript</option>
                <option value="c++">C++</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-[#9a968c]">Device</span>
              <select
                value={deviceId}
                onChange={(e) => {
                  setDeviceId(e.target.value);
                  const d = devices.find((x) => x.deviceId === e.target.value);
                  if (d?.adapters[0]) setAdapter(d.adapters[0].adapter);
                }}
                className="mt-1 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2 outline-none"
              >
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-[#9a968c]">Agent</span>
              <select value={adapter} onChange={(e) => setAdapter(e.target.value)} className="mt-1 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2 outline-none">
                {(device?.adapters || []).map((a) => (
                  <option key={a.adapter} value={a.adapter}>{a.adapter}{a.validated ? "" : " (unvalidated)"}</option>
                ))}
              </select>
            </label>
          </div>
          <button onClick={() => void start()} disabled={busy || !scenarioId || !deviceId} className="px-5 py-2.5 rounded-md bg-[#e8b33d] text-black font-semibold text-sm disabled:opacity-50">
            {busy ? "Starting…" : "Start with my agent"}
          </button>
          {error && <p className="text-[#e8b33d]">{error}</p>}
        </div>
      )}

      {attempts.length > 0 && (
        <div className="mt-6 font-ui text-sm">
          <p className="text-xs text-[#9a968c]">Recent attempts</p>
          <ul className="mt-2 space-y-2">
            {attempts.slice(0, 10).map((a) => (
              <li key={a.id}>
                <a href={`/native/${a.id}`} className="text-[#e8b33d] hover:underline">
                  {a.scenarioId}
                </a>{" "}
                <span className="text-[#9a968c] text-xs">· {a.status} · {new Date(a.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
