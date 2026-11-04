# Codelit — 3-minute demo script

**Live URL:** https://codelit.duckdns.org

Prepare before recording: sign in with a browser profile that already has
five practice scenarios passed (so Ranked is unlocked), keep a second
profile or the attempts list ready for the practice view, and have
`codelit-connect run` ready on the demo machine. Never show API keys,
pairing secrets, or the raw data directory.

## 0:00–0:25 — The problem

> "LeetCode grades what you paste. A photo and an AI model paste perfectly,
> so the green tick proves nothing. Codelit grades what a photo cannot
> produce: how you direct an agent, and whether you can defend its code."

Show the landing page and the Practice / Ranked explainer.

## 0:25–0:55 — Practice and the gate

Open **Scenarios → Practice**. Point at a blurb with its worked sample.

> "Practice is repeatable and unscored. You learn the staged system here.
> Ranked stays locked until you pass five different practice scenarios."

Switch to **Ranked** and show the unlocked state.

## 0:55–1:45 — Solve with your agent

Start a ranked scenario and show the three panels: released requirements,
captured agent conversation, and the prompt box.

> "The platform never hands the brief to my agent. I have to explain the
> task. Every prompt and file change is captured automatically, and the
> requirements tighten across three stages."

Send one real prompt, show the agent writing `solution.py`, then run the
visible checks and unlock the next stage.

## 1:45–2:15 — Finish and hidden acceptance

Click **Finish & evaluate**. Show the frozen snapshot result.

> "Finishing freezes a hash-bound snapshot. Hidden acceptance tests run
> server-side; I only ever see how many passed, never the hidden cases."

## 2:15–2:50 — Defend the trace

Click **Finish & proceed to defense**. Answer at least one question live.

> "Now I defend my exact code: a quoted line, a design trade-off, and the
> prompts behind the run — ninety seconds each. This is graded by Meta's
> Muse Spark model, and it is the part you cannot copy from a screenshot."

Show the verdict, score breakdown, and tier.

## 2:50–3:00 — Passport close

Open **Passport**.

> "Defended runs bank here. Not a green tick — a credibility record.
> Codelit doesn't ban AI. It makes cheating pointless."

---

## Show the agent connection (weave into 0:55–1:45, or a 30s cutaway)

Open **Agents** (or "Connect agent" on the landing page). Show the two
provider cards — **Codex** and **Muse Code** — and the gold model
dropdown listing every model the connected agent reports.

> "My agent never leaves my machine. I pair this computer once with a
> one-time code, pick Codex or Muse Code, and choose a model. The
> sign-in stays inside my own agent — Codelit never sees my credentials."

On the demo machine, show the connector running in a terminal (start it
before recording). Say:

> "This small connector is the bridge. It runs my agent locally in a
> locked workspace for this attempt and streams the work back. If I
> revoke the device, it stops instantly."

Do not show the pairing code itself, any terminal with tokens, or the
relay URL with a device credential.

## Under the hood — technical notes for judge questions

**How local agents connect.** The browser never talks to your agent
directly. A local program, `codelit-connect`, pairs with the server
using a single-use code that expires in ten minutes and only binds
after you confirm on the machine itself. From then on the connector
holds a revocable device credential (the server holds no provider
tokens at all) and polls the server over HTTPS. Per attempt, the server
issues a short-lived, fail-closed work lease scoped to that attempt and
session generation; if the lease lapses or is denied, only that
attempt's agent stops. The agent works in a dedicated local workspace
containing only the task file and the current solution — the full brief
never reaches the agent, which is why the user has to explain the task
in their own words.

**What gets captured (the trace).** Every prompt the user sends, the
agent's streamed replies, tool activity, and each solution-file
revision is recorded server-side as it happens and bound to the
attempt. There is no paste-in box to game: what the user sent is what
the platform saw, because the platform's connector carried it.

**How the defense works.** Finishing freezes the exact solution files
under a content hash; hidden acceptance tests then run server-side
against that frozen snapshot (the user sees pass counts, never the
hidden cases). The defense interrogates that frozen run across three
lenses — a quoted line of the actual code, a design trade-off in the
implementation, and the prompts that produced it. Each answer is timed
(90 seconds). Questions and grading run on Meta's Muse Spark 1.3
Contributor model via the Meta Model API — deliberately the small,
cheap model: short, grounded prompts over the user's own code do not
need frontier reasoning, and running it per-answer keeps the defense
fast enough to feel live. If the model API is unreachable, grading
falls back offline and the result is explicitly marked unverified
rather than silently trusted.

**Scoring and the passport.** The final score combines hidden-test
acceptance, stage completion, prompt-budget and time discipline, and
the three defense grades. Only defended ranked runs bank to the
passport; practice is unscored and repeatable. Ranked unlocks after
five distinct practice passes, enforced server-side. Scenarios are
generative — seeded variants change names, data, and twists per
attempt, so a memorized or shared solution does not transfer.

**Where Meta models run.** Two places: Muse Spark 1.3 Contributor
powers the defense (question generation and answer grading), and Muse
Code — Meta's own agent, running on the user's machine under their
login — is one of the two supported solving agents, alongside Codex.
