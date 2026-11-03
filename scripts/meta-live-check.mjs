// Regression check: the contributor model spends ~200 tokens reasoning
// before answering, so a small max_tokens cap returns empty content and
// nextQuestion silently degrades to the offline interrogator. Stubs fetch
// to emulate that: content is only produced when the budget clears 1000.
// Offline, no key needed:  node scripts/meta-live-check.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const dir = await mkdtemp(join(tmpdir(), "codelit-meta-test-"));
try {
  const source = await readFile("src/lib/meta.ts", "utf8");
  await writeFile(
    join(dir, "meta.js"),
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  );
  let seenBudget = 0;
  globalThis.fetch = async (_url, init) => {
    seenBudget = JSON.parse(init.body).max_tokens;
    const content = seenBudget >= 1000 ? "What does your map store at each step?" : null;
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  process.env.MODEL_API_KEY = "test-key";
  const { nextQuestion } = require(join(dir, "meta.js"));
  const out = await nextQuestion({
    round: 0,
    problemTitle: "Two Sum",
    statement: "Return indices of two numbers that add up to target.",
    code: "def two_sum(nums, target):\n seen={}\n return []",
    fnName: "two_sum",
    history: [],
  });
  assert.ok(seenBudget >= 1000, `max_tokens budget ${seenBudget} is below the reasoning floor`);
  assert.notEqual(out.engine, "offline", "live model reply was discarded (empty content)");
  assert.match(out.question, /map store/);
  console.log(`PASS meta-live-check (max_tokens=${seenBudget}, engine=${out.engine})`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
