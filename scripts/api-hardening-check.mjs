// API hardening check. Run against an isolated loopback server:
// CODELIT_TEST_URL=http://127.0.0.1:3116 node scripts/api-hardening-check.mjs
import assert from "node:assert/strict";

const base = process.env.CODELIT_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) {
  throw new Error("Set CODELIT_TEST_URL to an isolated loopback test server.");
}

async function raw(route, { method = "POST", body, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body } : {}),
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* health and errors are checked by status */ }
  return { status: response.status, data, headers: response.headers };
}

for (const route of ["/api/run", "/api/interrogate", "/api/leaderboard"]) {
  const res = await raw(route, { body: "{bad json" });
  assert.equal(res.status, 400, `${route} must reject malformed JSON with 400`);
}

const health = await raw("/api/health", { method: "GET", body: undefined });
assert.equal(health.status, 200, "health endpoint must return 200");
assert.equal(health.data?.ok, true, "health endpoint must report ok");

// A changing X-Forwarded-For must not change browser identity once the
// signed anonymous cookie exists. Duel ownership is the observable surface.
const first = await raw("/api/duel", {
  body: JSON.stringify({ action: "create", difficulty: "easy", scenarioId: "agent-two-sum" }),
  headers: { "X-Forwarded-For": "203.0.113.10" },
});
assert.equal(first.status, 200, JSON.stringify(first.data));
const duelId = first.data?.duelId;
assert.ok(duelId, "duel create must return an id");
const cookie = first.headers.get("set-cookie")?.split(";")[0] || "";
assert.match(cookie, /^codelit_anon=/, "proxy must issue the anonymous identity cookie");

const second = await raw("/api/duel", {
  body: JSON.stringify({ action: "status", duelId }),
  headers: { "X-Forwarded-For": "203.0.113.99", Cookie: cookie },
});
assert.equal(second.status, 200, "same browser with a different spoofed XFF must still own its duel");
assert.equal(second.data?.scenarioId, "agent-two-sum");

console.log("PASS: malformed JSON is 400, health is live, spoofed XFF cannot steal browser identity");
