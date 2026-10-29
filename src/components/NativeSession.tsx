// Native solving session: chat with the user's own agent, live activity,
// approvals, a revisioned solution view, and finish. The browser editor is
// locked while the agent holds the write token; edits flush with the next
// turn or the connector reports a conflict. Local activity is labeled as
// such — only frozen bytes evaluated server-side count. Experimental.

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { OctagonX, Play, ShieldAlert, Square, FlaskConical, Layers } from "lucide-react";
import type { NativeAttempt, NativeEvent } from "@/lib/native/protocol";

interface Props {
  attemptId: string;
}

function evText(e: NativeEvent): string {
  const p = e.payload;
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  switch (e.type) {
    case "prompt.forwarded":
      return `You: ${s("text").slice(0, 500)}`;
    case "message.final":
      return `${e.model || e.adapter || "agent"}: ${s("text").slice(0, 800)}`;
    case "turn.started":
      return "Agent is working…";
    case "turn.completed":
      return "Turn complete.";
    case "turn.failed":
      return `Turn failed: ${s("error").slice(0, 200)}`;
    case "turn.interrupted":
      return "Turn interrupted.";
    case "tool.requested":
      return `Tool: ${s("name").slice(0, 120)}`;
    case "tool.completed":
      return `Done: ${s("name").slice(0, 120)}${s("summary") ? ` — ${s("summary").slice(0, 160)}` : ""}`;
    case "tool.failed":
      return `Tool failed: ${s("name").slice(0, 120)}`;
    case "tool.denied":
      return `Denied: ${s("name").slice(0, 120)}`;
    case "local.command":
      return `Local run: ${(s("cmd") || "checks").slice(0, 120)} → ${p.passed === true ? "pass" : p.passed === false ? "FAIL" : "done"}`;
    case "official.test":
      return `Official acceptance: ${String(p.passedCount ?? "?")}/${String(p.totalCount ?? "?")} green.`;
    case "connection.gap":
      return "Reconnect gap — some connector events may be missing; history was not invented.";
    case "session.replaced":
      return "Native session was replaced — earlier context may not carry over.";
    case "context.delivered":
      return `Stage ${String(p.stage ?? "?")} requirements synced to the agent.`;
    case "file.snapshot":
      return "Snapshot frozen for evaluation.";
    default:
      return "";
  }
}

export default function NativeSession({ attemptId }: Props) {
  const [attempt, setAttempt] = useState<NativeAttempt | null>(null);
  const [events, setEvents] = useState<NativeEvent[]>([]);
  const [input, setInput] = useState("");
  const [code, setCode] = useState("");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const sinceRef = useRef(-1);
  const finishTries = useRef(0);

  const load = useCallback(async () => {
    try {
      setNowMs(Date.now());
      const res = await fetch(`/api/native/events?attemptId=${encodeURIComponent(attemptId)}&since=${sinceRef.current}`);
      const data = await res.json();
      if (!res.ok) {
        setNotice(typeof data.error === "string" ? data.error : `Server error ${res.status}`);
        return;
      }
      if (data.attempt) setAttempt(data.attempt as NativeAttempt);
      const fresh = (data.events || []) as NativeEvent[];
      if (fresh.length > 0) {
        setEvents((prev) => {
          const ids = new Set(prev.map((e) => e.id));
          const merged = [...prev, ...fresh.filter((e) => !ids.has(e.id))].sort((a, b) => a.seq - b.seq);
          return merged.slice(-300);
        });
        sinceRef.current = Math.max(sinceRef.current, ...fresh.map((e) => e.seq));
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }, [attemptId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const p = setInterval(() => void load(), 3000);
    return () => {
      clearTimeout(t);
      clearInterval(p);
    };
  }, [load]);

  // Editor is a render-derived view: the agent revision shows unless the user
  // has unsent edits. A rev advance over unsent edits is shown, not clobbered.
  const revEvents = events.filter((e) => e.type === "file.revision" || e.type === "file.snapshot");
  const latestRev = revEvents.length > 0 ? revEvents[revEvents.length - 1] : null;
  const latestRevNum = typeof latestRev?.payload.rev === "number" ? (latestRev.payload.rev as number) : -1;
  const latestContent = typeof latestRev?.payload.content === "string" ? (latestRev.payload.content as string) : "";
  const conflict = events.filter((e) => e.type === "file.revision" && e.payload.conflict === true).slice(-1)[0];
  const shownCode = dirty ? code : latestContent || code;
  const revAdvancedOverEdits = dirty && latestContent !== "" && latestContent !== code;

  // Auto-complete the two-phase finish once the snapshot lands.
  useEffect(() => {
    if (!finishing || !attempt || attempt.acceptance || finishTries.current >= 8) return;
    const t = setTimeout(async () => {
      finishTries.current += 1;
      try {
        const res = await fetch("/api/native/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "finish", attemptId }),
        });
        const data = await res.json();
        if (res.ok && data.acceptance) setFinishing(false);
      } catch {
        /* retry on next tick */
      }
      void load();
    }, 5000);
    return () => clearTimeout(t);
  }, [finishing, attempt, attemptId, load]);

  async function post(op: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/native/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, attemptId, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) setNotice(typeof data.error === "string" ? data.error : `Server error ${res.status}`);
      return data;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
      void load();
    }
  }

  async function send() {
    if (!input.trim()) return;
    const data = await post("send", {
      text: input,
      ...(dirty ? { code, baseRev: latestRevNum } : {}),
    });
    if (data && data.ok) {
      setInput("");
      setDirty(false);
    }
  }

  async function finish() {
    finishTries.current = 0;
    const data = await post("finish", {});
    if (data && data.ok && data.freezing && !data.acceptance) setFinishing(true);
    if (data && data.ok && data.acceptance) setFinishing(false);
  }

  const decided = new Set(
    events.filter((e) => e.type === "approval.decided").map((e) => String(e.payload.approvalId || ""))
  );
  const pendingApprovals = events.filter(
    (e) =>
      e.type === "approval.requested" &&
      !decided.has(String(e.payload.approvalId || "")) &&
      typeof e.payload.expiresAt === "number" &&
      (e.payload.expiresAt as number) > nowMs
  );

  const agentBusy = attempt?.status === "running" || attempt?.status === "waiting_approval";
  const feed = events.map((e) => ({ e, text: evText(e) })).filter((x) => x.text);
  const budget = attempt ? `${attempt.turnsUsed + attempt.turnsReserved} prompts reserved` : "";

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-3 font-ui text-xs text-[#9a968c]">
        <Link href="/native" className="hover:text-white">← Native attempts</Link>
        {attempt && (
          <>
            <span>{attempt.scenarioId}</span>
            <span>{attempt.adapter || "agent"} · {attempt.language}</span>
            <span>stage {attempt.stage}/3</span>
            <span>{budget}</span>
            <span className="px-2 py-0.5 rounded-full border border-[#3a3c37]">{attempt.status}</span>
          </>
        )}
        <span className="px-2 py-0.5 rounded-full border border-[#e8b33d]/40 text-[#e8b33d]">Experimental</span>
      </div>

      {conflict && (
        <div className="mt-4 rounded-lg border border-red-400/30 bg-red-400/5 px-4 py-3 font-ui text-sm text-red-200">
          Edit conflict: the agent changed the file while you were typing, so your buffer was not applied.
          Copy what you need from your text — the agent revision below is authoritative.
        </div>
      )}
      {pendingApprovals.length > 0 && (
        <div className="mt-4 space-y-2">
          {pendingApprovals.map((a) => (
            <div key={a.id} className="rounded-lg border border-[#e8b33d]/40 bg-[#141613] px-4 py-3 font-ui text-sm">
              <p className="font-semibold flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-[#e8b33d]" /> Approval requested
              </p>
              <p className="mt-1 text-[#9a968c] font-code text-xs break-all">
                {String(a.payload.kind || "tool")} · {String(a.payload.command || a.payload.path || a.payload.detail || "")}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => void post("approval", { approvalId: String(a.payload.approvalId || ""), decision: "allow-once" })}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-md bg-[#e8b33d] text-black font-semibold text-xs disabled:opacity-50"
                >
                  Allow once
                </button>
                <button
                  onClick={() => void post("approval", { approvalId: String(a.payload.approvalId || ""), decision: "deny" })}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-md border border-[#3a3c37] text-xs"
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-5 lg:grid-cols-2 items-start">
        <div className="rounded-lg border border-[#262824] bg-[#141613] p-4">
          <p className="font-ui text-xs text-[#9a968c]">Agent chat & activity</p>
          <div className="mt-2 h-96 overflow-y-auto space-y-2 font-ui text-sm">
            {feed.length === 0 && <p className="text-[#9a968c]">No activity yet — introduce your task below.</p>}
            {feed.map(({ e, text }) => (
              <div key={e.id} className="rounded-md bg-black/40 border border-[#262824] px-3 py-2 leading-6">
                {text}
                {e.source === "connector" && <span className="ml-2 text-[11px] text-[#9a968c]">via {e.adapter || "connector"}</span>}
              </div>
            ))}
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            placeholder="Ask your agent to solve, explain, or change the code…"
            className="mt-3 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2 font-ui text-sm outline-none focus:border-[#e8b33d]"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => void send()} disabled={busy || !input.trim()} className="px-4 py-2 rounded-md bg-[#e8b33d] text-black font-semibold text-sm disabled:opacity-50">
              Send
            </button>
            <button onClick={() => void post("interrupt", {})} disabled={busy} className="px-3 py-2 rounded-md border border-[#3a3c37] text-sm flex items-center gap-1.5">
              <Square className="h-3.5 w-3.5" /> Stop
            </button>
            <button onClick={() => void post("test", {})} disabled={busy} className="px-3 py-2 rounded-md border border-[#3a3c37] text-sm flex items-center gap-1.5">
              <FlaskConical className="h-3.5 w-3.5" /> Run visible checks
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-[#262824] bg-[#141613] p-4">
          <div className="flex items-center justify-between">
            <p className="font-ui text-xs text-[#9a968c]">
              Solution · rev {latestRevNum >= 0 ? latestRevNum : "—"}
              {agentBusy ? " · locked — agent is writing" : " · editable"}
            </p>
            {attempt && attempt.stage < 3 && (
              <button onClick={() => void post("stage", {})} disabled={busy} className="text-xs px-3 py-1.5 rounded-md border border-[#3a3c37] flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" /> Release stage {attempt.stage + 1}
              </button>
            )}
          </div>
          <textarea
            value={shownCode}
            onChange={(e) => {
              setCode(e.target.value);
              setDirty(true);
            }}
            rows={18}
            spellCheck={false}
            disabled={agentBusy}
            placeholder="The agent's solution appears here once it writes the file."
            className="mt-2 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2 font-code text-[13px] leading-6 outline-none focus:border-[#e8b33d] disabled:opacity-70"
          />
          {revAdvancedOverEdits && (
            <p className="mt-1 font-ui text-xs text-[#e8b33d]">
              The agent published a newer revision while you were typing — your text is kept; sending will flush it or report a conflict.
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={() => void finish()} disabled={busy || finishing} className="px-4 py-2 rounded-md bg-emerald-400/90 text-black font-semibold text-sm disabled:opacity-50 flex items-center gap-1.5">
              <Play className="h-3.5 w-3.5" /> {finishing ? "Freezing…" : "Finish & evaluate"}
            </button>
            {notice && <span className="font-ui text-xs text-[#e8b33d]">{notice}</span>}
          </div>
          {attempt?.acceptance && (
            <div className={`mt-3 rounded-md border p-3 font-ui text-sm ${attempt.acceptance.passed ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-200" : "border-red-400/30 bg-red-400/5 text-red-200"}`}>
              Official acceptance: {attempt.acceptance.passedCount}/{attempt.acceptance.totalCount} green
              {attempt.submissionHash && <span className="block text-xs text-[#9a968c] mt-1 font-code">snapshot {attempt.submissionHash.slice(0, 16)}…</span>}
            </div>
          )}
        </div>
      </div>

      {attempt?.status === "finishing" && !attempt.acceptance && (
        <p className="mt-4 font-ui text-sm text-[#9a968c] flex items-center gap-2">
          <OctagonX className="h-4 w-4" /> Waiting for the agent to go idle and the frozen snapshot — keep this page open.
        </p>
      )}
    </div>
  );
}
