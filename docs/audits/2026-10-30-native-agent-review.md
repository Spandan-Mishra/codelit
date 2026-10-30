# Codelit native-agent audit and product direction

Reviewed 2026-10-30. Baseline: commit `6471c4d` plus the existing uncommitted connector/native-workflow changes. This review covers the working tree, not just committed code. The planning thread's latest implementation summary reported 29 passing connector tests and an end-to-end Codex run; those improvements were considered rather than assuming the earlier audit still described everything.

Target thread: **Plan Codelit for the Developer Hackathon**, `215b73cb-ac34-4409-9533-6e43b23489d8`.

## Outcome

The local-connector direction matches the user's requirement: bring a native agent into the website and remain there while solving. The implementation has real improvements: owned native attempt IDs, discovered model catalogs, structured agent control, retained source revisions, gated stages, and independent acceptance of frozen bytes.

The next priorities are trustworthy lifecycle handling and an actual pair-programming learning loop. Today the native path delegates all edits to the agent, imposes the scenario's prompt par as a hard cap, and ends at acceptance without the defense/passport connection. Several concurrency/recovery boundaries still admit contradictory state despite the passing baseline tests.

**No application source was changed by this audit.** The reviewer ran checks and disposable probes, then added this report. Existing uncommitted source changes must be preserved by the fixing thread.

## Verification and limits

Passed on the reviewed working tree:

- `npm --prefix connector test`: all 29 tests passed.
- `npm run lint`.
- `npx tsc --noEmit`.
- `npm run build`.
- `CODELIT_TEST_URL=http://127.0.0.1:3107 node scripts/native-api-check.mjs`: existing API regression flow passed.

Additional API tests used a separate production server on port 3107 with a disposable `CODELIT_NATIVE_DATA_DIR`. Synthetic devices advertised a fixture model and supplied events; no actual agent/provider inference was requested. Adapter checks used an injected mock RPC; local file/queue probes used temporary directories. Browser inspection targeted the disposable server. Existing demo data and the user's running server on port 3000 were not used for mutations.

This is a bounded functional/adversarial audit, not a saturation load test or a renewed certification of live account/model access. Findings explicitly separate runtime reproduction from inspection and product recommendations.

## Findings and requested fixes

### F01 — P0: native acceptance still executes candidate code with server privileges

Evidence: `src/lib/exec.ts`, especially `runJs`; imports in `src/app/api/native/session/route.ts`; `Dockerfile`.

Runtime reproduction against the isolated server: submitting `function probe(){return typeof process}` to `/api/run` returned `"object"`. JavaScript still uses synchronous `new Function` in the serving process without an execution timeout. Python/C++ run with inherited host permissions/environment. The native path now calls these same runners for visible checks and final acceptance. Earlier comparator and stdout fixes do not close the execution boundary.

Impact: untrusted submissions can access the serving process or host; an accidental JS infinite loop can block it. Containerizing the entire application is not per-submission isolation.

Fix: move candidate execution into a disposable, resource-limited service with no provider credentials, restricted filesystem/network, and hard termination. Separate process timeout alone is useful containment but not a full security boundary. Restrict public execution until contained. `.dockerignore` also does not exclude `.env*` or data while Docker uses `COPY . .`; exclude local secrets and runtime records before building an image.

Acceptance: all languages have a measured wall-clock limit and cannot read an application-owned sentinel or inherit evaluator/model secrets; the web process remains responsive during a looping submission. Use synthetic sentinels, never actual secrets.

### F02 — P1: an old native terminal event can complete the current turn

Evidence: `connector/lib/codex.mjs`, `routeNotification`, approximately lines 260–310.

Runtime reproduction with injected RPC: start browser turn 1/native turn 1, complete it, start browser turn 2/native turn 2, then deliver a delayed duplicate completion for native turn 1. The adapter emits `turn.completed` for **browser turn 2** and becomes idle. It checks whether any logical turn exists, not whether the event belongs to the active native turn. Tool/message events similarly lack complete native item/turn correlation.

Impact: Codelit can unlock the editor/evaluation path or spend/release the wrong reservation while the real current agent is still active.

Fix: maintain explicit native-turn to logical-turn identity and reject/quarantine stale terminal events. Correlate items and approvals too; thread identity alone is insufficient. Reconcile start notifications that precede the start response.

Acceptance: duplicate/delayed events for the previous turn cannot mutate the next turn; actual completion is processed once. Add an offline regression with the exact sequence above.

### F03 — P1: command delivery is at-most-once, while browser operations lack durable idempotency

Evidence: `src/lib/native/registry.ts:217`, `connector/lib/relay.mjs:161`, and native session `start`/`send` handlers.

Runtime reproductions:

1. Poll returned `session.start`; discard the response without acknowledgement. The next poll returned no commands. The server marks commands delivered before HTTP receipt and has no delivery lease/reconciliation path for that state.
2. Send a request with `requestId: stable-request`, finish its synthetic turn, and repeat the same request ID. The API created a different turn and accepted it again. Start also creates a fresh attempt each time rather than binding a client operation ID.

Manual Stop can release certain stranded turns, which is an improvement, but does not make dropped session/context/freeze commands recover automatically. The connector's handled-command set is memory-only and is not a durable inference-start ledger.

Fix: persistent client operation IDs, command delivery leases, durable connector receipt/execution records, and reconciliation before redelivery of uncertain inference. Do not solve loss by blindly resending prompts. Distinguish received, executing, completed, and acknowledged states.

Acceptance: lose each relevant response before/after server commit and connector receipt; recover one attempt/session/turn with no duplicate inference and no permanently stranded command.

### F04 — P1: one pairing code can issue two credentials concurrently

Evidence: `src/app/api/native/pair/route.ts:69`, `src/lib/native/registry.ts:68`.

Runtime reproduction: two simultaneous `claim` POSTs using the same newly issued pairing code both returned HTTP 200 with different device IDs. Ticket lookup is synchronous, but consumption occurs only after awaiting device persistence, allowing both callers through.

Fix: atomically reserve/consume the ticket before asynchronous registration, with defined failure recovery. Keep the single-use property across the deployed persistence model. Do not merely add a browser button guard.

Acceptance: concurrent claims produce exactly one credential. A failed persistence attempt cannot create an unknown second owner or silently reuse an already consumed authorization.

### F05 — P1: a cancelled freeze can supply the snapshot for a newer freeze

Evidence: native session `finish`/`reopen` and native relay `snapshot`, approximately `session/route.ts:277–307`, `relay/route.ts:108–130`.

Runtime reproduction: release all stages with verified visible tests; request freeze A; reopen; publish source revision 2; request freeze B; upload revision 1 from A. Upload returned 200, and finish B evaluated the old bytes successfully. The hash correctly describes those bytes, but no freeze generation/request ID binds them to B. Snapshot revision is not checked against the intended generation.

Fix: issue a unique freeze/submission generation with the intended session and revision/hash policy. Include it in command, upload, and evaluation; cancel pending generations on reopen. Reject delayed uploads from cancelled or superseded freezes.

Acceptance: freeze A's response cannot satisfy B, including across connector restart, command replay, and reopen. The exact bytes the user approved for the current finish are the evaluated artifact.

### F06 — P1: connector event types and lifecycle effects are insufficiently authorized

Evidence: `src/lib/native/protocol.ts`, `src/app/api/native/relay/route.ts:62–93`, and native UI check rendering.

Runtime reproductions:

- A normal paired connector uploaded `official.test` with 99/99 passing; the API accepted it. `source` is forced to connector, which is good, but the UI primarily interprets the type and does not consistently enforce/display its authority.
- An event `turn.completed` with a never-issued turn ID was accepted and incremented `turnsUsed` from 2 to 3.

This does not directly forge the endpoint's independently banked acceptance record. It can forge visible official-looking activity and corrupt budgets/state. Old sessions can also emit lifecycle events without matching a current command/session epoch.

Fix: a strict connector event allowlist; per-event payload schemas; session/generation/issued-turn validation; server-owned lifecycle effects based on known reservations; visible provenance. Reserve `official.*` and `prompt.accepted` for the backend. Source timestamps remain reports.

Acceptance: unknown/old/terminal-replayed turns cannot alter current state or counters; connector `official.*` is rejected; UI never displays connector assertions as independent checks.

### F07 — P1: one rejected replay event can block all future attempts, and device re-pairing is incomplete

Evidence: `connector/lib/relay.mjs:131–152`, `connector/bin/codelit-connect.mjs:104–120`, native relay device/attempt ownership validation.

Runtime reproduction with a local stub: queue a valid event, a rejected event, and an event for a new attempt. The server returns HTTP 400 with the first ID in `accepted`. Two flushes resend the same whole batch and retain all three records. The connector ignores accepted prefixes on non-200 and cannot quarantine a permanent rejection. Later attempts share the backlog.

Related inspection finding: re-pairing changes local session device IDs, but server attempts remain bound to the old device and queued events retain prior attribution. Rewriting only local IDs does not authorize a server-side attempt transfer. This can create exactly the permanently rejected backlog that blocks unrelated work.

Fix: honor partial acknowledgements regardless of the overall batch status; classify permanent/transient failures; quarantine rejected records with an explicit gap/error rather than deleting critical evidence silently. Implement browser-authorized same-owner device reassignment or explicitly start a new linked session. Keep prior events attributed to their actual device.

Acceptance: an invalid/stale old-attempt event cannot prevent a valid new attempt from syncing; re-pair/revoke/restart behavior is explicitly tested without changing provider credentials or silently moving other owners' sessions.

### F08 — P1: revocation/outage does not establish that active local work stopped

Evidence: connector CLI `cmdRun` revocation callback around lines 155–157, `relay.mjs:174–181`, `rpc.mjs` child lifecycle.

Inspection: revocation calls `process.exit(3)` directly rather than the interrupt/close path. Network failures back off indefinitely without a documented active-work containment deadline. Browser closure does not send a stop or renew an execution lease. RPC child pipes closing is not proof the tool/process tree stopped, particularly for subprocesses launched by an agent.

Fix: unified bounded shutdown for revoke, expired execution lease, disconnect policy, SIGINT/SIGTERM, and crashes. Interrupt, await actual terminal state where possible, then close/contain the process tree with tested OS semantics. Report unknown completion honestly. Do not promise instantaneous remote revocation while offline.

Acceptance: use a fake long-running agent/tool sentinel to prove no further writes after the documented boundary; no paid inference is necessary. Reconnect reconciles partial work before allowing a new turn.

### F09 — P1 product completeness: the native path ends before defense and passport

Evidence: `src/components/NativeSession.tsx`, native session `finish`, `src/app/passport/page.tsx`, and `/agent/[id]` redirect.

Inspection: native completion banks acceptance and links back to attempts. It does not enter a defense round or persist a defended native result to the passport, which still reads legacy localStorage agent-run records. Standard scenarios redirect into the native path, while duels still use legacy AgentClient. The main product journey is split between two incompatible attempt/evidence systems.

Fix: make native submission IDs the reference for a server-owned defense/result path and passport evidence. Migrate or visibly separate legacy duel/score behavior; do not claim a connector trace is defended because hidden tests passed.

Acceptance: complete a native attempt, defend the frozen version using actual trace evidence, refresh, and see the same persistent result in the passport. Legacy-only content must not be advertised as equivalent native support.

### F10 — P2: streaming and trace capture lose meaningful content silently

Evidence: `connector/lib/codex.mjs:110–119`, `src/app/api/native/events/route.ts:19`, native UI feed logic around lines 249–260.

Runtime/browser reproductions:

- Three text deltas, `Hello, ` / `this is ` / `the last delta.`, rendered only `the last delta.` in Codelit. API compaction and UI choose the last delta rather than accumulating message content.
- A 5,000-character final message became 4,000 characters with no truncation indicator.
- An MCP item with a tool name, arguments, call ID and long result became only a server name plus a shortened tail summary. Capabilities nevertheless advertise `toolArgs:true` and `toolResults:true`.

A finalized commentary message also suppresses later live deltas for the entire turn because message completion is tracked at turn level.

Fix: preserve native message/item/call IDs, cumulative streamed text, phases, bounded full arguments/results or an explicit truncated payload reference. Be accurate about adapter capabilities. Do not collect hidden reasoning to compensate for missing ordinary message data.

Acceptance: multiple messages in one turn, commentary then final answer, long output, reconnect mid-message, and multiple tool calls retain correct ordering/content; truncation is explicit and native call arguments remain inspectable.

### F11 — P2 product fit: human edits are disabled, and learning questions consume a hard par budget

Evidence: `NativeSession.tsx:342–345`; session send limit `turnsUsed + turnsReserved >= scenario.promptPar`.

Browser confirmed read-only source with instructions to ask the agent for every change. The idle editor is never editable despite existing connector revision-conflict support. Pair Sum allows only four prompts total; explanation, clarification, and connector-side pre-execution errors can consume this scarce budget. `promptPar`, a comparison target in the original design, has become a hard ceiling.

This is a product tradeoff, not a hidden runtime exception. It discourages human participation and the comprehension questions the project should encourage. If the cap is exhausted before a needed repair, the only choices may be submission of a failing solution or abandoning the attempt.

Fix: editable human-driver mode while the agent is idle, with revision acknowledgement/conflict handling; separate learning practice from explicitly budgeted challenge modes. Distinguish pre-inference rejection from inference use. Measure appropriate agent use rather than assuming fewer prompts means more skill.

Acceptance: the user can author a test or small repair inside Codelit, switch back to agent editing safely, and ask explanation questions in practice without exhausting an arbitrary challenge cap.

### F12 — P2: local checks disagree with official semantics; infrastructure failures are banked as failed acceptance

Evidence: `connector/lib/workspace.mjs:155–163`; native final evaluation catch at `session/route.ts:315–320`.

Runtime reproduction: local JavaScript returned `[0,1]` for expected `[0, 1]`; helper reported 0/1 solely because it compares formatted strings. It also lacks robust bool/collection equivalence and C++ execution. This helper is not the main browser's official-check path, so prioritize according to whether it is exposed to users/tools.

Inspection: the final evaluator catches runner exceptions, constructs failed test results, and marks the attempt done. Missing executables or execution-service failure can permanently close an otherwise valid attempt as a coding failure.

Fix: shared typed comparison semantics for released tests; separate candidate errors from infrastructure failure and return retryable infrastructure status without banking a verdict. Persist bounded final feedback for failed submissions so refresh does not reduce it to an unexplained pass count.

Acceptance: semantically equal results agree across paths; a deliberately unavailable runner preserves the frozen attempt and can be retried idempotently.

## Additional deployment constraints

- File-backed stores cache and rewrite entire maps, including all attempts' event logs. Every event can trigger multiple complete-file writes; no multi-process transaction or replica coordination exists. This is a code-inspection scalability/durability risk, not a measured saturation result. Batch ingestion and use an append-oriented transactional store before broader deployment; define retention for commands, events, and snapshots.
- All connector devices share an IP-keyed relay bucket. Token traffic/acks/polls and several people on one Wi-Fi can interfere; per-device/account quotas should separate cheap status, control, and event ingestion with backpressure.
- The signed browser cookie is HttpOnly/SameSite=Lax, but lacks production `Secure`; endpoints do not explicitly validate Origin/Fetch Metadata. This is hardening work, not a demonstrated cross-origin exploit in this audit. Pairing/commands that influence a local process deserve explicit origin and ownership tests.
- Connector relay URLs are not visibly limited to HTTPS outside loopback; the CLI accepts an override using the saved device credential. Bind credentials to their approved relay origin, reject untrusted redirects, and allow plaintext only in clearly scoped local development.
- Claude solving is still unsupported and accurately labeled. Keep it unavailable until an actual adapter passes the same lifecycle tests. The older Phase-0 document and current README report different live-validation stages; update the evidence record instead of treating either document as comprehensive health certification.

## Product ideas: make Codelit an agentic pair-programming training environment

The strongest direction is a controlled collaboration loop: **plan → work together → inspect a change → predict behavior → verify → transfer the skill**. Keep the user's chosen agent embedded in the website. Treat learning claims as hypotheses to evaluate, not scores inferred solely from token/prompt counts.

Research context: [Anthropic's coding-skills experiment](https://www.anthropic.com/research/AI-assistance-coding-skills) found a comprehension disadvantage with AI assistance in a small, specific learning task and associations between interaction styles and quiz outcomes. It does not establish how Codelit or all agentic workflows perform. It motivates testing understanding and transfer separately from completion speed.

### I01 — Human/agent driver handoff with a review checkpoint

Let the human drive the editor while idle and explicitly hand it to the agent. Capture agent turn-level diffs against the prior snapshot, let the user inspect/revert a patch, and ask for a review decision on consequential changes. Use existing revision conflict logic as a starting point, not concurrent uncontrolled edits. Optional checkpoints should target meaningful decisions, not interrupt every tool call.

Measure: useful corrections/rejected faulty changes, missed regressions, and understanding of the accepted diff. Ship first after lifecycle fixes.

### I02 — Test-first collaboration and output prediction

Before delegating an implementation, let the user specify an edge case or expected output. The agent implements; Codelit runs a hidden counterexample or mutation against the user's stated expectation. For a failure, require a short diagnosis before requesting a repair in an optional training mode.

Measure: counterexamples found, prediction accuracy, and whether the next fix repairs the mechanism rather than just the visible example. This creates objective evidence beyond a prose grade.

### I03 — A defense grounded in one actual decision, then an unassisted transfer

After acceptance, select a real code change/tool failure/approach change from the trace. Ask why the user accepted that decision, then give a small changed requirement or mutation requiring a prediction or brief human-authored fix. Pause the connected agent for the exercise, while acknowledging that external assistance cannot be ruled out.

Measure: independent variant correctness and retention on a later revisit. Use a platform-controlled reviewer (Meta can have a substantive role here) with deterministic checks where possible and visible engine provenance. Never silently substitute an unvalidated offline score.

### I04 — Two modes with different incentives

**Practice studio:** explanations, retries, human edits, checkpoint replay, no harsh prompt cap. **Budgeted assessment:** declared rules, fixed task/evidence version, explicit turn/time limits and independently checked outcomes. Avoid ranking different models and incomplete capture by raw prompt counts.

Show dimensions such as correctness, test design, review judgment, debugging, and transfer separately. An overall score needs calibration; fewer prompts is not automatically better pair programming.

### I05 — Brownfield micro-repositories

Expand beyond a single function into small bounded tasks: a regression in an existing module, an API change with callers, a failing test suite, a performance constraint, or an intentional misleading agent proposal. Keep the repository small and deterministic, with a defined submission manifest and isolated evaluation.

Measure: preservation of existing behavior, quality of tests, navigation of dependencies, and review of agent-generated changes. This better represents real programming environments than story variation over the same answer pattern.

### I06 — Decision replay and deliberate retry

Turn the event stream into a replay of prompts, file diffs, tests and outcomes. Let the user mark “this helped,” “this misled me,” or “I should have verified here.” Offer a fork from a checkpoint to try a different approach on a copied workspace. A model comparison requires explicit user authorization for additional usage and must keep outcomes/session histories separate.

Measure: improved decisions on the second attempt, not just prettier transcripts. Defer branching until frozen snapshots and session generations are reliable.

## Recommended order for the fixing thread

1. **Contain execution and close lifecycle/security boundaries:** F01–F08. Add targeted offline/API regressions; these are more valuable now than widening provider support.
2. **Complete one coherent native product journey:** F09–F12, with a human editor, correct trace presentation, retryable evaluation, and native defense/passport linkage. Keep existing functionality and data; migrate deliberately.
3. **Ship one distinctive learning loop:** combine I01 + I02 + I03 on one scenario with practice mode. Demonstrate that an AI-produced correct solution is followed by a meaningful human review and transfer check.
4. **Expand only after that loop works:** Claude parity, richer tasks, replay/branching and calibrated multi-dimensional results.

Do not treat all new ideas as an immediate implementation backlog. First fix reproducible correctness/security issues, then select the smallest learning feature that demonstrates the user's goal.

## Requested response from the implementation thread

For each finding, return fixed / already fixed with evidence / deferred with reason, relevant tests and changed files. Preserve current uncommitted work. Run the 29-test baseline plus new failure-path regressions, lint, TypeScript, production build and one isolated browser flow. Do not run new paid inference implicitly; use fake agents for failure injection and obtain the appropriate authorization if live provider use is necessary. Do not publish/deploy or push changes merely because this review was delivered.
