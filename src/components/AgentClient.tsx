"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Editor from "@/components/Editor";
import PostToLeaderboard from "@/components/PostToLeaderboard";
import type { DifficultyKey } from "@/lib/duel";
import type { BoardResult } from "@/lib/leaderboard";
import { runTests, type RunResult } from "@/lib/runner";
import { finalScore, provisionalScore, verdictTier } from "@/lib/judge";
import type { DefendTurn, ScenarioStage, ScenarioStubs, TestCase } from "@/lib/types";
import { getProvider } from "@/lib/agents";
import { getAgentConfig, getAgentKeys } from "@/lib/agentStore";
import { Play, ShieldCheck, Timer, AlertTriangle, Lock, CheckCircle2, Bot, ChevronDown } from "lucide-react";

// Scenario.stages is always exactly 3; locked briefs stay server-side.
const TOTAL_STAGES = 3;
const PROMPT_BUDGET = 12;
const DEFEND_SECONDS = 90;
const AGENT_RUNS_KEY = "codelit:agent-runs";

export interface AgentRunRecord {
  scenarioId: string;
  title: string;
  score: number;
  traceScore: number;
  defendScore: number;
  prompts: number;
  secondsUsed: number;
  finishedAt: string;
}

interface FinishScore {
  promptsUsed: number;
  promptPar: number;
  timeUsedSec: number;
  timeParSec: number;
  reverts: number;
  score0_100: number;
}

interface FinishData {
  results: RunResult[];
  passed: boolean;
  passedCount: number;
  totalCount: number;
  score: FinishScore;
  traceSummary: string;
}

interface TraceEventOut {
  t: number;
  kind: "prompt" | "code" | "run" | "stage" | "hint";
  text?: string;
  passed?: boolean;
  linesChanged?: number;
}

function starterFor(lang: "python" | "javascript" | "c++", fnName: string, stubs?: ScenarioStubs): string {
  if (stubs) {
    if (lang === "python") return stubs.py;
    if (lang === "javascript") return stubs.js;
    return stubs.cpp;
  }
  if (fnName === "two_sum") {
    if (lang === "python") return "def two_sum(nums, target):\n    # your code here\n    pass\n";
    if (lang === "javascript") return "function twoSum(nums, target) {\n  // your code here\n}\n";
    return "#include <vector>\nusing namespace std;\n\nvector<int> two_sum(vector<int> nums, int target) {\n    // your code here\n    return {};\n}\n";
  }
  if (fnName === "merge") {
    if (lang === "python") return "def merge(intervals):\n    # your code here\n    pass\n";
    if (lang === "javascript") return "function merge(intervals) {\n  // your code here\n}\n";
    return "#include <vector>\nusing namespace std;\n\nvector<vector<int>> merge(vector<vector<int>> intervals) {\n    // your code here\n    return {};\n}\n";
  }
  if (lang === "python") return `def ${fnName}(*args):\n    # your code here\n    pass\n`;
  if (lang === "javascript") return `function ${fnName}(...args) {\n  // your code here\n}\n`;
  return `#include <vector>\nusing namespace std;\n\n// implement ${fnName} here\n`;
}

function saveAgentRun(rec: AgentRunRecord) {
  try {
    const raw = localStorage.getItem(AGENT_RUNS_KEY);
    const arr = raw ? (JSON.parse(raw) as AgentRunRecord[]) : [];
    arr.push(rec);
    localStorage.setItem(AGENT_RUNS_KEY, JSON.stringify(arr.slice(-50)));
  } catch {}
}

export default function AgentClient(props: {
  id: string;
  title: string;
  difficulty: string;
  tags: string[];
  minutes: number;
  promptPar: number;
  timePar: number;
  fnName: string;
  stubs?: ScenarioStubs;
  cppReturn?: string;
  onFinish?: (passed: boolean) => void;
  boardDifficulty?: DifficultyKey;
  boardResult?: BoardResult;
}) {
  const { id, title, difficulty, tags, minutes, promptPar, timePar, fnName, stubs, cppReturn, onFinish } = props;
  const boardDifficulty: DifficultyKey = props.boardDifficulty ?? "easy";
  const boardResult: BoardResult = props.boardResult ?? "solo";
  const [phase, setPhase] = useState<"loading" | "code" | "verdict" | "defend" | "done" | "blocked">("loading");
  const [blockedMsg, setBlockedMsg] = useState("");
  const [retryAfterSec, setRetryAfterSec] = useState<number | null>(null);

  const [stages, setStages] = useState<ScenarioStage[]>([]);
  const [tests, setTests] = useState<TestCase[]>([]);
  const [stageUnlocked, setStageUnlocked] = useState(1);
  const [resumed, setResumed] = useState(false);
  const startedAt = useRef(0);
  const lastT = useRef(0);

  const [lang, setLang] = useState<"python" | "javascript" | "c++">("python");
  const [code, setCode] = useState(() => starterFor("python", fnName, stubs));
  const lastSnapshot = useRef("");

  const [promptDraft, setPromptDraft] = useState("");
  const [prompts, setPrompts] = useState<string[]>([]);
  const [loggingPrompt, setLoggingPrompt] = useState(false);

  const [assistOpen, setAssistOpen] = useState(false);
  const [assistLoading, setAssistLoading] = useState(false);
  const [assistReply, setAssistReply] = useState("");
  const [assistEngine, setAssistEngine] = useState("");
  const [assistError, setAssistError] = useState("");
  const [assistPrompt, setAssistPrompt] = useState("");
  const [assistLabel, setAssistLabel] = useState("House Agent (free)");

  const [results, setResults] = useState<RunResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishData, setFinishData] = useState<FinishData | null>(null);

  const [round, setRound] = useState(0);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerPaste, setAnswerPaste] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(DEFEND_SECONDS);
  const [grading, setGrading] = useState(false);
  const [turns, setTurns] = useState<DefendTurn[]>([]);
  const roundStart = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function nowT(): number {
    const t = Math.max(0, (Date.now() - startedAt.current) / 1000);
    lastT.current = Math.max(lastT.current, t);
    return lastT.current;
  }

  async function sendEvent(event: TraceEventOut): Promise<{ ok: boolean; data: Record<string, unknown>; error: string }> {
    try {
      const res = await fetch("/api/agent-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "event", scenarioId: id, event }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) return { ok: false, data, error: typeof data.error === "string" ? data.error : `Server error ${res.status}` };
      return { ok: true, data, error: "" };
    } catch (e) {
      return { ok: false, data: {}, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function startAttempt() {
    setPhase("loading");
    setBlockedMsg("");
    setRetryAfterSec(null);
    try {
      const res = await fetch("/api/agent-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", scenarioId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBlockedMsg(typeof data.error === "string" ? data.error : `Server error ${res.status}`);
        setRetryAfterSec(typeof data.retryAfterSec === "number" ? data.retryAfterSec : null);
        setPhase("blocked");
        return;
      }
      startedAt.current = typeof data.startedAt === "number" ? data.startedAt : Date.now();
      lastT.current = 0;
      lastSnapshot.current = "";
      setStages(Array.isArray(data.stages) ? data.stages : []);
      setTests(Array.isArray(data.tests) ? data.tests : []);
      setStageUnlocked(typeof data.stageUnlocked === "number" ? data.stageUnlocked : 1);
      setResumed(data.resumed === true);
      setPhase("code");
    } catch (e) {
      setBlockedMsg(e instanceof Error ? e.message : String(e));
      setPhase("blocked");
    }
  }

  useEffect(() => {
    // External-system sync (attempt start), deferred so it runs as a callback.
    const t = setTimeout(() => void startAttempt(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function switchLang(next: "python" | "javascript" | "c++") {
    setLang(next);
    setCode(starterFor(next, fnName, stubs));
  }

  async function logPrompt() {
    const text = promptDraft.trim();
    if (!text || loggingPrompt) return;
    setLoggingPrompt(true);
    setNotice("");
    const r = await sendEvent({ t: nowT(), kind: "prompt", text: text.slice(0, 4000) });
    setLoggingPrompt(false);
    if (!r.ok) {
      setNotice(r.error);
      return;
    }
    setPrompts((p) => [...p, text]);
    setPromptDraft("");
  }

  function toggleAssist() {
    if (!assistOpen) {
      const cfg = getAgentConfig();
      setAssistLabel(getProvider(cfg.provider)?.label || "House Agent (free)");
    }
    setAssistOpen((o) => !o);
  }

  async function askAgent() {
    if (assistLoading) return;
    setAssistLoading(true);
    setAssistError("");
    setAssistReply("");
    setAssistEngine("");
    try {
      const cfg = getAgentConfig();
      const def = getProvider(cfg.provider);
      setAssistLabel(def?.label || "House Agent (free)");
      const keys = getAgentKeys();
      const key = keys[cfg.provider] || "";
      if (def?.needsKey && !key) {
        setAssistError("No key saved for this provider — add one on the Agents page first.");
        return;
      }
      const brief = stages.length ? stages[stages.length - 1].brief : "";
      const system =
        "You are a coding coach. Give a short hint (2-3 sentences): point at the likely bug or next step, ask one focusing question. Never write the full solution.";
      const user =
        `Stage ${stageUnlocked} brief: ${brief}\nLanguage: ${lang}\nCode:\n${code}`.slice(0, 5500);
      setAssistPrompt(user);
      const res = await fetch("/api/agent-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: cfg.provider,
          key: key || undefined,
          baseUrl: cfg.baseUrl || undefined,
          model: cfg.model,
          system,
          user,
        }),
      });
      const data = (await res.json()) as { text?: string; engine?: string; error?: string };
      if (!res.ok) {
        setAssistError(typeof data.error === "string" ? data.error : `Server error ${res.status}`);
        return;
      }
      setAssistReply(typeof data.text === "string" ? data.text : "");
      setAssistEngine(typeof data.engine === "string" ? data.engine : "");
    } catch (e) {
      setAssistError(e instanceof Error ? e.message : String(e));
    } finally {
      setAssistLoading(false);
    }
  }

  function logAssistPrompt() {
    if (!assistPrompt) return;
    setPromptDraft(assistPrompt);
    setNotice("Assist prompt loaded into the prompt draft above — log it to count it.");
  }

  async function doRun() {
    if (running) return;
    setRunning(true);
    setRunError("");
    setNotice("");
    try {
      const out = await runTests({ language: lang, code, fnName, tests, cppReturn });
      if (out.error) setRunError(out.error);
      setResults(out.results);
      if (out.results.length === 0) return; // infra failure: don't pollute the trace
      const passed = out.results.every((r) => r.passed);
      const linesChanged = Math.abs(code.split("\n").length - lastSnapshot.current.split("\n").length);
      const codeEv = await sendEvent({ t: nowT(), kind: "code", text: code.slice(0, 20000), linesChanged });
      if (!codeEv.ok) setNotice(codeEv.error);
      else lastSnapshot.current = code;
      const runEv = await sendEvent({
        t: nowT(),
        kind: "run",
        passed,
        text: `${out.results.filter((r) => r.passed).length}/${out.results.length} stage ${stageUnlocked}`.slice(0, 1000),
      });
      if (!runEv.ok) setNotice(runEv.error);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function submitStage() {
    if (submitting || stageUnlocked >= TOTAL_STAGES) return;
    setSubmitting(true);
    setNotice("");
    const r = await sendEvent({ t: nowT(), kind: "stage", text: String(stageUnlocked + 1) });
    setSubmitting(false);
    if (!r.ok) {
      setNotice(r.error);
      return;
    }
    const unlocked = r.data.unlocked as { stage?: ScenarioStage; tests?: TestCase[] } | undefined;
    if (unlocked?.stage) {
      setStages((s) => [...s, unlocked.stage as ScenarioStage]);
      setTests(Array.isArray(unlocked.tests) ? unlocked.tests : []);
      setStageUnlocked(typeof r.data.stageUnlocked === "number" ? (r.data.stageUnlocked as number) : stageUnlocked + 1);
      setResults(null);
      setNotice(`Stage ${stageUnlocked + 1} unlocked.`);
    } else {
      setNotice("Server confirmed, but no new stage arrived — reload to resync.");
    }
  }

  async function doFinish() {
    if (finishing) return;
    setFinishing(true);
    setRunError("");
    setNotice("");
    try {
      const res = await fetch("/api/agent-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finish", scenarioId: id, language: lang, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(typeof data.error === "string" ? data.error : `Server error ${res.status}`);
        return;
      }
      setFinishData({
        results: Array.isArray(data.results) ? data.results : [],
        passed: data.passed === true,
        passedCount: typeof data.passedCount === "number" ? data.passedCount : 0,
        totalCount: typeof data.totalCount === "number" ? data.totalCount : 0,
        score: data.score as FinishScore,
        traceSummary: typeof data.traceSummary === "string" ? data.traceSummary : "",
      });
      setPhase("verdict");
      onFinish?.(data.passed === true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setFinishing(false);
    }
  }

  async function fetchQuestion(r: number, hist: DefendTurn[]) {
    if (!finishData) return;
    const statement = stages.map((s, i) => `Stage ${i + 1} — ${s.title}: ${s.brief}`).join("\n");
    const res = await fetch("/api/interrogate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "question",
        round: r,
        problemTitle: title,
        statement,
        code,
        fnName,
        history: hist.map((t) => ({ question: t.question, answer: t.answer })),
        traceSummary: finishData.traceSummary,
      }),
    });
    const data = await res.json();
    setQuestion(data.question || "Explain your solution.");
    setAnswer("");
    setAnswerPaste(0);
    setSecondsLeft(DEFEND_SECONDS);
    roundStart.current = Date.now();
  }

  async function startDefend() {
    setPhase("defend");
    setRound(0);
    setTurns([]);
    await fetchQuestion(0, []);
  }

  useEffect(() => {
    if (phase !== "defend") return;
    timerRef.current = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, round]);

  useEffect(() => {
    if (phase === "defend" && secondsLeft === 0 && !grading) void submitAnswer(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  async function submitAnswer(timedOut = false) {
    if (!finishData || grading) return;
    setGrading(true);
    const used = DEFEND_SECONDS - secondsLeft;
    try {
      const res = await fetch("/api/interrogate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "grade",
          round,
          question,
          answer: timedOut && !answer ? "(no answer — time expired)" : answer,
          code,
          traceSummary: finishData.traceSummary,
        }),
      });
      const data = await res.json();
      const turn: DefendTurn = {
        question,
        answer: answer || "(blank)",
        score: data.score ?? 0,
        feedback: data.feedback || "",
        secondsUsed: used,
        pastedChars: answerPaste,
      };
      const next = [...turns, turn];
      setTurns(next);
      if (round + 1 < 3) {
        setRound(round + 1);
        await fetchQuestion(round + 1, next);
      } else {
        const total = next.reduce((s, t) => s + t.score, 0);
        const r = finalScore({
          passedCount: finishData.passedCount,
          totalCount: finishData.totalCount,
          traceScore0_100: finishData.score.score0_100,
          defendTotal0_30: total,
        });
        saveAgentRun({
          scenarioId: id,
          title,
          score: r.score,
          traceScore: finishData.score.score0_100,
          defendScore: total,
          prompts: finishData.score.promptsUsed,
          secondsUsed: finishData.score.timeUsedSec,
          finishedAt: new Date().toISOString(),
        });
        setPhase("done");
      }
    } finally {
      setGrading(false);
    }
  }

  const defendTotal = turns.reduce((s, t) => s + t.score, 0);

  if (phase === "loading") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 font-ui text-sm text-[#9a968c]" aria-busy="true">
        Starting your attempt…
      </div>
    );
  }

  if (phase === "blocked") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="rounded-lg border border-[#e8b33d]/40 bg-[#141613] p-6 font-ui">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-[#e8b33d]" /> Attempt unavailable</p>
          <p className="mt-2 text-sm text-[#9a968c] leading-6">{blockedMsg || "Could not start this scenario."}</p>
          {retryAfterSec !== null && (
            <p className="mt-1 font-code text-[13px] text-[#9a968c]">Retry in ~{Math.max(1, Math.ceil(retryAfterSec / 60))}m.</p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={() => void startAttempt()} className="px-4 py-2 rounded-md bg-[#e8b33d] text-black font-semibold text-sm">Retry</button>
            <Link href="/scenarios" className="px-4 py-2 rounded-md border border-[#3a3c37] text-sm">Back to scenarios</Link>
            <Link href="/passport" className="px-4 py-2 rounded-md border border-[#3a3c37] text-sm">View passport</Link>
          </div>
        </div>
      </div>
    );
  }

  const current = stages[stages.length - 1];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center gap-3 font-ui text-xs text-[#9a968c]">
        <Link href="/scenarios" className="hover:text-white">← Scenarios</Link>
        <span className="px-2 py-0.5 rounded-full border border-[#3a3c37]">{difficulty}</span>
        <span>{tags.join(" · ")}</span>
        <span className="ml-auto inline-flex items-center gap-1"><Timer className="h-3.5 w-3.5" /> {minutes}m · par {promptPar} prompts / {timePar}m</span>
      </div>
      <h1 className="mt-2 text-3xl leading-tight">{title}</h1>
      {resumed && (
        <p className="mt-2 font-ui text-xs text-[#8a877d]">Resumed your active attempt — earlier trace events are kept server-side.</p>
      )}

      <div className="mt-6 grid lg:grid-cols-[0.9fr_1.1fr] gap-6 items-start">
        <div className="rounded-lg border border-[#262824] bg-[#141613] p-5">
          <p className="font-ui text-xs tracking-[0.18em] text-[#9a968c]">STAGE {stageUnlocked} / {TOTAL_STAGES}</p>
          <div className="mt-3 space-y-3">
            {stages.map((s, i) => (
              <div key={i} className={`rounded-md border p-3.5 ${i === stages.length - 1 ? "border-[#e8b33d]/40 bg-black/40" : "border-[#262824]"}`}>
                <p className="font-ui text-sm font-semibold flex items-center gap-2">
                  {i < stages.length - 1 && <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
                  Stage {i + 1} — {s.title}
                </p>
                <p className="font-ui text-[13px] leading-6 text-[#b9b5a9] mt-1.5">{s.brief}</p>
              </div>
            ))}
            {Array.from({ length: Math.max(0, TOTAL_STAGES - stages.length) }, (_, k) => (
              <div key={`locked-${k}`} className="rounded-md border border-dashed border-[#3a3c37] p-3.5 font-ui text-[13px] text-[#8a877d] flex items-center gap-2">
                <Lock className="h-4 w-4" /> Stage {stages.length + k + 1} — locked.
                {k === 0 && current ? ` ${current.unlockHint}` : ""}
              </div>
            ))}
          </div>
          {phase === "code" && (
            <>
              <h3 className="font-ui font-semibold text-sm mt-5">Visible tests — stage {stageUnlocked}</h3>
              <div className="space-y-2 mt-2">
                {tests.map((t, i) => (
                  <div key={i} className="font-code text-[13px] rounded-md bg-black/40 border border-[#262824] p-3">in: {t.input}<br />out: {t.expected}</div>
                ))}
                {tests.length === 0 && <p className="font-ui text-[13px] text-[#8a877d]">No visible tests at this stage — finish to run acceptance.</p>}
              </div>
            </>
          )}
        </div>

        <div>
          {phase === "code" && (
            <>
              <div className="rounded-lg border border-[#262824] bg-[#141613] p-5">
                <div className="flex items-center justify-between font-ui text-sm">
                  <span className="font-semibold">Prompt log</span>
                  <span className="font-code text-xs text-[#9a968c]">{prompts.length} / {PROMPT_BUDGET} this session</span>
                </div>
                <p className="font-ui text-xs text-[#8a877d] mt-1.5 leading-5">Log the prompts you actually used — an empty trace caps your score and the defense will catch it.</p>
                <textarea
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  rows={2}
                  placeholder="Paste the prompt you just gave your agent…"
                  className="mt-3 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2.5 font-ui text-sm outline-none focus:border-[#e8b33d]"
                />
                <button onClick={() => void logPrompt()} disabled={loggingPrompt || !promptDraft.trim()} className="mt-2 font-ui px-4 py-2 rounded-md border border-[#3a3c37] text-sm disabled:opacity-40">
                  {loggingPrompt ? "Logging…" : "Log this prompt"}
                </button>
                {prompts.length > 0 && (
                  <ol className="mt-3 space-y-1.5 font-ui text-[13px] text-[#b9b5a9]">
                    {prompts.map((p, i) => (
                      <li key={i} className="rounded-md bg-black/40 border border-[#262824] px-3 py-2">
                        <span className="text-[#8a877d]">#{i + 1}</span> {p.length > 160 ? `${p.slice(0, 160)}…` : p}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="mt-4 rounded-lg border border-[#262824] bg-[#141613] font-ui">
                <button
                  onClick={toggleAssist}
                  aria-expanded={assistOpen}
                  className="w-full flex items-center gap-2 px-5 py-3.5 text-sm font-semibold text-left"
                >
                  <Bot className="h-4 w-4 text-[#e8b33d]" />
                  Ask my agent
                  <span className="font-normal text-xs text-[#8a877d]">· {assistLabel}</span>
                  <ChevronDown className={`h-4 w-4 ml-auto text-[#9a968c] transition-transform ${assistOpen ? "rotate-180" : ""}`} />
                </button>
                {assistOpen && (
                  <div className="px-5 pb-5">
                    <p className="text-xs text-[#8a877d] leading-5">
                      Sends your current code and the stage brief to your configured agent.{" "}
                      <Link href="/agents" className="text-[#e8b33d] hover:underline rounded">Manage providers →</Link>
                    </p>
                    <button
                      onClick={() => void askAgent()}
                      disabled={assistLoading}
                      className="mt-3 px-4 py-2 rounded-md border border-[#3a3c37] text-sm disabled:opacity-40"
                    >
                      {assistLoading ? "Asking…" : "Ask for a hint"}
                    </button>
                    {assistError && <p className="text-sm text-red-300 mt-3">{assistError}</p>}
                    {assistReply && (
                      <div className="mt-3 rounded-md bg-black/40 border border-[#262824] px-3 py-2.5 text-[13px] text-[#b9b5a9] leading-6">
                        {assistEngine && <p className="font-code text-xs text-[#8a877d] mb-1">{assistEngine}</p>}
                        {assistReply}
                        <div className="mt-2">
                          <button onClick={logAssistPrompt} className="px-3 py-1.5 rounded-md border border-[#3a3c37] text-xs">
                            Log prompt to trace
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 font-ui text-sm">
                <button onClick={() => switchLang("python")} className={`px-3 py-1.5 rounded-md border ${lang === "python" ? "bg-[#e8b33d] text-black font-semibold border-transparent" : "border-[#3a3c37]"}`}>Python</button>
                <button onClick={() => switchLang("c++")} className={`px-3 py-1.5 rounded-md border ${lang === "c++" ? "bg-[#e8b33d] text-black font-semibold border-transparent" : "border-[#3a3c37]"}`}>C++</button>
                <button onClick={() => switchLang("javascript")} className={`px-3 py-1.5 rounded-md border ${lang === "javascript" ? "bg-[#e8b33d] text-black font-semibold border-transparent" : "border-[#3a3c37]"}`}>JavaScript</button>
                <span className="text-xs text-[#8a877d] ml-auto">fn: <span className="font-code">{fnName}</span></span>
              </div>
              <div className="mt-3"><Editor value={code} onChange={setCode} language={lang === "c++" ? "cpp" : lang} /></div>
              <div className="mt-3 flex flex-wrap gap-3 font-ui">
                <button onClick={() => void doRun()} disabled={running} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-white text-black font-semibold text-sm disabled:opacity-50"><Play className="h-4 w-4" /> {running ? "Running…" : "Run visible tests"}</button>
                {stageUnlocked < TOTAL_STAGES ? (
                  <button onClick={() => void submitStage()} disabled={submitting} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#e8b33d] text-black font-semibold text-sm disabled:opacity-40">{submitting ? "Submitting…" : `Submit stage ${stageUnlocked} →`}</button>
                ) : (
                  <button onClick={() => void doFinish()} disabled={finishing} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#e8b33d] text-black font-semibold text-sm disabled:opacity-40"><ShieldCheck className="h-4 w-4" /> {finishing ? "Finishing…" : "Finish & run acceptance"}</button>
                )}
              </div>
              {stageUnlocked < TOTAL_STAGES && (
                <button onClick={() => void doFinish()} disabled={finishing} className="mt-2 font-ui text-xs text-[#8a877d] underline underline-offset-2 disabled:opacity-40">
                  {finishing ? "Finishing…" : "Or finish early — consumes your one shot."}
                </button>
              )}
              {notice && <p className="font-ui text-sm text-[#e8b33d] mt-3">{notice}</p>}
              {runError && <p className="font-ui text-sm text-red-300 mt-3">{runError}</p>}
              {results && (
                <div className="mt-4 rounded-lg border border-[#262824] overflow-hidden">
                  <div className="font-ui text-sm px-4 py-2.5 bg-[#141613] border-b border-[#262824]">{results.filter((r) => r.passed).length}/{results.length} visible passed</div>
                  <div className="divide-y divide-[#262824] font-code text-[13px]">
                    {results.map((r, i) => (
                      <div key={i} className="px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1"><span className={r.passed ? "text-emerald-300" : "text-red-300"}>{r.passed ? "PASS" : "FAIL"}</span><span className="text-[#9a968c]">{r.input}</span><span>expected {r.expected}</span><span>got {r.actual || "—"}</span></div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {phase === "verdict" && finishData && (() => {
            const vis = finishData.results.filter((r) => !r.hidden);
            const hid = finishData.results.filter((r) => r.hidden);
            const hidPassed = hid.filter((r) => r.passed).length;
            return (
              <div className="rounded-lg border border-[#262824] bg-[#141613] p-5 font-ui">
                <p className="text-xs tracking-[0.18em] text-[#9a968c]">ATTEMPT FINISHED — ONE SHOT SPENT</p>
                <p className={`text-3xl mt-2 ${finishData.passed ? "text-emerald-300" : "text-red-300"}`}>
                  {finishData.passedCount}<span className="text-lg text-[#9a968c]"> / {finishData.totalCount} acceptance</span>
                </p>
                <p className="text-sm text-[#9a968c] mt-1">Trace: {finishData.traceSummary}</p>
                {(() => {
                  const prov = provisionalScore(finishData.score.score0_100);
                  const tier = verdictTier(prov);
                  return (
                    <p className="mt-3 inline-block text-sm px-3 py-1.5 rounded-md bg-white/5">
                      Provisional <strong>{prov}/100 · {tier.label}</strong> — defend your trace to bank a final score.
                    </p>
                  );
                })()}
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-full bg-white/5">trace {finishData.score.score0_100}/100</span>
                  <span className="px-2.5 py-1 rounded-full bg-white/5">{finishData.score.promptsUsed} prompts</span>
                  <span className="px-2.5 py-1 rounded-full bg-white/5">{Math.round(finishData.score.timeUsedSec / 60)}m used</span>
                  <span className="px-2.5 py-1 rounded-full bg-white/5">{finishData.score.reverts} reverts</span>
                </div>
                <div className="mt-4 rounded-lg border border-[#262824] overflow-hidden">
                  <div className="divide-y divide-[#262824] font-code text-[13px]">
                    {vis.map((r, i) => (
                      <div key={i} className="px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1"><span className={r.passed ? "text-emerald-300" : "text-red-300"}>{r.passed ? "PASS" : "FAIL"}</span><span className="text-[#9a968c]">{r.input}</span><span>expected {r.expected}</span><span>got {r.actual || "—"}</span></div>
                    ))}
                    {hid.length > 0 && (
                      <div className="px-4 py-2.5 text-[#9a968c]">Hidden tests: {hidPassed}/{hid.length} passed — details stay hidden</div>
                    )}
                  </div>
                </div>
                <p className="text-sm text-[#9a968c] mt-4">Final score blends this trace (60%) with a live defense (40%).</p>
                <button onClick={() => void startDefend()} className="mt-3 inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#e8b33d] text-black font-semibold text-sm"><ShieldCheck className="h-4 w-4" /> Defend your trace (3 × {DEFEND_SECONDS}s)</button>
              </div>
            );
          })()}

          {phase === "defend" && (
            <div className="rounded-lg border border-[#e8b33d]/40 bg-[#141613] p-5">
              <div className="flex items-center justify-between font-ui text-sm">
                <span className="font-semibold">Defense round {round + 1} / 3</span>
                <span className={`font-code px-2.5 py-1 rounded-md ${secondsLeft <= 15 ? "bg-red-500/20 text-red-200" : "bg-white/5"}`}>{secondsLeft}s left</span>
              </div>
              <div className="h-1.5 rounded bg-white/10 mt-3 overflow-hidden"><div className="h-full bg-[#e8b33d] transition-all" style={{ width: `${(secondsLeft / DEFEND_SECONDS) * 100}%` }} /></div>
              <p className="font-ui text-xs text-[#8a877d] mt-2">Questions quote your code and your trace. Answer from memory — the clock is the proctor.</p>
              <p className="mt-4 text-lg leading-8">{question || "Preparing your personalized question…"}</p>
              <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} onPaste={(e) => setAnswerPaste((p) => p + e.clipboardData.getData("text").length)} rows={6} placeholder="Answer from your code. Name lines, inputs, and what breaks…" className="mt-4 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2.5 font-ui text-sm outline-none focus:border-[#e8b33d]" />
              <div className="mt-2 font-ui text-xs text-[#8a877d]">Pasted in this answer: {answerPaste} chars · Time will auto-submit at 0s.</div>
              <button onClick={() => void submitAnswer(false)} disabled={grading || !question} className="mt-4 font-ui px-5 py-2.5 rounded-md bg-[#e8b33d] text-black font-semibold text-sm disabled:opacity-50">{grading ? "Grading…" : round === 2 ? "Submit final answer" : "Submit & next round →"}</button>
              {turns.length > 0 && <div className="mt-5 space-y-2 font-ui text-sm">{turns.map((t, i) => <div key={i} className="rounded-md bg-black/40 border border-[#262824] p-3">Round {i + 1}: <strong>{t.score}/10</strong> in {t.secondsUsed}s — {t.feedback}</div>)}</div>}
            </div>
          )}

          {phase === "done" && finishData && (() => {
            const r = finalScore({
              passedCount: finishData.passedCount,
              totalCount: finishData.totalCount,
              traceScore0_100: finishData.score.score0_100,
              defendTotal0_30: defendTotal,
            });
            const rows = [
              { label: `Acceptance ${finishData.passedCount}/${finishData.totalCount}`, value: r.breakdown.acceptance },
              { label: `Efficiency ${finishData.score.promptsUsed}/${finishData.score.promptPar} prompts · ${Math.round(finishData.score.timeUsedSec / 60)}m`, value: r.breakdown.efficiency },
              { label: `Defense ${defendTotal}/30`, value: r.breakdown.defense ?? 0 },
            ];
            return (
            <div className="rounded-lg border border-emerald-400/30 bg-[#141613] p-5 font-ui">
              <p className="text-xs tracking-[0.18em] text-emerald-300">AGENT RUN COMPLETE</p>
              <p className="text-3xl mt-2">{r.score}<span className="text-lg text-[#9a968c]"> / 100 · {r.tier.label}</span></p>
              <p className="text-sm text-[#9a968c] mt-1">{r.tier.blurb}</p>
              <div className="mt-4 space-y-2">
                {rows.map((row) => (
                  <div key={row.label}>
                    <div className="flex justify-between text-xs text-[#9a968c]"><span>{row.label}</span><span>{row.value}</span></div>
                    <div className="h-1.5 rounded bg-white/10 mt-1 overflow-hidden"><div className="h-full bg-[#e8b33d]" style={{ width: `${row.value}%` }} /></div>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2 text-sm">{turns.map((t, i) => <div key={i} className="rounded-md bg-black/40 border border-[#262824] p-3"><p className="font-semibold">Round {i + 1} — {t.score}/10 · {t.secondsUsed}s · pasted {t.pastedChars} chars</p><p className="text-[#9a968c] mt-1">Q: {t.question}</p><p className="mt-1">{t.feedback}</p></div>)}</div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link href="/passport" className="px-4 py-2 rounded-md bg-[#e8b33d] text-black font-semibold text-sm">View passport</Link>
                <Link href="/scenarios" className="px-4 py-2 rounded-md border border-[#3a3c37] text-sm">Back to scenarios</Link>
                <PostToLeaderboard
                  scenarioId={id}
                  difficulty={boardDifficulty}
                  score={r.score}
                  tier={r.tier.label}
                  result={boardResult}
                  prompts={finishData.score.promptsUsed}
                />
              </div>
            </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
