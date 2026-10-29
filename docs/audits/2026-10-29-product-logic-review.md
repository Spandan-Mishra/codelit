# Codelit product and logic audit

Reviewed 2026-10-29 at commit `bd2d2fa`. BYOS means bring your own subscription; it is proposed, not implemented.

## Verdict and scope

The current UI supports nine staged scenarios, Python/JavaScript/C++ execution, an integrated hints coach with seven provider choices, three defense rounds, a local passport, duels/credits, and a shared leaderboard. The baseline works: production build, ESLint, and `tsc --noEmit` all passed. One browser scenario completed from editing through acceptance and defense.

The central product claim is not supported by the current trust model. A normal browser run earned **97/100, Convincing**, by submitting a valid solution, asking one hint, then supplying the same meaningless keyword string in all three defense rounds. Separately, fabricated API events earned a 95/100 trace, and a duel awarded credits without any submission. Public deployment also exposes host code execution.

This was a bounded adversarial audit, not a saturation benchmark. Requests targeted an audit-owned local development server on port 3099; provider protocol checks used a local stub and fake key. No actual provider credentials, production traffic, or provider charges were used. Live model access, production proxy configuration, and container deployment remain unverified. Findings distinguish runtime reproduction from code inspection.

## P0 — fix before opening execution to strangers

### 1. Candidate code executes with the app server's privileges

Evidence: `src/lib/exec.ts:29`, `:40`, `:80`, `:103`; `Dockerfile`.

JavaScript uses `new Function` in the route process, with no execution timeout. A submitted function returned `typeof process + ':' + process.version`, obtaining `object:v22.23.4`. A separate disposable subprocess running the same runner with an infinite loop had to be killed by an external 600ms timeout; the application runner itself has no timeout. An accidental `while(true)` can block the serving process.

Python and compiled C++ are subprocesses, but inherit environment and host permissions. A Python probe confirmed access to the host environment without reading any secret. Temporary directories and timeouts do not isolate filesystem, networking, process creation, or credentials. The Dockerfile adds no unprivileged user or per-submission sandbox.

Impact: server secrets, app data, other users, and availability share the candidate's trust boundary. This includes the server's Meta key if configured. Do not solve this merely by swapping `new Function` for Node `vm`.

Fix: separate execution service with disposable isolation, no model credentials, restricted network/filesystem, resource/process quotas, and hard wall-clock termination for every language.

### 2. Custom provider URLs allow server-side requests into internal services

Evidence: `src/app/api/agent-proxy/route.ts:99`, `src/app/api/providers/route.ts:45`.

Both APIs accept arbitrary base URLs. A local HTTP stub bound to 127.0.0.1 received requests from the app, including the fake API key in Authorization. There is no HTTPS policy, private-address restriction, destination allowlist, or explicit redirect policy. This is an unauthenticated SSRF surface; keyless Ollama is also available. It does not imply arbitrary response bodies are always returned, since the adapters parse specific shapes.

Fix: hosted deployment should use fixed approved provider origins. If custom endpoints are a deliberate feature, isolate their egress and validate resolved destinations and redirects. Local/self-hosted mode needs a separate explicit network policy.

## P1 — correctness, credibility, and demo blockers

### 3. Offline defense grading rewards keywords rather than understanding

Evidence: `src/lib/meta.ts:110`.

The fallback explicitly ignores candidate code and counts words. This answer scored 10/10:

> because invariant complexity O(n) fail break edge duplicate return line input example trade memory time

Using it unchanged in all three rounds through the browser produced 30/30 defense, 95 trace, and 97 final. No API tampering was necessary. The fallback is used when there is no key and when the live request fails or its JSON is invalid.

Fix: offline mode should give ungraded practice feedback or an explicitly unverified result. A credible score needs validated, question-specific evidence. Build a grading evaluation set containing keyword spam, contradictions, copied generic answers, correct concise answers, and prompt injections.

### 4. Trace evidence and stage gates are client assertions

Evidence: `src/lib/trace.ts:34`, `:57`, `:113`; `src/app/api/agent-run/route.ts:113`.

Reproduction: start Pair Sum; send one `prompt` event containing `x`, a `run` event with `passed:true`, stage 2, another passed run, and stage 3, all with `t:0`. Every event was accepted. Finishing a correct solution returned 95 efficiency and zero seconds. No agent call or visible-test execution was needed to unlock stages.

Even honest timing is wrong: duration is last-event time minus first-event time, excluding initial thinking and the interval after the last event until finish. The prompt par is displayed but not used in the penalty calculation.

Fix: record provider requests/replies and runner outcomes on the server under an authenticated attempt ID. Use server timestamps and immutable code hashes. Stage advancement must reference a verified run for the current code and stage.

### 5. A duel can be won without code; the opponent is a clock

Evidence: `src/app/api/duel/route.ts:96`; `src/lib/duel.ts:72`.

Reproduction: create easy duel, immediately resolve with `userPassed:true`. Returned win and +2 credits without a scenario attempt or submission. There is no binding between a duel and a verified acceptance result.

Separately, house progress and success are calculated entirely from elapsed time. No house model executes code or passes tests. The last progress label can say `full suite green → passed` before `housePassed` becomes true: easy mode reaches label 6 at 375s but only passes at 480s. The UI presents this as live agent progress.

Fix: make resolution consume a server-owned accepted submission tied to the duel and seed. Implement real house execution or label it as simulated sparring. Credit changes must be transactional and idempotent.

### 6. Ordinary polling exceeds the app's rate limit

Evidence: `src/components/HousePanel.tsx:65`; `src/app/api/duel/route.ts:45`; `src/app/api/agent-run/route.ts:67`.

The panel polls every 2 seconds, roughly 30 status calls/minute, while all duel actions share a 20/minute bucket. Bounded requests reproduced 429 responses after the bucket filled. A normal duel will periodically lose its progress feed; finish resolution can hit the same exhausted bucket.

The scenario bucket is also tight: start (1) + three visible runs with code/run events (6) + two unlocks (2) + finish (1) + five prompt/reply pairs (10) totals 20 calls to agent-run. A sixth prompt or another run can exceed 20 within a minute. The separate execution requests also have their own bucket. Additional reloads or simultaneous users compete with finishing.

Fix: separate cheap reads, trace recording, and expensive execution limits; batch events or record them server-side. Add backoff and useful Retry-After handling.

### 7. IP addresses stand in for users and attempts

Evidence: `src/lib/ratelimit.ts:17`; `src/app/api/agent-run/route.ts:22`; `src/lib/duel.ts:84`.

Two requests with the same IP and scenario resumed the same attempt. After one finished, the other was blocked for ten minutes. Thus judges on shared Wi-Fi can share attempts, limits, and credits. Without X-Forwarded-For, all callers become `local`. Changing the header bypassed the lock locally; exploitability on deployment depends on whether its trusted proxy overwrites client-supplied values.

State uses process-local maps. Restart/redeploy resets attempts, credits, duels, and limits; separate replicas do not share them. Maps have no general expiry cleanup.

Fix: session/user identity, unique attempt IDs, trusted proxy configuration, persistent transactional state and TTLs. IP remains an abuse signal, not account identity.

### 8. One-shot completion races and cannot reliably recover

Evidence: `src/app/api/agent-run/route.ts:146`; `src/components/AgentClient.tsx:171`, `:335`, `:393`.

Two simultaneous Python finish requests for the same active attempt both returned HTTP 200 and accepted results. Status changes only after awaiting execution. There is no evaluating state, transaction, or idempotency key.

The client does not persist draft code, chat, finish result, or in-progress defense. Start resumes stage metadata but returns neither code nor event history. Reloading an active run loses work; reloading after finish hits cooldown instead of recovering the verdict and defense. A lost finish response can consume the one shot without letting the user bank it.

Python compile/runtime errors are broadly classified as infrastructure failures and can leave the attempt unconsumed; JS exceptions become failed test results and consume it. This creates inconsistent one-shot semantics.

Fix: persist drafts and outcomes, restore by attempt ID, atomically transition active → evaluating → finished, distinguish user failures from infrastructure failures, and make finish/retry idempotent.

### 9. The runner accepts incorrect results and trusts candidate stdout

Evidence: `src/lib/runner.ts:28`, `:52`; `src/lib/exec.ts:44`, `:93`.

Reproduction A: `[4,2,1]` passed against `[1,2,4]` for `retry_delays`, because all flat numeric arrays are sorted before comparison. This also undermines order-sensitive allocation/rate-limit arrays and ascending index requirements. Normalization additionally lowercases string outputs. The group-anagrams legacy path uses substring checks rather than exact groups.

Reproduction B: Python code printing `1` and `2` at import, then returning 999 for every input, passed two tests expecting 1 and 2. The driver treats the first stdout lines as test answers. Conversely, an innocent debug print shifts results and makes correct code fail. C++ uses the same line-based assumption.

Fix: typed, task-specific comparators and a harness-owned result channel separate from candidate logs, inside isolation. An adversarial candidate must not control the trusted driver. Add regression coverage for ordering, strings, duplicates, debug output, exceptions, and fabricated output.

### 10. Final scores, leaderboard entries, and passports lack provenance

Evidence: `src/components/AgentClient.tsx:445`; `src/app/api/leaderboard/route.ts:47`; `src/app/passport/page.tsx:23`; `src/lib/leaderboard.ts:67`.

Final score is computed and saved in the browser. Leaderboard accepts client-supplied score, tier, prompts, difficulty and result without an attempt ID or verifying completion. Passport is editable localStorage and stores aggregate records rather than replayable evidence. A win can be posted as 100 directly from DuelClient, separately from a defended final score. These are incomparable metrics on one board.

File-backed leaderboard writes use read-modify-write with no lock; concurrent submissions can overwrite each other. Persistence failures are swallowed while the response still says posted. These are code-inspection findings; the existing board was not polluted to demonstrate them.

Fix: compute and bank final results on the server; board posts reference immutable evaluated attempts, with uniqueness constraints and durable writes. Distinguish duel wins from defended scores. A shareable passport needs identity and an evidence record.

### 11. Prompt budget is enforced after assistance has already been delivered

Evidence: `src/components/AgentClient.tsx:249`, `:270`; `src/app/api/agent-proxy/route.ts:75`.

The model responds first; recording the prompt is a separate later request. If the 12-prompt budget, event cap, network, or event rate limit rejects recording, the user still has the answer and may already have incurred a BYOK charge. The proxy has no attempt ID and works without any attempt, reproduced using house mode. Failed model calls are not logged as attempted prompts. Failed reply events are ignored.

Fix: atomically reserve a prompt slot before calling the provider, then record completion/error against the same request. Define whether failures consume budget and prevent duplicate billing on retries.

### 12. Defense cannot verify the trace it asks about

Evidence: `src/components/AgentClient.tsx:368`, `:418`; `src/lib/meta.ts:130`, `:157`.

The interrogator receives final code and a one-line summary, not actual prompts, replies, snapshots or diffs. The grader receives question, answer, code and summary, without the original task requirements or verified expected behavior. Asking which prompt caused a particular change does not supply the evidence needed to check the answer. Offline trace-aware round 2 replaces concrete mutation with a broad retrospective question.

The grade endpoint is stateless: client supplies question, round, code and summary. There is no issued question ID, deadline, or one-grade-per-round rule. The 90-second clock and paste telemetry live only in the browser; paste counts are displayed but do not affect grading. A 90-second limit alone cannot establish that no external assistant was used.

Fix: freeze submission and trace, issue server-owned rounds/deadlines, grade against actual task/trace evidence, and introduce an objectively checked code mutation or test prediction. Treat textual grading as evidence with uncertainty rather than proof of authorship.

## BYOK-specific gaps

### 13. Connection tests do not test the chosen model or actual operation

Evidence: `src/app/agents/page.tsx:252`; `src/app/api/providers/route.ts:56`; `src/app/api/agent-proxy/route.ts:150`.

The UI does not send the selected model to Test. Most adapters list models; Anthropic pings its default instead. Neither proves the chosen model accepts the generation body or that quota permits useful inference. A local stub returned successful Test, then rejected the actual generation request with HTTP 400, which the app reduced to a generic 502. This demonstrates the mismatch, not a live-provider outage.

The common adapter unconditionally sends `max_tokens:500` and `temperature:0.4`, with no model capability handling or reasoning-budget policy. GPT-5 options require live compatibility validation; this audit did not certify them against a paid account. Model lists returned by Test are discarded; UI selections remain hardcoded. A reachable Ollama instance with only another installed model cannot be configured through the normal picker. Connected status is not invalidated when credentials/base/model change. Per-provider custom configuration is lost when switching away and reloading.

Fix: inexpensive actual generation using the selected model and exact adapter; capability-aware schemas, account-specific models/custom model input, configuration-specific health state, and actionable error categories.

### 14. Privacy wording and credential lifecycle need correction

Evidence: `src/lib/agentStore.ts:28`; `src/app/agents/page.tsx:309`, `:258`; proxy code.

“Keys stay on this device” is misleading: plaintext keys persist in localStorage and are sent to the Codelit backend both for Test and assist, then forwarded to the chosen destination. This audit did not find keys being deliberately logged; the issue is the broader trust boundary and exposure to same-origin scripts. Arbitrary HTTP endpoints can receive keys without TLS. Storage failures are silently swallowed.

Fix: clearly disclose routing and recipients; offer session-only credentials and explicit removal; restrict endpoints and protect against XSS; show storage failure. If adopting server-side encrypted storage, explain that separate trust choice. OAuth refresh tokens for BYOS need their own secure lifecycle, not another plaintext key field.

### 15. BYOK only powers hints; it does not power the defense

Evidence: `src/components/AgentClient.tsx:222`, `:368`; `src/lib/meta.ts:13`.

A user can connect Meta BYOK and get live hints while all defense calls still use the server MODEL_API_KEY or offline fallback. If that server key is missing, successful user setup does not make the key product feature live. Conversely, BYOK does not remove Codelit's judging cost.

The hints UI looks conversational but sends no prior conversation. Each request includes only latest stage, current code and newest question. User text comes after code and the entire payload is sliced at 5,500 chars, so long code can remove the actual question. The recorded prompt is truncated further at 4,000 chars. This means what was recorded may not equal what the model saw.

Fix: distinguish solver-provider and evaluator-provider policies. Keep the evaluator under platform control for comparable results; preserve a bounded conversation and explicit context truncation, and record hashes/full canonical payloads server-side.

### 16. Model failures can hang or silently change grading behavior

Evidence: `src/lib/meta.ts:13`; `src/components/AgentClient.tsx:385`, `:430`.

The defense model fetch has no application timeout. Provider HTTP/auth/quota/format errors silently select offline grading. The UI ignores defense engine metadata. Question/grade handlers parse JSON without checking HTTP status: a 429/413 can become generic “Explain your solution” or score zero, instead of a retryable error. Accepted code can be 20k chars while defense rejects over 12k, making a valid finished submission undefendable. Network exceptions have no useful round recovery.

Fix: bounded requests; visible live/offline status; retryable errors that do not consume a round; consistent size policies; preserve issued round and outcome. Never silently turn a live certified assessment into a keyword-scored assessment.

## Missing or misleading product pieces

- **Harder duel selection is unreachable through normal UI.** All scenario Duel links force `difficulty=easy`; medium/hard cards have no selection action (`src/app/duels/page.tsx:77`). Credits therefore have no obvious in-product redemption path.
- **Starting a paid duel happens before checking scenario eligibility.** A duel can be created and charged, then its AgentClient can hit an existing scenario cooldown. No refund/resume flow exists.
- **The “agent” is a short, hints-only chat.** It cannot edit, run tests, or iterate autonomously. This conflicts with copy about defending what the agent wrote and can disappoint users expecting an agent-driving assessment.
- **No repeatable practice path currently exists.** README/DEMO describe Practice/Arena/Debug Under Fire and Two Sum routes, but current navigation/build exposes scenarios, duels, passport and agents. The old demo script cannot be followed as written. Scenario minutes are labels/par values, not an enforced run countdown.
- **Only 3–4 acceptance tests per scenario.** Pair Sum randomization changes offsets but preserves answer indices. Seed is client-selectable. Generated story variation is not equivalent to test diversity or resistance to memorized strategies. Hidden test input/expected values are returned in finish JSON even when the UI hides them.
- **No grading calibration or evidence of assessment validity.** Different models, hint policies, tasks and user skill levels share a score. Zero prompts caps efficiency at 30, so even perfect acceptance/defense maxes at 58 final, while a single trivial prompt raises the ceiling to 97. The score rewards using a prompt, not necessarily using an agent well.
- **Operational packaging:** README still says Piston although all languages run locally. `.dockerignore` does not exclude `.env*` or `data`, and Docker uses `COPY . .`; a later local environment file could be baked into an image. This was inspected, not container-tested.
- **No automated regression suite or test script** was present for these business rules. Passing build/lint does not exercise them.

## BYOS compared with BYOK

BYOK and BYOS can both be first-class solver connections, but they need separate adapters and explicit capability checks. BYOS is not “paste a subscription token into the existing API-key box.”

### BYOK: current implementation, easier protocol ownership

The user supplies a provider API credential. Codelit can broker requests and own a canonical trace. User friction includes obtaining a key, configuring billing/quota and trusting Codelit with it. Failures include no credits, revoked/restricted keys, model permission mismatch, quotas and incompatible generation parameters. Usage is generally metered against the credential's provider account; a subscription may include credits in some plans, so do not claim all subscription and API billing are always unrelated.

The current code implements the credential forwarding but lacks verified trace capture, model health, clear billing semantics, and reliable recovery. Fix those before adding another auth method.

### BYOS through an official integration: feasible, provider-specific

As checked on 2026-10-29, OpenAI documents eligible ChatGPT plan usage through Sign in with ChatGPT. This requires inference scopes in addition to identity; identity-only sign-in does not authorize model use. Its OSS/local-hosted documentation explicitly directs paid/remotely hosted apps to an interest form, so Codelit's hosted eligibility must be established before promising it.

Its request contract also differs: Responses endpoint, account-specific models, `store:false`, `stream:true`, context supplied by the client, and restrictions on parameters/tools. The current nonstreaming Chat Completions adapter cannot accept this as a drop-in credential replacement.

Anthropic's current help article describes subscription-backed Agent SDK/`claude -p` usage and API credits for some plans. This does not establish that an arbitrary hosted Codelit website may reuse that login with its current raw `/v1/messages` adapter. Validate the specific supported integration and deployment model.

New failure states to design for: unsupported plan/client/deployment, identity-only consent, user denial, token expiry/revocation, refresh failure, account/workspace switching, model entitlement changes, shared allowance depletion, and unavailable endpoints. Show which account/allowance is being used. Switching automatically from subscription to BYOK must require the user's prior billing choice.

### BYOS through an external chat or local coding CLI: a different trust tier

Allowing users to work in their existing ChatGPT/Claude/Codex client lowers key friction but does not automatically expose their full transcript or make it trustworthy. Imported/manual transcripts are user assertions. A local bridge needs installation, protocol/version checks, secure pairing, reconnects and scope boundaries; a hosted site cannot invoke a visitor's CLI by calling its own server's localhost.

The same applies to the existing Ollama flow: localhost currently means the Codelit server/container, not the visitor's computer. It may work when app and Ollama run together but does not deliver the deployed promise “runs on your machine.” This follows directly from server-side fetch placement and was confirmed with a loopback stub.

Separate server-observed tool events, locally attested events, and self-reported/imported activity. None establishes that the user did no unobserved work elsewhere. A practical product claim is that the user passed a controlled defense of the submitted work, with a declared provenance level.

## Meta hackathon implications and order of work

Assuming the Meta Global AI Developer Hackathon currently advertised for Oct 26–Nov 4, its public page emphasizes working technical ambition for indie entrants and production execution for startups. This audit does not establish compliance with the complete official rules or the user's selected track.

The strongest demonstration would be one real Meta-powered coaching run, a preserved trace, and a concrete personalized mutation that a generic response fails. Currently the duel has no live model and defense may silently fall back; BYOK configuration is not evidence the defense used Meta. A provider selector alone contributes little to the product's distinguishing claim.

Recommended sequence:

1. **Contain execution and egress.** Isolate runner, keep evaluator credentials out, restrict hosted provider destinations.
2. **Make one trustworthy assessment path.** Stable sessions and persistent attempt IDs; server-owned prompt/run events; exact comparators; immutable final submission; atomic completion and banked score.
3. **Make the demo reliable.** Fix polling limits, timeouts, error handling and recovery; show live/offline model provenance; remove graded offline keyword scores. Label simulated duels or implement actual house execution.
4. **Make defense meaningful.** Provide real trace/code-diff evidence and task context; include an objectively verified mutation; evaluate the rubric against adversarial and honest answers. Revisit prompt-count scoring and model fairness.
5. **Improve BYOK onboarding.** Test actual selected inference; fix context/history and key wording; quota/billing errors and durable configuration.
6. **Then pilot one official BYOS path.** Confirm hosted eligibility and integration contract, implement OAuth/account lifecycle and subscription errors, and retain a clear separation between solver access and platform evaluation.

## Verification record

Passed: `npm run lint`, `npx tsc --noEmit`, `npm run build`.

Runtime checks: fabricated trace/stage unlocks; same-IP collision and changed-header bypass; offline keyword defense; credits without code; duel rate-limit threshold; JS host access; Python host environment presence; ordered-array false positive; debug-print corruption and stdout spoofing; loopback provider forwarding; connected-but-generation-rejected stub; concurrent finish race; assistance without an attempt; full browser scenario and 97/100 keyword defense. The infinite-loop check used a disposable subprocess, not the serving app.

No live-provider credentials were available or requested; no production load test was performed. Existing leaderboard data was not modified. Application source was not changed during the review.

## Official references checked

- [Meta hackathon overview](https://dev.meta.ai/events/global-hackathon)
- [Meta Chat Completions contract](https://dev.meta.ai/docs/protocols/chat-completions): current endpoint/response shape matches the app broadly; `max_tokens` remains an accepted deprecated alias. Do not label the Meta integration broken merely because of that field.
- [OpenAI Sign in with ChatGPT quickstart](https://developers.openai.com/siwc/quickstart)
- [ChatGPT plan usage overview and hosted-app distinction](https://developers.openai.com/siwc/token-sharing-open-source)
- [ChatGPT plan inference contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [ChatGPT plan preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Claude Agent SDK with a Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
