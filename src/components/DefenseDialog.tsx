"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCheck, LoaderCircle, ShieldCheck, Timer } from "lucide-react";
import { finalScore } from "@/lib/judge";
import SessionMarkdown from "./SessionMarkdown";

const DEFEND_SECONDS = 90;
const LENSES = ["code", "design", "prompts"] as const;
const LENS_LABEL = ["Code excerpt", "Design choice", "Your prompts"] as const;
const AGENT_RUNS_KEY = "codelit:agent-runs";

interface DefenseTurn {
  question: string;
  answer: string;
  score: number;
  feedback: string;
  secondsUsed: number;
  pastedChars: number;
  engine: string;
}

interface DefenseDialogProps {
  open: boolean;
  onClose: () => void;
  scenarioId: string;
  problemTitle: string;
  statement: string;
  code: string;
  fnName: string;
  traceSummary: string;
  passedCount: number;
  totalCount: number;
  traceScore0_100: number;
  promptsUsed: number;
}

export default function DefenseDialog(props: DefenseDialogProps) {
  const { open, onClose } = props;
  const [started, setStarted] = useState(false);
  const [round, setRound] = useState(0);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answer, setAnswer] = useState("");
  const [pasted, setPasted] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(DEFEND_SECONDS);
  const [loading, setLoading] = useState(false);
  const [grading, setGrading] = useState(false);
  const [turns, setTurns] = useState<DefenseTurn[]>([]);
  const question = questions[round] || "";
  const [error, setError] = useState("");
  const [verdict, setVerdict] = useState<ReturnType<typeof finalScore> | null>(null);
  const savedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The parent mounts this dialog fresh on every open, so the initial
  // state below is always a clean defense — no reset effect needed.

  // Prefetch the three questions as soon as the dialog opens, so they are
  // ready by the time the user reads the intro and clicks Start.
  useEffect(() => {
    if (open && questions.length === 0 && !loading && !verdict) void fetchQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  useEffect(() => {
    if (!open || !started || verdict || !question) return;
    timerRef.current = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [open, started, verdict, round, question]);

  // All three questions arrive in ONE call up front; submits after that
  // are instant and local, and grading happens once at the end.
  async function fetchQuestions() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/interrogate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "questions",
          problemTitle: props.problemTitle,
          statement: props.statement,
          code: props.code,
          fnName: props.fnName,
          traceSummary: props.traceSummary,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `Server error ${res.status}`);
        return;
      }
      const qs = Array.isArray(data.questions) ? data.questions.filter((q: unknown) => typeof q === "string" && q) : [];
      setQuestions(qs.length === LENSES.length ? qs : LENSES.map(() => "Explain your solution."));
      setRound(0);
      setAnswer("");
      setPasted(0);
      setSecondsLeft(DEFEND_SECONDS);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function gradeFinal(next: DefenseTurn[]) {
    setGrading(true);
    setError("");
    try {
      const res = await fetch("/api/interrogate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "gradeAll",
          items: next.map((t) => ({ question: t.question, answer: t.answer })),
          code: props.code,
          traceSummary: props.traceSummary,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `Server error ${res.status}`);
        return;
      }
      const grades = Array.isArray(data.grades) ? data.grades : [];
      const engine = typeof data.engine === "string" ? data.engine : "unknown";
      const graded = next.map((t, i) => ({
        ...t,
        score: typeof grades[i]?.score === "number" ? grades[i].score : 0,
        feedback: typeof grades[i]?.feedback === "string" ? grades[i].feedback : "",
        engine,
      }));
      setTurns(graded);
      const total = graded.reduce((s, t) => s + t.score, 0);
      setVerdict(finalScore({
        passedCount: props.passedCount,
        totalCount: props.totalCount,
        traceScore0_100: props.traceScore0_100,
        defendTotal0_30: total,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGrading(false);
    }
  }

  // Submit is local and instant: record the answer, advance or finish.
  function submitAnswer(timedOut = false) {
    if (grading || loading || !question) return;
    const turn: DefenseTurn = {
      question,
      answer: timedOut && !answer ? "(no answer — time expired)" : answer || "(blank)",
      score: 0,
      feedback: "",
      secondsUsed: DEFEND_SECONDS - secondsLeft,
      pastedChars: pasted,
      engine: "",
    };
    const next = [...turns, turn];
    setTurns(next);
    setError("");
    if (round + 1 < LENSES.length) {
      setRound(round + 1);
      setAnswer("");
      setPasted(0);
      setSecondsLeft(DEFEND_SECONDS);
    } else {
      void gradeFinal(next);
    }
  }

  useEffect(() => {
    if (open && started && !verdict && secondsLeft === 0 && !grading && !loading && question) {
      // Timer expiry must submit through the same path as the button.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void submitAnswer(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  // Bank the result to the passport once, when the verdict lands.
  useEffect(() => {
    if (!verdict || savedRef.current) return;
    savedRef.current = true;
    try {
      const raw = localStorage.getItem(AGENT_RUNS_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
      const list = Array.isArray(arr) ? arr : [];
      list.push({
        scenarioId: props.scenarioId,
        title: props.problemTitle,
        score: verdict.score,
        traceScore: props.traceScore0_100,
        defendScore: turns.reduce((s, t) => s + t.score, 0),
        prompts: props.promptsUsed,
        secondsUsed: turns.reduce((s, t) => s + t.secondsUsed, 0),
        finishedAt: new Date().toISOString(),
      });
      localStorage.setItem(AGENT_RUNS_KEY, JSON.stringify(list.slice(-50)));
    } catch {
      /* passport persistence is best-effort */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdict]);

  // The page behind the dialog must not scroll: lock body scroll while
  // the defense is up, and always restore it on close or unmount.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open ]);

  if (!open) return null;

  const step = verdict ? LENSES.length + 1 : started ? round + 1 : 0;
  const stepLabel = verdict
    ? "Verdict"
    : !started
      ? "Ready"
      : `Question ${round + 1} of ${LENSES.length} · ${LENS_LABEL[round]}`;
  const offline = turns.some((t) => t.engine === "offline");

  return (
    <div role="dialog" aria-modal="true" aria-label="Solution defense" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 font-ui backdrop-blur-sm">
      <div className="my-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#3a3d33] bg-[#141613] shadow-2xl shadow-black/60">
        <div className="border-b border-[#2c3026] px-5 pb-4 pt-5">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-[#e8eadf]"><ShieldCheck size={16} className="text-[#e8b33d]" /> Defend your solution</p>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded bg-white/10" role="progressbar" aria-valuenow={step} aria-valuemin={0} aria-valuemax={LENSES.length + 1} aria-label={stepLabel}>
            <div className="h-full bg-[#e8b33d] transition-all" style={{ width: `${(step / (LENSES.length + 1)) * 100}%` }} />
          </div>
          <p className="mt-2 text-[11px] text-[#929b83]">{stepLabel} · answer from your own code, not the statement</p>
        </div>

        <div className="px-5 py-5">
          {error && <p role="alert" className="mb-4 rounded-lg border border-red-400/25 bg-red-400/5 px-3 py-2 text-xs leading-6 text-red-200">{error}</p>}

          {!started && !verdict && (
            <div>
              <p className="text-sm leading-7 text-[#c9cec0]">Three timed questions about <span className="font-semibold text-[#e8eadf]">your</span> solution — a code excerpt, a design choice, and the prompts behind it. You get {DEFEND_SECONDS} seconds per question; the clock auto-submits at zero.</p>
              <p className="mt-2 text-xs leading-6 text-[#929b83]">Your defense banks the final score and lands on your passport. Answer all three questions to finish — the dialog stays until your verdict.</p>
              <button disabled={loading || (questions.length === 0 && !error)} onClick={() => { setStarted(true); if (questions.length === 0) void fetchQuestions(); }} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#e8b33d] px-5 py-2.5 text-xs font-semibold text-[#17190e] transition hover:bg-[#f0c15d] disabled:cursor-not-allowed disabled:opacity-40">
                {loading || questions.length === 0 ? <><LoaderCircle size={14} className="animate-spin" /> Preparing questions…</> : <>Start defense <ArrowRight size={13} /></>}
              </button>
            </div>
          )}

          {started && !verdict && !question && !error && (
            <p role="status" className="flex items-center gap-2 text-sm text-[#a5a997]"><LoaderCircle size={16} className="animate-spin" /> Preparing your question…</p>
          )}

          {started && !verdict && grading && (
            <p role="status" className="flex items-center gap-2 text-sm text-[#a5a997]"><LoaderCircle size={16} className="animate-spin" /> Grading your three answers…</p>
          )}

          {started && !verdict && !grading && question && (
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-[#e8b33d]"><Timer size={13} /> {secondsLeft}s left{secondsLeft === 0 ? " — submitting…" : ""}</p>
              <div className="mt-1 h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-[#e8b33d] transition-all" style={{ width: `${(secondsLeft / DEFEND_SECONDS) * 100}%` }} /></div>
              <div className="mt-4 rounded-lg border border-[#30342a] bg-[#0d100b] p-4"><SessionMarkdown text={question} /></div>
              <label htmlFor="defense-answer" className="mb-1 mt-4 block text-xs font-semibold text-[#d7ddcb]">Your answer</label>
              <textarea
                id="defense-answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onPaste={(e) => setPasted((p) => p + e.clipboardData.getData("text").length)}
                disabled={grading || loading}
                rows={5}
                maxLength={3000}
                placeholder="Answer from your code — quote your lines and inputs…"
                className="w-full resize-y rounded-lg border border-[#3d4532] bg-[#0c1009] px-3 py-2.5 text-sm leading-6 text-[#e1e6d6] placeholder:text-[#626e56] focus:border-[#e8b33d] focus:outline-none disabled:opacity-50"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] text-[#828e73]">{answer.length}/3000 · pasted {pasted} chars · auto-submits at 0s</span>
                <button disabled={grading || loading || !answer.trim()} onClick={() => void submitAnswer(false)} className="inline-flex items-center gap-2 rounded-lg bg-[#e8b33d] px-4 py-2 text-xs font-semibold text-[#17190e] transition hover:bg-[#f0c15d] disabled:cursor-not-allowed disabled:opacity-40">
                  {grading ? <><LoaderCircle size={13} className="animate-spin" /> Grading…</> : <>Submit answer <ArrowRight size={12} /></>}
                </button>
              </div>
              {error && <button disabled={loading || grading} onClick={() => { if (turns.length >= LENSES.length) void gradeFinal(turns); else void fetchQuestions(); }} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#34372e] px-3 py-2 text-xs text-[#d9dbd0] transition hover:bg-white/5">{turns.length >= LENSES.length ? "Retry grading" : "Retry questions"}</button>}
            </div>
          )}

          {verdict && (
            <div>
              <div className="rounded-xl border border-[#e8b33d]/30 bg-[#e8b33d]/5 p-4 text-center">
                <p className="text-4xl font-semibold text-[#e8eadf]">{verdict.score}<span className="text-lg text-[#929b83]">/100</span></p>
                <p className="mt-1 text-sm font-semibold text-[#e8b33d]">{verdict.tier.label}</p>
                <p className="mt-1 text-xs text-[#a5ad98]">{verdict.tier.blurb}</p>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {[["Acceptance", verdict.breakdown.acceptance], ["Efficiency", verdict.breakdown.efficiency], ["Defense", verdict.breakdown.defense ?? 0]].map(([label, value]) => (
                  <div key={label as string} className="rounded-lg border border-[#30342a] bg-[#0d100b] px-2 py-2.5">
                    <p className="text-lg font-semibold text-[#dfe3d6]">{value}</p>
                    <p className="text-[10px] uppercase tracking-wider text-[#849373]">{label}</p>
                  </div>
                ))}
              </div>
              {offline && <p className="mt-3 rounded-lg border border-[#e8b33d]/25 bg-[#e8b33d]/5 p-2.5 text-[11px] leading-5 text-[#d5c59e]">Partly graded offline — keyword matching, not understanding. It can never award top marks.</p>}
              <div className="mt-4 space-y-2">
                {turns.map((t, i) => (
                  <div key={i} className="rounded-lg border border-[#30342a] bg-black/20 p-3 text-xs leading-6">
                    <p className="font-semibold text-[#dfe3d6]">Round {i + 1} · {LENS_LABEL[i]} — {t.score}/10 · {t.secondsUsed}s{t.engine === "offline" ? " · offline" : ""}</p>
                    <p className="mt-1 text-[#9aa68a]">Q: {t.question}</p>
                    <p className="mt-1 text-[#c2c9b4]">{t.feedback}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/native" className="inline-flex items-center gap-2 rounded-lg bg-[#e8b33d] px-4 py-2 text-xs font-semibold text-[#17190e] transition hover:bg-[#f0c15d]">Back to attempts <ArrowRight size={12} /></Link>
                <button onClick={onClose} className="inline-flex items-center gap-2 rounded-lg border border-[#34372e] px-4 py-2 text-xs text-[#d9dbd0] transition hover:bg-white/5"><CheckCheck size={13} /> Stay here</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
