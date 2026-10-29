# Codelit — prove you wrote it

Cheat-resistant coding prep: solve, then defend your code under timed interrogation.

LeetCode grades what you paste. A photo + an AI model pastes perfectly, so the green tick proves nothing.
Codelit grades what a photo cannot produce: a **timed, personalized defense of your own lines** plus **debugging on a prompt budget**.
Cheating the code is allowed — the clock and the follow-ups make it pointless.

## Run

```bash
npm install
npm run dev    # http://localhost:3000
```

Production: `npm run build && npm run start -- -p 3000`

## Deploy

Serverless platforms can't compile C++ or guarantee `python3`, so deploy
the container (Render, Fly.io, Railway, or any VM):

```bash
docker build -t codelit .
docker run -p 3000:3000 -e MODEL_API_KEY=... codelit
```

Set `MODEL_API_KEY` for live interrogation (optional — the offline
interrogator works without it). Rate limits are in-memory per instance;
front them with the platform's own throttling if traffic grows.

## Live interrogation (optional — works offline without it)

Copy `.env.example` to `.env.local` and set `MODEL_API_KEY`.
Interrogation uses the cheap model in `META_MODEL_INTERROGATE`. Without a key, a deterministic
interrogator asks line-specific mutation questions, so the demo never breaks.

## How it works

- **Practice** (repeatable) vs **Arena** (graded, one defended attempt then locked on device).
- **Solve → Defend:** pass visible tests, then 3 rounds × 90s: intent/invariant → live mutation of your actual code → complexity/trade-off. Paste telemetry is recorded; generic answers score ≤4.
- **Debug Under Fire:** broken code, countdown, hard prompt budget. The agent (Muse Spark or fallback) hints, never writes the fix.
- **Passport:** credibility score from defended + debug traces stored locally.

Python runs via the Piston sandbox API; JavaScript runs locally. Isolate the JS runner before real users.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind · Monaco · local Python + JS runners
