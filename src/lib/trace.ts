// Trace recorder (phase 1): validates agent-assisted attempt events and
// scores trace efficiency. A finished attempt with zero prompts is capped
// at 30 — pasted, unassisted code is untrusted until defended.

import type { AgentAttempt, TraceEvent, TraceEventKind } from "./types";
import { getScenario, STAGE_COUNT } from "./scenarios";

export const PROMPT_BUDGET = 12;
export const MAX_EVENT_TEXT = 20_000; // code snapshot size cap
export const MAX_PROMPT_TEXT = 4_000;
export const MAX_STAGE_TEXT = 1_000;
export const MAX_EVENTS = 200;
export const MAX_T_SEC = 24 * 3600;

const KINDS: TraceEventKind[] = ["prompt", "code", "run", "stage", "hint"];

export function countKind(events: TraceEvent[], kind: TraceEventKind): number {
  return events.filter((e) => e.kind === kind).length;
}

// Stage events carry the stage number in text ("2", "stage 2", ...).
export function parseStageNumber(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.match(/\d+/);
  return m ? Number(m[0]) : null;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateEvent(attempt: AgentAttempt, event: TraceEvent): ValidationResult {
  if (attempt.status !== "active") return { ok: false, error: `Attempt is ${attempt.status} — events are closed.` };
  if (attempt.events.length >= MAX_EVENTS) return { ok: false, error: `Event cap reached (${MAX_EVENTS}).` };

  if (!Number.isFinite(event.t) || event.t < 0 || event.t > MAX_T_SEC) {
    return { ok: false, error: "Event t must be seconds since start (0..24h)." };
  }
  const last = attempt.events[attempt.events.length - 1];
  if (last && event.t < last.t) return { ok: false, error: "Event t went backwards — timestamps must be monotonic." };

  if (!KINDS.includes(event.kind)) return { ok: false, error: "Unknown event kind." };

  const len = event.text?.length ?? 0;
  if (event.kind === "prompt" || event.kind === "hint") {
    if (len === 0 || len > MAX_PROMPT_TEXT) {
      return { ok: false, error: `Prompt/hint text must be 1..${MAX_PROMPT_TEXT} chars.` };
    }
  } else if (event.kind === "code") {
    if (len > MAX_EVENT_TEXT) return { ok: false, error: `Code snapshot exceeds ${MAX_EVENT_TEXT} chars.` };
  } else if (len > MAX_STAGE_TEXT) {
    return { ok: false, error: `Stage/run note exceeds ${MAX_STAGE_TEXT} chars.` };
  }

  if (event.kind === "prompt" && countKind(attempt.events, "prompt") >= PROMPT_BUDGET) {
    return { ok: false, error: `Prompt budget exhausted (${PROMPT_BUDGET}).` };
  }

  if (event.kind === "run" && typeof event.passed !== "boolean") {
    return { ok: false, error: "Run events require a passed boolean." };
  }
  if (event.kind === "code" && event.linesChanged !== undefined && !Number.isFinite(event.linesChanged)) {
    return { ok: false, error: "linesChanged must be a finite number." };
  }

  if (event.kind === "stage") {
    const n = parseStageNumber(event.text);
    if (n === null || n < 1 || n > STAGE_COUNT) {
      return { ok: false, error: `Stage event must name a stage 1..${STAGE_COUNT}.` };
    }
    if (n < attempt.stageUnlocked) return { ok: false, error: "Stage order went backwards." };
    if (n > attempt.stageUnlocked + 1) return { ok: false, error: "Cannot skip a stage." };
    if (n === attempt.stageUnlocked + 1) {
      // Drip-feed gate: the current stage's sample must pass first.
      const lastStageIdx = attempt.events.map((e) => e.kind).lastIndexOf("stage");
      const since = attempt.events.slice(lastStageIdx + 1);
      const passedRun = since.some((e) => e.kind === "run" && e.passed === true);
      if (!passedRun) {
        return { ok: false, error: `Pass a run at stage ${attempt.stageUnlocked} before unlocking stage ${n}.` };
      }
    }
  }

  return { ok: true };
}

// Revert episodes: failed runs after a pass (regression). Consecutive fails
// count as one episode until the next pass. Returns 1-based step numbers.
export function findReverts(events: TraceEvent[]): number[] {
  const steps: number[] = [];
  let seenPass = false;
  let inEpisode = false;
  events.forEach((e, i) => {
    if (e.kind !== "run") return;
    if (e.passed) {
      seenPass = true;
      inEpisode = false;
    } else if (seenPass && !inEpisode) {
      inEpisode = true;
      steps.push(i + 1);
    }
  });
  return steps;
}

export interface EfficiencyScore {
  promptsUsed: number;
  promptPar: number;
  timeUsedSec: number;
  timeParSec: number;
  reverts: number;
  score0_100: number;
}

export function efficiencyScore(attempt: AgentAttempt): EfficiencyScore {
  const promptsUsed = countKind(attempt.events, "prompt");
  const timeUsedSec = attempt.events.length
    ? Math.max(0, Math.round(attempt.events[attempt.events.length - 1].t - attempt.events[0].t))
    : 0;
  const reverts = findReverts(attempt.events).length;

  const scenario = getScenario(attempt.scenarioId);
  const promptPar = scenario?.promptPar ?? PROMPT_BUDGET;
  const timeParSec = (scenario?.timePar ?? 20) * 60;
  const promptPenalty = Math.min(35, promptsUsed * 5);
  const timePenalty = timeUsedSec > timeParSec ? Math.min(25, Math.round(((timeUsedSec - timeParSec) / timeParSec) * 25)) : 0;
  const revertPenalty = Math.min(20, reverts * 10);
  let score = Math.max(0, Math.min(100, 100 - promptPenalty - timePenalty - revertPenalty));

  // Untrusted until defended: a finished trace with zero agent prompts
  // reads as pasted code, so it cannot score above 30 on trace alone.
  if (attempt.status === "finished" && promptsUsed === 0) score = Math.min(score, 30);

  return { promptsUsed, promptPar, timeUsedSec, timeParSec, reverts, score0_100: score };
}

// One-liner for the defense round, e.g. "3 prompts, 1 revert at step 4,
// solved in 6m". Round-2 questions reference the revert/decision point.
export function summarizeTrace(attempt: AgentAttempt): string {
  const s = efficiencyScore(attempt);
  const mins = Math.max(1, Math.round(s.timeUsedSec / 60));
  const revertSteps = findReverts(attempt.events);
  const revertPart =
    revertSteps.length === 0
      ? "no reverts"
      : `${revertSteps.length} revert${revertSteps.length === 1 ? "" : "s"} at step ${revertSteps[0]}`;
  const verb = attempt.status === "finished" ? "solved" : "in progress";
  return `${s.promptsUsed} prompts, ${revertPart}, ${verb} in ${mins}m`;
}
