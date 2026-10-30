// Run against an isolated Codelit server/store, never the user's demo data:
// CODELIT_TEST_URL=http://127.0.0.1:3100 node scripts/native-api-check.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

const base = process.env.CODELIT_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) {
  throw new Error("Set CODELIT_TEST_URL to an isolated loopback test server.");
}
let cookie = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function request(route, body, headers = {}) {
  // Pace writes to stay under the prod rate limits (60/min session, 10/min
  // pair/claim); the limits themselves are the product behavior under test.
  if (body) await sleep(1100);
  const response = await fetch(`${base}/api/native/${route}`, {
    method: body ? "POST" : "GET", headers: {
      ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers,
    }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  const data = await response.json();
  return { status: response.status, data };
}
const ready = {
  adapter: "codex", adapterVersion: "test", ready: true, status: "ready", installed: true,
  models: [{ id: "test-model", label: "Test fixture model" }],
};
const pair = await request("pair", { op: "create" });
assert.equal(pair.status, 200);
const claim = await request("pair", { op: "claim", code: pair.data.code, label: "API regression fixture", adapters: [ready] });
assert.equal(claim.status, 200);
const deviceId = claim.data.deviceId;
const credential = { "x-device-id": deviceId, "x-device-token": claim.data.token };
const relay = (body) => request("relay", body, credential);
let devices = await request("devices");
assert.equal(devices.data.devices.find((d) => d.deviceId === deviceId).online, false, "pairing alone is not online");
const start = (model = "test-model") => request("session", { op: "start", scenarioId: "agent-two-sum", language: "python", deviceId, adapter: "codex", model });
assert.equal((await start()).status, 409, "offline starts must fail");
await relay({ op: "poll", adapters: [ready] });
assert.equal((await start("made-up-model")).status, 409, "unadvertised model must fail");
await relay({ op: "poll", adapters: [{ ...ready, ready: false, status: "unauthenticated" }] });
assert.equal((await start()).status, 409, "unsigned-in provider must fail");
await relay({ op: "poll", adapters: [ready] });
const created = await start();
assert.equal(created.status, 200);
const attemptId = created.data.attempt.id;
const op = (name, extra = {}) => request("session", { op: name, attemptId, ...extra });
let session = await request(`events?attemptId=${attemptId}`);
assert.equal(session.data.scenario.stages.length, 1);
assert.equal(session.data.scenario.stages[0].title, "Core pair");
assert.equal((await op("stage")).status, 409, "stages must require passing checks");
const escapedPrompt = '"\n'.repeat(2999);
assert.equal((await op("send", { text: escapedPrompt })).status, 200);
assert.equal((await op("interrupt")).status, 200);
session = await request(`events?attemptId=${attemptId}`);
assert.equal(session.data.attempt.turnsReserved, 0, "Stop cancels a queued prompt without waiting for the connector");
assert.equal(session.data.attempt.turnsUsed, 0, "a never-delivered prompt does not spend inference budget");
const sends = await Promise.all([op("send", { text: "Implement it in the file." }), op("send", { text: "Duplicate click." })]);
assert.deepEqual(sends.map((r) => r.status).sort(), [200, 409], "one concurrent send wins");
const turnId = sends.find((r) => r.status === 200).data.turnId;
const delivery = await relay({ op: "poll" });
assert.ok(delivery.data.commands.some((c) => c.type === "turn.send"));
assert.equal((await op("interrupt")).status, 200);
const cancellation = await relay({ op: "poll" });
assert.ok(cancellation.data.commands.some((c) => c.type === "turn.interrupt" && c.payload.pendingTurnIds.includes(turnId)), "Stop names delivered turns even if the execution response was lost");
let seq = 0;
function event(type, payload = {}, overrides = {}) {
  return { v: 1, id: `ev_${randomUUID()}`, attemptId, deviceId, nativeSessionId: "test-native-thread", turnId,
    parentId: null, type, source: "connector", sourceSeq: seq++, sourceTime: Date.now(), adapter: "codex", model: "test-model", payload, ...overrides };
}
const solution = "def two_sum(nums, target):\n    seen = {}\n    for i, value in enumerate(nums):\n        if target-value in seen:\n            return [seen[target-value], i]\n        seen[value] = i\n    return []\n";
const largeSolution = solution + "# padding for a file larger than the old event limit\n".repeat(180);
assert.equal((await relay({ op: "events", events: [event("prompt.forwarded", { text: escapedPrompt }), event("turn.started"), event("approval.requested", { approvalId: "test-approval", expiresAt: Date.now() + 10000, kind: "file" })] })).status, 200);
assert.equal((await op("approval", { approvalId: "invented", decision: "allow-once" })).status, 409);
assert.equal((await op("approval", { approvalId: "test-approval", decision: "allow-once" })).status, 200);
assert.equal((await op("approval", { approvalId: "test-approval", decision: "allow-once" })).status, 409, "approval is single-use");
const ended = event("turn.completed");
assert.equal((await relay({ op: "events", events: [event("file.revision", { content: largeSolution, rev: 1 }), event("approval.requested", { approvalId: "ended-turn-approval", expiresAt: Date.now() + 10000, kind: "file" }), ended] })).status, 200);
assert.equal((await op("approval", { approvalId: "ended-turn-approval", decision: "allow-once" })).status, 409, "an approval cannot outlive the turn that requested it");
await relay({ op: "events", events: [ended, event("turn.completed")] });
session = await request(`events?attemptId=${attemptId}`);
assert.equal(session.data.attempt.turnsUsed, 1, "terminal replay cannot spend a prompt twice");
assert.equal(session.data.attempt.turnsReserved, 0);
assert.equal(session.data.events.filter((e) => e.id === ended.id).length, 1, "event replay is deduplicated");
assert.equal(session.data.events.find((e) => e.type === "file.revision").payload.content, largeSolution);
const checked = await op("test");
assert.equal(checked.status, 200);
assert.equal(checked.data.passedCount, checked.data.totalCount);
assert.equal((await op("stage")).data.stage, 2);
session = await request(`events?attemptId=${attemptId}`);
assert.equal(session.data.scenario.stages.length, 2);
assert.match(session.data.scenario.stages[1].brief, /duplicate/i);
assert.equal((await op("stage")).status, 409, "stage 2 requires its own checks");
assert.equal((await op("test")).status, 200);
assert.equal((await op("stage")).data.stage, 3);
assert.equal((await op("rename", { title: "My verified pair solution" })).status, 200);
assert.equal((await op("archive")).status, 200);
assert.equal((await op("send", { text: "archived" })).status, 409);
assert.equal((await op("restore")).status, 200);
const history = await request("devices?attempts=1");
const summary = history.data.attempts.find((a) => a.id === attemptId);
assert.equal(summary.title, "My verified pair solution");
assert.equal(summary.progress.hasSolution, true);
assert.equal(summary.progress.stage, 3);
assert.equal(summary.shortId.length, 8);
assert.equal((await op("provider", { adapter: "claude" })).status, 409);
assert.equal((await op("provider", { adapter: "codex", model: "test-model" })).status, 200);
const frozen = await op("finish");
assert.equal(frozen.data.freezing, true);
assert.equal((await relay({ op: "snapshot", attemptId, language: "python", path: "../solution.py", source: solution })).status, 400);
assert.equal((await relay({ op: "snapshot", attemptId, language: "javascript", path: "solution.js", source: solution })).status, 400);
async function freezeEcho(id, pollAs) {
  const box = await pollAs({ op: "poll", attemptId: id });
  const cmd = box.data.commands.find((c) => c.type === "freeze.request");
  assert.ok(cmd, "freeze.request delivered with binding");
  return { freezeId: cmd.payload.freezeId, sessionEpoch: cmd.payload.sessionEpoch, expectedRevision: cmd.payload.expectedRevision, expectedHash: cmd.payload.expectedHash };
}
const mainFreeze = await freezeEcho(attemptId, relay);
assert.equal((await relay({ op: "snapshot", attemptId, language: "python", path: "solution.py", source: solution, revision: 1, ...mainFreeze })).status, 200);
// A second disposable attempt checks simultaneous snapshot upload/evaluation.
const race = await start();
assert.equal(race.status, 200);
const raceId = race.data.attempt.id;
const raceOp = (name) => request("session", { op: name, attemptId: raceId });
await relay({ op: "events", events: [event("file.revision", { content: solution, rev: 1 }, { attemptId: raceId, turnId: null, nativeSessionId: "race-thread" })] });
for (let stage = 1; stage <= 2; stage++) {
  assert.equal((await raceOp("test")).status, 200);
  assert.equal((await raceOp("stage")).data.stage, stage + 1);
}
assert.equal((await raceOp("finish")).data.freezing, true);
const raceFreeze = await freezeEcho(raceId, relay);
const uploadRace = (source, extra = {}) => relay({ op: "snapshot", attemptId: raceId, language: "python", path: "solution.py", source, revision: 1, ...raceFreeze, ...extra });
assert.equal((await uploadRace(solution)).status, 200);
const [raceFinish, raceUpload] = await Promise.all([raceOp("finish"), uploadRace(solution + "\n# concurrent upload\n")]);
assert.equal(raceFinish.status, 200);
assert.ok([200, 409].includes(raceUpload.status));
const raced = await request(`events?attemptId=${raceId}`);
assert.equal(raced.status, 200);
assert.equal(createHash("sha256").update(`python\n${raced.data.snapshot.content}`).digest("hex"), raced.data.attempt.submissionHash, "displayed frozen bytes always match evaluated hash under upload/evaluation concurrency");
// Third disposable attempt: server-verdict allowlist, issued turns, human
// edits, same/cross-session transfer with epoch bump, freeze mismatch, delete.
const third = await start();
assert.equal(third.status, 200);
const thirdId = third.data.attempt.id;
const thirdOp = (name, extra = {}) => request("session", { op: name, attemptId: thirdId, ...extra });
const thirdEvent = (type, payload = {}, overrides = {}) => event(type, payload, { ...overrides, attemptId: thirdId, turnId: null, nativeSessionId: "third-thread" });
const owner = cookie;
assert.equal((await relay({ op: "events", events: [thirdEvent("official.test", { passedCount: 1, totalCount: 1 })] })).status, 400, "server verdicts are never connector-submitted");
assert.equal((await relay({ op: "events", events: [thirdEvent("turn.completed", {}, { turnId: "never-issued" })] })).status, 409, "foreign terminals cannot move budgets");
assert.equal((await thirdOp("edit", { code: "print(1)", baseRev: -1 })).status, 400);
assert.equal((await thirdOp("edit", { code: "print(1)", baseRev: 0 })).status, 200);
const editBox = await relay({ op: "poll", attemptId: thirdId });
assert.ok(editBox.data.commands.some((c) => c.type === "human.edit"), "idle edit travels as human.edit");
assert.equal((await relay({ op: "events", events: [thirdEvent("file.revision", { content: solution, rev: 1 })] })).status, 200);
cookie = "";
const pair3 = await request("pair", { op: "create" });
const claim3 = await request("pair", { op: "claim", code: pair3.data.code, label: "foreign device", adapters: [ready] });
const device3 = claim3.data.deviceId;
cookie = owner;
assert.equal((await thirdOp("transfer", { toDeviceId: device3 })).status, 404, "a foreign device is not even addressable for transfer");
const pair2 = await request("pair", { op: "create" });
const claim2 = await request("pair", { op: "claim", code: pair2.data.code, label: "second device", adapters: [ready] });
const device2 = claim2.data.deviceId;
const relay2 = (body) => request("relay", body, { "x-device-id": device2, "x-device-token": claim2.data.token });
assert.equal((await thirdOp("transfer", { toDeviceId: device2 })).status, 200);
const moved = await request(`events?attemptId=${thirdId}`);
assert.equal(moved.data.attempt.deviceId, device2);
assert.ok(moved.data.attempt.sessionEpoch > 0, "transfer bumps the epoch");
const movedBox = await relay2({ op: "poll", attemptId: thirdId });
assert.ok(Array.isArray(movedBox.data.leases) && movedBox.data.leases.length === 1, "poll carries the per-session lease");
assert.equal((await thirdOp("test")).status, 200);
assert.equal((await thirdOp("stage")).data.stage, 2);
assert.equal((await thirdOp("test")).status, 200);
assert.equal((await thirdOp("stage")).data.stage, 3);
assert.equal((await thirdOp("finish")).data.freezing, true);
const thirdFreeze = await freezeEcho(thirdId, relay2);
assert.equal((await relay2({ op: "snapshot", attemptId: thirdId, language: "python", path: "solution.py", source: "print(1)", revision: 0, ...thirdFreeze, freezeId: "freeze_wrong" })).status, 409, "superseded freeze bytes are rejected");
assert.equal((await relay2({ op: "snapshot", attemptId: thirdId, language: "python", path: "solution.py", source: "print(1)", revision: 5, ...thirdFreeze })).status, 409, "wrong revision is rejected");
assert.equal((await thirdOp("reopen")).status, 200, "stuck freeze reopens and cancels its generation");
assert.equal((await thirdOp("delete")).status, 200);
assert.equal((await request(`events?attemptId=${thirdId}`)).status, 404);
assert.equal((await thirdOp("delete")).status, 404);
assert.equal((await request("devices", { op: "revoke", deviceId })).status, 200);
const final = await op("finish");
assert.equal(final.data.acceptance.passed, true, "a snapshot already uploaded can be evaluated without a connected device");
assert.ok(final.data.results.some((r) => r.hidden));
assert.ok(final.data.results.filter((r) => r.hidden).every((r) => !r.input && !r.expected && !r.actual), "hidden cases do not leak");
assert.equal((await op("finish")).data.acceptance.passed, true, "finish is idempotent");
session = await request(`events?attemptId=${attemptId}`);
assert.equal(session.data.snapshot.content, solution, "accepted view uses the frozen artifact rather than a different live revision");
assert.notEqual(session.data.events.filter((e) => e.type === "file.revision").at(-1).payload.content, solution);
const ownerCookie = cookie;
cookie = "";
assert.equal((await request(`events?attemptId=${attemptId}`)).status, 401);
await request("pair", { op: "create" });
assert.equal((await request(`events?attemptId=${attemptId}`)).status, 404, "another session cannot read the trace");
cookie = ownerCookie;
console.log("Native API flow passed: provider readiness/model validation, owned history, stage checks, large files, replay, freeze and hidden acceptance.");
