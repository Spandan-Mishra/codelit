# Codelit — prove how you work with AI

**Live product:** http://130.210.6.147:3000

Codelit is an AI-first coding assessment platform built for a world where
every candidate already has an agent. It does not try to stop people using
AI. It makes copied answers worthless by grading the part a screenshot
cannot produce: how you direct an agent under constraints, and whether you
can defend the resulting code under time pressure.

Built during the Meta Global AI Developer Hackathon (Oct 26–Nov 4, 2026).

## The loop

1. **Practice** — connect your own coding agent and learn the staged
   scenario system. Practice is repeatable and unscored.
2. **Ranked** — after passing five distinct practice scenarios, enter
   counted runs with the same staged requirements and prompt budget.
3. **Solve with your agent** — requirements arrive in three stages. Your
   prompts and the agent's file changes are captured automatically; the
   brief itself is never handed to the agent, so you must explain the task.
4. **Finish** — the solution is frozen and evaluated against visible
   checks plus hidden acceptance tests (only pass counts are shown for
   hidden tests).
5. **Defend** — a timed dialog asks three questions about your frozen
   solution: a quoted code excerpt, a design choice, and the prompts
   behind the run. Answers are graded and banked.
6. **Passport** — defended runs become a credibility record: score, tier,
   prompt count, and defense performance.

There are nine scenarios (two hand-written and seven generative vault
scenarios). Vault variants are seeded, so constraints and values change
between attempts while the underlying skill stays the same.

## Why cheating is pointless here

- The agent never receives the platform brief; the candidate must
  understand and explain the task themselves.
- Requirements change across three stages, so a memorized final answer
  does not fit the run.
- Hidden acceptance tests are evaluated server-side from a frozen,
  hash-bound snapshot.
- The score is not banked until the candidate defends their exact lines,
  design choices, and prompt decisions against a 90-second clock.

## Meta Model API

Defense questions and grading use Meta's Model API
(`muse-spark-1.3-contributor` by default; override with
`META_MODEL_INTERROGATE`). If no key is configured, a deterministic
offline fallback keeps the flow usable and is visibly marked unverified;
it can never award top marks.

Candidate code execution never uses a model. Python, JavaScript, and C++
run locally inside disposable bubblewrap namespaces with CPU, memory,
process, file-size, output, and network limits.

## Bring your own agent

Install the connector on the computer where your coding agent is signed in:

```bash
bash connector/install.sh
codelit-connect status
```

Then open **Connect agent** in Codelit, create a one-time pairing code,
and run the command shown by the setup guide. Pairing codes are
single-use and expire after ten minutes. The connector keeps your
provider login on your machine; Codelit receives a revocable device
credential, prompts, tool activity, and solution-file revisions.

Codex solving is supported today. A Claude CLI installation can be
detected, but Claude solving through this connector is not enabled yet.

## Local development

```bash
npm install
cp .env.example .env.local   # set MODEL_API_KEY for live defense grading
npm run dev                  # http://localhost:3000
```

Production:

```bash
npm run build
npm run start -- -p 3000
```

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run test:connector
npm run test:containment
```

Focused integration checks live in `scripts/` (`native-api-check.mjs`,
`mode-gate-check.mjs`, `api-hardening-check.mjs`, `meta-live-check.mjs`).
Each header documents the isolated server it expects; never point them at
production data you care about.

## Deployment

Production runs natively on an Oracle Cloud Ubuntu VM (not in a nested
container, because the code runner needs unprivileged user namespaces).
See [DEPLOY.md](DEPLOY.md). Pushes to `master` are verified by GitHub
Actions and then deployed automatically to the VM with health checks,
runtime-data backup, and rollback on failure.

## Current limitations

- Defense is text-only; voice is intentionally not shipped yet.
- Duel mode races a simulated house pace, not another live user.
- Legacy duel/agent-run state and rate limits are in-memory per process.
- The public deployment is HTTP on the VM's IP until a domain is attached
  for HTTPS.
