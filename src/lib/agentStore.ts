"use client";
import { getProvider, type ProviderId } from "@/lib/agents";

export const AGENT_KEYS_KEY = "codelit:agent-keys";
export const AGENT_CONFIG_KEY = "codelit:agent-config";

export interface AgentConfig {
  provider: ProviderId;
  model: string;
  baseUrl: string;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  provider: "house",
  model: "house-guided",
  baseUrl: "",
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// Keys stay on this device. Callers must only send them inside
// /api/agent-proxy POST bodies, never render or log them.
export function getAgentKeys(): Record<string, string> {
  const v = read<Record<string, string>>(AGENT_KEYS_KEY, {});
  return v && typeof v === "object" ? v : {};
}

export function setAgentKey(provider: ProviderId, key: string) {
  const keys = getAgentKeys();
  if (key) keys[provider] = key;
  else delete keys[provider];
  write(AGENT_KEYS_KEY, keys);
}

export function getAgentConfig(): AgentConfig {
  const v = read<Partial<AgentConfig>>(AGENT_CONFIG_KEY, {});
  const def = v && typeof v.provider === "string" ? getProvider(v.provider) : undefined;
  if (!def) return { ...DEFAULT_AGENT_CONFIG };
  return {
    provider: def.id,
    model: typeof v.model === "string" && v.model ? v.model : def.defaultModel,
    baseUrl: typeof v.baseUrl === "string" ? v.baseUrl : "",
  };
}

export function setAgentConfig(cfg: AgentConfig) {
  write(AGENT_CONFIG_KEY, cfg);
}

export function getActiveProviderLabel(): { label: string; model: string } {
  const cfg = getAgentConfig();
  const def = getProvider(cfg.provider);
  return { label: def ? def.label : "House Agent (free)", model: cfg.model };
}
