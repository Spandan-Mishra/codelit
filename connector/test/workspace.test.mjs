import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { outputsMatch, runVisible } from "../lib/workspace.mjs";

test("typed visible comparator ignores collection formatting but preserves strings, order and bool types", () => {
  assert.equal(outputsMatch("[0,1]", "[0, 1]"), true);
  assert.equal(outputsMatch("true", "True"), true);
  assert.equal(outputsMatch("['one', False, None]", '["one", false, null]'), true);
  assert.equal(outputsMatch('["True", "a  b"]', "['True', 'a  b']"), true);
  assert.equal(outputsMatch('["a  b"]', '["a b"]'), false);
  assert.equal(outputsMatch("1", "True"), false);
  assert.equal(outputsMatch("[1,0]", "[0,1]"), false);
  assert.equal(outputsMatch("[1,0]", "[0,1]", "two_sum"), true);
});

test("local JavaScript checks use typed outputs; C++ explicitly unavailable rather than failed", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codelit-visible-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, "solution.js"), "function pair(){ return [0,1]; }");
  const tests = [{ input: "pair()", expected: "[0, 1]" }];
  const result = await runVisible(dir, "javascript", tests, "pair");
  assert.equal(result.passed, 1);
  const cpp = await runVisible(dir, "c++", tests, "pair");
  assert.equal(cpp.unavailable, true); assert.equal(cpp.passed, null);
});
