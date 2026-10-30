# codelit-connect (experimental)

Local connector: runs **your own** coding agent for Codelit attempts. Codelit supplies the
interface; your agent supplies its runtime, login, and tools. No dependencies — Node 22+ only.

## Install

```bash
cd connector
./install.sh   # npm link: puts `codelit-connect` on your PATH
```

No npm? Run it directly from this folder instead:

```bash
node bin/codelit-connect.mjs status
```

You also need the agent itself: `codex` on PATH with `codex login` done (subscription or API
key — your own Codex setup, unchanged). Check with:

```bash
codelit-connect status        # adapter detection + capability flags
codelit-connect probe-codex   # read-only protocol check (handshake + model list, no inference)
```

## Pair

1. Open Codelit → Agents → **Connect local agent** → **Pair a new device**. A one-time code appears.
2. On your computer:
   ```bash
   codelit-connect pair --relay https://<your-codelit-host> --code <CODE>
   ```
   Confirm what gets shared (challenge messages, replies, tool activity, file revisions).
   Never shared: your agent login/tokens, unrelated files or chats.
3. The page shows **Connected**. The device token is stored `0600` in `~/.codelit/device.json`.

## Solve

```bash
codelit-connect run --relay https://<your-codelit-host>
```

Then in Codelit: **Solve with my agent** → pick scenario, device, agent. Chat, approvals, and
edits stay in the browser; the agent works in `~/.codelit/attempts/<attemptId>/`
(override base with `CODELIT_BASE`). Pin a model with `CODELIT_MODEL` if you want
one; otherwise your Codex default is used and your Codex approval settings apply
(the connector never auto-approves).

Ctrl-C interrupts active turns and stops. Revoke anytime from Agents — the connector
exits on next poll when its credential dies.

## Security notes

- Outbound HTTPS only; the connector opens no listener.
- One challenge folder per attempt; only `solution.*`, `TASK.md`, and released visible
  tests live there. Hidden tests and unreleased stages never sync down.
- Browser edits flush with the next turn and apply only on revision match — conflicts
  are reported, never overwritten silently.
- Approval decisions bind one request id; replays are rejected server-side.
- Event backlog (`~/.codelit/event-queue.jsonl`) is bounded; replays resume from the
  last ack and the server marks gaps explicitly.

## Status / gaps (honest)

- Codex adapter validated against app-server protocol 0.164.0 (handshake, model list,
  thread/turn lifecycle, command/file/permissions approvals). Live multi-turn runs need
  your own login and are not yet exercised end-to-end here.
- Claude adapter is an explicit stub (Phase 2): detection works, turns refuse with guidance.
- MCP elicitation questions are declined with an explanation (unsupported in MVP).
- Transport is HTTPS poll + JSON; SSE/push relay is a documented future seam.
