"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Bot, Check, CheckCheck, ChevronDown, Circle, CircleAlert, Code2, FileCode2, FlaskConical, Layers, LoaderCircle, LockKeyhole, RefreshCw, Send, ShieldAlert, Square, Terminal, Wifi, WifiOff } from "lucide-react";
import type { AdapterCapabilities, NativeAttempt, NativeEvent } from "@/lib/native/protocol";
import SessionMarkdown from "./SessionMarkdown";
import AttemptPreparation from "./AttemptPreparation";

type SessionAttempt = NativeAttempt & { model?: string | null; title?: string; archivedAt?: number | null };
type SessionAdapter = AdapterCapabilities & { status?: string; message?: string; models?: { id: string; label: string }[] };
interface SessionScenario {
  id: string;
  title: string;
  difficulty: string;
  tags: string[];
  fnName: string;
  promptPar: number;
  minutes: number;
  stages: { stage: number; title: string; brief: string; visibleTests: { input: string; expected: string }[] }[];
  stub: string;
}
interface SessionDevice {
  label: string;
  lastSeenAt: number;
  online?: boolean;
  revokedAt?: number | null;
  adapters: SessionAdapter[];
}
interface SessionData {
  attempt: SessionAttempt;
  events: NativeEvent[];
  scenario: SessionScenario;
  device: SessionDevice | null;
  snapshot?: { content: string; rev: number; hash: string } | null;
}

const button = "inline-flex items-center justify-center gap-2 rounded-lg border border-[#34372e] px-3 py-2 text-xs font-medium text-[#d9dbd0] transition hover:border-[#777e66] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#34372e] disabled:hover:bg-transparent";
const select = "mt-1.5 w-full min-w-0 rounded-lg border border-[#34372e] bg-[#0e100c] px-2.5 py-2 text-xs text-[#e3e5d9] disabled:cursor-not-allowed disabled:opacity-50";

function stringPayload(event: NativeEvent, key: string) {
  return typeof event.payload[key] === "string" ? event.payload[key] as string : "";
}

function activityText(event: NativeEvent): string {
  const text = (key: string) => stringPayload(event, key);
  switch (event.type) {
    case "prompt.accepted": return "Prompt queued for your agent.";
    case "prompt.rejected": return `Prompt rejected: ${text("error") || text("reason") || "The connector could not start this turn."}`;
    case "turn.started": return "Agent is working on your solution.";
    case "turn.completed": return "Agent turn complete. Review the file and run checks.";
    case "turn.failed": return `Agent turn failed: ${text("error") || "No error details were reported."}`;
    case "turn.interrupted": return "Agent turn stopped.";
    case "tool.requested": case "tool.started": return `Using ${text("name") || "a tool"}${text("summary") ? ` · ${text("summary")}` : ""}`;
    case "tool.completed": return `${text("name") || "Tool"} completed${text("summary") ? ` · ${text("summary")}` : ""}`;
    case "tool.failed": case "tool.denied": return `${text("name") || "Tool"} ${event.type === "tool.failed" ? "failed" : "denied"}${text("error") || text("summary") ? ` · ${text("error") || text("summary")}` : ""}`;
    case "local.command": return `Connector check: ${text("cmd") || "local command"} · ${event.payload.passed === true ? "passed" : event.payload.passed === false ? "failed" : "completed"}${text("summary") ? `\n${text("summary")}` : ""}`;
    case "official.test": return `${event.payload.scope === "visible" ? `Stage ${String(event.payload.stage ?? "")} visible checks` : "Final acceptance"}: ${String(event.payload.passedCount ?? "?")}/${String(event.payload.totalCount ?? "?")} passed.`;
    case "connection.gap": return "Connection gap: some connector activity may be missing from this history.";
    case "session.replaced": return `Agent session changed. ${text("reason") || "The next prompt uses the current requirements."}`;
    case "context.delivered": return `Stage ${String(event.payload.stage ?? "?")} requirements released to the workspace.`;
    case "file.snapshot": return "Solution snapshot frozen for final evaluation.";
    case "approval.expired": return "An approval request expired. Ask your agent to retry if needed.";
    default: return "";
  }
}

function CheckResults({ event }: { event: NativeEvent }) {
  const results = Array.isArray(event.payload.results) ? event.payload.results as Record<string, unknown>[] : [];
  if (!results.length) return null;
  return <details className="mt-2"><summary className="cursor-pointer text-xs text-[#e8b33d]">View check results</summary><div className="mt-2 space-y-2">{results.map((result, index) => <div key={index} className="rounded-md border border-[#30322c] bg-black/20 p-2.5 text-xs"><p className={result.passed === true ? "text-emerald-300" : "text-red-300"}>{result.passed === true ? "Passed" : "Failed"} · example {index + 1}</p>{["input", "expected", "actual"].map((key) => result[key] !== undefined && <div key={key} className="mt-1.5"><span className="text-[#979c8c]">{key}</span><pre className="overflow-x-auto whitespace-pre-wrap break-words font-code text-[#d5d8ca]">{typeof result[key] === "string" ? result[key] : JSON.stringify(result[key], null, 2)}</pre></div>)}</div>)}</div></details>;
}

// Generic level meanings. These describe the fixed stage structure, never the
// unreleased briefs — locked-stage content stays server-side until unlocked.
const STAGE_LEVEL_MEANINGS = [
  "Core sample — implement the base behavior against one visible example.",
  "Edges and extensions — adapt the same solution; every visible example is shown.",
  "Hidden acceptance — final coverage; finishing runs the full suite including hidden tests.",
];

function containsFullSolution(text: string): boolean {
  let fenceLen = 0, maxFence = 0, inFence = false, indentLen = 0, maxIndent = 0;
  for (const line of text.split("\n")) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      if (inFence) { maxFence = Math.max(maxFence, fenceLen); fenceLen = 0; }
      inFence = !inFence;
      indentLen = 0;
      continue;
    }
    if (inFence) { if (line.trim()) fenceLen++; }
    else if (/^(?: {4}|\t)/.test(line) && line.trim()) { indentLen++; maxIndent = Math.max(maxIndent, indentLen); }
    else indentLen = 0;
  }
  if (inFence) maxFence = Math.max(maxFence, fenceLen);
  return maxFence >= 8 || maxIndent >= 8;
}

function ToolActivity({ event }: { event: NativeEvent }) {
  const failed = event.type === "tool.failed" || event.type === "tool.denied";
  const name = stringPayload(event, "name");
  const label = event.type === "tool.completed" ? "Tool completed" : event.type === "tool.failed" ? "Tool failed" : event.type === "tool.denied" ? "Tool denied" : "Agent tool";
  const detail = [name, stringPayload(event, "summary"), stringPayload(event, "error")].filter(Boolean).join("\n\n");
  return <details className={`min-w-0 rounded-lg border px-3 py-2 text-[11px] ${failed ? "border-red-400/20 bg-red-400/5 text-red-200" : "border-[#30362a] text-[#9da98d]"}`}>
    <summary className="cursor-pointer break-words leading-6">{label}{name ? ` · ${name.split("\n")[0].slice(0, 80)}${name.length > 80 ? "…" : ""}` : ""}</summary>
    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-3 font-code text-[11px] leading-6"><code>{detail || "No additional tool details were reported."}</code></pre>
  </details>;
}

export default function NativeSession({ attemptId }: { attemptId: string }) {
  // Navigation between attempts must never reuse a previous attempt's history.
  return <SessionWorkspace key={attemptId} attemptId={attemptId} />;
}

function SessionWorkspace({ attemptId }: { attemptId: string }) {
  const [attempt, setAttempt] = useState<SessionAttempt | null>(null);
  const [scenario, setScenario] = useState<SessionScenario | null>(null);
  const [device, setDevice] = useState<SessionDevice | null>(null);
  const [snapshot, setSnapshot] = useState<SessionData["snapshot"]>(null);
  const [events, setEvents] = useState<NativeEvent[]>([]);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState("");
  const [finishState, setFinishState] = useState<"idle" | "waiting" | "retry">("idle");
  const [finishRetry, setFinishRetry] = useState(0);
  const [selection, setSelection] = useState<{ adapter: string; model: string } | null>(null);
  const [viewedStage, setViewedStage] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const sinceRef = useRef(-1);
  const loadingRef = useRef(false);
  const mountedRef = useRef(false);
  const pendingRef = useRef(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const followChatRef = useRef(true);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const response = await fetch(`/api/native/events?attemptId=${encodeURIComponent(attemptId)}&since=${sinceRef.current}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Could not refresh session (${response.status}).`);
      if (!mountedRef.current) return;
      const session = data as SessionData;
      setNow(Date.now());
      setLoadError("");
      if (session.attempt) setAttempt(session.attempt);
      if (session.scenario) setScenario(session.scenario);
      setDevice(session.device || null);
      setSnapshot(session.snapshot || null);
      const fresh = Array.isArray(session.events) ? session.events : [];
      if (fresh.length) {
        setEvents((previous) => {
          const ids = new Set(previous.map((event) => event.id));
          return [...previous, ...fresh.filter((event) => !ids.has(event.id))].sort((a, b) => a.seq - b.seq);
        });
        sinceRef.current = Math.max(sinceRef.current, ...fresh.map((event) => event.seq));
      }
    } catch (error) {
      if (mountedRef.current) { setLoadError(error instanceof Error ? error.message : String(error)); setNow(Date.now()); }
    } finally { loadingRef.current = false; }
  }, [attemptId]);

  useEffect(() => {
    mountedRef.current = true;
    const first = setTimeout(() => void load(), 0);
    const poll = setInterval(() => void load(), 3000);
    return () => { mountedRef.current = false; clearTimeout(first); clearInterval(poll); };
  }, [load]);

  useEffect(() => {
    if (followChatRef.current && chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [events]);

  const isFinishing = attempt?.status === "finishing" && !attempt.acceptance;
  // The server status, rather than a click-local flag, restores a pending
  // two-phase finish after reload. This timer is independent of event polling.
  useEffect(() => {
    if (!isFinishing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    async function evaluate() {
      if (cancelled) return;
      setFinishState("waiting");
      try {
        const response = await fetch("/api/native/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "finish", attemptId }) });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setNotice(typeof data.error === "string" ? data.error : `Evaluation failed (${response.status}).`);
          setFinishState("retry");
          void load();
          return;
        }
        setNotice("");
        if (data.acceptance) {
          setAttempt((current) => current ? { ...current, status: "done", acceptance: data.acceptance } : current);
          setFinishState("idle");
          void load();
          return;
        }
      } catch (error) {
        if (cancelled) return;
        setNotice(error instanceof Error ? error.message : "Could not reach final evaluation.");
      }
      if (cancelled) return;
      void load();
      if (++tries >= 8) {
        setFinishState("retry");
        setNotice("The solution snapshot is still pending. Check that your connector is running, then retry evaluation or return to solving.");
      } else timer = setTimeout(() => void evaluate(), 5000);
    }
    timer = setTimeout(() => void evaluate(), 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isFinishing, finishRetry, attemptId, load]);

  async function post(op: string, extra: Record<string, unknown> = {}) {
    if (pendingRef.current) return null;
    pendingRef.current = true;
    setPending(op);
    setNotice("");
    try {
      const response = await fetch("/api/native/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, attemptId, ...extra }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Request failed (${response.status}).`);
      if (!mountedRef.current) return null;
      if (data.attempt) setAttempt(data.attempt as SessionAttempt);
      return data;
    } catch (error) {
      if (mountedRef.current) setNotice(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) { setPending(""); void load(); }
    }
  }

  const busy = Boolean(pending);
  const agentBusy = attempt?.status === "running" || attempt?.status === "waiting_approval" || (attempt?.turnsReserved ?? 0) > 0;
  const closed = attempt?.status === "done" || isFinishing || Boolean(attempt?.archivedAt);
  const online = Boolean(device && !device.revokedAt && device.online !== false && now - device.lastSeenAt <= 45000 && !loadError);
  const activeAdapter = device?.adapters.find((adapter) => adapter.adapter === attempt?.adapter);
  const chosenAdapter = selection?.adapter ?? attempt?.adapter ?? "";
  const chosenModel = selection?.model ?? attempt?.model ?? "";
  const selectedAdapter = device?.adapters.find((adapter) => adapter.adapter === chosenAdapter);
  const canOperate = Boolean(attempt && online && !closed && !busy);
  const idle = canOperate && !agentBusy;
  const ready = activeAdapter?.status === "ready";
  const modelOptions = selectedAdapter?.models || [];
  const selectionChanged = chosenAdapter !== (attempt?.adapter || "") || chosenModel !== (attempt?.model || "");
  const releasedStages = scenario?.stages.filter((stage) => stage.stage <= (attempt?.stage ?? 0)) || [];
  const currentStage = releasedStages.find((stage) => stage.stage === attempt?.stage);
  const selectedStage = releasedStages.find((stage) => stage.stage === viewedStage) || currentStage;
  const totalStages = 3;
  const revisionEvents = events.filter((event) => (event.type === "file.revision" || event.type === "file.snapshot") && typeof event.payload.content === "string");
  const revision = revisionEvents[revisionEvents.length - 1];
  const frozen = attempt?.acceptance ? snapshot : null;
  const code = frozen ? frozen.content : revision ? stringPayload(revision, "content") : scenario?.stub || "";
  const revisionNumber = frozen?.rev ?? (typeof revision?.payload.rev === "number" ? revision.payload.rev : typeof revision?.payload.revision === "number" ? revision.payload.revision : null);
  const revisionHash = frozen?.hash || revision?.payload.hash;
  const filePath = stringPayloadOptional(revision, "path") || `solution${attempt?.language === "python" ? ".py" : attempt?.language === "c++" ? ".cpp" : ".js"}`;
  const visibleCheck = events.filter((event) => event.type === "official.test" && event.payload.scope === "visible").at(-1);
  const sameCheckedFile = visibleCheck && typeof visibleCheck.payload.hash === "string" && typeof revisionHash === "string"
    ? visibleCheck.payload.hash === revisionHash
    : !revision || Boolean(visibleCheck && visibleCheck.seq > revision.seq);
  const checksCurrent = Boolean(visibleCheck && visibleCheck.payload.stage === attempt?.stage && sameCheckedFile);
  const checksPassed = checksCurrent && typeof visibleCheck?.payload.totalCount === "number" && visibleCheck.payload.totalCount > 0 && visibleCheck.payload.passedCount === visibleCheck.payload.totalCount;
  const budgetUsed = (attempt?.turnsUsed ?? 0) + (attempt?.turnsReserved ?? 0);
  const budgetExhausted = scenario ? budgetUsed >= scenario.promptPar : false;
  const resolvedApprovals = new Set(events.filter((event) => event.type === "approval.decided" || event.type === "approval.expired").map((event) => String(event.payload.approvalId || "")));
  const terminalTurns = new Set(events.filter((event) => ["turn.completed", "turn.failed", "turn.interrupted"].includes(event.type)).map((event) => event.turnId));
  const approvals = events.filter((event) => event.type === "approval.requested" && event.turnId && !terminalTurns.has(event.turnId) && event.nativeSessionId === attempt?.nativeSessionId && !resolvedApprovals.has(String(event.payload.approvalId || "")) && typeof event.payload.expiresAt === "number" && event.payload.expiresAt > now);
  const finalizedTurns = new Set(events.filter((event) => event.type === "message.final").map((event) => event.turnId));
  const forwardedTurns = new Set(events.filter((event) => event.type === "prompt.forwarded").map((event) => event.turnId));
  const latestDelta = new Map<string | null, string>();
  for (const event of events) if (event.type === "message.delta") latestDelta.set(event.turnId, event.id);
  const feed = events.filter((event) => {
    if (event.type === "prompt.accepted" && forwardedTurns.has(event.turnId)) return false;
    return event.type === "prompt.forwarded" || event.type === "message.final" || (event.type === "message.delta" && !finalizedTurns.has(event.turnId) && latestDelta.get(event.turnId) === event.id) || Boolean(activityText(event));
  });
  const stateLabel = attempt?.status === "done" ? "Complete" : isFinishing ? "Evaluating" : !online ? "Connector offline" : attempt?.status === "waiting_approval" ? "Approval needed" : attempt?.status === "running" ? "Agent working" : agentBusy ? "Prompt queued" : !ready ? "Agent unavailable" : "Waiting for your prompt";
  const lockReason = closed ? isFinishing ? "Final evaluation in progress." : "This attempt is closed." : !online ? "Start your connector to continue." : agentBusy ? "Wait for the current agent turn or stop it." : !ready ? activeAdapter?.message || "Your agent has not reported ready. Check its local setup." : budgetExhausted ? "Prompt budget used. You can still run checks and finish." : "";

  async function send() {
    if (!idle || !ready || budgetExhausted || !input.trim() || input.length > 6000) return;
    const sent = input;
    const data = await post("send", { text: sent });
    if (data?.ok) {
      setInput((current) => current === sent ? "" : current);
      setAttempt((current) => current ? { ...current, turnsReserved: Math.max(1, current.turnsReserved) } : current);
      followChatRef.current = true;
    }
  }

  async function applyProvider() {
    const data = await post("provider", { adapter: chosenAdapter, ...(chosenModel ? { model: chosenModel } : {}) });
    if (data?.ok || data?.attempt) setSelection(null);
  }

  async function finish() {
    const data = await post("finish");
    if (data?.ok && data.freezing) { setAttempt((current) => current ? { ...current, status: "finishing" } : current); setFinishRetry((value) => value + 1); }
  }

  async function releaseStage() {
    const data = await post("stage");
    if (data?.ok) {
      if (typeof data.stage === "number") setAttempt((current) => current ? { ...current, stage: data.stage } : current);
      setViewedStage(null);
    }
  }

  if (!attempt && !loadError) return <AttemptPreparation />;

  if (!attempt) return <div className="mx-auto max-w-7xl px-4 py-12 font-ui"><Link href="/native" className="inline-flex items-center gap-2 text-xs text-[#a5a997] hover:text-[#e8b33d]"><ArrowLeft size={14} /> All attempts</Link><div className="mt-8 rounded-xl border border-[#30322c] bg-[#141613] p-8 text-sm">{loadError ? <><p role="alert" className="text-red-300">{loadError}</p><button className={`${button} mt-4`} onClick={() => void load()}><RefreshCw size={14} /> Retry loading</button></> : <p role="status" className="flex items-center gap-2 text-[#a5a997]"><LoaderCircle size={16} className="animate-spin" /> Loading your workspace…</p>}</div></div>;

  return (
    <div className="attempt-enter mx-auto max-w-[1800px] px-4 py-6 font-ui sm:px-6 lg:px-8">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#929887]">
          <Link href="/native" className="inline-flex items-center gap-1.5 transition hover:text-[#e8b33d]"><ArrowLeft size={14} /> All attempts</Link>
          <div className="flex flex-wrap items-center gap-3"><span className="font-code" title={attempt.id}>Attempt {attempt.id.slice(-8)}</span><span className="rounded-full border border-[#e8b33d]/30 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#d8b365]">Experimental</span></div>
        </div>
        <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d6b461]">Solve with your agent</p><h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-[#eeeee6] sm:text-3xl">{scenario?.title || "Challenge workspace"}</h1><p className="mt-2 text-xs text-[#9ea48f]">{scenario?.difficulty && <span className="capitalize">{scenario.difficulty} · </span>}{attempt.language} · {scenario ? `${scenario.minutes} min target · ` : ""}{scenario?.tags.join(" / ")}</p></div>
          <div className="rounded-xl border border-[#30362b] bg-[#151911] px-4 py-3"><p role="status" className="flex items-center gap-2 text-xs font-medium text-[#d7ddcb]">{agentBusy || isFinishing ? <LoaderCircle size={14} className="animate-spin text-[#e8b33d]" /> : attempt.status === "done" ? <CheckCheck size={14} className="text-emerald-300" /> : <Circle size={10} className="fill-[#e8b33d] text-[#e8b33d]" />}{stateLabel}</p><p className="mt-1 text-[11px] text-[#929b83]">Stage {attempt.stage} of {totalStages} · {budgetUsed}{scenario ? `/${scenario.promptPar}` : ""} prompts{attempt.turnsReserved > 0 ? ` · ${attempt.turnsReserved} queued` : ""}</p></div>
        </div>
        <div className="mt-5 rounded-xl border border-[#e8b33d]/30 bg-[#e8b33d]/[0.05] p-4 text-xs leading-6 text-[#d5c9a8]">
          <p className="font-semibold text-[#efcf88]">Read first — you never hand-write code here.</p>
          <p className="mt-1">Your agent writes <span className="font-code">solution.*</span> on its own computer. The file panel is a read-only, revisioned view: every agent turn flushes the latest revision here. To change the code, prompt the agent in chat — never retype it yourself.</p>
        </div>
        <ol aria-label="What to do" className="mt-3 grid gap-2 rounded-xl border border-[#292e23] bg-[#11150e] p-3 text-[11px] leading-5 text-[#a5ad98] sm:grid-cols-3 sm:gap-4">
          <li><span className="mr-2 font-semibold text-[#e8b33d]">1.</span>Read the brief and examples on the left.</li>
          <li><span className="mr-2 font-semibold text-[#e8b33d]">2.</span>Prompt your agent in the prompt box below. It writes the solution file.</li>
          <li><span className="mr-2 font-semibold text-[#e8b33d]">3.</span>Run visible checks, unlock new stages, then finish for grading.</li>
        </ol>
      </header>

      {(notice || loadError) && <div role="alert" className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-red-400/25 bg-red-400/5 px-4 py-3 text-xs leading-6 text-red-200"><p className="flex min-w-0 items-start gap-2"><CircleAlert size={15} className="mt-1 shrink-0" /><span className="break-words">{loadError || notice}</span></p>{loadError && <button className={button} onClick={() => void load()}><RefreshCw size={13} /> Reconnect</button>}</div>}

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:grid-cols-[minmax(280px,0.85fr)_minmax(340px,1.1fr)_minmax(320px,1fr)]">
        <section aria-labelledby="problem-heading" className="min-w-0 overflow-hidden rounded-xl border border-[#2c3026] bg-[#141711] lg:row-span-2 xl:row-span-1">
          <div className="flex items-center justify-between border-b border-[#2c3026] px-5 py-4"><h2 id="problem-heading" className="flex items-center gap-2 text-sm font-semibold"><Layers size={16} className="text-[#e8b33d]" /> The problem</h2>{scenario?.fnName && <code className="text-[10px] text-[#9aa28c]">{scenario.fnName}()</code>}</div>
          <div className="p-5">
            <div aria-label="Released stages" className="flex gap-1.5">{Array.from({ length: totalStages }, (_, index) => { const stage = index + 1; const released = releasedStages.some((item) => item.stage === stage); return <button key={stage} disabled={!released} onClick={() => setViewedStage(stage)} aria-pressed={selectedStage?.stage === stage} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] transition disabled:cursor-not-allowed ${selectedStage?.stage === stage ? "border-[#e8b33d]/50 bg-[#e8b33d]/10 text-[#edc770]" : "border-[#30342a] text-[#8e9781] hover:bg-white/5"}`}>{released ? stage < attempt.stage ? <Check size={12} /> : <Circle size={8} className="fill-current" /> : <LockKeyhole size={11} />} Stage {stage}</button>; })}</div>
            <div className="mt-4 rounded-lg border border-[#2d3226] bg-[#0d100b] p-3">
              <h4 className="text-[10px] font-semibold uppercase tracking-widest text-[#9fa88f]">What each stage means</h4>
              <ol className="mt-2 space-y-2 text-[11px] leading-5 text-[#a5ad98]">
                {Array.from({ length: totalStages }, (_, index) => {
                  const number = index + 1;
                  const released = releasedStages.find((item) => item.stage === number);
                  const state = number < attempt.stage ? "Passed" : number === attempt.stage ? "Current" : "Locked";
                  return <li key={number}><span className={released ? "font-semibold text-[#d8dccf]" : "font-semibold text-[#8e9781]"}>Stage {number} · {released ? released.title : state}</span><br /><span>{STAGE_LEVEL_MEANINGS[index]}</span>{!released && <span className="text-[#7d8971]"> Unlocks after the current visible checks pass.</span>}</li>;
                })}
              </ol>
            </div>
            {selectedStage ? <div className="mt-5"><p className="text-[10px] font-semibold uppercase tracking-widest text-[#d6b461]">{selectedStage.stage === attempt.stage ? attempt.stage > 1 ? "New requirements · current stage" : "Current stage" : "Previous requirements"}</p><h3 className="mt-2 text-lg font-semibold text-[#e8eadf]">{selectedStage.title}</h3><div className="mt-3"><SessionMarkdown text={selectedStage.brief} /></div>{selectedStage.stage > 1 && <p className="mt-3 rounded-lg border border-[#e8b33d]/20 bg-[#e8b33d]/5 p-3 text-xs leading-6 text-[#d5c59e]">{closed ? "These requirements were part of this attempt. Its solution and evaluation are preserved below." : "Ask your agent to adapt the existing solution to these requirements, then run the visible checks again."}</p>}
              <div className="mt-6 border-t border-[#30342a] pt-4"><h4 className="text-[10px] font-semibold uppercase tracking-widest text-[#9fa88f]">Visible examples</h4><div className="mt-3 space-y-3">{selectedStage.visibleTests.map((test, index) => <div key={index} className="overflow-hidden rounded-lg border border-[#2d3226] bg-[#0d100b]"><p className="border-b border-[#252a20] px-3 py-2 text-[10px] text-[#8f9980]">Example {index + 1}</p><div className="space-y-3 p-3">{[["Input", test.input], ["Expected", test.expected]].map(([label, value]) => <div key={label}><p className="mb-1 text-[10px] text-[#8f9980]">{label}</p><pre className="overflow-x-auto whitespace-pre font-code text-xs leading-6 text-[#d8ddce]">{value}</pre></div>)}</div></div>)}{!selectedStage.visibleTests.length && <p className="text-xs leading-6 text-[#929b83]">No visible examples were released for this stage.</p>}</div></div>
            </div> : <p className="mt-5 text-sm leading-7 text-[#a5ad98]">Requirements have not loaded yet. Refresh to retrieve the released problem brief.</p>}
            <div className="mt-5 border-t border-[#30342a] pt-4">
              {attempt.stage < totalStages ? <><p className="mb-3 text-xs leading-6 text-[#929b83]">Pass the current stage’s visible checks on the latest file to unlock the next requirements.</p><button onClick={() => void releaseStage()} disabled={!idle || !ready || !checksPassed} className={`${button} w-full border-[#e8b33d]/35 text-[#e3bd66]`}><Layers size={14} />{pending === "stage" ? "Releasing requirements…" : `Unlock stage ${attempt.stage + 1}`}<ArrowRight size={13} /></button></> : <p className="flex items-start gap-2 text-xs leading-6 text-[#adb79b]"><CheckCheck size={15} className="mt-1 shrink-0 text-[#e8b33d]" />{attempt.status === "done" ? "All stages released and final evaluation complete." : "All stages released. Run checks on your final solution, then finish for full acceptance."}</p>}
            </div>
          </div>
        </section>

        <section aria-labelledby="chat-heading" className="min-w-0 overflow-hidden rounded-xl border border-[#323729] bg-[#141711]">
          <div className="flex items-center justify-between border-b border-[#2c3026] px-5 py-4"><h2 id="chat-heading" className="flex items-center gap-2 text-sm font-semibold"><Bot size={17} className="text-[#e8b33d]" /> Agent workspace</h2><span className="text-[10px] text-[#9ca58c]">Agent: {attempt.adapter || "none selected"}{attempt.model ? ` · ${attempt.model}` : " · runtime default"}</span></div>
          <div className="border-b border-[#2c3026] bg-[#11150e] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]"><span className={`flex items-center gap-1.5 ${online ? "text-[#acb79c]" : "text-[#d8b568]"}`}>{online ? <Wifi size={13} /> : <WifiOff size={13} />}{device?.label || "No device information"} · {online ? "connector online" : "connector offline"}</span>{device?.lastSeenAt && <span className="text-[10px] text-[#848d78]">Last contact {new Date(device.lastSeenAt).toLocaleTimeString()}</span>}</div>
            <details className="mt-3 group"><summary className="flex cursor-pointer list-none items-center justify-between text-[11px] text-[#b8c0aa]">Agent & model settings<ChevronDown size={13} className="transition group-open:rotate-180" /></summary><div className="mt-3 grid grid-cols-2 gap-3"><label className="min-w-0 text-[10px] text-[#96a083]">Provider<select aria-label="Provider" className={select} disabled={!idle} value={chosenAdapter} onChange={(event) => setSelection({ adapter: event.target.value, model: "" })}>{!device?.adapters.length && <option value={chosenAdapter}>{chosenAdapter || "No providers reported"}</option>}{device?.adapters.map((adapter) => <option key={adapter.adapter} value={adapter.adapter}>{adapter.adapter} · {adapter.status || "readiness unknown"}</option>)}</select></label><label className="min-w-0 text-[10px] text-[#96a083]">Model<select aria-label="Model" className={select} disabled={!idle || selectedAdapter?.status !== "ready"} value={chosenModel} onChange={(event) => setSelection({ adapter: chosenAdapter, model: event.target.value })}><option value="">Runtime default</option>{chosenModel && !modelOptions.some((model) => model.id === chosenModel) && <option value={chosenModel} disabled>{chosenModel} (not currently advertised)</option>}{modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label || model.id}</option>)}</select></label></div><p className="mt-2 text-[10px] leading-5 text-[#8f9980]">{selectedAdapter?.message || "Readiness has not been reported. Update and run your connector."} Settings can change while the agent is idle. Changing providers starts fresh agent context.</p>{!closed && <button className={`${button} mt-2`} disabled={!idle || selectedAdapter?.status !== "ready" || Boolean(chosenModel && !modelOptions.some((model) => model.id === chosenModel))} onClick={() => void applyProvider()}>{pending === "provider" ? "Connecting…" : selectionChanged ? "Apply selection" : "Reconnect agent session"}</button>}</details>
            {!online && !closed && <p className="mt-2 text-[11px] leading-5 text-[#d0b575]">Run <code className="font-code">codelit-connect run</code> on your paired computer. This page reconnects automatically. <Link href="/agents" className="underline underline-offset-2">Connection setup</Link></p>}
          </div>
          <div ref={chatRef} onScroll={() => { const element = chatRef.current; if (element) followChatRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90; }} aria-label="Agent conversation and activity" role="log" aria-live="polite" aria-relevant="additions" className="h-[430px] space-y-4 overflow-y-auto overscroll-contain px-4 py-5 sm:h-[520px] xl:h-[550px]">
            {!feed.length && <div className="flex h-full flex-col items-center justify-center px-5 text-center"><div className="mb-4 rounded-xl border border-[#e8b33d]/20 bg-[#e8b33d]/5 p-3"><Bot size={24} className="text-[#d7b663]" /></div><h3 className="text-sm font-medium text-[#dce1d1]">You guide. Your agent builds.</h3><p className="mt-2 max-w-xs text-xs leading-6 text-[#969f87]">Read the brief, then ask your agent to implement the current stage. Its solution file will appear alongside the conversation.</p></div>}
            {feed.map((event) => {
              const isUser = event.type === "prompt.forwarded" || (event.type === "prompt.accepted" && Boolean(stringPayload(event, "text")));
              const isMessage = isUser || event.type === "message.final" || event.type === "message.delta";
              const failed = ["turn.failed", "prompt.rejected", "tool.failed", "tool.denied", "connection.gap"].includes(event.type);
              const messageText = stringPayload(event, "text");
              const fullSolution = !isUser && isMessage && containsFullSolution(messageText);
              return isMessage ? <article key={event.id} className={`min-w-0 rounded-xl border p-3.5 ${isUser ? "ml-5 border-[#e8b33d]/20 bg-[#e8b33d]/5" : "mr-2 border-[#30362a] bg-[#0e120c]"}`}><div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px]"><span className={isUser ? "font-semibold text-[#e3bf72]" : "font-semibold text-[#b8c7a5]"}>{isUser ? "You" : event.adapter || "Agent"}{!isUser && event.model ? ` · ${event.model}` : ""}</span><span className="text-[#7d8971]">{new Date(event.serverTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>{fullSolution && <p className="mb-2 rounded-md border border-[#e8b33d]/25 bg-[#e8b33d]/5 px-2.5 py-1.5 text-[11px] leading-5 text-[#d5c59e]">This reply pastes a full solution. The graded code is the file panel ({filePath}) — don’t copy-paste from chat; ask the agent to update the file instead.</p>}<SessionMarkdown text={messageText} />{event.type === "message.delta" && <p className="mt-2 text-[10px] text-[#a1ac92]">Reply in progress · partial text</p>}{event.type === "prompt.accepted" && <p className="mt-2 text-[10px] text-[#a1ac92]">Queued for your agent</p>}</article> : event.type.startsWith("tool.") ? <ToolActivity key={event.id} event={event} /> : <div key={event.id} className={`flex items-start gap-2 text-[11px] leading-6 ${failed ? "rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-red-200" : "text-[#8f9a81]"}`}>{failed ? <CircleAlert size={13} className="mt-1.5 shrink-0" /> : event.type === "official.test" ? <FlaskConical size={13} className="mt-1.5 shrink-0 text-[#c8b77e]" /> : <Terminal size={12} className="mt-1.5 shrink-0" />}<div className="min-w-0 flex-1"><p className="whitespace-pre-wrap break-words">{activityText(event)}</p>{event.type === "local.command" && <p className="text-[10px] text-[#75826b]">Reported by your connector · not final acceptance</p>}{event.type === "official.test" && <CheckResults event={event} />}</div></div>;
            })}
          </div>
          {approvals.length > 0 && <div className="space-y-3 border-t border-[#e8b33d]/25 bg-[#e8b33d]/5 p-4">{approvals.map((approval) => <div key={approval.id}><p className="flex items-center gap-2 text-xs font-semibold text-[#e9c473]"><ShieldAlert size={15} /> Your approval is needed</p><pre className="my-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-code text-xs leading-6 text-[#c4c9b8]">{String(approval.payload.command || approval.payload.path || approval.payload.detail || approval.payload.kind || "Tool permission")}</pre><p className="mb-2 text-[10px] text-[#a99d7f]">Expires {new Date(approval.payload.expiresAt as number).toLocaleTimeString()}</p><div className="flex gap-2"><button disabled={!canOperate} onClick={() => void post("approval", { approvalId: String(approval.payload.approvalId || ""), decision: "allow-once" })} className={`${button} border-[#e8b33d]/40 text-[#e9c473]`}>Allow once</button><button disabled={!canOperate} onClick={() => void post("approval", { approvalId: String(approval.payload.approvalId || ""), decision: "deny" })} className={button}>Deny</button></div></div>)}</div>}
          <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="border-t border-[#30362a] p-4"><label htmlFor="agent-prompt" className="mb-1 block text-xs font-semibold text-[#d7ddcb]">Prompt box — give your agent an instruction</label><p className="mb-2 text-[11px] leading-5 text-[#8f9980]">Your agent reads this together with the current stage brief and edits the solution file for you.</p><textarea id="agent-prompt" value={input} onChange={(event) => setInput(event.target.value)} disabled={!idle || !ready || budgetExhausted} rows={3} maxLength={6000} placeholder={attempt.stage > 1 ? "Adapt the solution to the new stage requirements and explain your changes…" : "Implement the current requirements in the solution file. Explain your approach and run the visible checks…"} className="w-full resize-y rounded-lg border border-[#3d4532] bg-[#0c1009] px-3 py-2.5 text-sm leading-6 text-[#e1e6d6] placeholder:text-[#626e56] focus:border-[#e8b33d] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50" /><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] text-[#828e73]">{input.length}/6000 · The agent edits the file for you.</span><div className="flex gap-2"><button type="button" disabled={!canOperate || !agentBusy} onClick={() => void post("interrupt")} className={button}><Square size={12} /> Stop</button><button type="submit" disabled={!idle || !ready || budgetExhausted || !input.trim()} className="inline-flex items-center gap-2 rounded-lg bg-[#e8b33d] px-4 py-2 text-xs font-semibold text-[#17190e] transition hover:bg-[#f0c15d] disabled:cursor-not-allowed disabled:opacity-40"><Send size={13} />{pending === "send" ? "Sending…" : "Send prompt"}</button></div></div>{lockReason && <p role="status" className="mt-2 text-[11px] leading-5 text-[#b8ab87]">{lockReason}</p>}</form>
        </section>

        <section aria-labelledby="file-heading" className="min-w-0 overflow-hidden rounded-xl border border-[#2c3026] bg-[#12160f]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2c3026] px-4 py-4"><h2 id="file-heading" className="flex min-w-0 items-center gap-2 font-code text-xs text-[#d5dcc9]"><FileCode2 size={15} className="shrink-0 text-[#d5b76d]" /><span className="break-all">{filePath}</span></h2><span className="flex items-center gap-1 text-[10px] text-[#9aa68a]"><LockKeyhole size={10} /> Read-only</span></div>
          <div className="flex items-center justify-between gap-2 border-b border-[#252c1f] px-4 py-2.5 text-[10px] text-[#849373]"><span>{revision || frozen ? `Revision ${revisionNumber ?? "—"}` : "Starter template · awaiting agent file"}</span><span>{frozen || revision?.type === "file.snapshot" ? "Frozen snapshot" : agentBusy ? "Agent working" : "Agent-managed file"}</span></div>
          <div tabIndex={0} role="region" aria-label="Read-only agent solution file" className="max-h-[560px] min-h-[260px] overflow-auto bg-[#0b0e09] xl:min-h-[390px]">{code ? <pre className="flex min-w-fit py-4 font-code text-[12px] leading-6 [tab-size:4]"><span aria-hidden="true" className="sticky left-0 select-none border-r border-[#242c1c] bg-[#0b0e09] px-3 text-right text-[#48553c]">{code.split("\n").map((_, index) => <span key={index} className="block">{index + 1}</span>)}</span><code className="block px-4 text-[#c8d6b8]">{code}</code></pre> : <div className="p-6 text-center"><Code2 size={24} className="mx-auto mb-3 text-[#657451]" /><p className="text-xs leading-6 text-[#8f9e7f]">Your agent’s solution appears here after it writes the file. Prompt it in chat to begin.</p></div>}</div>
          <div className="space-y-4 border-t border-[#2c3026] p-4"><p className="text-[11px] leading-6 text-[#929f83]">{closed ? "This is the saved solution for this attempt." : "To change this file, ask your agent in chat. Run checks on the latest revision before advancing."}</p><button disabled={!idle || !ready || !revision} onClick={() => void post("test")} className={`${button} w-full`}><FlaskConical size={15} />{pending === "test" ? "Running visible checks…" : "Run visible checks"}</button>{visibleCheck && <div className={`rounded-lg border p-3 text-xs leading-6 ${checksCurrent ? checksPassed ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-200" : "border-red-400/20 bg-red-400/5 text-red-200" : "border-[#343b2b] text-[#99a78a]"}`}><p>{checksCurrent ? `Stage ${String(visibleCheck.payload.stage)} · ${String(visibleCheck.payload.passedCount)}/${String(visibleCheck.payload.totalCount)} visible checks passed` : "Previous check results · run again for the current file and stage"}</p><CheckResults event={visibleCheck} /></div>}
            <div className="border-t border-[#2c3026] pt-4"><p className="mb-3 text-[11px] leading-6 text-[#929f83]">Final evaluation freezes your solution and runs the full acceptance suite, including hidden tests.</p><button disabled={!idle || !ready || !revision || attempt.stage < totalStages} onClick={() => void finish()} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#e8b33d] px-4 py-2.5 text-xs font-semibold text-[#17190e] transition hover:bg-[#f0c15d] disabled:cursor-not-allowed disabled:opacity-40"><CheckCheck size={15} />{pending === "finish" ? "Freezing solution…" : "Finish & evaluate"}</button>{attempt.stage < totalStages && <p className="mt-2 text-center text-[10px] text-[#89977a]">Unlock all {totalStages} stages before finishing.</p>}</div>
            {isFinishing && <div role="status" className="rounded-lg border border-[#e8b33d]/25 bg-[#e8b33d]/5 p-3 text-xs leading-6 text-[#d4be8e]"><p className="flex items-start gap-2"><LoaderCircle size={14} className={`mt-1 shrink-0 ${finishState === "waiting" ? "animate-spin" : ""}`} />{finishState === "retry" ? "Evaluation needs attention. Your attempt is preserved." : "Waiting for the frozen solution, then evaluating. You can reload this page safely."}</p><div className="mt-3 flex flex-wrap gap-2">{finishState === "retry" && <button className={button} disabled={busy} onClick={() => { setNotice(""); setFinishRetry((value) => value + 1); }}><RefreshCw size={12} /> Retry evaluation</button>}<button className={button} disabled={busy} onClick={async () => { const data = await post("reopen"); if (data?.ok) setAttempt((current) => current ? { ...current, status: "open" } : current); }}>Return to solving</button></div></div>}
            {attempt.acceptance && <div role="status" className={`rounded-xl border p-4 ${attempt.acceptance.passed ? "border-emerald-400/30 bg-emerald-400/7 text-emerald-200" : "border-red-400/25 bg-red-400/5 text-red-200"}`}><p className="flex items-center gap-2 text-sm font-semibold">{attempt.acceptance.passed ? <CheckCheck size={17} /> : <CircleAlert size={17} />}{attempt.acceptance.passed ? "Challenge accepted" : "Evaluation complete"}</p><p className="mt-2 text-xs">{attempt.acceptance.passedCount}/{attempt.acceptance.totalCount} full acceptance checks passed.</p>{attempt.submissionHash && <p className="mt-2 break-all font-code text-[10px] opacity-65" title={attempt.submissionHash}>Snapshot {attempt.submissionHash.slice(0, 16)}</p>}<Link href="/native" className="mt-4 inline-flex items-center gap-1 text-xs underline underline-offset-4">Back to attempts <ArrowRight size={12} /></Link></div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function stringPayloadOptional(event: NativeEvent | undefined, key: string) {
  return event ? stringPayload(event, key) : "";
}
