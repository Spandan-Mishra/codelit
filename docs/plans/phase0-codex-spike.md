# Phase 0 — Codex App Server spike record

Date: 2026-10-30. CLI: codex-cli 0.164.0. Machine: Linux dev host (this is the
implementer's machine, not a user device; no user credentials were touched).

## What was validated (real, local, no inference)

- Spawned `codex app-server` over stdio, completed `initialize` → `initialized`
  handshake. Server returned `userAgent`, `codexHome`, `platformFamily`, `platformOs`.
- `model/list` with `params: {}` returned the account's model catalog
  (gpt-6.1-sol, gpt-6-astra, gpt-6.1-terra, gpt-6-sol, gpt-6-luna, …) including
  per-model `supportedReasoningEfforts`. Note: `model/list` requires an explicit
  (possibly empty) `params` object — omitting it is a `-32600` error.
- Generated pinned TS bindings (`codex app-server generate-ts`) and grounded the
  connector's approval responses in them: command/file decisions are
  `accept`/`decline` (`CommandExecutionApprovalDecision`,
  `FileChangeApprovalDecision`); permissions grants echo the requested subset
  with `scope: "turn"`. The prose docs' `accept`/`decline` strings match the
  pinned schema for 0.164.0 (an older `ReviewDecision` shape also exists for
  legacy methods — the connector only answers the v2 `item/*` requests).
- `thread/start` accepts `cwd` (workspace restriction) and optional `model`;
  the connector passes `cwd` always and inherits all other policy (including
  approvals) from the user's own Codex config — no blanket auto-approve.
- Protocol sequence for turns: `turn/start` → `item/agentMessage/delta`,
  `item/started`, `item/completed`, `turn/completed`; approvals arrive as
  server-initiated requests; `turn/interrupt` cancels; `thread/resume`
  reattaches. Re-run `probe-codex` after any CLI upgrade.

## What was NOT validated (explicit gaps)

- No `turn/start` was issued here: that would run inference against whoever is
  logged in on this machine. The first live multi-turn run, edit, approval,
  cancel, and resume must happen on the user's own device with their own login.
- `account/read` was deliberately never called (privacy).
- Claude adapter: detection only (`claude --version` present). SDK embedding,
  subscription eligibility, and permission callbacks are Phase 2 work.
- MCP elicitation (`item/tool/requestUserInput`): declined by design in the MVP.

## Material constraint found in vendor docs

App-server authentication "has never been permitted for commercial or hosted
services" — hosted use needs Sign in with ChatGPT (partner waitlist). The
local-connector architecture (auth never leaves the user's machine; Codelit
holds only a revocable device token) is the compliant shape. Do not centralize
app-server auth server-side.

## Repro

`codelit-connect probe-codex` (read-only) and `codelit-connect status`.
