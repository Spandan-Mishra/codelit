// Attempt execution is independent of CLI/process lifecycle for offline tests.
import { promises as fs } from "node:fs";
import {
  applyBrowserEdit, attemptDir, initAttempt, readSolution, recordAgentWrite,
  runVisible, safeJoin, setInFlight, solutionName,
} from "./workspace.mjs";

const TERMINAL = new Set(["turn.completed", "turn.failed", "turn.interrupted"]);

export function buildCodingPrompt(context, request, contexts = [context]) {
  const file = solutionName(context.language);
  return [
    "You are implementing a Codelit coding challenge in this workspace.",
    `Required artifact: ${file}. Read TASK.md and ${file}, then implement the request by editing ${file} with your file/shell tools.`,
    "Do not answer with code only in chat: chat text is not submitted. Preserve the required function interface and earlier stage behavior. Do not edit meta.json or TASK.md. Run available visible checks when useful. Finish with a short summary after saving the file.",
    `Language: ${context.language}. Required function: ${context.fnName || "use the solution stub"}. Current stage: ${context.stage}.`,
    "Released challenge context:",
    ...contexts.map((c) => `# ${c.title || "Challenge"} — stage ${c.stage}\n${c.brief || ""}\nVisible tests:\n${JSON.stringify(c.visibleTests || [])}`),
    "User request:", String(request || ""),
  ].join("\n\n");
}

function validateBrowserEdit(code) {
  if (typeof code !== "string" || code.length > 60000 || JSON.stringify({ rev: Number.MAX_SAFE_INTEGER, hash: "0".repeat(64), content: code, human: true, conflict: false }).length > 70000) throw new Error("Browser edit exceeds the complete source/revision limit");
}

export function createAttemptRuntime({ adapters, sessions, deviceId, queue, uploadSnapshot, saveSessions, getCapabilities }) {
  let eventTail = Promise.resolve();
  let stopping = false;
  let shutdownPending;
  const blockedAttempts = new Map();
  const attemptStops = new Map();
  const inferenceStarted = new WeakSet();
  const ctxFor = (attemptId) => {
    const s = sessions[attemptId] || {};
    return { attemptId, deviceId: s.deviceId || deviceId, sessionEpoch: s.sessionEpoch, adapter: s.adapter || null, threadId: s.threadId || null, turnId: s.inFlight || null, model: s.model || null };
  };
  async function emit(attemptId, type, payload = {}, extra = {}) {
    const ctx = ctxFor(attemptId);
    // Count JSON escaping too; never silently publish shortened user text.
    const maxPayload = type === "file.revision" ? 70000 : type === "prompt.forwarded" ? 40000 : type === "message.final" ? 32000 : 8000;
    if (JSON.stringify(payload).length > maxPayload) throw new Error(`${type} exceeds its relay payload limit`);
    await queue({
      v: 1, id: `ev_${crypto.randomUUID()}`, attemptId, deviceId: ctx.deviceId,
      ...(ctx.sessionEpoch !== undefined ? { sessionEpoch: ctx.sessionEpoch } : {}),
      nativeSessionId: ctx.threadId, turnId: ctx.turnId, parentId: null,
      type, source: "connector", sourceSeq: -1, sourceTime: Date.now(),
      adapter: ctx.adapter, model: ctx.model, payload, ...extra,
    });
  }
  async function revision(attemptId, extra = {}, turnId) {
    const s = sessions[attemptId];
    const r = await readSolution(attemptDir(attemptId), s.context.language);
    const payload = { rev: r.rev, hash: r.hash, content: r.content, ...extra };
    if (r.content.length > 60000 || JSON.stringify(payload).length > 70000) {
      await emit(attemptId, "message.final", { text: "Solution exceeds the 60,000-character source or 70,000-character event limit. Shorten the file before syncing or finishing; no partial revision was published.", error: true, code: "solution_too_large" }, turnId ? { turnId } : {});
      return;
    }
    await emit(attemptId, "file.revision", payload, turnId ? { turnId } : {});
  }

  async function contextFor(attemptId, incoming) {
    const s = sessions[attemptId];
    if (incoming) {
      if (s.context?.language && incoming.language && incoming.language !== s.context.language) throw new Error("Cannot change an existing attempt's language");
      s.context = { ...s.context, ...incoming };
    }
    const context = s.context;
    if (!context || !["python", "javascript", "c++"].includes(context.language)) throw new Error("Missing or unsupported challenge language");
    const released = new Map((s.contexts || []).map((c) => [c.stage, c]));
    released.set(context.stage, context);
    s.contexts = [...released.values()].sort((a, b) => a.stage - b.stage);
    await fs.writeFile(await safeJoin(attemptDir(attemptId), "TASK.md"), buildCodingPrompt(context, "Implement the user's request in the solution file.", s.contexts));
    return context;
  }
  function onEvent(ev) {
    eventTail = eventTail.then(async () => {
      const entry = Object.entries(sessions).find(([, s]) => s?.threadId === ev.nativeSessionId);
      if (!entry) return;
      const [attemptId, s] = entry;
      if (s.deviceId && s.deviceId !== deviceId) return;
      if (ev.turnId && ev.turnId !== s.inFlight) return;
      if (ev.model) s.model = ev.model;
      const turnId = ev.turnId || s.inFlight;
      // Terminal/tool notifications are serialized with file revision updates.
      if (ev.type === "tool.completed" || TERMINAL.has(ev.type)) {
        const wr = await recordAgentWrite(attemptDir(attemptId), s.context.language);
        // Always republish the authoritative snapshot before a terminal. The
        // previous tool revision may have been pending during an outage.
        if (wr.changed || TERMINAL.has(ev.type)) await revision(attemptId, {}, turnId);
      }
      let type = ev.type;
      let payload = ev.payload || {};
      if (TERMINAL.has(type)) {
        if (!s.inFlight || turnId !== s.inFlight) return;
        const sol = await readSolution(attemptDir(attemptId), s.context.language);
        if (type === "turn.completed" && sol.hash === s.beforeHash) {
          const warning = `The solution file ${solutionName(s.context.language)} is unchanged after this turn. If you requested code, ask the agent to edit that file with its tools: code in chat is not submitted. Check denied tools or workspace permissions in the trace. Explanation-only turns may leave the file unchanged.`;
          payload = { ...payload, solutionChanged: false, code: "solution_unchanged", warning };
          await emit(attemptId, "message.final", { text: warning, warning: true, code: "solution_unchanged" }, { turnId });
        }
        await emit(attemptId, type, payload, { turnId });
        s.inFlight = null;
        await setInFlight(attemptDir(attemptId), null);
        await saveSessions(sessions);
      } else await emit(attemptId, type, payload, { turnId: turnId || null, ...(ev.model ? { model: ev.model } : {}) });
    }).catch(async (error) => {
      console.error("[runtime] event processing failed:", error.message);
      // A deleted/unreadable solution must not leave the UI running forever.
      // Tool-stage read failures can be transient while an editor replaces a
      // file; terminal failures need an explicit actionable outcome.
      if (!TERMINAL.has(ev.type)) return;
      const entry = Object.entries(sessions).find(([, s]) => s?.threadId === ev.nativeSessionId);
      if (!entry) return;
      const [attemptId, s] = entry;
      if (!s.inFlight) return;
      const turnId = s.inFlight;
      await emit(attemptId, "turn.failed", { code: "solution_read_error", error: `Cannot read or record the saved solution after this turn. Restore ${solutionName(s.context.language)} and check local workspace permissions before continuing.` }, { turnId }).catch(() => {});
      s.inFlight = null;
      await setInFlight(attemptDir(attemptId), null).catch(() => {});
      await saveSessions(sessions);
    });
    return eventTail;
  }
  for (const adapter of Object.values(adapters)) adapter.onEvent(onEvent);

  async function ensureAdapter(name, model) {
    const adapter = adapters[name];
    if (!adapter) throw new Error(`Unsupported agent adapter: ${name}`);
    const caps = getCapabilities ? await getCapabilities(name) : await adapter.capabilities();
    if (stopping) throw new Error("Connector is shutting down");
    if (!caps?.ready) throw new Error(caps?.message || "Agent readiness has not been established; run connector status");
    if (model && !caps.models?.some((m) => m.id === model)) throw new Error("Selected model is not in the installed runtime catalog. Refresh the connection and select an available model.");
    return adapter;
  }
  async function handle(cmd) {
    await eventTail;
    const p = cmd.payload || {};
    const attemptId = cmd.attemptId;
    const dir = attemptDir(attemptId);
    let s = sessions[attemptId];
    if (stopping) throw new Error("Connector is shutting down; reconnect before starting work");
    if (blockedAttempts.has(attemptId)) throw new Error("Session execution lease ended; reconnect its browser before continuing");
    const transferGranted = cmd.type === "session.start" && s?.deviceId && s.deviceId !== deviceId && p.transferFromDeviceId === s.deviceId;
    if (s?.deviceId && s.deviceId !== deviceId && !transferGranted) throw new Error("Attempt belongs to a prior device; request browser-authorized transfer or re-pair / recover with a new session");
    const epoch = cmd.sessionEpoch ?? p.sessionEpoch;
    if (cmd.type !== "session.start" && s?.sessionEpoch !== undefined && epoch !== s.sessionEpoch) throw new Error("Stale session epoch");
    if (cmd.type === "session.start") {
      if (s?.inFlight) throw new Error("Cannot replace or transfer an agent while a turn is active; stop and reconcile it first");
      const name = p.adapter || "codex";
      const model = p.model || process.env.CODELIT_MODEL || null;
      const adapter = await ensureAdapter(name, model);
      await initAttempt(dir, p.context || {});
      if (stopping) throw new Error("Connector is shutting down");
      // Start first; a failed replacement leaves the previous session intact.
      const started = await adapter.start({ cwd: dir, model });
      const old = s;
      s = { ...s, deviceId, sessionEpoch: epoch, adapter: name, selectedModel: model, model: started.model || model, threadId: started.nativeSessionId, context: p.context || s?.context, inFlight: null };
      sessions[attemptId] = s;
      await contextFor(attemptId);
      await saveSessions(sessions);
      if (old?.threadId) await adapters[old.adapter]?.close(old.threadId);
      await emit(attemptId, "session.replaced", { model: s.model, adapter: name, ...(transferGranted ? { transferFromDeviceId: old.deviceId } : {}) });
      await recordAgentWrite(dir, s.context.language);
      await revision(attemptId, { initial: true });
      return;
    }
    if (cmd.type === "turn.interrupt") {
      const pending = Array.isArray(p.pendingTurnIds) ? [...new Set(p.pendingTurnIds.filter((id) => typeof id === "string" && id))] : [];
      for (const turnId of pending) {
        if (turnId !== s?.inFlight) {
          await emit(attemptId, "turn.interrupted", { reason: "cancelled before local execution / no running native turn" }, { turnId });
        }
      }
      // A delivered command can be lost before even creating a local session.
      // Stop must still release its reservation, without executing its prompt.
      if (!s?.inFlight || (pending.length && !pending.includes(s.inFlight))) return;
      const adapter = adapters[s.adapter];
      if (!adapter) throw new Error("Attempt uses an unsupported adapter; reconnect with a ready agent");
      return adapter.interrupt(s.threadId);
    }
    if (!s) throw new Error("No local session for this attempt. Reconnect its agent to create a session.");
    const adapter = adapters[s.adapter];
    if (!adapter) throw new Error("Attempt uses an unsupported adapter; reconnect with a ready agent");
    if (cmd.type === "context.sync") {
      await contextFor(attemptId, p.context);
      await saveSessions(sessions);
      // Delivered to workspace; next actual coding turn includes it in input.
      await emit(attemptId, "context.delivered", { stage: s.context.stage, delivery: "workspace", nextTurnIncludesContext: true });
      return;
    }
    if (cmd.type === "human.edit") {
      if (s.inFlight) throw new Error("Wait for the agent to stop before editing");
      validateBrowserEdit(p.code);
      if (!Number.isInteger(p.baseRev)) throw new Error("Invalid browser edit base revision");
      const result = await applyBrowserEdit(dir, s.context.language, p.code, p.baseRev);
      const sol = await readSolution(dir, s.context.language);
      await revision(attemptId, { human: true, conflict: !!result.conflict });
      await emit(attemptId, result.conflict ? "human.edit.conflict" : "human.edit.ack", { editId: p.editId || cmd.id, rev: sol.rev, hash: sol.hash });
      return;
    }
    if (cmd.type === "turn.send") {
      if (s.inFlight) throw new Error("Another turn is already active. Wait or interrupt it first.");
      if (p.adapter && p.adapter !== s.adapter) throw new Error("Agent selection changed without a session.start; reconnect the selected provider");
      // Selection intent is separate from the model resolved by thread/start.
      // A native/configured default can legitimately be absent from model/list.
      const model = p.model || s.selectedModel || null;
      await ensureAdapter(s.adapter, model);
      const context = await contextFor(attemptId, p.context);
      if (p.stage && p.stage !== context.stage) throw new Error("Stage context is out of sync. Reconnect before sending this turn.");
      if (p.pendingEdit) {
        validateBrowserEdit(p.pendingEdit.code);
        const r = await applyBrowserEdit(dir, context.language, p.pendingEdit.code, p.pendingEdit.baseRev);
        if (r.conflict) {
          await revision(attemptId, { conflict: true });
          throw new Error("Editor revision conflict. Your edit was not applied; review the current solution and send again.");
        }
        await revision(attemptId);
      }
      if (stopping) throw new Error("Connector is shutting down");
      if (adapter.state(s.threadId) === "closed" || adapter.state(s.threadId) === "failed") {
        const resumed = await adapter.resume(s.threadId, { cwd: dir, model });
        s.model = resumed?.model || model || s.model;
      }
      s.selectedModel = model;
      s.model = model || s.model;
      s.inFlight = p.turnId;
      s.beforeHash = (await readSolution(dir, context.language)).hash;
      await setInFlight(dir, s.inFlight);
      await saveSessions(sessions);
      await emit(attemptId, "prompt.forwarded", { text: String(p.text || ""), stage: context.stage, solution: solutionName(context.language), model: s.model });
      await emit(attemptId, "context.delivered", { stage: context.stage, delivery: "turn" });
      if (stopping || blockedAttempts.has(attemptId)) throw new Error("Execution lease ended before inference");
      inferenceStarted.add(cmd);
      await adapter.turn(s.threadId, buildCodingPrompt(context, p.text, s.contexts), { turnId: p.turnId, model });
      return;
    }
    if (cmd.type === "approval.decide") return adapter.decideApproval(s.threadId, String(p.approvalId || ""), String(p.decision || "deny"));
    if (cmd.type === "test.run") {
      const r = await runVisible(dir, s.context.language, s.context.visibleTests || [], s.context.fnName);
      await emit(attemptId, "local.command", { cmd: "visible checks", ...(r.unavailable ? { unavailable: true } : { passed: r.passed === r.total }), summary: r.summary });
      return;
    }
    if (cmd.type === "freeze.request") {
      if (!p.freezeId || epoch === undefined || !Number.isInteger(p.expectedRevision) || typeof p.expectedHash !== "string") throw new Error("Freeze requires an explicit generation and expected revision/hash");
      if (s.inFlight) {
        await adapter.interrupt(s.threadId);
        const deadline = Date.now() + 20000;
        while (s.inFlight && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          await eventTail;
        }
        if (s.inFlight) throw new Error("Agent is still writing. Wait for its interrupt to complete before finishing.");
      }
      await recordAgentWrite(dir, s.context.language);
      const sol = await readSolution(dir, s.context.language);
      if (!sol.content.trim()) throw new Error("Nothing to submit: the solution file is empty. Ask the agent to edit it first.");
      if (sol.content.length > 60000) throw new Error("Solution exceeds the 60,000-character source limit. Shorten the file before finishing.");
      if (sol.rev !== p.expectedRevision || sol.hash !== p.expectedHash) throw new Error("Freeze revision/hash changed; review the current solution and retry Finish");
      await revision(attemptId);
      const result = await uploadSnapshot(attemptId, { freezeId: p.freezeId, sessionEpoch: epoch, expectedRevision: p.expectedRevision, expectedHash: p.expectedHash, hash: sol.hash, path: solutionName(s.context.language), source: sol.content, language: s.context.language, revision: sol.rev });
      if (result.status !== 200) throw new Error(`Snapshot upload failed (${result.status}); retry Finish.`);
      return;
    }
    throw new Error(`Unknown command ${cmd.type}`);
  }
  async function onCommand(cmd) {
    try { return await handle(cmd); }
    catch (error) {
      const attemptId = cmd.attemptId;
      const s = sessions[attemptId];
      const message = error.message || "Local connector command failed";
          if (cmd.type === "turn.send") {
        await emit(attemptId, "turn.failed", { code: "connector_execution_error", error: message, phase: inferenceStarted.has(cmd) ? "execution" : "preflight", inferenceStarted: inferenceStarted.has(cmd) }, { turnId: cmd.payload?.turnId || null, ...((cmd.sessionEpoch ?? cmd.payload?.sessionEpoch) !== undefined ? { sessionEpoch: cmd.sessionEpoch ?? cmd.payload.sessionEpoch } : {}) });
        if (s?.inFlight === cmd.payload?.turnId) {
          s.inFlight = null;
          await setInFlight(attemptDir(attemptId), null);
          await saveSessions(sessions);
        }
      } else {
        if (cmd.type === "human.edit" && s?.context?.language) {
          const sol = await readSolution(attemptDir(attemptId), s.context.language);
          await emit(attemptId, "human.edit.conflict", { editId: cmd.payload?.editId || cmd.id, rev: sol.rev, hash: sol.hash });
        }
        await emit(attemptId, "message.final", { text: message, error: true, command: cmd.type });
      }
      throw error;
    }
  }
  async function recover() {
    // Recovery only republishes saved bytes and resolves stranded UI state;
    // it never starts, resumes or repeats inference.
    for (const [attemptId, s] of Object.entries(sessions)) {
      if (!s || (s.deviceId && s.deviceId !== deviceId)) continue;
      if (s.inFlight) {
        s.recoveredTurnIds = [...(s.recoveredTurnIds || []), s.inFlight].slice(-100);
        await onEvent({ nativeSessionId: s.threadId, turnId: s.inFlight, type: "turn.failed", payload: { code: "connector_restarted", completion: "unknown", inferenceStarted: true, phase: "reconcile", error: "connector restarted mid-turn; the prompt was not auto-resent" } });
      } else if (s.context?.language) {
        try {
          await recordAgentWrite(attemptDir(attemptId), s.context.language);
          await revision(attemptId);
        } catch {
          await emit(attemptId, "message.final", { error: true, code: "solution_read_error", text: "Cannot sync the saved solution after connector restart. Restore the solution file and check local workspace permissions before continuing." });
        }
      }
    }
  }
  async function reconcile(cmd, outcome = {}) {
    // An executing durable record is uncertain, even if no local inFlight
    // survived. Surface the outcome; never replay a prompt or session start.
    const alreadyRecovered = sessions[cmd.attemptId]?.recoveredTurnIds?.includes(cmd.payload?.turnId);
    await emit(cmd.attemptId, cmd.type === "turn.send" && !alreadyRecovered ? "turn.failed" : "message.final", {
      code: "command_reconciliation_required", error: "Connector restarted during command execution; outcome unknown. Review saved work before retrying.",
      text: "Command outcome unknown after restart; explicit reconciliation required.", phase: outcome.inferenceStarted === false ? "preflight" : "reconcile", inferenceStarted: outcome.inferenceStarted ?? (cmd.type === "turn.send"), completion: "unknown", commandId: cmd.id, reason: outcome.reason || "restart",
    }, { turnId: alreadyRecovered ? null : cmd.payload?.turnId || null, ...((cmd.sessionEpoch ?? cmd.payload?.sessionEpoch) !== undefined ? { sessionEpoch: cmd.sessionEpoch ?? cmd.payload.sessionEpoch } : {}) });
  }
  function stopAttempt(attemptId, sessionEpoch, reason = "session execution lease expired") {
    const s = sessions[attemptId];
    if (!s || s.sessionEpoch !== sessionEpoch || (s.deviceId && s.deviceId !== deviceId)) return Promise.resolve();
    blockedAttempts.set(attemptId, sessionEpoch);
    const key = `${attemptId}:${sessionEpoch}`;
    if (attemptStops.has(key)) return attemptStops.get(key);
    const operation = (async () => {
      await adapters[s.adapter]?.close(s.threadId);
      await eventTail;
      if (s.inFlight) {
        await emit(attemptId, "turn.failed", { code: "execution_lease_expired", error: reason, completion: "unknown", inferenceStarted: true });
        s.inFlight = null;
        await setInFlight(attemptDir(attemptId), null);
        await saveSessions(sessions);
      }
    })();
    attemptStops.set(key, operation);
    return operation;
  }
  async function renewAttempt(attemptId, sessionEpoch) {
    const key = `${attemptId}:${sessionEpoch}`;
    if (attemptStops.has(key)) await attemptStops.get(key);
    if (blockedAttempts.get(attemptId) === sessionEpoch || sessions[attemptId]?.sessionEpoch !== sessionEpoch) blockedAttempts.delete(attemptId);
    attemptStops.delete(key);
  }
  function shutdown(reason = "connector shutdown") {
    stopping = true;
    return shutdownPending ||= (async () => {
      // Adapter shutdown owns bounded interrupt + process-group containment.
      const closed = await Promise.allSettled(Object.values(adapters).map(async (adapter) => {
        if (adapter.shutdown) return adapter.shutdown(reason);
        const owned = Object.values(sessions).filter((s) => s?.adapter && adapters[s.adapter] === adapter && (!s.deviceId || s.deviceId === deviceId));
        await Promise.all(owned.map(async (s) => { try { if (s.inFlight) await adapter.interrupt(s.threadId); } finally { await adapter.close(s.threadId); } }));
      }));
      for (const result of closed) if (result.status === "rejected") console.error("[runtime] adapter shutdown failed:", result.reason?.message || result.reason);
      await eventTail;
      for (const [attemptId, s] of Object.entries(sessions)) {
        if (!s?.inFlight || (s.deviceId && s.deviceId !== deviceId)) continue;
        await emit(attemptId, "turn.failed", { code: "connector_shutdown", error: reason, completion: "unknown", inferenceStarted: true });
        s.inFlight = null;
        await setInFlight(attemptDir(attemptId), null);
      }
      await saveSessions(sessions);
    })();
  }
  return { onCommand, onEvent, reconcile, shutdown, stopAttempt, renewAttempt, drain: () => eventTail, revision, recover };
}
