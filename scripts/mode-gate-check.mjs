// Practice/Ranked gate check. Run against an isolated Codelit server/store,
// never the user's demo data:
// CODELIT_NATIVE_DATA_DIR=/tmp/codelit-mode-data npm run start -- --hostname 127.0.0.1 -p 3112
// CODELIT_TEST_URL=http://127.0.0.1:3112 node scripts/mode-gate-check.mjs
import assert from "node:assert/strict";

const base = process.env.CODELIT_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) {
  throw new Error("Set CODELIT_TEST_URL to an isolated loopback test server.");
}
let cookie = "";
async function request(route, body, headers = {}) {
  const response = await fetch(`${base}/api/native/${route}`, {
    method: body ? "POST" : "GET",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  return { status: response.status, data: await response.json() };
}
const ready = {
  adapter: "codex", adapterVersion: "test", ready: true, status: "ready", installed: true,
  models: [{ id: "test-model", label: "Test fixture model" }],
};
const pair = await request("pair", { op: "create" });
assert.equal(pair.status, 200);
const claim = await request("pair", { op: "claim", code: pair.data.code, label: "Mode gate fixture", adapters: [ready] });
assert.equal(claim.status, 200);
const credential = { "x-device-id": claim.data.deviceId, "x-device-token": claim.data.token };
await request("relay", { op: "poll", adapters: [ready] }, credential);

const start = (extra = {}) => request("session", {
  op: "start", scenarioId: "agent-two-sum", language: "python",
  deviceId: claim.data.deviceId, adapter: "codex", model: "test-model", ...extra,
});
const ranked = await start({ mode: "ranked" });
assert.equal(ranked.status, 403, "ranked with 0 practice solves must be forbidden");
assert.match(ranked.data.error, /5 practice/, "403 names the unlock requirement");

const practice = await start({ mode: "practice" });
assert.equal(practice.status, 200);
assert.equal(practice.data.attempt.mode, "practice", "practice start stamps its mode");

const listed = await request("devices?attempts=1");
assert.equal(listed.status, 200);
assert.ok(listed.data.attempts.some((a) => a.mode === "practice"), "attempts listing carries mode");

console.log("PASS: ranked 403 at 0 solves, practice start stamps mode, listing carries mode");
