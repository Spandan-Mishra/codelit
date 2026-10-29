# Embedded user agents in Codelit

Status: proposed implementation handoff; no implementation is included in this document.

Prepared: 2026-10-30. Provider documentation was checked on this date; the implementing agent must recheck capabilities against the versions it actually uses.

## 1. Product intent and the user's clarified requirements

Users should bring their own coding agents into Codelit and solve problems through the Codelit website. They should chat with the agent, see code changes, run tests, respond to permission requests, and submit their work without switching to a terminal, IDE, or another chat website during normal solving.

The agent runs through a local connector on the user's computer. Codelit supplies the interface; the user's native agent supplies its supported runtime, authentication, tools, and session behavior. This is an embedded-agent integration, not simply an API-key field or a link to an external agent.

The user's example of projects containing chats was illustrative. Choosing a folder for chat organization, saving conversations into that folder, and synchronizing conversations into ChatGPT/Claude are **not requirements for the initial implementation**. Session continuity is necessary for reliable solving, but a project/chat library is a separate future feature.

The user has authorized this document only. A receiving agent should treat it as a specification and wait for its own implementation instruction before changing application code.

### Required product outcomes

- The complete solving experience remains in Codelit after initial installation/authentication.
- Users can connect a supported native coding agent and use its supported account access, including subscription-backed access where permitted.
- Prompts and responses are visible in Codelit, with tools and code edits shown where the agent exposes them.
- The browser editor and the agent operate on the same challenge files.
- Attempts can survive browser refreshes and recover from connection interruptions without silently restarting the conversation or duplicating prompts.
- Codelit can reconstruct the observed sequence of prompts, replies, edits, and tests for later defense.
- Codelit evaluates the exact submitted code independently of the agent's claims.

### Initial non-goals

- A universal connector for every frontier provider on day one.
- Exporting chats into a provider's consumer web history, or importing its personal memories and previous conversations.
- A user-facing folder/project/chat management product.
- Running an arbitrary locally installed executable selected by a website command.
- Screen scraping, terminal-output scraping, copying subscription cookies, or extracting credentials from unrelated applications.
- Proving that no outside assistance occurred. A user-controlled computer cannot provide that guarantee.
- Replacing the native agent with a newly built Codelit agent loop while calling it the user's existing agent.
- Migrating all existing BYOK, duel, passport, or leaderboard functionality in the first integration spike.

## 2. The intended experience

### First connection

1. The user opens Codelit's Agents area and selects **Connect local agent**.
2. Codelit explains that a small background connector runs the native agent on their computer; messages and challenge activity will be shared with Codelit for the selected attempt.
3. The user installs and starts the connector. A proposed executable/package name such as `codelit-connect` is a placeholder, not an existing command.
4. The user pairs that device with their Codelit browser session through a short-lived pairing flow and explicit confirmation on the local device.
5. The connector reports supported installed agents and versions. A missing agent produces setup guidance rather than an unrelated model fallback.
6. The user selects an agent. The connector checks authentication and helps initiate the agent's official sign-in when necessary. Initial vendor sign-in may open a provider page; normal solving remains in Codelit afterward.
7. The page shows **Connected**, selected agent, available account/model information, and the device used. It must distinguish native-agent connections from existing API-provider configurations.

### Solving

1. The user opens a scenario and clicks **Start with my agent**.
2. Codelit creates an attempt with a stable ID and a fixed scenario variant. An idempotent request creates one dedicated native session and one isolated challenge directory for this attempt.
3. The connector writes the starter solution and currently released requirements into that directory. Codelit sends the native agent the current task context, available tests, entrypoint contract, and workspace restrictions.
4. The user sends messages in Codelit's chat. The native agent can read/edit challenge files and use permitted tools. Codelit shows its responses, activity, changed code, and any approval requests.
5. The user runs visible tests from Codelit. Agent-initiated local commands can also appear, but must be labeled as local activity rather than official acceptance.
6. When Codelit releases another stage, it updates the attempt context and synchronizes the released requirements with the same native session.
7. The user finishes. The system waits for an idle agent, resolves file synchronization, freezes the chosen source snapshot, and sends those exact bytes for independent acceptance.
8. Defense occurs in Codelit against the frozen submission and the observed trace. It does not silently use the user's solver agent as its own evaluator.

### Returning later

Browser refresh restores attempt state, chat/activity history, code revision, connection status, and native session identity. Reconnection attaches to the same session where supported. If native history or files have been deleted, explain the loss and offer an explicit new session; do not pretend to resume.

## 3. Architecture and responsibilities

Recommended MVP: browser and connector communicate through a Codelit-owned authenticated relay. The connector establishes an outbound TLS connection, avoiding a public listener on the user's device and browser-to-localhost compatibility issues.

The logical message path is:

```text
Codelit browser UI
    -> authenticated Codelit attempt service / connection relay
    -> paired local connector
    -> supported native agent adapter
    -> native agent runtime -> provider inference service

Agent messages, tool activity, approvals, and file revisions
    -> connector -> relay / event storage -> Codelit UI

Frozen source snapshot
    -> independent Codelit execution service -> acceptance / defense
```

This is a logical design, not an instruction to place persistent sockets inside a Next.js route. The deployment must explicitly support long-lived connections. A separate small relay service is appropriate when the Next.js host cannot provide them. Reconnect, acknowledgement, authentication, and persistence remain required regardless of the transport implementation.

### Browser

- Owns the challenge UI, editor, native-agent chat, visible tool activity, approval controls, and connection/recovery states.
- Issues typed attempt/session commands; never sends arbitrary shell strings as connector control instructions.
- Uses stable request IDs and renders stored events as well as live events.
- Displays pending/synchronized/conflicting file state.
- Does not store native-provider credentials or refresh tokens.

### Codelit backend and relay

- Authenticates users/browser sessions, devices, attempt ownership, and all commands.
- Owns scenario seeds, stage releases, acceptance results, server deadlines, prompt-turn reservations, and final verdicts.
- Routes only to the selected paired device and session.
- Stores normalized events, device/session mappings, acknowledged revisions, and immutable submission snapshots durably.
- Marks locally reported activity separately from independently checked results.
- Has no need to receive the user's subscription credentials in this architecture. It does receive the explicitly disclosed challenge messages and activity routed through it.

### Local connector

- Runs unprivileged and starts only a supported agent adapter after explicit pairing and user selection.
- Manages dedicated challenge directories, native session IDs, process lifetime, protocol I/O, event normalization, and local replay buffers.
- Uses supported agent authentication flows and credential storage. Do not parse or exfiltrate tokens from the user's other applications.
- Applies workspace/command policies, checks browser-issued requests, and surfaces permission requests.
- Reconnects to Codelit and reconciles session state without automatically rerunning an uncertain turn.

### Native agent

- Supplies the actual agent loop, supported model access, tool behavior, context management, and agent-specific permissions.
- May use native settings/instructions where supported and permitted. Enumerate the actual loaded configuration; do not promise every plugin, memory, or global instruction automatically transfers.
- Runs locally; model inference generally still occurs at its provider. “Local connector” does not mean an offline model.

### Independent evaluation service

- Runs submitted source in isolated execution without solver credentials.
- Uses server-owned tests and trusted result handling.
- Does not accept a local `passed` flag as proof of hidden acceptance.

## 4. Native agent support

### Codex: first proof of concept

Use Codex App Server rather than launching an interactive terminal and scraping it. Official documentation describes managed ChatGPT authentication, persistent threads/turns, workspace selection, resume, and structured item events. See [Codex App Server](https://learn.chatgpt.com/docs/app-server).

The spike must demonstrate supported authentication, account/model discovery, a new session in a dedicated directory, consecutive chat turns, an edit, an exposed command/tool result, approval handling, cancellation, and resume. Save the native thread/session identifiers as returned; do not infer their relationships.

Pin a tested version and generate/validate protocol types where supported. Verify handshake ordering, history pagination, event completeness, and permission semantics against that version. Examples in vendor documentation are not the intended Codelit permission policy.

### Claude Code: second adapter behind the same interface

Use the official Agent SDK or another explicitly supported structured interface. The SDK embeds Claude Code's runtime and exposes session handling and tool/text streaming. See [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) and [streamed output](https://code.claude.com/docs/en/agent-sdk/streaming-output).

Confirm subscription eligibility and distribution/authentication behavior for this exact connector. Current [subscription guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) describes plan-backed SDK/CLI usage; it is not a universal authorization for every hosting arrangement. Do not silently switch to a separately billed API key when subscription access fails.

Verify resume, cancellation, message aggregation, tool results, failure events, and permission callbacks. Consult [sessions](https://code.claude.com/docs/en/agent-sdk/sessions) and [permissions](https://code.claude.com/docs/en/agent-sdk/permissions). A final assistant message, a tool completion, and a completed user turn are different events.

### Future agents

ACP is a candidate common interface for agents that support it, not a replacement for agent-specific capability testing or subscription eligibility. Add another agent only when its supported interface meets the acceptance criteria. Do not claim compatibility with a vendor merely because Codelit already has that vendor's model API adapter.

### Adapter contract: proposed responsibilities

Each adapter must expose typed operations for detection/version checks, capability discovery, auth status and supported sign-in, create/resume session, send turn, interrupt, resolve approval, inspect current state, and close/dispose.

It must emit normalized events and capability flags, including whether it supports text deltas, tool arguments/results, file diffs, native resume, usage reporting, and enforceable workspace restrictions. A missing capability is represented explicitly. Core Codelit code must not branch on raw vendor payloads throughout the UI.

## 5. Connection, identity, and pairing requirements

- Stable device IDs are distinct from provider account IDs and native session IDs.
- Attempt ownership uses an authenticated account or a secure server-issued browser session, never an IP address. An anonymous prototype can use a signed browser session; its limitations must be explicit.
- Pairing tickets must be short-lived, single-use, audience-bound, and tied to the intended browser session. A short display code alone is not a long-lived bearer credential; rate-limit attempts and require local confirmation.
- The connector authenticates independently after pairing. Store its revocable device credential using OS-protected storage where available, or explicitly restricted local files for the development prototype.
- Relay authorization verifies user, device, attempt, native session, message type, and current lifecycle state. A device credential is not a general shell-access grant.
- Provide device disconnect/revoke and a clear local stop control. Revoke stops future commands and cancels or contains active work according to the documented policy.
- Never transmit provider tokens, browser cookies, or entire agent configuration directories as part of connection setup.
- Support one active controlling browser per native session in the MVP. A second tab is read-only until ownership is explicitly transferred. Pending approvals cannot be answered by an old controller.
- Origin checks, cross-site request protections, schema validation, bounded payloads, protocol version negotiation, and credential redaction are mandatory. Do not introduce an unauthenticated localhost control endpoint as a shortcut.

## 6. Workspace and editor synchronization

Folder selection is not a required feature. Initially create a connector-managed directory per attempt under a locally approved base directory. Offer custom base-directory selection later if useful. Never reuse an arbitrary personal repository by default.

The challenge directory holds only released task files, visible tests, and allowed solution artifacts. Hidden tests, future unreleased stages, evaluator prompts, and Codelit credentials must never be synchronized there.

### Authoritative revisions

The connector filesystem is authoritative for native-agent execution. The browser editor is a revisioned view with a local unsaved buffer. Every saved snapshot has a revision and content hash. Codelit stores the synchronized revision needed for rendering, official test execution, and submission.

For the MVP, use a single writer:

- Before sending an agent turn, flush the browser buffer and await the connector's hash/revision acknowledgement.
- While an agent turn or approved editing tool is active, make the browser editor read-only and render incoming file changes.
- Restore editing when the agent is idle and the final file revision is acknowledged.
- Detect external file modifications. If a browser save targets a stale revision, show a conflict/diff rather than overwriting silently.
- Language switches create/reset a defined source file only after resolving unsaved work; never destroy a running agent's files.

Only monitor allowed challenge files. Enforce path normalization, traversal checks, symlink/reparse-point handling, file type/size limits, and atomic writes. A directory allowlist alone is not an OS sandbox.

Start with a single visible solution file to match today's editor. Either block unexpected source files with a useful explanation or define a submission manifest; do not imply a multi-file solution will be evaluated when only one buffer is submitted.

## 7. Prompt and context behavior

- Preserve the native session across turns so normal follow-up questions have conversation context.
- Separate the user's authored text from Codelit's injected task context, stage notifications, test feedback, and file synchronization messages.
- Supply current released requirements, language/entrypoint constraints, and supported visible tests. Record the context revision delivered to the agent.
- Do not silently truncate a user question or label a shortened log as an exact payload. Summarization/truncation requires visible metadata.
- A stage release updates the context exactly once, idempotently, and is tied to the attempt. Queue it while a turn is active or deliver through a supported steering mechanism; do not reset the conversation.
- Reserve a user-turn slot before forwarding a budgeted prompt. Reject exhausted budgets before any new inference is started.
- Count user-authored turns separately from tool calls, automatic continuation, retries, injected context, and internal model calls. Provider token/cost figures are optional and must be labeled unavailable when not exposed.
- Store an accepted/rejected/forwarded/started/completed/failed state for each user turn. Define explicitly whether a failed attempt consumes a slot; do not infer failure means no provider usage occurred.
- Changing agents during an attempt must not be silent. Initially require a new linked native session and record the switch, or disable switching until the attempt ends. Historical messages must retain their original agent attribution.

## 8. Tool access, permissions, and user-machine safety

The connector gives a remote website influence over a process on the user's machine. Protect this boundary even for a hackathon prototype.

- Default to access restricted to the dedicated challenge workspace. Prefer the agent's supported sandbox and validate what it actually enforces on each target OS.
- Do not use blanket bypass/auto-approve modes as the default. Handle permission requests inside Codelit with exact action, relevant path/command, requesting session, and allow-once/deny semantics.
- Permission decisions bind to one pending request ID. Replayed or late decisions cannot authorize another action. Timeouts/disconnects deny or keep actions blocked; they do not silently approve.
- Stop/cancel must interrupt the native turn and account for any executing tools. A UI button changing state is not proof the process stopped.
- Separate connector control commands from native tool activity. The backend cannot invoke arbitrary executables or broaden permissions through unconstrained request fields.
- Restrict environment inheritance and prevent Codelit service credentials from reaching agent processes. Native credentials remain in the supported native credential path.
- Identify loaded user plugins/MCP servers/global configuration that broaden access. For the MVP, allow a documented subset rather than importing everything silently.
- Workspace permissions do not automatically block network exfiltration, process execution, or all host file access. If enforceable restrictions cannot be provided on an OS, disclose the limitation and do not label the workspace isolated. Treat broad-access tools as an explicit separate product decision.
- Do not recursively delete user directories. Cleanup affects only verified connector-managed attempt directories, with a clear retention policy.

## 9. Trace and evidence model

The purpose is to reconstruct observable collaboration, not to collect private chain-of-thought or certify complete authorship.

Recommended event categories:

- User prompt accepted/forwarded.
- Assistant message delta and finalized message.
- Native turn started/completed/interrupted/failed.
- Tool requested/started/completed/failed/denied, where exposed.
- Approval requested/decided/expired.
- File revision/snapshot/diff.
- Context/stage delivered.
- Local command/test output, distinctly labeled.
- Official Codelit test run, submission, and defense events.
- Connector disconnection/reconnection, capture gap, and session replacement.

Each event envelope should identify protocol/schema version, unique event ID, attempt ID, connector/device ID, logical session and native session ID, turn ID, correlation/parent ID where applicable, event type, adapter version, model when known, source sequence, source timestamp, server receipt timestamp, evidence source, and a bounded typed payload. Tool events include their native call ID, exposed arguments/results, status, and duration where available. File events carry revision/hash and relative paths.

Distinguish three provenance classes:

1. **Codelit-observed:** server-issued stage release, server receipt, independently evaluated source and results.
2. **Connector-reported:** native prompts/replies/tool events and local file revisions received from a paired device.
3. **Self-reported/imported:** optional history supplied outside the connected session.

Pairing, signatures, hashes, and server receipt can establish origin/order/integrity properties; they do not make a user-controlled connector an independent witness. A hash proves consistency of supplied bytes, not that every action was captured.

Store finalized messages separately from raw deltas; do not feed every token into today's capped business-event array. Batch durable ingestion and compact replay data without discarding meaningful transitions. Missing/redacted/truncated fields must be explicit.

Default collection is restricted to this attempt. Redact secrets, unrelated absolute paths, and sensitive configuration. Show users what is uploaded, define retention/deletion behavior, and make clear that the relay can see disclosed challenge content. No background collection of unrelated native chats.

## 10. Session reliability and lifecycle

Track connection state, native execution state, and attempt state separately. A disconnected browser does not imply an idle agent; an idle agent does not imply an accepted submission.

Suggested connection states: unpaired, pairing, connected, reconnecting, revoked, incompatible.

Suggested native states: starting, idle, running, waiting for approval, interrupting, interrupted, failed, closed. Authentication is a separate status: ready, sign-in required, expired, unavailable.

Required behavior:

- Each command has a request ID; creation and sending are idempotent at the connector boundary.
- Persist session mappings and event acknowledgements; buffer a bounded event backlog locally and replay from the last acknowledged sequence.
- If replay history is incomplete, emit a capture-gap event instead of inventing continuity.
- On an uncertain send outcome, query/reconcile the native session before retrying. Do not automatically replay a possibly executed prompt and incur duplicate work/usage.
- Browser refresh reattaches to the logical session and rehydrates stored finalized messages and current revisions.
- If the browser closes while work is active, MVP behavior is to request interruption. Until acknowledged, display execution as unknown/running on recovery. A disconnected connector should interrupt locally after a documented grace period, especially with approvals pending.
- On restart, reconcile local journal, process status, native resume support, and backend state. If recovery requires a replacement session, ask explicitly and record a discontinuity.
- Provider rate limits, allowance exhaustion, sign-in expiry, unsupported models, and agent crashes have distinct actionable UI states. Never substitute another provider or billing method automatically.
- A timed-out request may still be running. Avoid turning every transport timeout into a fresh operation.

## 11. Submission, acceptance, and defense

Submission must bind an immutable source snapshot to an attempt, scenario version/seed, language, entrypoint, and content hash.

Before finish, stop accepting new solver turns and wait for the agent to become quiescent. If interruption is needed, reconcile final writes before freezing. An unacknowledged or conflicting revision cannot be submitted silently.

The backend independently evaluates the uploaded bytes. Local commands and agent statements can support the trace but cannot unlock authoritative acceptance by assertion. Keep hidden tests and their detailed expected results on the evaluator side.

Use a transactional/idempotent submission lifecycle. A lost response must be recoverable by request/submission ID rather than consuming the attempt without a retrievable outcome.

Defense receives the frozen solution, actual released task context, and relevant observed prompts/tool outcomes/diffs. A one-line summary alone is insufficient for questions about a specific prompt or decision. Pause the connected solver session during defense; disclose that this does not prevent an external agent/client from being used elsewhere.

Keep the evaluator independent from solver credentials and instructions. Do not let a tool output, local event, or user-controlled transcript change the grading rules. Capture completeness is a separate dimension from correctness and defense quality. Do not penalize missing conversation coverage as if it were observed zero usage.

## 12. Fit with the current repository

This is a navigation map, not a statement that the new components already exist. Reinspect the working tree before implementation because the application is being changed elsewhere.

- `src/components/AgentClient.tsx`: current scenario/chat/editor/run/defense UI. Separate the native session controller and event-driven conversation display from its existing short-hint request path.
- `src/components/Editor.tsx`: current editor surface; add explicit revision/synchronization status and active-turn write ownership through a controller.
- `src/app/agents/page.tsx`: connection setup. Represent native agent/device connections distinctly from API provider cards.
- `src/lib/agents.ts` and `src/lib/agentStore.ts`: existing API-provider definitions/preferences. Avoid overloading `provider/model/baseUrl` with device pairing and native authentication.
- `src/app/api/agent-proxy/route.ts`: current model-hint API. Keep it as a separate connection mode; it is not the native agent transport.
- `src/app/api/agent-run/route.ts`: current attempt/event/acceptance path. Introduce stable owned attempt IDs and durable storage rather than building the connector around IP-keyed in-memory attempts.
- `src/lib/types.ts` and `src/lib/trace.ts`: current compact event types/scoring. Add a versioned richer event model and a compatibility projection where useful; do not squeeze tool streams into generic text events.
- `src/lib/runner.ts`, `src/lib/exec.ts`, and `src/app/api/run/route.ts`: current execution paths. Establish safe independent evaluation before relying on them for public acceptance.
- `src/lib/meta.ts` and `src/app/api/interrogate/route.ts`: platform evaluation path, kept separate from the native solver adapter.

Suggested new boundaries, with names to be chosen by the implementer: native session service, connector/relay protocol package, local connector process, Codex adapter, Claude adapter, revisioned workspace service, normalized event store, and browser session controller. A shared TypeScript protocol package fits the current codebase, but native runtime requirements may justify an adapter subprocess.

Before writing Next.js code, read the relevant bundled guides in `node_modules/next/dist/docs/` as required by `AGENTS.md`. Do not assume standard older Next.js route/socket conventions apply.

## 13. Delivery sequence and decision gates

### Phase 0: prove the native integration

Build a disposable Codex integration spike with a controlled challenge directory. Demonstrate login/status, a real multi-turn session, edit, exposed tool result, approval/deny, cancellation, and resume using a pinned version. Document what events are and are not available. No live credential should be committed or logged.

Exit gate: the native session can be driven programmatically with sufficient events and safe permission behavior. If subscription or embedding behavior is unsupported, report the exact limitation; do not substitute scraping or a model API while claiming success.

### Phase 1: one end-to-end Codelit problem

Implement owned attempt identity, pairing/relay, one device and controller, one native adapter, single-file synchronization, browser chat/activity, independent visible/acceptance execution, submission snapshot, and recovery. Keep this behind a clearly identified feature flag or experimental mode.

Exit gate: a user solves one complete scenario entirely in the website after initial setup, including refresh and one disconnect/reconnect, without duplicated turns or lost code.

### Phase 2: second adapter and hardening

Add Claude through the shared interface after confirming auth/eligibility. Validate capability differences, permissions, event ordering, installer/update behavior, OS sandbox limitations, logs/privacy, and recovery. Reuse the same UI and contract tests.

Do not advertise an OS before its connector lifecycle, path handling, permissions, and agent behavior have been exercised. The initial development spike may target the implementer's current OS; the release support matrix is an explicit deliverable.

### Phase 3: optional extensions

Consider ACP adapters, custom base directories, project/chat organization, existing-session attachment, optional transcript exports, richer multi-file challenges, and provider-native history discovery. None should block the core embedded workflow.

MCP can later expose Codelit-specific stage/test/submission tools to the native agent. It is supporting infrastructure here; do not replace the agreed website experience with “go use your agent elsewhere.”

## 14. Acceptance criteria

The implementation is ready for review only when the receiving agent can demonstrate:

1. A fresh user can install/pair a connector, select an available native agent, and understand which account/access mode is in use.
2. The initial supported native-agent connection does not require pasting a model API key into Codelit when supported subscription access is available.
3. Two consecutive turns reference the same native session and preserve context.
4. An agent edit appears in the Codelit editor and the exact acknowledged bytes are used by a browser-triggered test.
5. A user edit is acknowledged locally before the next agent turn reads it.
6. Supported tool requests/results and failures appear with stable IDs and accurate state; unsupported fields are labeled unavailable.
7. Permission requests can be approved or denied inside Codelit, and a stale/replayed decision cannot authorize a different action.
8. Stop interrupts actual work and reconciles final file changes.
9. Browser refresh restores the conversation, source revision, and execution state without creating a second session.
10. Sleep/network interruption and connector restart recover safely or show an explicit discontinuity. An uncertain turn is not automatically resent.
11. The final source hash matches the frozen submission evaluated by Codelit, and local test claims cannot create a verified pass.
12. Wrong-user/wrong-device/wrong-attempt commands, replayed pairing tickets, traversal/symlink escapes, oversized events, and expired approvals are rejected.
13. Native credentials are absent from browser storage, backend event payloads, logs, and committed artifacts.
14. Hidden tests and unreleased task context are absent from the local challenge workspace.
15. The UI distinguishes reported tool activity from official evaluation and records capture gaps honestly.
16. Missing agent, incompatible version, expired login, exhausted subscription allowance, unavailable model, and crash produce recoverable messages without automatic billing/provider switches.
17. The chosen single-writer policy prevents browser/agent conflicts and two-tab control races.
18. No normal solving step requires leaving Codelit after setup. Chat-folder organization and consumer-app history synchronization are not acceptance dependencies.

Use adapter contract tests, replay fixtures, state-machine tests, and targeted security/integration tests. Include at least one real native-agent end-to-end validation when authorized credentials are available; mocks alone cannot prove subscription access or native runtime behavior. Document any untested provider/OS capability rather than claiming it passed.

## 15. Implementation handoff checklist

Before committing to the design, the receiving agent should settle and record:

- Tested agent versions and exact supported authentication/distribution modes.
- Initial supported OS and its enforceable permission restrictions.
- Relay deployment host, durable storage choice, and anonymous-session versus account identity.
- Connector packaging/startup/update strategy and local confirmation surface.
- Event coverage and native history/resume limitations for each adapter.
- Explicit disconnect grace period, cancellation behavior, retention, and deletion policy.
- Prompt budget semantics and source-file/submission manifest constraints.

These are engineering decisions within the agreed embedded-local-agent design, not reasons to reopen the product direction. Escalate only a material capability mismatch, security limitation, or required product tradeoff.

Expected handoff back after implementation: changed components, setup instructions, supported versions/OS, a reproducible end-to-end walkthrough, tests run, event/capture limits, unresolved risks, and any provider capability that could not be validated.

## 16. Primary references

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)
- [Claude SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Claude SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- [Claude plan usage guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

The provider capabilities summarized above come from these references. The architecture, proposed contracts, rollout, and acceptance criteria are Codelit design recommendations, not vendor guarantees. Revalidate documentation and the exact installed versions before implementation.
