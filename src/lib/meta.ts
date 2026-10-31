// Model API client + deterministic offline fallback.
// Interrogation is deliberately routed to the cheap contributor tier:
// short Q&A needs no frontier reasoning, and the per-token cost is ~10x lower.
// Override with META_MODEL_INTERROGATE. Fallback works with no key / no network.

export function hasMetaKey() {
  return Boolean(process.env.MODEL_API_KEY);
}

export const INTERROGATE_MODEL =
  process.env.META_MODEL_INTERROGATE || process.env.META_MODEL || "muse-spark-1.3-contributor";

async function callMeta(messages: { role: string; content: string }[], maxTokens = 400, model = INTERROGATE_MODEL) {
  const key = process.env.MODEL_API_KEY;
  if (!key) return null;
  const base = process.env.META_API_BASE || "https://api.meta.ai/v1";
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.4 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.choices?.[0]?.message?.content as string) || null;
  } catch {
    return null;
  }
}

export interface CodeFeatures {
  fn: string;
  lines: string[];
  usesDict: boolean;
  usesSort: boolean;
  usesStack: boolean;
  usesLoop: boolean;
  usesRecursion: boolean;
  loopLine: string;
  condLine: string;
}

export function analyzeCode(code: string, fnName: string): CodeFeatures {
  const lines = code.split("\n").map((l) => l.trim()).filter(Boolean);
  const lower = code.toLowerCase();
  return {
    fn: fnName,
    lines,
    usesDict: lower.includes("{}") || lower.includes("dict") || lower.includes("map(") || lower.includes("new map"),
    usesSort: lower.includes("sort"),
    usesStack: lower.includes("append") || lower.includes("push") || lower.includes("pop"),
    usesLoop: /\bfor\b|\bwhile\b/.test(lower),
    usesRecursion: (code.match(new RegExp(fnName, "g")) || []).length > 1,
    loopLine: lines.find((l) => /\bfor\b|\bwhile\b/.test(l)) || lines[1] || "",
    condLine: lines.find((l) => l.startsWith("if")) || lines[2] || "",
  };
}

const ROUND_FOCUS = [
  "intent and invariant",
  "live mutation / edge-case break",
  "complexity and trade-off",
];

export type DefenseLens = "code" | "design" | "prompts";

const LENS_INSTRUCTION: Record<DefenseLens, string> = {
  code: "Focus on a QUOTED code excerpt from their solution: make them explain, trace, or defend one exact line.",
  design: "Focus on a DESIGN choice: complexity, trade-offs, scaling limits, or what they would rewrite under new constraints.",
  prompts: "Focus on THEIR process: which prompt, decision, or failure shaped the solution, and what it changed in the code.",
};

export function fallbackQuestion(
  round: number,
  problemTitle: string,
  code: string,
  fnName: string,
  history: { question: string; answer: string }[],
  traceSummary?: string,
  lens?: DefenseLens
): string {
  const f = analyzeCode(code, fnName);
  const seed = (code.length + round * 17 + history.length * 7) % 3;
  if (lens === "code") {
    const line = (f.condLine || f.loopLine).slice(0, 70);
    const variants = [
      `From your own solution, quote what this line does on the smallest non-trivial input, step by step: \`${line}\`. You have 90 seconds; a generic answer will not match your line.`,
      `Live mutation: I flip the comparison/boundary by one in your line \`${line}\`. Name the smallest input that now fails and trace why. You have 90 seconds; a pasted generic answer will not match your line.`,
      `I delete one line from your solution — the one your correctness depends on most. Which line, and which test catches the deletion first?`,
    ];
    return variants[seed];
  }
  if (lens === "design") {
    const variants = [
      `State your time and space complexity and name the input size where your approach becomes the wrong choice. What would you switch to, and what breaks in your current code first?`,
      `If the input were streamed and 100× larger than memory, which line of your code fails first? Sketch the change in words — no new code needed.`,
      `Trade-off round: your solution optimizes one thing and sacrifices another. Name both, and give the constraint change that would make you rewrite it.`,
    ];
    return variants[seed];
  }
  if (lens === "prompts") {
    if (traceSummary) {
      return `Your trace shows ${traceSummary}. Which single prompt or decision moved your run forward the most — and what exactly did it change in the code? Quote the line. You have 90 seconds; a generic answer will not match your trace.`;
    }
    return `No trace was captured for this run, so defend your process from memory: which single instruction or decision shaped your final solution most — and what exactly did it change in the code? Quote the line.`;
  }
  if (round === 0) {
    // Trace-grounded defense: round 1 asks about the decision that drove the run.
    if (traceSummary) {
      return `Your trace shows ${traceSummary}. Which single prompt or decision moved your run forward the most — and what exactly did it change in the code? Quote the line. You have 90 seconds; a generic answer will not match your trace.`;
    }
    if (f.usesDict) return `In 2–3 sentences: what does your map store at each step of "${problemTitle}", and what invariant guarantees you never reuse the same element twice? Answer from your code, not the problem statement.`;
    if (f.usesSort) return `Why must your code sort before the main pass in "${problemTitle}"? Give the exact input order that breaks it if the sort is removed.`;
    if (f.usesStack) return `What exactly do you push and pop in "${problemTitle}", and what does the stack look like on the input from the second example?`;
    return `Walk me through your code on the smallest non-trivial input. What is the loop invariant after the first iteration?`;
  }
  if (round === 1) {
    // Trace-aware defense: round 2 references the revert/decision point.
    if (traceSummary) {
      return `Your trace shows ${traceSummary}. Point to the exact decision where your approach turned — the revert or the prompt that changed it — and explain what was wrong before and why the new direction is correct. Quote the line. You have 90 seconds; a generic answer will not match your trace.`;
    }
    const line = f.condLine || f.loopLine;
    const variants = [
      `Live mutation: I change your line \`${line.slice(0, 70)}\` — flipping its comparison/boundary by one. Name the smallest input that now fails and trace why. You have 90 seconds; a pasted generic answer will not match your line.`,
      `Edge attack: give me the input that stresses YOUR implementation most (duplicates, empty-ish, or already-ordered). What does your code return, step by step?`,
      `I delete one line from your solution — the one your correctness depends on most. Which line, and which test catches the deletion first?`,
    ];
    return variants[seed];
  }
  // Trace-grounded defense: round 3 closes on trace honesty when we have one.
  if (traceSummary && seed === 0) {
    return `Your trace shows ${traceSummary}. Looking back, which prompt or step cost you the most for the least progress — and what would you ask or try instead next time? One concrete lesson, no generalities.`;
  }
  const variants = [
    `State your time and space complexity and name the input size where your approach becomes the wrong choice. What would you switch to, and what breaks in your current code first?`,
    `If the input were streamed and 100× larger than memory, which line of your code fails first? Sketch the change in words — no new code needed.`,
    `Trade-off round: your solution optimizes one thing and sacrifices another. Name both, and give the constraint change that would make you rewrite it.`,
  ];
  return variants[seed];
}

export function fallbackGrade(answer: string, round: number, _code: string, traceSummary?: string): { score: number; feedback: string } {
  void _code;
  const a = answer.trim();
  if (a.length < 25) return { score: 1, feedback: "Too short to prove understanding. The defense rewards specifics from your own code." };
  const lower = a.toLowerCase();
  const signals = ["because", " invariant", "complexity", "o(", "fail", "break", "edge", "duplicate", "return", "line", "input", "example", "trade", "memory", "time"];
  const hits = signals.filter((s) => lower.includes(s)).length;
  const mentionsCode = /`|\bline\b|\bloop\b|\bdict\b|\bmap\b|\bstack\b|\bsort\b|\bindex\b/.test(lower);
  const mentionsTrace = Boolean(traceSummary) && /revert|my trace|decision|step \d+|prompt \d+/.test(lower);
  // Offline grading is unverified keyword matching, not understanding: it can
  // never award top marks, so keyword spam cannot reach a credible verdict.
  // A live-graded defense is required for full credit.
  let score = Math.min(6, 2 + hits + (mentionsCode ? 2 : 0) + (a.length > 220 ? 1 : 0) + (mentionsTrace ? 1 : 0));
  if (a.length > 40 && hits <= 1) score = Math.min(score, 4);
  const feedback =
    score >= 8
      ? `Strong ${ROUND_FOCUS[round]} answer — specific to your code and falsifiable.`
      : score >= 5
        ? `Partial. You gestured at the idea but did not pin it to your actual lines/input. Judges: push for a concrete failing input.`
        : `Weak. This reads like a generic explanation that would fit any pasted solution. Name your lines and a concrete input.`;
  return { score, feedback };
}

export async function nextQuestion(args: {
  round: number;
  problemTitle: string;
  statement: string;
  code: string;
  fnName: string;
  history: { question: string; answer: string }[];
  traceSummary?: string;
  lens?: DefenseLens;
}): Promise<{ question: string; engine: string }> {
  const traceLine = args.traceSummary ? ` Candidate trace: ${args.traceSummary}.` : "";
  const lensLine = args.lens ? ` ${LENS_INSTRUCTION[args.lens]}` : "";
  const live = await callMeta([
    {
      role: "system",
      content:
        "You are Codelit's interrogator. Ask ONE short defense question. Round focus: " +
        ROUND_FOCUS[args.round] +
        "." +
        lensLine +
        " Reference the candidate's actual code lines." +
        (args.traceSummary ? " Reference their trace (prompts, reverts, decision points)." : "") +
        " Make it personalized and timed so a generic pasted AI answer does not fit. No preamble, just the question.",
    },
    {
      role: "user",
      content: `Problem: ${args.problemTitle}\n${args.statement}\nCandidate code:\n${args.code}\nPrior Q&A: ${JSON.stringify(args.history)}${traceLine}\nAsk round ${args.round + 1} of 3.`,
    },
  ]);
  if (live) return { question: live.trim(), engine: INTERROGATE_MODEL };
  return { question: fallbackQuestion(args.round, args.problemTitle, args.code, args.fnName, args.history, args.traceSummary, args.lens), engine: "offline" };
}

export async function gradeAnswer(args: {
  round: number;
  question: string;
  answer: string;
  code: string;
  traceSummary?: string;
}): Promise<{ score: number; feedback: string; engine: string }> {
  const traceLine = args.traceSummary ? `\nCandidate trace: ${args.traceSummary}` : "";
  const live = await callMeta([
    {
      role: "system",
      content:
        'Grade a coding-defense answer 0-10 for specificity to the candidate code. Reply exactly as JSON: {"score": number, "feedback": "one sentence"}. Generic answers that fit any solution score <=4.' +
        (args.traceSummary ? " Reward answers that accurately reference their own trace (reverts, decision points)." : ""),
    },
    { role: "user", content: `Question: ${args.question}\nCandidate code:\n${args.code}\nAnswer: ${args.answer}${traceLine}` },
  ]);
  if (live) {
    try {
      const parsed = JSON.parse(live.slice(live.indexOf("{"), live.lastIndexOf("}") + 1));
      return { score: Math.max(0, Math.min(10, Number(parsed.score) || 0)), feedback: String(parsed.feedback || ""), engine: INTERROGATE_MODEL };
    } catch {
      /* fall through */
    }
  }
  const g = fallbackGrade(args.answer, args.round, args.code, args.traceSummary);
  return { ...g, engine: "offline" };
}
