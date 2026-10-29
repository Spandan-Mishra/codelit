"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, CheckCircle2, KeyRound, XCircle } from "lucide-react";
import { PROVIDERS, type ProviderDef, type ProviderId } from "@/lib/agents";
import {
  getAgentConfig,
  getAgentKeys,
  setAgentConfig,
  setAgentKey,
  type AgentConfig,
} from "@/lib/agentStore";

type StatusState = "untested" | "testing" | "connected" | "error";

interface ProviderStatus {
  state: StatusState;
  message: string;
  latencyMs: number | null;
  at: string | null;
}

const FRESH_STATUS: ProviderStatus = { state: "untested", message: "", latencyMs: null, at: null };

interface TestResponse {
  ok: boolean;
  message: string;
  latencyMs: number;
}

function StatusPill({ status }: { status: ProviderStatus }) {
  const base = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-ui text-xs";
  if (status.state === "connected")
    return (
      <span className={`${base} bg-emerald-400/10 text-emerald-300`}>
        <CheckCircle2 className="h-3.5 w-3.5" /> Connected
      </span>
    );
  if (status.state === "error")
    return (
      <span className={`${base} bg-red-400/10 text-red-300`}>
        <XCircle className="h-3.5 w-3.5" /> Error
      </span>
    );
  if (status.state === "testing")
    return <span className={`${base} bg-[#e8b33d]/10 text-[#e8b33d]`}>Testing…</span>;
  return <span className={`${base} bg-white/5 text-[#9a968c]`}>Untested</span>;
}

function ProviderCard({
  def,
  active,
  config,
  keys,
  status,
  onKey,
  onConfig,
  onUse,
  onTest,
}: {
  def: ProviderDef;
  active: boolean;
  config: AgentConfig;
  keys: Record<string, string>;
  status: ProviderStatus;
  onKey: (provider: ProviderId, key: string) => void;
  onConfig: (provider: ProviderId, patch: Partial<AgentConfig>) => void;
  onUse: (provider: ProviderId) => void;
  onTest: (provider: ProviderId) => void;
}) {
  const key = keys[def.id] || "";
  const model = config.model;
  const baseUrl = config.baseUrl;
  const showBaseUrl = def.defaultBaseUrl !== null;

  return (
    <div
      className={`rounded-lg border bg-[#141613] p-5 ${active ? "border-[#e8b33d]/50" : "border-[#262824]"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg leading-snug flex items-center gap-2">
          <Bot className="h-4 w-4 text-[#e8b33d]" /> {def.label}
        </h2>
        {active && (
          <span className="font-ui text-xs px-2 py-0.5 rounded-full bg-[#e8b33d] text-black font-semibold">
            Active
          </span>
        )}
        <span className="ml-auto">
          <StatusPill status={status} />
        </span>
      </div>
      <p className="font-ui text-[13px] text-[#9a968c] mt-1 leading-5">{def.blurb}</p>

      <div className="mt-4 space-y-3 font-ui text-sm">
        {def.needsKey && (
          <div>
            <label
              htmlFor={`key-${def.id}`}
              className="text-xs text-[#9a968c] flex items-center gap-1.5"
            >
              <KeyRound className="h-3.5 w-3.5" /> {def.keyLabel}
            </label>
            <input
              id={`key-${def.id}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              placeholder={def.keyPlaceholder}
              onChange={(e) => onKey(def.id, e.target.value)}
              className="mt-1.5 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2 text-sm font-code outline-none focus:border-[#e8b33d]"
            />
          </div>
        )}

        {showBaseUrl && (
          <div>
            <label htmlFor={`base-${def.id}`} className="text-xs text-[#9a968c]">
              Base URL <span className="text-[#8a877d]">(blank = default)</span>
            </label>
            <input
              id={`base-${def.id}`}
              type="url"
              autoComplete="off"
              spellCheck={false}
              value={baseUrl}
              placeholder={def.defaultBaseUrl || ""}
              onChange={(e) => onConfig(def.id, { baseUrl: e.target.value })}
              className="mt-1.5 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2 text-sm font-code outline-none focus:border-[#e8b33d]"
            />
          </div>
        )}

        <div>
          <label htmlFor={`model-${def.id}`} className="text-xs text-[#9a968c]">
            Model
          </label>
          <select
            id={`model-${def.id}`}
            value={def.models.includes(model) ? model : def.defaultModel}
            onChange={(e) => onConfig(def.id, { model: e.target.value })}
            className="mt-1.5 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2 text-sm outline-none focus:border-[#e8b33d]"
          >
            {def.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5 font-ui text-sm">
        <button
          onClick={() => onTest(def.id)}
          disabled={status.state === "testing"}
          className="px-4 py-2 rounded-md border border-[#3a3c37] text-sm hover:bg-white/5 disabled:opacity-40"
        >
          {status.state === "testing" ? "Testing…" : "Test"}
        </button>
        {!active && (
          <button
            onClick={() => onUse(def.id)}
            className="px-4 py-2 rounded-md bg-[#e8b33d] text-black font-semibold text-sm hover:bg-[#f2c14e]"
          >
            Use {def.label}
          </button>
        )}
        {def.helpUrl && (
          <a
            href={def.helpUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[#e8b33d] hover:underline rounded"
          >
            {def.needsKey ? "Get a key →" : "Docs →"}
          </a>
        )}
      </div>

      {(status.message || status.at) && (
        <p className="font-ui text-xs text-[#9a968c] mt-3 leading-5">
          {status.message}
          {status.latencyMs !== null && status.state === "connected" ? ` (${status.latencyMs}ms)` : ""}
          {status.at ? ` · last tested ${status.at}` : ""}
        </p>
      )}
    </div>
  );
}

export default function AgentsPage() {
  const [config, setConfig] = useState<AgentConfig>({
    provider: "house",
    model: "house-guided",
    baseUrl: "",
  });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, { model: string; baseUrl: string }>>({});
  const [statuses, setStatuses] = useState<Record<string, ProviderStatus>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // External-system sync (localStorage), deferred so it runs as a callback.
    const t = setTimeout(() => {
      setConfig(getAgentConfig());
      setKeys(getAgentKeys());
      setLoaded(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  function draftFor(def: ProviderDef): { model: string; baseUrl: string } {
    if (def.id === config.provider) return { model: config.model, baseUrl: config.baseUrl };
    return drafts[def.id] || { model: def.defaultModel, baseUrl: "" };
  }

  function handleKey(provider: ProviderId, key: string) {
    const trimmed = key.trim();
    setKeys((k) => {
      const next = { ...k };
      if (trimmed) next[provider] = trimmed;
      else delete next[provider];
      return next;
    });
    setAgentKey(provider, trimmed);
  }

  function handleConfig(provider: ProviderId, patch: Partial<AgentConfig>) {
    const def = PROVIDERS.find((p) => p.id === provider);
    if (!def) return;
    const current = draftFor(def);
    const next = { ...current, ...patch, provider } as AgentConfig;
    if (provider === config.provider) {
      setConfig(next);
      setAgentConfig(next);
    } else {
      setDrafts((d) => ({ ...d, [provider]: { model: next.model, baseUrl: next.baseUrl } }));
    }
  }

  function handleUse(provider: ProviderId) {
    const def = PROVIDERS.find((p) => p.id === provider);
    if (!def) return;
    const d = draftFor(def);
    const next: AgentConfig = { provider, model: d.model, baseUrl: d.baseUrl };
    setConfig(next);
    setAgentConfig(next);
  }

  async function handleTest(provider: ProviderId) {
    const def = PROVIDERS.find((p) => p.id === provider);
    if (!def) return;
    setStatuses((s) => ({ ...s, [provider]: { ...FRESH_STATUS, state: "testing" } }));
    const d = draftFor(def);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test",
          provider,
          key: keys[provider] || "",
          baseUrl: d.baseUrl || undefined,
        }),
      });
      const data = (await res.json()) as TestResponse;
      setStatuses((s) => ({
        ...s,
        [provider]: {
          state: data.ok ? "connected" : "error",
          message: data.message || (data.ok ? "Connected." : "Test failed."),
          latencyMs: typeof data.latencyMs === "number" ? data.latencyMs : null,
          at: new Date().toLocaleTimeString(),
        },
      }));
    } catch (e) {
      setStatuses((s) => ({
        ...s,
        [provider]: {
          state: "error",
          message: e instanceof Error ? e.message : String(e),
          latencyMs: null,
          at: new Date().toLocaleTimeString(),
        },
      }));
    }
  }

  // Per-card view model: active card reads live config, others read drafts.
  function cardConfig(def: ProviderDef): AgentConfig {
    if (def.id === config.provider) return config;
    const d = drafts[def.id] || { model: def.defaultModel, baseUrl: "" };
    return { provider: def.id, ...d };
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <h1 className="text-3xl tracking-tight">Your agents</h1>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl leading-6">
        Keys stay on this device — they are only sent inside assist requests. The House agent is
        free and needs no key. <Link href="/scenarios" className="text-[#e8b33d] hover:underline rounded">Run a scenario →</Link>
      </p>

      {!loaded ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading providers">
          {PROVIDERS.slice(0, 4).map((p) => (
            <div key={p.id} className="rounded-lg border border-[#262824] bg-[#141613] p-5 animate-pulse">
              <div className="h-5 w-40 rounded bg-white/10" />
              <div className="mt-3 h-10 rounded bg-white/5" />
              <div className="mt-2 h-10 rounded bg-white/5" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 items-start">
          {PROVIDERS.map((def) => (
            <ProviderCard
              key={def.id}
              def={def}
              active={def.id === config.provider}
              config={cardConfig(def)}
              keys={keys}
              status={statuses[def.id] || FRESH_STATUS}
              onKey={handleKey}
              onConfig={handleConfig}
              onUse={handleUse}
              onTest={(id) => void handleTest(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
