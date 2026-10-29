"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Editor from "@/components/Editor";
import { getDebug } from "@/lib/problems";
import { runTests, type RunResult } from "@/lib/runner";
import { saveDebug } from "@/lib/store";
import { Play, Lightbulb, Timer } from "lucide-react";

export default function DebugClient({ id }: { id: string }) {
  const ch = getDebug(id);
  const [code, setCode] = useState(ch?.buggyPy ?? "");
  const [results, setResults] = useState<RunResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [promptsUsed, setPromptsUsed] = useState(0);
  const [hints, setHints] = useState<string[]>([]);
  const [hintLoading, setHintLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState((ch?.minutes ?? 6) * 60);
  const [done, setDone] = useState<"solved" | "failed" | null>(null);
  const startRef = useRef<number>(0);
  const doneRef = useRef(false);

  useEffect(() => {
    startRef.current = Date.now();
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1 && !doneRef.current) {
          doneRef.current = true;
          // Timeout transition inside the timer callback (external system).
          setTimeout(() => {
            setDone("failed");
            saveDebug({ challengeId: id, status: "failed", promptsUsed: 0, secondsUsed: Math.round((Date.now() - startRef.current) / 1000), finishedAt: new Date().toISOString() });
          }, 0);
          return 0;
        }
        return Math.max(0, s - 1);
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ch) return <div className="mx-auto max-w-4xl px-4 py-16 font-ui">Challenge not found. <Link className="text-[#e8b33d]" href="/debug">Back</Link></div>;

  async function doRun() {
    setRunning(true); setRunError("");
    try {
      const out = await runTests({ language: "python", code, fnName: ch!.fnName, tests: ch!.tests });
      if (out.error) setRunError(out.error);
      setResults(out.results);
      if (out.results.length && out.results.every((r) => r.passed)) {
        doneRef.current = true;
        setDone("solved");
        saveDebug({ challengeId: ch!.id, status: "solved", promptsUsed, secondsUsed: Math.round((Date.now() - startRef.current) / 1000), finishedAt: new Date().toISOString() });
      }
    } catch (e) {
      setRunError(String(e));
    } finally { setRunning(false); }
  }

  async function askHint() {
    if (promptsUsed >= ch!.maxPrompts || hintLoading) return;
    setHintLoading(true);
    try {
      const res = await fetch("/api/debug-hint", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId: ch!.id, code, promptsUsed }) });
      const data = await res.json();
      setHints((h) => [...h, data.hint || "Re-read the failing test and trace it by hand."]);
      setPromptsUsed((p) => p + 1);
    } finally { setHintLoading(false); }
  }

  const mm = Math.floor(secondsLeft / 60); const ss = String(secondsLeft % 60).padStart(2, "0");
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/debug" className="font-ui text-xs text-[#9a968c] hover:text-white">← Debug Under Fire</Link>
      <div className="flex flex-wrap items-center gap-3 mt-2">
        <h1 className="text-3xl leading-tight flex-1">{ch.title}</h1>
        <span className={`font-code font-ui text-sm px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 ${secondsLeft <= 60 ? "bg-red-500/20 text-red-200" : "bg-white/5"}`}><Timer className="h-4 w-4" /> {mm}:{ss}</span>
        <span className="font-ui text-sm px-3 py-1.5 rounded-md bg-white/5">Prompts: {promptsUsed}/{ch.maxPrompts}</span>
      </div>
      <p className="font-ui text-sm text-[#c9c5ba] mt-3 max-w-3xl leading-6">{ch.description}</p>
      <div className="mt-6 grid lg:grid-cols-[1.1fr_0.9fr] gap-6 items-start">
        <div>
          <Editor value={code} onChange={setCode} language="python" height={360} />
          <div className="mt-3 flex flex-wrap gap-3 font-ui">
            <button onClick={doRun} disabled={running || done !== null} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-white text-black font-semibold text-sm disabled:opacity-50"><Play className="h-4 w-4" /> {running ? "Running…" : "Run tests"}</button>
            <button onClick={askHint} disabled={promptsUsed >= ch.maxPrompts || hintLoading || done !== null} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-[#e8b33d]/60 text-[#e8b33d] font-semibold text-sm disabled:opacity-40"><Lightbulb className="h-4 w-4" /> {hintLoading ? "Thinking…" : `Ask agent (${ch.maxPrompts - promptsUsed} left)`}</button>
          </div>
          {runError && <p className="font-ui text-sm text-red-300 mt-3">{runError}</p>}
          {results && <div className="mt-4 rounded-lg border border-[#262824] overflow-hidden"><div className="font-ui text-sm px-4 py-2.5 bg-[#141613] border-b border-[#262824]">{results.filter((r) => r.passed).length}/{results.length} passed</div><div className="divide-y divide-[#262824] font-code text-[13px]">{results.map((r, i) => <div key={i} className="px-4 py-2.5 flex flex-wrap gap-x-4"><span className={r.passed ? "text-emerald-300" : "text-red-300"}>{r.passed ? "PASS" : "FAIL"}</span><span className="text-[#9a968c]">{r.input}</span><span>expected {r.expected}</span><span>got {r.actual || "—"}</span></div>)}</div></div>}
          {done === "solved" && <div className="mt-4 font-ui rounded-md border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm">Solved with {promptsUsed} prompt(s). Saved to your passport.</div>}
          {done === "failed" && <div className="mt-4 font-ui rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm">Time expired. Retry from the list.</div>}
        </div>
        <div className="rounded-lg border border-[#262824] bg-[#141613] p-5 font-ui">
          <p className="text-xs tracking-[0.18em] text-[#9a968c]">AGENT — HINTS ONLY, NEVER THE FIX</p>
          {hints.length === 0 ? <p className="text-sm text-[#9a968c] mt-3">No hints used yet. Trace one failing test by hand first.</p> : (
            <ol className="mt-3 space-y-3 text-sm">{hints.map((h, i) => <li key={i} className="rounded-md bg-black/40 border border-[#262824] p-3"><span className="text-[#e8b33d] font-code text-xs">HINT {i + 1}</span><p className="mt-1 leading-6">{h}</p></li>)}</ol>
          )}
          <p className="text-xs text-[#8a877d] mt-4">Limited to {ch.maxPrompts} prompts — form a hypothesis first.</p>
        </div>
      </div>
    </div>
  );
}
