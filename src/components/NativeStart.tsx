"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ArrowRight, Bot, Check, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import NativeConnect, { adapterIsReady, adapterLabel, deviceIsOnline, useNativeDevices } from "@/components/NativeConnect";
import AttemptPreparation from "@/components/AttemptPreparation";
import SessionMarkdown from "@/components/SessionMarkdown";
import type { NativeAdapterId } from "@/lib/native/protocol";

type Scenario = { id: string; title: string };
type Language = "python" | "javascript" | "c++";
type ScenarioPreview = {
  id: string;
  blurb: string;
  difficulty: string;
  minutes: number;
  promptPar: number;
  stageTitle: string;
  brief: string;
  visibleTests: { input: string; expected: string }[];
  stubs: Record<Language, string>;
};
const languageLabels: Record<Language, string> = { python: "Python", javascript: "JavaScript", "c++": "C++" };
interface Attempt {
  id: string;
  shortId?: string;
  title?: string;
  scenarioId: string;
  mode?: string;
  scenarioTitle?: string;
  status: string;
  createdAt: number;
  updatedAt?: number;
  archivedAt?: number | null;
  stage?: number;
  turnsUsed?: number;
  turnsReserved?: number;
  progress?: { stage: number; totalStages: number; turnsUsed: number; turnsReserved: number; promptLimit: number; hasSolution: boolean; lastActivityAt: number };
  latestCheck?: { passed: number; total: number; stage: number } | null;
  acceptance?: { passed: boolean; passedCount: number; totalCount: number; at: number } | null;
}

// Stage overviews stay generic here: the start page only previews stage one,
// so future briefs must not leak before their attempt unlocks them.
const STAGE_LEVEL_MEANINGS = [
  "Core sample — implement the base behavior against one visible example.",
  "Edges and extensions — adapt the same solution; every visible example is shown.",
  "Hidden acceptance — final coverage; finishing runs the full suite including hidden tests.",
];

// No delete op exists in /api/native/session (verified read-only), and the
// session API is out of scope for this change, so deleted attempts are hidden
// per-browser. Archiving stays the server-side way to shelve an attempt.
const DELETED_ATTEMPTS_KEY = "codelit.native.deletedAttemptIds.v1";

function loadDeletedAttemptIds(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DELETED_ATTEMPTS_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

const inputClass = "mt-1.5 w-full rounded-md border border-[#3a3c37] bg-black/30 px-3 py-2.5 text-sm outline-none disabled:opacity-50";
const statusLabels: Record<string, string> = { open: "Ready to continue", running: "Agent working", waiting_approval: "Needs approval", finishing: "Grading", done: "Completed" };

export default function NativeStart({ scenarios, initialScenarioId, initialMode, preview }: { scenarios: Scenario[]; initialScenarioId?: string; initialMode?: "practice" | "ranked"; preview?: ScenarioPreview }) {
  const mode = initialMode === "ranked" ? "ranked" : "practice";
  const router = useRouter();
  const [changingScenario, changeScenario] = useTransition();
  const [openingAttempt, openAttempt] = useTransition();
  const { devices, loading, error: deviceError, now, refresh } = useNativeDevices();
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"active" | "archived">("active");
  const [language, setLanguage] = useState<Language>("python");
  const [deviceId, setDeviceId] = useState("");
  const [adapter, setAdapter] = useState<NativeAdapterId>("codex");
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const startingRef = useRef(false);
  const [createdAttemptId, setCreatedAttemptId] = useState("");
  const [mutatingId, setMutatingId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  // Lazy initializer (not an effect): localStorage is read once per mount.
  // The try/catch inside also covers server rendering, where localStorage
  // is undefined and the list simply starts empty until hydration.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(loadDeletedAttemptIds);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/native/devices?attempts=1", { cache: "no-store" });
      const data = await res.json();
      if (res.status === 401) {
        setAttempts([]);
        setHistoryError("");
      } else if (!res.ok || !Array.isArray(data.attempts)) {
        throw new Error(data.error || "Could not load your attempts.");
      } else {
        setAttempts(data.attempts);
        setHistoryError("");
      }
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Could not load your attempts.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void loadHistory(), 0);
    const interval = setInterval(() => void loadHistory(), 15_000);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, [loadHistory]);

  const scenarioId = scenarios.some((scenario) => scenario.id === initialScenarioId) ? initialScenarioId! : "";
  const scenario = scenarios.find((item) => item.id === scenarioId);
  const liveDevices = devices.filter((device) => device.revokedAt === null);
  const readyDevices = liveDevices.filter((device) => deviceIsOnline(device, now) && device.adapters.some(adapterIsReady));
  const device = readyDevices.find((item) => item.deviceId === deviceId) || readyDevices[0];
  const availableAdapters = device?.adapters.filter(adapterIsReady) || [];
  const provider = availableAdapters.find((item) => item.adapter === adapter) || availableAdapters[0];
  const models = provider?.models || [];
  const selectedModel = models.some((item) => item.id === model) ? model : "";
  const returnHref = scenarioId ? `/native?scenario=${encodeURIComponent(scenarioId)}&mode=${mode}` : "/native";
  const practiceSolved = new Set(attempts.filter((a) => a.acceptance?.passed === true && (a.mode || "practice") !== "ranked").map((a) => a.scenarioId)).size;
  const rankedGate = mode === "ranked" && practiceSolved < 5;
  const connectHref = `/agents?next=${encodeURIComponent(returnHref)}`;
  const unavailableDevices = liveDevices.filter((item) => !readyDevices.some((readyDevice) => readyDevice.deviceId === item.deviceId));
  const liveAttempts = attempts.filter((attempt) => !deletedIds.has(attempt.id));
  const visibleAttempts = liveAttempts.filter((attempt) => historyFilter === "archived" ? !!attempt.archivedAt : !attempt.archivedAt);
  const deletedCount = attempts.length - liveAttempts.length;

  function deleteAttempt(attemptId: string, title: string) {
    if (!window.confirm(`Hide "${title}" from this browser's attempt list? The attempt stays on the server — use Archive to shelve it there.`)) return;
    setDeletedIds((previous) => {
      const next = new Set(previous);
      next.add(attemptId);
      try {
        localStorage.setItem(DELETED_ATTEMPTS_KEY, JSON.stringify([...next]));
      } catch {
        // Storage full or blocked: the hide still applies for this session.
      }
      return next;
    });
  }

  function restoreHiddenAttempts() {
    setDeletedIds(new Set());
    try {
      localStorage.removeItem(DELETED_ATTEMPTS_KEY);
    } catch {
      // Nothing to restore from storage; the in-memory list is already clear.
    }
  }

  const sample = preview?.id === scenarioId ? preview : undefined;
  const resumable = liveAttempts.filter((attempt) => attempt.scenarioId === scenarioId && (attempt.mode || "practice") === mode && !attempt.archivedAt && attempt.status !== "done");
  const preparing = busy || openingAttempt;
  const locked = preparing || !!createdAttemptId;

  function selectScenario(id: string) {
    if (!scenarios.some((item) => item.id === id)) return;
    setError("");
    changeScenario(() => router.replace(`/native?scenario=${encodeURIComponent(id)}`, { scroll: false }));
  }

  async function startAttempt() {
    if (startingRef.current || createdAttemptId) return;
    if (!scenarioId || !device || !provider || !deviceIsOnline(device, now) || !adapterIsReady(provider)) {
      setError("Connect an online computer with a ready provider first.");
      void refresh();
      return;
    }
    if (model && !models.some((item) => item.id === model)) {
      setError("That model is no longer advertised by your agent. Choose an available model.");
      return;
    }
    startingRef.current = true;
    setBusy(true);
    setError("");
    let createdId = "";
    try {
      const res = await fetch("/api/native/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "start", scenarioId, language, deviceId: device.deviceId, adapter: provider.adapter, model: selectedModel || null, mode }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.attempt?.id !== "string") throw new Error(data.error || "Could not start this attempt.");
      createdId = data.attempt.id;
      setCreatedAttemptId(createdId);
      openAttempt(() => router.push(`/native/${encodeURIComponent(createdId)}`));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not start your attempt.";
      setError(createdId ? `Your attempt was created, but the workspace could not open. ${message} Use the link below to open it.` : message);
      void refresh();
      void loadHistory();
    } finally {
      startingRef.current = false;
      setBusy(false);
    }
  }

  async function updateAttempt(attemptId: string, op: "rename" | "archive" | "restore") {
    const title = draftTitle.trim();
    if (op === "rename" && (!title || title.length > 80)) {
      setHistoryError("Use a title between 1 and 80 characters.");
      return;
    }
    setMutatingId(attemptId);
    setHistoryError("");
    try {
      const res = await fetch("/api/native/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, attemptId, ...(op === "rename" ? { title } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Could not ${op} this attempt.`);
      setEditingId("");
      await loadHistory();
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : `Could not ${op} this attempt.`);
    } finally {
      setMutatingId("");
    }
  }

  const history = (
        <section className="min-w-0 font-ui" aria-label="Attempt history">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Your attempts</h2><button type="button" onClick={() => void loadHistory()} disabled={historyLoading} className="flex items-center gap-1.5 rounded text-xs text-[#b3afa3] hover:text-white disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />Refresh</button></div>
          <div className="mt-4 flex gap-1 rounded-lg border border-[#30322c] bg-[#141613] p-1">{(["active", "archived"] as const).map((filter) => <button key={filter} type="button" aria-pressed={historyFilter === filter} onClick={() => setHistoryFilter(filter)} className={`flex-1 rounded-md px-3 py-2 text-xs ${historyFilter === filter ? "bg-[#30322c] text-white" : "text-[#b3afa3] hover:text-white"}`}>{filter === "active" ? "Active" : "Archived"} <span className="ml-1 opacity-70">{liveAttempts.filter((attempt) => filter === "archived" ? !!attempt.archivedAt : !attempt.archivedAt).length}</span></button>)}</div>
          {historyLoading ? <p role="status" className="mt-5 text-sm text-[#b3afa3]">Loading your attempts…</p> : visibleAttempts.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-[#3a3c37] px-5 py-8 text-sm leading-6 text-[#b3afa3]">{historyFilter === "archived" ? "No archived attempts. Archiving hides an idle attempt from the active list and keeps its trace." : "Your next challenge starts here. New attempts will appear with their own title, ID, and progress."}</div> : <ul className="mt-4 max-h-[640px] space-y-3 overflow-y-auto pr-1">{visibleAttempts.map((attempt) => {
            const scenarioName = attempt.scenarioTitle || scenarios.find((item) => item.id === attempt.scenarioId)?.title || attempt.scenarioId;
            const title = attempt.title || scenarioName;
            const progress = attempt.progress;
            const stage = progress?.stage || attempt.stage || 1;
            const totalStages = progress?.totalStages || 3;
            const isWorking = ["running", "waiting_approval", "finishing"].includes(attempt.status) || (progress?.turnsReserved ?? attempt.turnsReserved ?? 0) > 0;
            const isArchived = !!attempt.archivedAt;
            return <li key={attempt.id} className="rounded-xl border border-[#30322c] bg-[#141613] p-4">
              {editingId === attempt.id ? <form onSubmit={(event) => { event.preventDefault(); void updateAttempt(attempt.id, "rename"); }} className="flex items-center gap-2"><input autoFocus aria-label="Attempt title" value={draftTitle} maxLength={80} onChange={(event) => setDraftTitle(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[#3a3c37] bg-black/30 px-2 py-1.5 text-sm" /><button type="submit" disabled={!!mutatingId || !draftTitle.trim()} aria-label="Save attempt title" className="rounded p-1 text-emerald-300 disabled:opacity-50"><Check className="h-4 w-4" /></button><button type="button" aria-label="Cancel rename" onClick={() => setEditingId("")} className="rounded p-1 text-[#b3afa3]"><X className="h-4 w-4" /></button></form> : <Link href={`/native/${encodeURIComponent(attempt.id)}`} className="block break-words text-sm font-semibold leading-6 text-[#ece9e2] hover:text-[#e8b33d]">{title}</Link>}
              {title !== scenarioName && <p className="mt-1 text-xs text-[#9a968c]">Scenario: {scenarioName}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#9a968c]"><span title={attempt.id} className="font-code text-[#e8b33d]">#{attempt.shortId || attempt.id.slice(-8)}</span><span>· {(attempt.mode || "practice") === "ranked" ? "Ranked" : "Practice"}</span><span>· {statusLabels[attempt.status] || attempt.status}</span><time dateTime={new Date(attempt.createdAt).toISOString()} className="ml-auto">{new Date(attempt.createdAt).toLocaleDateString()}</time></div>
              <div className="mt-3 flex justify-between gap-2 text-xs text-[#b3afa3]"><span>Stage {stage}/{totalStages}</span><span>{progress ? `${progress.turnsUsed}/${progress.promptLimit} prompts${progress.turnsReserved ? ` · ${progress.turnsReserved} queued` : ""}` : `${attempt.turnsUsed ?? 0} prompts`}</span></div>
              <div role="progressbar" aria-label="Released challenge stages" aria-valuemin={0} aria-valuemax={totalStages} aria-valuenow={stage} className="mt-2 h-1 overflow-hidden rounded-full bg-[#30322c]"><div style={{ width: `${Math.min(100, stage / totalStages * 100)}%` }} className="h-full bg-[#e8b33d]/70" /></div>
              {attempt.latestCheck && <p className="mt-2 text-xs text-[#9a968c]">Last check · {attempt.latestCheck.passed}/{attempt.latestCheck.total} passed · stage {attempt.latestCheck.stage}</p>}
              {attempt.acceptance && <p className={`mt-2 text-xs ${attempt.acceptance.passed ? "text-emerald-300" : "text-[#e8b33d]"}`}>Acceptance · {attempt.acceptance.passedCount}/{attempt.acceptance.totalCount} passed{attempt.acceptance.passed ? "" : " · not passed"}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#30322c] pt-3 text-xs"><Link href={`/native/${encodeURIComponent(attempt.id)}`} className="mr-auto text-[#e8b33d] hover:underline">{attempt.status === "done" ? "View attempt" : "Resume"} →</Link><button type="button" onClick={() => { setEditingId(attempt.id); setDraftTitle(title); setHistoryError(""); }} disabled={!!mutatingId} aria-label={`Rename ${title}`} className="inline-flex items-center gap-1 rounded text-[#b3afa3] hover:text-white disabled:opacity-40"><Pencil className="h-3 w-3" />Rename</button><button type="button" onClick={() => void updateAttempt(attempt.id, isArchived ? "restore" : "archive")} disabled={!!mutatingId || (!isArchived && isWorking)} title={!isArchived && isWorking ? "Stop active work before archiving" : isArchived ? "Return to active attempts" : "Hide from active list; retain trace"} className="inline-flex items-center gap-1 rounded text-[#b3afa3] hover:text-white disabled:opacity-40">{isArchived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}{mutatingId === attempt.id ? "Saving…" : isArchived ? "Restore" : "Archive"}</button><button type="button" onClick={() => deleteAttempt(attempt.id, title)} disabled={!!mutatingId || (!isArchived && isWorking)} title={!isArchived && isWorking ? "Stop active work before hiding" : "Hide from this browser's list (kept on server)"} aria-label={`Delete ${title} from this browser`} className="inline-flex items-center gap-1 rounded text-[#b3afa3] hover:text-red-300 disabled:opacity-40"><Trash2 className="h-3 w-3" />Delete</button></div>
            </li>;
          })}</ul>}
          {historyError && <p role="alert" className="mt-4 text-sm text-[#e8b33d]">{historyError}</p>}
          <p className="mt-3 text-xs leading-5 text-[#9a968c]">History belongs to this browser session. Reconnecting a computer does not delete it. Archive retains the attempt and its trace. Delete hides it in this browser only.{deletedCount > 0 && <> <button type="button" onClick={restoreHiddenAttempts} className="text-[#e8b33d] underline underline-offset-4">Restore {deletedCount} hidden</button></>}</p>
        </section>
  );

  const settings = (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-xs text-[#b3afa3]">Solution language<select aria-label="Solution language" value={language} disabled={locked} onChange={(event) => setLanguage(event.target.value as Language)} className={inputClass}>{Object.entries(languageLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="block text-xs text-[#b3afa3]">Online computer<select aria-label="Online computer" value={device?.deviceId || ""} disabled={!readyDevices.length || locked} onChange={(event) => { setDeviceId(event.target.value); setModel(""); }} className={inputClass}>{readyDevices.length ? readyDevices.map((item) => <option key={item.deviceId} value={item.deviceId}>{item.label}</option>) : <option value="">{loading ? "Checking connection…" : "No ready computer"}</option>}</select></label>
      <label className="block text-xs text-[#b3afa3]">Provider<select aria-label="Provider" value={provider?.adapter || ""} disabled={!availableAdapters.length || locked} onChange={(event) => { setAdapter(event.target.value as NativeAdapterId); setModel(""); }} className={inputClass}>{availableAdapters.length ? availableAdapters.map((item) => <option key={item.adapter} value={item.adapter}>{adapterLabel(item.adapter)}</option>) : <option value="">Connect a provider</option>}</select></label>
      <label className="block text-xs font-semibold text-[#ece9e2] sm:col-span-2">Model — {provider ? adapterLabel(provider.adapter) : "pick a provider"}{models.length ? ` · ${models.length} available` : ""}<select aria-label="Model" value={selectedModel} disabled={!provider || locked} onChange={(event) => setModel(event.target.value)} className="mt-1 w-full cursor-pointer rounded-md border-2 border-[#e8b33d]/70 bg-[#171814] px-3 py-2.5 text-sm font-medium text-[#ece9e2] shadow-[0_0_0_3px_rgba(232,179,61,0.12)] outline-none transition focus:border-[#e8b33d] focus:shadow-[0_0_0_4px_rgba(232,179,61,0.2)] disabled:cursor-not-allowed disabled:opacity-50"><option value="">Use agent default{models.length ? ` (recommended)` : ""}</option>{models.map((item) => <option key={item.id} value={item.id}>{item.label || item.id}</option>)}</select><span className="mt-1 block text-[11px] font-normal text-[#9a968c]">{provider ? "Every model your connected agent reports is listed here." : "Connect a computer and pick a provider to see its models."}</span></label>
    </div>
  );

  const connection = !loading && !readyDevices.length ? <NativeConnect continueHref={returnHref} inline onConnected={refresh} /> : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8" aria-busy={preparing}>
      {preparing && <AttemptPreparation fullScreen title={scenario?.title} attemptHref={createdAttemptId ? `/native/${encodeURIComponent(createdAttemptId)}` : undefined} />}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#30322c] pb-5">
        <div>
          <div className="flex items-center gap-2 font-ui text-xs text-[#9a968c]"><Link href="/scenarios" className="hover:text-[#e8b33d]">Scenarios</Link><span>/</span><span>{scenario ? "Solving workspace" : "Agent workspace"}</span></div>
          <h1 className="mt-2 text-2xl tracking-tight sm:text-3xl">{scenario?.title || "Your attempts"}</h1>
          {scenario && <p className="mt-2 font-ui text-xs"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${mode === "ranked" ? "border-[#e8b33d]/50 text-[#e8b33d]" : "border-[#3a3c37] text-[#b3afa3]"}`}>{mode === "ranked" ? "Ranked — defended and scored" : "Practice — repeatable, unscored"}</span></p>}
        </div>
        <div className="flex items-center gap-4 font-ui text-xs">
          {scenario && <Link href="/native" className="text-[#b3afa3] hover:text-white">All attempts</Link>}
          <Link href={connectHref} className="rounded-md border border-[#3a3c37] px-3 py-2 text-[#c9c5ba] hover:text-white">Manage connection</Link>
        </div>
      </header>

      {scenario && sample ? <>
        <section aria-label="Read first" className="mt-5 rounded-xl border border-[#e8b33d]/30 bg-[#e8b33d]/[0.04] p-4 font-ui text-xs leading-6 text-[#d5c9a8]">
          <p className="font-semibold text-[#efcf88]">Read first — you never hand-write code here.</p>
          <p className="mt-1">Your agent writes <span className="font-code">solution.*</span> on its own computer. The workspace file panel is a read-only, revisioned view: every agent turn flushes the newest revision there. You direct, review, and test — the agent types.</p>
        </section>
        {rankedGate && <p role="status" className="mt-4 rounded-xl border border-[#e8b33d]/35 bg-[#e8b33d]/[0.04] p-4 font-ui text-xs leading-6 text-[#d5c59e]">Ranked unlocks after passing 5 practice scenarios — you have {practiceSolved}. Practice attempts are repeatable and unscored; the server enforces this gate when you start.</p>}
        {!rankedGate && mode === "ranked" && <p role="status" className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-4 font-ui text-xs leading-6 text-emerald-200">Ranked run. Finish, defend your solution under time, and bank the score on your passport.</p>}
        {historyLoading && <p role="status" className="mt-4 font-ui text-xs text-[#b3afa3]">Checking for attempts to resume…</p>}
        {resumable.length > 0 && <section aria-label="Resume this scenario" className="mt-5 rounded-xl border border-[#e8b33d]/35 bg-[#e8b33d]/[0.04] p-4 font-ui">
          <h2 className="text-sm font-semibold text-[#efcf88]">Continue where you left off</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">{resumable.map((attempt) => <li key={attempt.id}><Link href={`/native/${encodeURIComponent(attempt.id)}`} className="flex h-full items-center justify-between gap-3 rounded-lg border border-[#e8b33d]/20 bg-[#141613] p-3 hover:border-[#e8b33d]/60">
            <div className="min-w-0"><p className="break-words text-sm text-[#ece9e2]">{attempt.title || scenario.title}</p><p className="mt-1 text-xs text-[#b3afa3]"><span title={attempt.id} className="font-code text-[#e8b33d]">#{attempt.shortId || attempt.id.slice(-8)}</span> · Stage {attempt.progress?.stage || attempt.stage || 1}/3 · {attempt.progress?.turnsUsed ?? attempt.turnsUsed ?? 0} prompts</p><p className="mt-1 text-xs text-[#9a968c]">{statusLabels[attempt.status] || attempt.status}</p></div>
            <span className="shrink-0 text-sm font-semibold text-[#e8b33d]">Resume →</span>
          </Link></li>)}</ul>
          <p className="mt-3 text-xs text-[#b3afa3]">Resume keeps your code and conversation. Start attempt creates a separate workspace.</p>
        </section>}

        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section aria-label="Stage one problem" className="min-w-0 overflow-hidden rounded-xl border border-[#30322c] bg-[#141613] font-ui">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#30322c] px-5 py-3 text-xs"><span className="font-semibold text-[#e8b33d]">Stage 1 of 3 · {sample.stageTitle}</span><span className="text-[#9a968c]">{sample.difficulty} · {sample.minutes} min · {sample.promptPar} prompts</span></div>
            <div className="p-5 sm:p-6">
              <p className="mb-4 rounded-md border border-[#3a3c37] bg-black/20 px-3 py-2 text-xs leading-5 text-[#b3afa3]"><span className="font-semibold text-[#efcf88]">Sample preview.</span> Each attempt gets its own brief and example values. Your exact requirements appear when you start an attempt.</p>
              <p className="mb-4 text-xs leading-6 text-[#b3afa3]">{sample.blurb}</p>
              <h2 className="mb-3 text-base font-semibold">{sample.stageTitle}</h2>
              <SessionMarkdown text={sample.brief} />
              {sample.visibleTests.length > 0 && <div className="mt-5"><h3 className="text-xs font-semibold text-[#b3afa3]">Sample example{sample.visibleTests.length === 1 ? "" : "s"}</h3><div className="mt-2 space-y-2">{sample.visibleTests.map((test, index) => <dl key={index} className="rounded-md border border-[#30322c] bg-black/20 p-3 text-xs"><dt className="text-[#9a968c]">Input</dt><dd className="mt-1 overflow-x-auto whitespace-pre font-code leading-6 text-[#e0ded5]">{test.input}</dd><dt className="mt-2 text-[#9a968c]">Expected output</dt><dd className="mt-1 overflow-x-auto whitespace-pre font-code leading-6 text-[#e0ded5]">{test.expected}</dd></dl>)}</div></div>}
            </div>
            <div className="border-t border-[#30322c] bg-black/20"><div className="flex items-center justify-between gap-3 border-b border-[#30322c] px-5 py-3 text-xs text-[#b3afa3]"><h3>Starter file · {languageLabels[language]}</h3><span>Preview</span></div><pre className="max-h-80 overflow-auto p-5 font-code text-xs leading-6 text-[#d3d3c9]"><code>{sample.stubs[language] || "No starter file provided."}</code></pre></div>
            <div className="border-t border-[#30322c] p-5">
              <h3 className="text-xs font-semibold text-[#b3afa3]">All three stages</h3>
              <ol className="mt-3 space-y-3 text-xs leading-5 text-[#b3afa3]">
                <li><span className="font-semibold text-[#ece9e2]">Stage 1 · {sample.stageTitle}</span> (previewed above)<br />{STAGE_LEVEL_MEANINGS[0]}</li>
                <li><span className="font-semibold text-[#ece9e2]">Stage 2 · locked until stage 1 passes</span><br />{STAGE_LEVEL_MEANINGS[1]}</li>
                <li><span className="font-semibold text-[#ece9e2]">Stage 3 · locked until stage 2 passes</span><br />{STAGE_LEVEL_MEANINGS[2]}</li>
              </ol>
              <p className="mt-3 text-xs leading-5 text-[#9a968c]">Each attempt gets its own brief and example values. Exact stage 2–3 requirements appear in the workspace as you unlock them.</p>
            </div>
          </section>

          <div className="min-w-0 space-y-5">
            <section aria-label="Agent workspace" className="rounded-xl border border-[#30322c] bg-[#141613] p-5 font-ui sm:p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-base font-semibold"><Bot className="h-4 w-4 text-[#e8b33d]" />Your agent</h2><span className="text-xs text-[#9a968c]">{preparing ? "Starting your attempt…" : createdAttemptId ? "Attempt created" : "Ready to start"}</span></div>
              {settings}
              <p role="status" className={`mt-3 text-xs leading-5 ${device && provider ? "text-emerald-300" : "text-[#e8b33d]"}`}>{device && provider ? `Relay online · ${adapterLabel(provider.adapter)} preflight ready` : loading ? "Checking your paired computers…" : "Connect your agent below. Your scenario and configuration stay here while you set up."}</p>
              <p className="mt-2 text-xs leading-5 text-[#9a968c]">Models come from your installed agent. Local provider usage and billing apply.</p>
              <p role="status" className="mt-3 rounded-md border border-[#3a3c37] bg-black/20 px-3 py-2 text-xs leading-5 text-[#ece9e2]">Solving with: {device ? device.label : "no computer selected"} · {provider ? adapterLabel(provider.adapter) : "no provider selected"} · {selectedModel ? models.find((item) => item.id === selectedModel)?.label || selectedModel : "agent default model"}. Change these above before starting.</p>
              <div className="mt-5 border-t border-[#30322c] pt-5">
                <h3 className="text-sm font-semibold">Ready for your attempt?</h3>
                <p className="mt-2 text-xs leading-6 text-[#b3afa3]">Open your workspace with its own question variant, agent chat, and solution file. Write your first prompt there when you are ready.</p>
                <button type="button" onClick={() => void startAttempt()} disabled={locked || !device || !provider} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#e8b33d] px-5 py-3 text-sm font-semibold text-black hover:bg-[#f2c14e] disabled:opacity-40">{preparing ? "Preparing your attempt…" : createdAttemptId ? "Attempt created" : "Start attempt"}<ArrowRight className="h-4 w-4" /></button>
                <p className="mt-3 text-xs leading-5 text-[#9a968c]">Starting sets up the workspace. Your agent begins solving only after you send a prompt on the attempt page.</p>
                {(error || deviceError) && <p role="alert" className="mt-3 text-sm leading-6 text-[#e8b33d]">{error || deviceError}</p>}
                {createdAttemptId && <Link href={`/native/${encodeURIComponent(createdAttemptId)}`} className="mt-3 inline-flex items-center gap-2 rounded-md border border-[#e8b33d]/50 px-3 py-2 text-sm font-semibold text-[#e8b33d]">Open created attempt <span className="font-code">#{createdAttemptId.slice(-8)}</span><ArrowRight className="h-4 w-4" /></Link>}
              </div>
              <ol aria-label="What to do" className="mt-5 grid gap-3 border-t border-[#30322c] pt-4 text-xs leading-5 text-[#b3afa3] sm:grid-cols-2"><li><span className="font-semibold text-[#e8b33d]">1.</span> Read the question and choose your agent and model.</li><li><span className="font-semibold text-[#e8b33d]">2.</span> Start an attempt to open your dedicated workspace.</li><li><span className="font-semibold text-[#e8b33d]">3.</span> Prompt your agent there, review its code, and run checks.</li><li><span className="font-semibold text-[#e8b33d]">4.</span> Unlock stages 2–3, then finish for code acceptance.</li></ol>
              {unavailableDevices.length > 0 && <details className="mt-4 border-t border-[#30322c] pt-4 text-xs"><summary className="cursor-pointer text-[#b3afa3]">{unavailableDevices.length} unavailable computer{unavailableDevices.length === 1 ? "" : "s"}</summary><ul className="mt-3 space-y-3 text-[#b3afa3]">{unavailableDevices.map((item) => <li key={item.deviceId}><span className="font-medium text-[#ece9e2]">{item.label}</span><p className="mt-1 leading-5">{!deviceIsOnline(item, now) ? "Relay offline. Start the existing connector; you do not need to pair again." : item.adapters.map((report) => `${adapterLabel(report.adapter)}: ${report.message || report.status || "readiness unknown; update the connector"}`).join(" · ") || "No provider reported. Update and restart the connector."}</p></li>)}</ul></details>}
            </section>
            {connection}
          </div>
        </div>
        <details className="mt-6 rounded-xl border border-[#30322c] p-5 font-ui"><summary className="cursor-pointer text-sm text-[#b3afa3]">All attempt history · rename, archive, or restore</summary><div className="mt-5">{history}</div></details>
      </> : <>
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
          <section aria-label="New attempt" className="rounded-xl border border-[#30322c] bg-[#141613] p-5 font-ui sm:p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Bot className="h-4 w-4 text-[#e8b33d]" />Start a challenge</h2>
            <p className="mt-3 text-sm leading-6 text-[#b3afa3]">Choose a scenario to open its problem, starter file, and agent configuration.</p>
            <label className="mt-5 block text-xs text-[#b3afa3]">Scenario<select disabled={changingScenario} value="" onChange={(event) => selectScenario(event.target.value)} className={inputClass}><option value="" disabled>{changingScenario ? "Opening scenario…" : "Choose a scenario"}</option>{scenarios.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <Link href="/scenarios" className="mt-4 inline-flex items-center gap-2 text-sm text-[#e8b33d] hover:underline">Browse all scenarios<ArrowRight className="h-4 w-4" /></Link>
          </section>
          {history}
        </div>
        {connection && <div className="mt-6">{connection}</div>}
      </>}
    </div>
  );
}
