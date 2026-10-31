// Upgrade regression: pre-index attempts must reconcile without allowing
// a connector to invent a prompt or borrow another attempt's reservation.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const data = new Map();
const source = await readFile(new URL("../src/lib/native/events.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: (name) => {
  if (name === "./store") return {
    storeGet: async (store, key) => data.get(`${store}:${key}`) ?? null,
    storeSet: async (store, key, value) => data.set(`${store}:${key}`, value),
  };
  if (name === "./secret") return { newId: () => "fixture-event" };
  if (name === "./lock") return { withNativeLock: async (_key, action) => action() };
  throw new Error(`Unexpected dependency: ${name}`);
} });
const { hasIssuedTurn } = exports;
assert.equal(await hasIssuedTurn("legacy", null), false);
assert.equal(await hasIssuedTurn("legacy", "unknown"), false);
data.set("events:legacy", { events: [
  { source: "connector", type: "prompt.accepted", turnId: "forged" },
  { source: "codelit", type: "prompt.accepted", turnId: "actual" },
] });
assert.equal(await hasIssuedTurn("legacy", "forged"), false);
assert.equal(await hasIssuedTurn("other-attempt", "actual"), false);
assert.equal(await hasIssuedTurn("legacy", "actual"), true);
assert.equal(data.get("kv:issuedturn:legacy:actual"), true);
data.delete("events:legacy");
assert.equal(await hasIssuedTurn("legacy", "actual"), true);
console.log("PASS: legacy server-issued turns recover their index; forged and foreign turns remain rejected.");
