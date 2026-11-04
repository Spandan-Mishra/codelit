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
