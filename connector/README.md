# codelit-connect 0.2.0 (experimental)

Runs your installed coding agent for Codelit attempts. Node 22+, no dependencies.
Your Codex login stays in Codex; Codelit receives a revocable connector device token.

## Install

From the Codelit connection page, download/install its connector package:

```bash
npm install --global 'https://<your-codelit-host>/api/native/connector'
```

For a local source checkout, run `cd connector && ./install.sh`, or use
`node connector/bin/codelit-connect.mjs` in place of `codelit-connect`.
Codex must be on PATH and configured locally. Authenticate with `codex login`
when your configured provider requires it.

```bash
codelit-connect status
codelit-connect probe-codex
```

These perform read-only local preflight: installed CLI, App Server handshake,
local authentication requirement and runtime model catalog. They do not run
inference, prove model entitlement, or guarantee provider health. Model IDs and
labels come from the installed runtime, not a hardcoded list. Claude installation
is detected, but its execution adapter is unsupported and cannot solve attempts.

## Pair, then run

Create a pairing code in Codelit and run:

```bash
codelit-connect pair --relay https://<your-codelit-host> --code <CODE>
codelit-connect run
```

Pairing stores the device credential with mode `0600` and exits. **It does not
start a background relay.** Keep `run` open while solving. The connector reports
runtime capabilities on startup and every 30 seconds; the page distinguishes a
paired device from a recently online relay. `--relay URL` on `run` is optional
when using the saved relay URL. Ctrl-C interrupts active work before exiting.
Revocation, contact expiry and browser-presence expiry use the bounded shutdown path described below.

Select an advertised model in Codelit. The selection reaches native session
creation and each turn; an absent selection uses the runtime default (or the
optional `CODELIT_MODEL` environment default). Provider/model replacement creates
a new native session while preserving the attempt's solution and released
context. It never silently falls back to another provider.
Explicit browser/environment selections are checked against the advertised
catalog. An implicit native default may resolve to an unlisted configured model;
the connector preserves that default and reports the actual resolved model.
User prompts retain their exact text, including JSON escapes, within the
40,000-character `prompt.forwarded` payload limit.

## Workspaces and recovery

Attempt workspaces live in `~/.codelit/attempts/<attemptId>/`. Each coding turn
includes released stage context, visible examples and instructions to edit
`solution.py`, `solution.js` or `solution.cpp`. Codex receives workspace-write
capability with network access disabled for the coding turn; approval requests
still follow local Codex policy and appear in Codelit. This is a writable sandbox,
not a claim of complete isolation from all host reads or configured Codex tools.
Approvals expire after five minutes: the connector denies the native request,
emits `approval.expired` and lets the turn continue. Decisions, native terminal
events and closing the session clear pending approval timers.

The connector publishes actual saved solution bytes after tool/turn completion,
including the initial revision zero. Every terminal event and connector restart
republishes a full authoritative revision even when metadata is unchanged.
Chat code is not submitted. An unchanged
file produces an actionable warning without mislabeling explanation-only turns
as failed. Oversized solutions are explicitly rejected for sync, never presented
as partial current revisions. The source limit is 60,000 characters, with a
70,000-character escaped JSON event limit.

Browser edits apply only at the matching revision; unobserved agent writes also
cause a conflict instead of being overwritten. Restarted native sessions resume
on the next user turn. An in-flight turn from a connector crash is reported as
failed and is never automatically resent. Stop also releases delivered pending
turns that have no matching local execution, without starting them; a running
native turn waits for its real interruption event.

The local backlog retains the newest 500 streaming deltas, the latest full
revision per device/attempt, and every other unacknowledged replay event
(including prompts, approvals and terminal events). Critical history can exceed
500 events during an outage; it is never silently discarded. Backlog and
per-attempt sequence counters survive restarts. Dropped deltas leave observable
sequence gaps. Unsupported MCP elicitation is declined with an explanation.

## Isolated connector instances

`CODELIT_CONFIG_DIR` overrides connector credentials, sessions, backlog and
sequence storage. `CODELIT_BASE` overrides attempt workspace storage. Neither
changes the installed Codex login/config location. Use different directories for
parallel connector instances or disposable end-to-end tests:

```bash
CODELIT_CONFIG_DIR=/tmp/codelit-test-state CODELIT_BASE=/tmp/codelit-test-attempts \
  codelit-connect pair --relay http://localhost:3100 --code <TEST_CODE> --yes
CODELIT_CONFIG_DIR=/tmp/codelit-test-state CODELIT_BASE=/tmp/codelit-test-attempts \
  codelit-connect run
```

## Validation

```bash
npm --prefix connector test
# Explicit opt-in: one bounded paid inference in a disposable workspace,
# using a model from the installed runtime catalog and an ephemeral thread.
CODELIT_LIVE_TEST=1 npm --prefix connector run test:live
```

Protocol checked against installed `codex-cli 0.164.0` generated App Server
schema. One isolated live Codex run successfully edited the solution file and
produced a revision and completed turn. Readiness continues to report
`validated:false`: that smoke test is not ongoing health validation or a promise
about every account/model. Full browser/relay multi-stage behavior requires
integration validation in the host app.

## Delivery, pairing and execution leases

Commands have a durable `command-ledger.json` entry before receipt ACK, and the
connector waits for a successful ACK response before effects. States are
`received`, `executing`, and `completed`, with a separate acknowledgement time.
Received work can recover after restart; completed work is not executed again.
An executing record recovered after restart has an **unknown outcome** and emits
`command_reconciliation_required` instead of repeating the prompt/session start.
Review saved bytes and explicitly reconcile/retry in the browser. Keep the ledger
when repairing local state; deleting it removes replay protection.

Partial event acknowledgements apply even to HTTP error responses. Permanent
rejections are retained, with original device/attempt identity, in
`event-quarantine.jsonl`. The connector logs a visible sync-gap warning and
continues later events/attempts. It preserves transient failures for retry.
Re-pairing does not reassign existing sessions to the new device; transfer needs
explicit browser/server authorization: a trusted session.start transfer grant
must name the saved prior device, and both devices must share the server-owned
browser session. Active local work must first be stopped/reconciled. Otherwise,
start a new session or follow re-pair/recover guidance. Existing event evidence
is never rewritten to impersonate the new device.

A successful poll renews the contact deadline for at most 29 seconds, bounded
further by the server's browser-presence execution leases. Each attempt/session
generation has its own lease: denial, expiry or omission closes only that native
thread, preserving unrelated sessions. A renewed lease permits a later user turn
without resending interrupted work. Device revocation, network contact expiry,
SIGINT and SIGTERM shut down all connector-owned sessions through the same
adapter close path. The adapter interrupts, then closes its process group
with bounded TERM/KILL waits. Remote revocation while offline is **not
instantaneous**: the connector starts shutdown by its contact/lease deadline, leaving one second for bounded adapter close within 30 seconds of last contact.
POSIX containment covers descendants remaining in the adapter process group;
processes that deliberately escape that group are outside this guarantee.
Unconfirmed turn completion is reported as unknown, never as successful native
completion. Reconnect reconciles saved work before new inference.

Browser `human.edit` commands apply saved code only while idle and at the matching
base revision; they emit `human.edit.ack` or `human.edit.conflict` and never invoke
inference. Pre-inference turn rejection includes `phase: "preflight"` and
`inferenceStarted: false` for server reservation accounting. Freeze uploads echo
`freezeId`, `sessionEpoch`, `expectedRevision` and `expectedHash`; changed local
bytes require another review/finish generation.

Local Python/JavaScript visible checks compare typed values, preserving string
contents and sequence order (except task-defined unordered answers). C++ local
checks explicitly report unavailable; this is not a failed test verdict. Browser
checks remain the independent acceptance path.
