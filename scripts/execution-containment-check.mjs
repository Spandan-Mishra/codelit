// Disposable, offline checks. Compiles only the runner modules, never starts Next or an account.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import http from 'node:http';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const dir = await mkdtemp(join(tmpdir(), 'codelit-containment-test-'));
const sentinel = resolve(`.execution-sentinel-${process.pid}`);
const server = http.createServer((_, res) => res.end('responsive'));
try {
  await mkdir(join(dir, 'execution'));
  for (const file of ['exec', 'runner', 'execution/sandbox']) {
    const source = await readFile(`src/lib/${file}.ts`, 'utf8');
    await writeFile(join(dir, `${file}.js`), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  }
  const { runJs, runPython, runCpp, isExecutionUnavailable } = require(join(dir, 'exec.js'));
  const sandbox = require(join(dir, 'execution/sandbox.js'));
  const test = (input, expected) => [{ input, expected }];
  const ok = (results) => assert.ok(results.every(r => r.passed), JSON.stringify(results));
  await writeFile(sentinel, 'synthetic-app-file');
  process.env.CODELIT_TEST_EVALUATOR_SECRET = 'synthetic-env-only';
  try {
    ok(await runJs('function sum(a,b){return a+b}', 'sum', test('sum(2,3)', '5')));
  } catch (e) {
    if (isExecutionUnavailable(e)) {
      console.error('FAIL CLOSED: sandbox unavailable; no candidate executed. Restore namespaces/runtimes and rerun.');
      throw e;
    }
    throw e;
  }
  ok(await runPython('def sum(a,b):\n return a+b', 'sum', test('sum(2,3)', '5')));
  ok(await runCpp('int sum(int a,int b){return a+b;}', 'sum', test('sum(2,3)', '5'), 'int'));
  // Preserve typed comparisons, camel names, bool, groups, string, matrix and noisy stdout.
  ok(await runJs('function twoSum(){ console.log("noise"); return [1,0] }', 'two_sum', test('two_sum()', '[0, 1]')));
  ok(await runPython('def yes():\n print("noise")\n return True', 'yes', test('yes()', 'True')));
  for (const [ret, code, expected] of [
    ['bool', 'bool f(){return true;}', 'True'],
    ['str', 'string f(){return "hello";}', '"hello"'],
    ['vecvec', 'vector<vector<int>> f(){return {{1,2},{3}};}', '[[1,2],[3]]'],
    ['groups', 'vector<vector<string>> f(){return {{"eat","tea"},{"bat"}};}', 'groups: eat,tea | bat'],
  ]) ok(await runCpp(code, 'f', test('f()', expected), ret));
  ok(await runJs(`function probe(){const fs=require('fs'); return !fs.existsSync(${JSON.stringify(sentinel)}) && !fs.existsSync('/proc/1/root'+${JSON.stringify(sentinel)}) && process.env.CODELIT_TEST_EVALUATOR_SECRET===undefined}`, 'probe', test('probe()', 'True')));
  ok(await runPython(`import os\ndef probe():\n return not os.path.exists(${JSON.stringify(sentinel)}) and 'CODELIT_TEST_EVALUATOR_SECRET' not in os.environ`, 'probe', test('probe()', 'True')));
  ok(await runCpp(`bool probe(){ifstream f(${JSON.stringify(sentinel)});return !f.good() && getenv("CODELIT_TEST_EVALUATOR_SECRET")==nullptr;}`, 'probe', test('probe()', 'True'), 'bool'));
  ok(await runPython(`def probe():\n for path in ['/outside-work','/dev/regular-file']:\n  try:\n   open(path,'w').write('x')\n   return False\n  except OSError: pass\n open('/work/private-marker','w').write('disposable')\n return True`, 'probe', test('probe()', 'True')));
  ok(await runPython(`import os\ndef probe():\n return not os.path.exists('/work/private-marker')`, 'probe', test('probe()', 'True')));
  // No external networking: loopback has no listening host server in the new net namespace.
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  ok(await runPython(`import socket\ndef probe():\n s=socket.socket();s.settimeout(.2)\n return s.connect_ex(('127.0.0.1',${port})) != 0`, 'probe', test('probe()', 'True')));
  const timings = {};
  for (const [name, run] of [
    ['javascript', () => runJs('function loop(){while(true){}}', 'loop', test('loop()', '0'))],
    ['python', () => runPython('def loop():\n while True: pass', 'loop', test('loop()', '0'))],
    ['cpp', () => runCpp('int loop(){while(true){} return 0;}', 'loop', test('loop()', '0'), 'int')],
  ]) {
    const start = performance.now();
    const pending = run();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'responsive');
    const results = await pending;
    timings[name] = Math.round(performance.now() - start);
    assert.ok(results.every(r => !r.passed && r.actual.startsWith('ERROR:')));
    assert.ok(timings[name] < (name === 'cpp' ? 17000 : 5000));
  }
  // A child that creates a new session must die with the sandbox PID namespace.
  const childToken = `codelit_child_${process.pid}_${Date.now()}`;
  const escapedChild = `import subprocess\ndef loop():\n subprocess.Popen(['/usr/bin/python3','-c', ${JSON.stringify(`import time; token="${childToken}"; time.sleep(60)`) }], start_new_session=True)\n while True: pass`;
  assert.ok((await runPython(escapedChild, 'loop', test('loop()', '0'))).every(r => !r.passed));
  const { readdir } = await import('node:fs/promises');
  for (const pid of (await readdir('/proc')).filter(p => /^\d+$/.test(p))) {
    let cmdline = '';
    try { cmdline = await readFile(`/proc/${pid}/cmdline`, 'utf8'); } catch { continue; }
    assert.ok(!cmdline.includes(childToken), 'sandbox descendant survived hard termination');
  }
  assert.ok((await runPython('invalid syntax !!', 'f', test('f()', '0'))).every(r => !r.passed));
  assert.ok((await runCpp('invalid syntax !!', 'f', test('f()', '0'), 'int')).every(r => !r.passed));
  assert.ok((await runJs('invalid syntax !!', 'f', test('f()', '0'))).every(r => !r.passed));
  // Inject unavailable spawn and inaccessible filesystem without changing actual system binaries.
  const cp = require('node:child_process');
  const originalSpawn = cp.spawn;
  cp.spawn = () => { throw new Error('synthetic missing launcher'); };
  try { await assert.rejects(() => runJs('function f(){return 1}', 'f', test('f()', '1')), isExecutionUnavailable); }
  finally { cp.spawn = originalSpawn; }
  const fs = require('node:fs/promises');
  const originalAccess = fs.access;
  fs.access = async () => { throw new Error('synthetic inaccessible runtime'); };
  try { await assert.rejects(() => runPython('def f(): return 1', 'f', test('f()', '1')), isExecutionUnavailable); }
  finally { fs.access = originalAccess; }
  assert.equal(sandbox.EXECUTION_LIMITS.maxConcurrent, 2);
  console.log(JSON.stringify({ status: 'passed', loopWallMs: timings, sentinelAndEnv: 'all three languages denied', network: 'host loopback denied', web: 'synthetic HTTP responsive during every loop', unavailable: 'retryable, no fallback' }, null, 2));
} finally {
  delete process.env.CODELIT_TEST_EVALUATOR_SECRET;
  await new Promise(resolve => server.close(resolve));
  await rm(sentinel, { force: true });
  await rm(dir, { recursive: true, force: true });
}
