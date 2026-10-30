import test from "node:test";
import assert from "node:assert/strict";
import { startRpc } from "../lib/rpc.mjs";

test("RPC requests timeout and missing executables reject without unhandled process error", async () => {
  const rpc = startRpc(process.execPath, ["-e", "process.stdin.resume()"], { timeoutMs: 30 });
  try { await assert.rejects(rpc.request("initialize"), /timed out/); } finally { rpc.close(); }
  const missing = startRpc("/nonexistent/codelit-codex-test", [], { timeoutMs: 1000 });
  try { await assert.rejects(missing.request("initialize"), /Cannot start|pipe closed/); } finally { missing.close(); }
});

test("server replies resolve on write without waiting for a nonexistent reply to the reply", async () => {
  const child = `process.stdin.on('data', x => { for (const line of x.toString().trim().split('\\n')) { const o=JSON.parse(line); if(o.method) console.log(JSON.stringify({id:o.id,result:{ok:true}})); } });`;
  const rpc = startRpc(process.execPath, ["-e", child], { timeoutMs: 1000 });
  try {
    assert.deepEqual(await rpc.request("initialize"), { ok: true });
    await rpc.respond("approval-id", { decision: "decline" });
    await rpc.respondError("unknown", -32601, "unsupported");
  } finally { rpc.close(); }
});

test("process-group close kills a TERM-ignoring tool after its parent exits; no writes after deadline", { skip: process.platform === "win32" }, async (t) => {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "codelit-process-tree-"));
  const sentinel = join(dir, "writes");
  const tool = `const fs=require('node:fs'); process.on('SIGTERM',()=>{}); const write=()=>fs.appendFileSync(${JSON.stringify(sentinel)},'x'); write(); setInterval(write,5);`;
  const parent = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); spawn(process.execPath,['-e',${JSON.stringify(tool)}],{stdio:'ignore'}); process.stdin.on('data', x=>{const o=JSON.parse(x.toString()); const wait=()=>{if(fs.existsSync(${JSON.stringify(sentinel)})) console.log(JSON.stringify({id:o.id,result:{ready:true}})); else setTimeout(wait,5);}; wait();});`;
  const rpc = startRpc(process.execPath, ["-e", parent], { timeoutMs: 2000 });
  t.after(async () => { await rpc.close(); await rm(dir, { recursive: true, force: true }); });
  assert.deepEqual(await rpc.request("ready"), { ready: true });
  const started = Date.now();
  const closing = rpc.close({ graceMs: 50, killWaitMs: 50 });
  assert.strictEqual(rpc.close(), closing);
  const result = await closing;
  assert.ok(Date.now() - started < 1000, "close has a bounded deadline");
  assert.equal(result.containment, "process-group");
  assert.equal(result.forced, true, "the surviving TERM-ignoring descendant required SIGKILL");
  const afterClose = await readFile(sentinel, "utf8");
  assert.ok(afterClose.length > 0);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await readFile(sentinel, "utf8"), afterClose, "tool cannot write after awaited close deadline");
  await assert.rejects(rpc.request("after-close"), /closed/);
});
