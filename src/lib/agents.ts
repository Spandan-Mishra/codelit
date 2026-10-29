// House agent free tier: when MODEL_API_KEY is configured, "house" answers
// via that server key on META_API_BASE/META_MODEL with a hints-only system
// prompt (its tokens count against the normal prompt budget). Otherwise it
// falls back to a deterministic offline guided hint (no model call, always
// available). Free expects abuse caps; rate-limit stays strict. Upgrade path:
// point the house provider at a dedicated fine-tuned house model later by
// swapping the model/base default below — the provider id stays "house".

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "meta"
  | "ollama"
  | "house";

export interface ProviderDef {
  id: ProviderId;
  label: string;
  needsKey: boolean;
  keyLabel: string;
  keyPlaceholder: string;
  defaultBaseUrl: string | null;
  models: string[];
  defaultModel: string;
  helpUrl: string;
  blurb: string;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "openai",
    label: "OpenAI",
    needsKey: true,
    keyLabel: "OpenAI API key",
    keyPlaceholder: "sk-...",
    defaultBaseUrl: "https://api.openai.com/v1",
    models: ["gpt-5-mini", "gpt-5"],
    defaultModel: "gpt-5-mini",
    helpUrl: "https://platform.openai.com/api-keys",
    blurb: "Your OpenAI key, billed to your account.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    needsKey: true,
    keyLabel: "Anthropic API key",
    keyPlaceholder: "sk-ant-...",
    defaultBaseUrl: "https://api.anthropic.com",
    models: ["claude-sonnet-4-6", "claude-opus-4-6"],
    defaultModel: "claude-sonnet-4-6",
    helpUrl: "https://console.anthropic.com/settings/keys",
    blurb: "Your Anthropic key, billed to your account.",
  },
  {
    id: "google",
    label: "Google",
    needsKey: true,
    keyLabel: "Google AI API key",
    keyPlaceholder: "AIza...",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    defaultModel: "gemini-2.5-flash",
    helpUrl: "https://aistudio.google.com/apikey",
    blurb: "Your Google AI key, billed to your account.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    needsKey: true,
    keyLabel: "OpenRouter API key",
    keyPlaceholder: "sk-or-...",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    models: ["openai/gpt-5-mini", "anthropic/claude-sonnet-4-6"],
    defaultModel: "openai/gpt-5-mini",
    helpUrl: "https://openrouter.ai/keys",
    blurb: "One key for many models via OpenRouter.",
  },
  {
    id: "meta",
    label: "Meta",
    needsKey: true,
    keyLabel: "Meta API key",
    keyPlaceholder: "meta-...",
    defaultBaseUrl: "https://api.meta.ai/v1",
    models: ["muse-spark-1.3-contributor", "muse-spark-1.3"],
    defaultModel: "muse-spark-1.3-contributor",
    helpUrl: "https://developers.meta.com/",
    blurb: "Your Meta key, billed to your account.",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    needsKey: false,
    keyLabel: "",
    keyPlaceholder: "",
    defaultBaseUrl: "http://localhost:11434",
    models: ["llama3.1", "qwen2.5-coder"],
    defaultModel: "llama3.1",
    helpUrl: "https://ollama.com/library",
    blurb: "Local models via Ollama — free, runs on your machine.",
  },
  {
    id: "house",
    label: "House Agent (free)",
    needsKey: false,
    keyLabel: "",
    keyPlaceholder: "",
    defaultBaseUrl: null,
    models: ["house-guided"],
    defaultModel: "house-guided",
    helpUrl: "",
    blurb: "Free guided hints, no key needed.",
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
