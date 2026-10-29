import { NextResponse } from "next/server";
import { getProvider, type ProviderId } from "@/lib/agents";
import { limited, clientIp } from "@/lib/ratelimit";

const TIMEOUT_MS = 12_000;

function baseOf(baseUrl: unknown, fallback: string | null): string {
  const b = typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : fallback || "";
  return b.replace(/\/+$/, "");
}

async function timed<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<{ out: T; ms: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const out = await fn(ctrl.signal);
    return { out, ms: Date.now() - start };
  } finally {
    clearTimeout(t);
  }
}

function fail(message: string, latencyMs: number) {
  return NextResponse.json({ ok: false, message, latencyMs });
}

export async function POST(req: Request) {
  if (limited(`providers:${clientIp(req)}`, 20)) {
    return NextResponse.json({ ok: false, message: "Rate limited — wait a minute.", latencyMs: 0 }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON body.", latencyMs: 0 }, { status: 400 });
  }
  if (body.action !== "test") {
    return NextResponse.json({ ok: false, message: "Unknown action.", latencyMs: 0 }, { status: 400 });
  }
  const def = getProvider(String(body.provider || ""));
  if (!def) {
    return NextResponse.json({ ok: false, message: "Unknown provider.", latencyMs: 0 }, { status: 400 });
  }
  const provider = def.id as ProviderId;
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const base = baseOf(body.baseUrl, def.defaultBaseUrl);

  if (provider === "house") {
    return NextResponse.json({ ok: true, message: "House agent is always available.", latencyMs: 0 });
  }
  if (def.needsKey && !key) {
    return NextResponse.json({ ok: false, message: "API key required.", latencyMs: 0 }, { status: 400 });
  }

  try {
    if (provider === "ollama") {
      const { out: res, ms } = await timed((signal) => fetch(`${base}/api/tags`, { signal }));
      if (!res.ok) return fail(`Ollama error (HTTP ${res.status}).`, ms);
      const data = (await res.json()) as { models?: { name?: string }[] };
      const models = (data.models || []).map((m) => m.name || "").filter(Boolean);
      return NextResponse.json({ ok: true, message: "Ollama is reachable.", latencyMs: ms, models });
    }
    if (provider === "anthropic") {
      // Anthropic has no models-list GET; minimal 1-token ping (max_tokens: 1).
      const { out: res, ms } = await timed((signal) =>
        fetch(`${base}/v1/messages`, {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({ model: def.defaultModel, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
        })
      );
      if (res.status === 401) return fail("Invalid key.", ms);
      if (!res.ok) return fail(`Anthropic error (HTTP ${res.status}).`, ms);
      return NextResponse.json({ ok: true, message: "Anthropic key works.", latencyMs: ms });
    }
    if (provider === "google") {
      const { out: res, ms } = await timed((signal) =>
        fetch(`${base}/models?key=${encodeURIComponent(key)}`, { signal })
      );
      if (res.status === 400 || res.status === 403) return fail("Invalid key.", ms);
      if (!res.ok) return fail(`Google error (HTTP ${res.status}).`, ms);
      return NextResponse.json({ ok: true, message: "Google key works.", latencyMs: ms });
    }
    // OpenAI-compatible: openai, openrouter, meta — GET {base}/models.
    const { out: res, ms } = await timed((signal) =>
      fetch(`${base}/models`, { signal, headers: { Authorization: `Bearer ${key}` } })
    );
    if (res.status === 401) return fail("Invalid key.", ms);
    if (!res.ok) return fail(`${def.label} error (HTTP ${res.status}).`, ms);
    let models: string[] | undefined;
    try {
      const data = (await res.json()) as { data?: { id?: string }[] };
      if (Array.isArray(data.data)) models = data.data.map((m) => m.id || "").filter(Boolean).slice(0, 50);
    } catch {
      /* models list optional */
    }
    return NextResponse.json({ ok: true, message: `${def.label} key works.`, latencyMs: ms, models });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    if (provider === "ollama") return fail("Unreachable — is Ollama running?", 0);
    return fail(aborted ? "Timed out reaching provider." : "Unreachable — check the base URL and network.", 0);
  }
}
