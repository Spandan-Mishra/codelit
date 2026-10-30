// Server-side workspace safety for native attempts: the relay only ever
// handles ONE solution file per attempt (single-file MVP). Path traversal,
// absolute paths, and oversized snapshots are rejected before any byte is
// accepted or evaluated. Hidden tests and unreleased stages never leave the
// server; only released requirement text is synced down.

import { createHash } from "node:crypto";

export const SOLUTION_FILE = "solution";
export const MAX_SNAPSHOT_CHARS = 60_000;

export function solutionHash(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export function snapshotHash(source: string, language: string): string {
  return createHash("sha256").update(`${language}\n${source}`, "utf8").digest("hex");
}

/** The only relative path a connector may report or upload for an attempt. */
export function checkAttemptPath(rel: unknown, language: string): { ok: boolean; error?: string } {
  if (typeof rel !== "string") return { ok: false, error: "Bad path." };
  const ext = language === "python" ? ".py" : language === "c++" ? ".cpp" : ".js";
  if (rel !== `${SOLUTION_FILE}${ext}`) {
    return { ok: false, error: `Only ${SOLUTION_FILE}${ext} is part of this attempt.` };
  }
  return { ok: true };
}

export function checkSnapshot(source: unknown): { ok: boolean; error?: string; source?: string } {
  if (typeof source !== "string") return { ok: false, error: "Snapshot must be text." };
  if (source.length === 0) return { ok: false, error: "Snapshot is empty." };
  if (source.length > MAX_SNAPSHOT_CHARS) {
    return { ok: false, error: `Snapshot exceeds ${MAX_SNAPSHOT_CHARS} chars.` };
  }
  return { ok: true, source };
}

/** Starter + released requirements the connector may place in the workspace. */
export function releasedContext(args: {
  title: string;
  stage: number;
  brief: string;
  fnName: string;
  language: string;
  stub: string;
  visibleTests: { input: string; expected: string }[];
}): Record<string, unknown> {
  return {
    title: args.title,
    stage: args.stage,
    brief: args.brief,
    fnName: args.fnName,
    language: args.language,
    stub: args.stub,
    visibleTests: args.visibleTests,
  };
}
