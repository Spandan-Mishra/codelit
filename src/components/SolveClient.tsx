"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Editor from "@/components/Editor";
import { getProblem } from "@/lib/problems";
import { runTests, type RunResult } from "@/lib/runner";
import { getAttempts, saveAttempt } from "@/lib/store";
import type { DefendTurn } from "@/lib/types";
import { Play, ShieldCheck, Timer, ClipboardPaste, AlertTriangle } from "lucide-react";

export default function SolveClient({ id }: { id: string }) {
  const problem = getProblem(id);
  const [lang, setLang] = useState<"python" | "javascript" | "c++">("python");
  const [code, setCode] = useState(() => problem?.starterPy ?? "");
  const [results, setResults] = useState<RunResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [pasteChars, setPasteChars] = useState(0);
  const [phase, setPhase] = useState<"code" | "defend" | "done">("code");
  const [round, setRound] = useState(0);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerPaste, setAnswerPaste] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(90);
  const [grading, setGrading] = useState(false);
  const [turns, setTurns] = useState<DefendTurn[]>([]);
  const [lockedMsg, setLockedMsg] = useState("");
  const roundStart = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!problem) return;
    // External-system sync (localStorage), deferred so it runs as a callback.
    const t = setTimeout(() => {
      const rec = getAttempts()[problem.id];
      if (problem.mode === "arena" && rec?.status === "locked") setLockedMsg("This Arena attempt is already used and locked on this device.");
    }, 0);
    return () => clearTimeout(t);
  }, [problem]);

  function switchLang(next: "python" | "javascript" | "c++") {
    setLang(next);
    if (problem) setCode(next === "python" ? problem.starterPy : next === "c++" ? problem.starterCpp : problem.starterJs);
  }

  const visiblePassed = useMemo(() => {
    if (!results) return false;
    const vis = results.filter((r) => !r.hidden);
    return vis.length > 0 && vis.every((r) => r.passed);
  }, [results]);
  const allPassed = results ? results.every((r) => r.passed) : false;

  async function doRun() {
    if (!problem) return;
    setRunning(true); setRunError("");
    try {
      const out = await runTests({ language: lang, code, fnName: problem.fnName, tests: problem.tests, problemId: problem.id });
      if (out.error) setRunError(out.error);
      setResults(out.results);
    } catch (e) {
      setRunError(String(e));
    } finally { setRunning(false); }
  }

  async function fetchQuestion(r: number, hist: DefendTurn[]) {
    if (!problem) return;
    const res = await fetch("/api/interrogate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "question", round: r, problemId: problem.id, problemTitle: problem.title, statement: problem.statement, code, fnName: problem.fnName, history: hist.map((t) => ({ question: t.question, answer: t.answer })) }),
    });
    const data = await res.json();
    setQuestion(data.question || "Explain your solution.");
    setAnswer(""); setAnswerPaste(0);
    setSecondsLeft(problem.defendSeconds);
    roundStart.current = Date.now();
  }

  async function startDefend() {
    setPhase("defend"); setRound(0); setTurns([]);
    await fetchQuestion(0, []);
  }

  // countdown
  useEffect(() => {
    if (phase !== "defend") return;
    timerRef.current = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, round]);

  useEffect(() => {
    if (phase === "defend" && secondsLeft === 0 && !grading) void submitAnswer(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  async function submitAnswer(timedOut = false) {
    if (!problem || grading) return;
    setGrading(true);
    const used = problem.defendSeconds - secondsLeft;
    try {
      const res = await fetch("/api/interrogate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "grade", round, question, answer: timedOut && !answer ? "(no answer — time expired)" : answer, code, problemId: problem.id }),
      });
      const data = await res.json();
      const turn: DefendTurn = { question, answer: answer || "(blank)", score: data.score ?? 0, feedback: data.feedback || "", secondsUsed: used, pastedChars: answerPaste };
      const next = [...turns, turn];
      setTurns(next);
      if (round + 1 < 3) { setRound(round + 1); await fetchQuestion(round + 1, next); }
      else {
        const total = next.reduce((s, t) => s + t.score, 0);
        saveAttempt({ problemId: problem.id, mode: problem.mode, status: problem.mode === "arena" ? "locked" : "defended", codeScore: allPassed ? 100 : 60, defendScore: total, turns: next, finishedAt: new Date().toISOString() });
        setPhase("done");
      }
    } finally { setGrading(false); }
  }

  if (!problem) return <div className="mx-auto max-w-4xl px-4 py-16 font-ui">Problem not found. <Link className="text-[#e8b33d]" href="/practice">Back to practice</Link></div>;
  const defendTotal = turns.reduce((s, t) => s + t.score, 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center gap-3 font-ui text-xs text-[#9a968c]">
        <Link href={problem.mode === "arena" ? "/arena" : "/practice"} className="hover:text-white">← {problem.mode === "arena" ? "Arena" : "Practice"}</Link>
        <span className="px-2 py-0.5 rounded-full border border-[#3a3c37]">{problem.difficulty}</span>
        <span>{problem.tags.join(" · ")}</span>
        <span className="ml-auto inline-flex items-center gap-1"><Timer className="h-3.5 w-3.5" /> Solve {problem.minutes}m · Defend 3×{problem.defendSeconds}s</span>
      </div>
      <h1 className="mt-2 text-3xl leading-tight">{problem.title}</h1>
      {lockedMsg && <div className="mt-3 font-ui text-sm rounded-md border border-[#e8b33d]/40 bg-[#e8b33d]/10 px-4 py-3 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {lockedMsg} You can still read the problem, but the graded defense is locked. <Link href="/passport" className="underline">View passport</Link></div>}

      <div className="mt-6 grid lg:grid-cols-[0.9fr_1.1fr] gap-6 items-start">
        <div className="rounded-lg border border-[#262824] bg-[#141613] p-5">
          <p className="font-ui text-[15px] leading-7 text-[#ddd9cf]">{problem.statement}</p>
          <h3 className="font-ui font-semibold text-sm mt-5">Constraints</h3>
          <ul className="font-code text-[13px] text-[#b9b5a9] mt-2 space-y-1">{problem.constraints.map((c) => <li key={c}>• {c}</li>)}</ul>
          <h3 className="font-ui font-semibold text-sm mt-5">Examples</h3>
          <div className="space-y-2 mt-2">{problem.examples.map((e, i) => (
            <div key={i} className="font-code text-[13px] rounded-md bg-black/40 border border-[#262824] p-3">in: {e.input}<br />out: {e.output}{e.note ? <><br />{e.note}</> : null}</div>
          ))}</div>
          <details className="mt-5 font-ui text-sm"><summary className="cursor-pointer text-[#e8b33d]">Hints (practice aid)</summary><ul className="text-[#9a968c] mt-2 space-y-1">{problem.hints.map((h) => <li key={h}>• {h}</li>)}</ul></details>
          <div className="mt-5 font-ui text-xs text-[#8a877d] flex items-center gap-2"><ClipboardPaste className="h-4 w-4" /> Pasted: {pasteChars} chars. Pasting is allowed — the defense decides.</div>
        </div>

        <div>
          {phase === "code" && (
            <>
              <div className="flex items-center gap-2 font-ui text-sm">
                <button onClick={() => switchLang("python")} className={`px-3 py-1.5 rounded-md border ${lang === "python" ? "bg-[#e8b33d] text-black font-semibold border-transparent" : "border-[#3a3c37]"}`}>Python</button>
                <button onClick={() => switchLang("c++")} className={`px-3 py-1.5 rounded-md border ${lang === "c++" ? "bg-[#e8b33d] text-black font-semibold border-transparent" : "border-[#3a3c37]"}`}>C++</button>
                <button onClick={() => switchLang("javascript")} className={`px-3 py-1.5 rounded-md border ${lang === "javascript" ? "bg-[#e8b33d] text-black font-semibold border-transparent" : "border-[#3a3c37]"}`}>JavaScript</button>
                <span className="text-xs text-[#8a877d] ml-auto">fn: <span className="font-code">{problem.fnName}</span></span>
              </div>
              <div className="mt-3"><Editor value={code} onChange={setCode} language={lang === "c++" ? "cpp" : lang} onPaste={(n) => setPasteChars((p) => p + n)} /></div>
              <div className="mt-3 flex flex-wrap gap-3 font-ui">
                <button onClick={doRun} disabled={running} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-white text-black font-semibold text-sm disabled:opacity-50"><Play className="h-4 w-4" /> {running ? "Running…" : "Run tests"}</button>
                <button onClick={startDefend} disabled={!visiblePassed || Boolean(lockedMsg)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#e8b33d] text-black font-semibold text-sm disabled:opacity-40"><ShieldCheck className="h-4 w-4" /> Defend your solution (3 × {problem.defendSeconds}s)</button>
              </div>
              {!visiblePassed && <p className="font-ui text-xs text-[#8a877d] mt-2">Pass the visible tests to unlock the defense.</p>}
              {runError && <p className="font-ui text-sm text-red-300 mt-3">{runError}</p>}
              {results && (() => {
                const vis = results.filter((r) => !r.hidden);
                const hid = results.filter((r) => r.hidden);
                const hidPassed = hid.filter((r) => r.passed).length;
                return (
                  <div className="mt-4 rounded-lg border border-[#262824] overflow-hidden">
                    <div className="font-ui text-sm px-4 py-2.5 bg-[#141613] border-b border-[#262824]">{results.filter((r) => r.passed).length}/{results.length} passed{allPassed ? " — defend it." : ""}</div>
                    <div className="divide-y divide-[#262824] font-code text-[13px]">
                      {vis.map((r, i) => (
                        <div key={i} className="px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1"><span className={r.passed ? "text-emerald-300" : "text-red-300"}>{r.passed ? "PASS" : "FAIL"}</span><span className="text-[#9a968c]">{r.input}</span><span>expected {r.expected}</span><span>got {r.actual || "—"}</span></div>
                      ))}
                      {hid.length > 0 && (
                        <div className="px-4 py-2.5 text-[#9a968c]">Hidden tests: {hidPassed}/{hid.length} passed{allPassed ? " ✓" : " — details stay hidden"}</div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {phase === "defend" && (
            <div className="rounded-lg border border-[#e8b33d]/40 bg-[#141613] p-5">
              <div className="flex items-center justify-between font-ui text-sm">
                <span className="font-semibold">Defense round {round + 1} / 3</span>
                <span className={`font-code px-2.5 py-1 rounded-md ${secondsLeft <= 15 ? "bg-red-500/20 text-red-200" : "bg-white/5"}`}>{secondsLeft}s left</span>
              </div>
              <div className="h-1.5 rounded bg-white/10 mt-3 overflow-hidden"><div className="h-full bg-[#e8b33d] transition-all" style={{ width: `${(secondsLeft / problem.defendSeconds) * 100}%` }} /></div>
              <p className="font-ui text-xs text-[#8a877d] mt-2">Questions quote your code. Answer from memory — the clock is the proctor.</p>
              <p className="mt-4 text-lg leading-8">{question || "Preparing your personalized question…"}</p>
              <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} onPaste={(e) => setAnswerPaste((p) => p + e.clipboardData.getData("text").length)} rows={6} placeholder="Answer from your code. Name lines, inputs, and what breaks…" className="mt-4 w-full rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2.5 font-ui text-sm outline-none focus:border-[#e8b33d]" />
              <div className="mt-2 font-ui text-xs text-[#8a877d]">Pasted in this answer: {answerPaste} chars · Time will auto-submit at 0s.</div>
              <button onClick={() => submitAnswer(false)} disabled={grading || !question} className="mt-4 font-ui px-5 py-2.5 rounded-md bg-[#e8b33d] text-black font-semibold text-sm disabled:opacity-50">{grading ? "Grading…" : round === 2 ? "Submit final answer" : "Submit & next round →"}</button>
              {turns.length > 0 && <div className="mt-5 space-y-2 font-ui text-sm">{turns.map((t, i) => <div key={i} className="rounded-md bg-black/40 border border-[#262824] p-3">Round {i + 1}: <strong>{t.score}/10</strong> in {t.secondsUsed}s — {t.feedback}</div>)}</div>}
            </div>
          )}

          {phase === "done" && (
            <div className="rounded-lg border border-emerald-400/30 bg-[#141613] p-5 font-ui">
              <p className="text-xs tracking-[0.18em] text-emerald-300">DEFENSE COMPLETE</p>
              <p className="text-3xl mt-2">{defendTotal}<span className="text-lg text-[#9a968c]"> / 30</span></p>
              <p className="text-sm text-[#9a968c] mt-1">{defendTotal >= 21 ? "Credible defense." : defendTotal >= 12 ? "Partial — practice the mutation round." : "Not yet — the code passed but the defense did not."}</p>
              <div className="mt-4 space-y-2 text-sm">{turns.map((t, i) => <div key={i} className="rounded-md bg-black/40 border border-[#262824] p-3"><p className="font-semibold">Round {i + 1} — {t.score}/10 · {t.secondsUsed}s · pasted {t.pastedChars} chars</p><p className="text-[#9a968c] mt-1">Q: {t.question}</p><p className="mt-1">{t.feedback}</p></div>)}</div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/passport" className="px-4 py-2 rounded-md bg-[#e8b33d] text-black font-semibold text-sm">View passport</Link>
                <Link href={problem.mode === "arena" ? "/arena" : "/practice"} className="px-4 py-2 rounded-md border border-[#3a3c37] text-sm">Back to {problem.mode}</Link>
                {problem.mode === "practice" && <button onClick={() => { setPhase("code"); setTurns([]); setResults(null); }} className="px-4 py-2 rounded-md border border-[#3a3c37] text-sm">Retry defense</button>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
