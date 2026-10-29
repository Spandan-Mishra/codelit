import { NextResponse } from "next/server";
import { getProvider } from "@/lib/agents";
import { limited, clientIp } from "@/lib/ratelimit";

const MAX_SYSTEM = 2000;
const MAX_USER = 6000;
const MAX_OUT = 1500;
const TIMEOUT_MS = 12_000;

const HOUSE_SYSTEM =
  "You are Codelit's house agent. Give short guided hints only (2-3 sentences): point at the likely bug or next step, ask one focusing question. Never write a full solution or full corrected code.";

function baseOf(baseUrl: unknown, fallback: string | null): string {
  const b = typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : fallback || "";
  return b.replace(/\/+$/, "");
}

function truncate(s: string): string {
  return s.length > MAX_OUT ? s.slice(0, MAX_OUT) : s;
}

function offlineHouseHint(user: string): string {
  const lines = user.split("\n").map((l) => l.trim()).filter(Boolean);
  const codeLine = lines.find((l) => /[=(){}\[\];:]/.test(l) && l.length < 120) || lines[0] || "";
  const quote = codeLine ? ` Look closely at \`${codeLine.slice(0, 80)}\` —` : "";
  const focus = /\bfor\b|\bwhile\b/.test(user)
    ? `trace what changes on the first two iterations and check the loop invariant after each.${quote} what value surprises you?`
    : /\bif\b|\belse\b/.test(user)
      ? `find the smallest input that takes each branch.${quote} which branch mishandles it, and why?`
      : `explain in one sentence what each line contributes to the answer.${quote} which line's contribution can't you justify?`;
  return (
    `Here's a nudge, not a solution: ${focus} ` +
    `Once you can name the exact failing input, the fix is usually one small change.`
  );
}

async function callHouse(user: string): Promise<{ text: string; engine: string }> {
  const key = process.env.MODEL_API_KEY;
  if (key) {
    const base = (process.env.META_API_BASE || "https://api.meta.ai/v1").replace(/\/+$/, "");
    const model = process.env.META_MODEL || "muse-spark-1.3-contributor";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: HOUSE_SYSTEM },
              { role: "user", content: user },
            ],
            max_tokens: 400,
            temperature: 0.4,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const text = (data.choices?.[0]?.message?.content as string) || "";
          if (text.trim()) return { text: truncate(text.trim()), engine: model };
        }
      } finally {
        clearTimeout(t);
      }
    } catch {
      /* fall through to offline hint */
    }
  }
  return { text: truncate(offlineHouseHint(user)), engine: "house-offline" };
}

export async function POST(req: Request) {
  if (limited(`agent-proxy:${clientIp(req)}`, 20)) {
    return NextResponse.json({ error: "Rate limited — wait a minute." }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const def = getProvider(String(body.provider || ""));
  if (!def) return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  const system = typeof body.system === "string" ? body.system : "";
  const user = typeof body.user === "string" ? body.user : "";
  if (!user.trim()) return NextResponse.json({ error: "Missing user prompt." }, { status: 400 });
  if (system.length > MAX_SYSTEM) return NextResponse.json({ error: "System prompt too long — keep it under 2000 characters." }, { status: 413 });
  if (user.length > MAX_USER) return NextResponse.json({ error: "User prompt too long — keep it under 6000 characters." }, { status: 413 });

  const provider = def.id;
  if (provider === "house") {
    const out = await callHouse(user);
    return NextResponse.json(out);
  }

  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (def.needsKey && !key) return NextResponse.json({ error: "API key required." }, { status: 400 });
  const base = baseOf(body.baseUrl, def.defaultBaseUrl);
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 100) : def.defaultModel;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res: Response;
    if (provider === "anthropic") {
      res = await fetch(`${base}/v1/messages`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 500,
          ...(system ? { system } : {}),
          messages: [{ role: "user", content: user }],
        }),
      });
      if (res.status === 401) return NextResponse.json({ error: "Invalid key." }, { status: 401 });
      if (!res.ok) return NextResponse.json({ error: `Anthropic error (HTTP ${res.status}).` }, { status: 502 });
      const data = await res.json();
      const text = (data.content?.[0]?.text as string) || "";
      return NextResponse.json({ text: truncate(text), engine: model });
    }
    if (provider === "google") {
      res = await fetch(
        `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
            contents: [{ parts: [{ text: user }] }],
            generationConfig: { maxOutputTokens: 500 },
          }),
        }
      );
      if (res.status === 400 || res.status === 403) return NextResponse.json({ error: "Invalid key." }, { status: 401 });
      if (!res.ok) return NextResponse.json({ error: `Google error (HTTP ${res.status}).` }, { status: 502 });
      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts?.[0]?.text as string) || "";
      return NextResponse.json({ text: truncate(text), engine: model });
    }
    // OpenAI-compatible chat completions: openai, openrouter, meta, ollama.
    const path = provider === "ollama" ? "/v1/chat/completions" : "/chat/completions";
    res = await fetch(`${base}${path}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: user },
        ],
        max_tokens: 500,
        temperature: 0.4,
      }),
    });
    if (res.status === 401) return NextResponse.json({ error: "Invalid key." }, { status: 401 });
    if (!res.ok) {
      if (provider === "ollama" && res.status === 404) {
        return NextResponse.json({ error: "Model not found — try `ollama pull` first." }, { status: 502 });
      }
      return NextResponse.json({ error: `${def.label} error (HTTP ${res.status}).` }, { status: 502 });
    }
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content as string) || "";
    return NextResponse.json({ text: truncate(text), engine: model });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    if (provider === "ollama") return NextResponse.json({ error: "Unreachable — is Ollama running?" }, { status: 502 });
    return NextResponse.json({ error: aborted ? "Timed out reaching provider." : "Unreachable — check the base URL and network." }, { status: 502 });
  } finally {
    clearTimeout(t);
  }
}
