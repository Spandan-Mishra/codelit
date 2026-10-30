# Native transport contract (implemented)

How the browser, the Next.js relay, and the local connector exchange work.
This doc captures the contract AS IMPLEMENTED in the tree, including the
root decisions it follows and the one place where the tree currently
conflicts with a root decision (section 7).

Implementing files:

- Server: `src/lib/native/protocol.ts`, `src/lib/native/registry.ts`,
  `src/app/api/native/relay/route.ts` (`src/lib/native/store.ts` needs no
  changes; the `kv`/`snapshots` stores already cover freezes and leases).
- Connector: `connector/lib/relay.mjs` (poll loop, leases, ledger, ACK),
  `connector/lib/runtime.mjs` (command execution, epochs, freeze, edits),
  `connector/bin/codelit-connect.mjs` (wiring).

## Root decisions

1. **Poll permit/lease is PER-SESSION, never a global boolean.** Every poll
   response carries, scoped to each native session,
   `{commands, permitWork, leaseExpiresAt, sessionEpoch}` (leases ride as a
   `leases[]` array; commands carry `sessionEpoch` top-level).
   `permitWork: false` or an expired lease stops THAT session's work; the
   loop keeps relaying other sessions. The connector must re-contact at
   least every 30s (29s contact cap, 1s bounded close). IMPLEMENTED.
2. **Locked names.** `sessionEpoch` top-level on commands and events with
   stale-epoch rejection (`session.start` exempt); `freeze.request`
   `{freezeId, sessionEpoch, expectedRevision, expectedHash}` with the
   snapshot echoing all four plus actuals; `human.edit.ack`/`human.edit.conflict`
   `{editId, rev, hash}`; restart-uncertain marker
   `command_reconciliation_required`; ACK-before-effects with idempotent
   ack. IMPLEMENTED.
3. **Keep the startup device rebind behavior.** NOT IMPLEMENTED in the
   current tree — see section 7. The tree instead retains per-attempt
   device identity with browser-authorized transfer. Needs a parent call.

## 1. Poll and per-session leases

### Shapes

Poll request: `{op: "poll", attemptId?: string, adapters?: [...]}`.
Poll response: `{commands: BrowserCommand[], leases: SessionLease[]}`.

```ts
interface SessionLease {
  attemptId: string;
  sessionEpoch: number;
  permitWork: boolean;
  leaseExpiresAt: number; // server clock, epoch ms, now + 30s
}
```

There is intentionally no global `permitWork`. `getSessionLeases`
(`registry.ts`) lists up to 50 recently-updated attempts for the device,
including closed ones with `permitWork: false` (`status === "done"` or
archived), so the connector stops lingering sessions instead of running
them on a stale generation.

### Timing

- Server grant: `NATIVE_LEASE_MS = 30_000` (`protocol.ts`).
- Connector contact cap: `min(leaseMs, 29_000)` per poll loop
  (`NATIVE_CONTACT_CAP_MS = 29_000`). A session's work requires a
  successful poll within the cap, regardless of `leaseExpiresAt`.
- Bounded close: 1s (`NATIVE_CLOSE_MS`). See section 6 for the stack.

### Connector enforcement (`relay.mjs` `runLoop`)

- Each 200 poll replaces the `leases` map (keyed by `attemptId`).
  Entries with a non-boolean `permitWork`, non-finite/past
  `leaseExpiresAt`, or missing `sessionEpoch` are stored invalid.
- `permits(cmd)` gates every command dispatch: loop alive, contact
  fresh, lease present and not stopped, `permitWork === true`,
  `lease.sessionEpoch === (cmd.sessionEpoch ?? cmd.payload?.sessionEpoch)`,
  and `now < lease.leaseExpiresAt`.
- `stopLease` → `options.onLeaseLost(attemptId, sessionEpoch, reason)` →
  `runtime.stopAttempt`: fires when a lease arrives invalid, expires
  (watchdog, ≤250ms), disappears from the poll (`browser_execution_lease_missing`),
  or its epoch advances (`session_epoch_changed`). `stopAttempt` blocks
  the attempt, closes its adapter thread, drains terminals, and fails a
  still-in-flight turn with `execution_lease_expired` (completion
  unknown, no retry). `runtime.handle` also refuses blocked attempts up
  front, including a pre-inference re-check on `turn.send`.
- Valid leases call `options.onLeaseRenewed` → `runtime.renewAttempt`,
  which serializes behind any in-flight stop and unblocks the attempt.
- Commands denied by `permits()` are HELD in the ledger (state
  `received`), not executed; they retry on later polls while their
  `expiresAt` (2min) allows, then reconcile as expired. Expired
  commands reconcile even when the lease is dead.
- Total contact loss (no 200 poll within the cap) still trips the
  connection-level deadline and shuts the connector down
  (`execution_lease_expired` → exit 3 via `onShutdown`). This is
  transport liveness for the single poll loop, not a work permit: all
  per-session permit decisions come from `leases[]`.

## 2. `sessionEpoch` generations

- The server owns the generation (`NativeAttempt.sessionEpoch`, starts
  at 0). `enqueueCommand` bumps it on every `session.start` and stamps
  the new epoch on that command; all other commands carry the current
  epoch. `takeCommands` emits `?? 0` for pre-epoch rows, which fails
  closed against any established generation.
- Connector dispatch (`permits()`) requires strict epoch equality.
  `session.start` needs no exemption there: server-bump-at-enqueue
  means a fresh `session.start` always equals the lease epoch, while a
  superseded one is correctly denied.
- Connector execution (`runtime.handle`) rejects non-`session.start`
  commands whose epoch differs from the local session (`Stale session
  epoch`); `session.start` is exempt and adopts the new epoch.
  `session.replaced` is emitted with the adopted epoch.
- Connector events carry `sessionEpoch` top-level (optional for
  backward compatibility). The relay `events` op rejects (409,
  connector-quarantined as a visible gap) any event with
  `epoch < expected - 1` or `epoch > expected`. Because the bump
  happens at enqueue, in-flight events from the replaced session
  (`expected - 1`) are still accepted as evidence and their terminals
  still release their own per-turn reservation — but only the current
  generation (or legacy epoch-less events) may move attempt status or
  rebind `nativeSessionId`.

## 3. Freeze generation binding

- `enqueueCommand` enriches every `freeze.request` with a binding
  `{freezeId, sessionEpoch, expectedRevision, expectedHash}` (explicit
  caller values win; otherwise fresh `freezeId` plus the latest
  reviewed `file.revision`), stored at `kv:freeze:{attemptId}`.
  Re-freezing overwrites the pending binding, so generations self-heal.
- The connector (`runtime.handle` `freeze.request`) interrupts and
  drains any active turn (≤20s), rejects empty/oversized solutions,
  requires `sol.rev/hash === expected`, republishes the revision, and
  uploads `{freezeId, sessionEpoch, expectedRevision, expectedHash,
  hash, revision, path, source, language}`.
- The relay `snapshot` op requires: attempt `finishing`, language/path/
  size checks, a pending freeze, exact echo of all four binding fields,
  `pending.sessionEpoch === attempt.sessionEpoch`, uploaded
  `revision === expectedRevision`, `sha256(source) === expectedHash`
  (content hash, matching `file.revision` payloads; skipped only when
  no revision was ever reviewed), and self-consistent `body.hash`.
  Old bytes from freeze A can never satisfy freeze B.
- Success stores an `AttemptSnapshot` (source, `snapshotHash`,
  revision, plus the four binding fields), records a `file.snapshot`
  server event with the same fields, and responds with the echo plus
  actuals: `{ok, freezeId, sessionEpoch, expectedRevision,
  expectedHash, revision, hash}`.

## 4. Human edits

- Command type `human.edit` (payload `{editId, code, baseRev}`) applies
  a browser edit only when `baseRev` matches and no turn is in flight,
  after size/JSON budget validation.
- Success emits `file.revision` (`human: true`) plus
  `human.edit.ack` / `human.edit.conflict` with `{editId, rev, hash}`.
- Failure also emits `human.edit.conflict` with the CURRENT
  `{editId, rev, hash}` (so the browser can rebase) plus a
  `message.final` error. (Before this contract, these event types were
  rejected by the relay as unknown; they are now accepted.)

## 5. ACK and reconciliation

- ACK-before-effects: the connector persists the ledger entry, then
  ACKs (`{op: "ack", id}`), and only then executes. A lost ACK
  response retries safely; effects run at most once per ledger entry.
- Server `ackCommand` is idempotent: re-acking returns ok and never
  re-queues work.
- Ledger states: `received → executing → completed`. `executing`
  survivors of a restart NEVER re-run inference or session creation;
  they reconcile via `runtime.reconcile`, which emits `turn.failed`
  (or `message.final`) with code `command_reconciliation_required`,
  `completion: "unknown"`, and the command id — except turns already
  reported by crash recovery, which reconcile as `message.final`
  without a duplicate terminal. Expired commands reconcile as
  preflight (`inferenceStarted: false`).

## 6. Bounded-close timing stack

`stopAttempt` containment: adapter `close()` races interrupt against
250ms, then `rpc.close` allows 250ms grace + 100ms kill-wait with
process-group kill, then the runtime drains `eventTail` and emits the
honest terminal. Worst case ≈ 250 + 250 + 100ms plus local IO — inside
the 1s budget. The relay watchdog (≤250ms) detects the lapse; renewal
serializes behind in-flight stops (`onLeaseRenewed` awaits
`leaseStops`).

## 7. Device identity vs root decision 3 (OPEN CONFLICT)

Root decision 3 says to keep the startup device rebind (commit
`6471c4d`: rebind stale per-attempt `deviceId`s to the current
credential at startup). The current tree does the opposite, deliberately:

- `connector/bin/codelit-connect.mjs` retains original per-attempt
  device identity at startup and logs
  `command_reconciliation_required (device changed …)` guidance.
- `runtime.handle`/`recover`/`onEvent` refuse cross-device work, and
  `session.start` supports explicit browser-authorized transfer via
  `payload.transferFromDeviceId` (emitted back on `session.replaced`).

Rationale in the tree: re-pairing alone is not authorization to move
an attempt. This directly contradicts root decision 3 as written, so
this doc records the conflict instead of pretending it is resolved:
either restore the `6471c4d` rebind block at startup, or amend root
decision 3 to the transfer model. No other section depends on rebind.

## 8. Compatibility notes

- Old connectors against this server exit: they require a global
  `permitWork` the poll response no longer sends. Upgrade both sides
  together.
- Pre-epoch stored commands/attempts normalize to epoch 0, which
  executes only when no generation has been established and is
  otherwise denied as stale.
- Epoch-less connector events are accepted as current-generation
  evidence (legacy connectors); epoch-ful events follow section 2.
- `store.ts` is unchanged: leases are computed per poll (not stored)
  and freezes reuse the `kv` store.
