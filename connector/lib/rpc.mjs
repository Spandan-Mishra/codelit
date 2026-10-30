// JSONL App Server transport. Only requests await responses; replies to
// server-initiated requests are writes, not new pending client requests.
import { spawn } from "node:child_process";
import readline from "node:readline";

export function startRpc(command, args, opts = {}) {
  // A dedicated POSIX process group contains ordinary tool descendants even
  // when the App Server exits before them. Session-escaping children are not
  // a security sandbox and are outside this containment guarantee.
  const processGroup = process.platform !== "win32";
  const proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], cwd: opts.cwd, env: opts.env, detached: processGroup });
  const rl = readline.createInterface({ input: proc.stdout });
  let nextId = 1;
  let closed = false;
  let closing;
  const pending = new Map();
  const handlers = { notification: () => {}, serverRequest: null, unknown: () => {}, exit: () => {} };
  // Drain stderr (otherwise a verbose child can block). Do not relay logs:
  // provider diagnostics can contain account details or environment values.
  proc.stderr.resume();
  function fail(error) {
    if (closed) return;
    closed = true;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
    pending.clear();
    handlers.exit(error.message);
  }
  function write(obj) {
    if (closed) return Promise.reject(new Error("App Server transport is closed"));
    return new Promise((resolve, reject) => {
      proc.stdin.write(JSON.stringify(obj) + "\n", (err) => err ? reject(err) : resolve(null));
    });
  }
  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`App Server ${method} timed out`));
      }, opts.timeoutMs ?? 20000);
      pending.set(id, { resolve, reject, timer });
      write({ id, method, params: params ?? {} }).catch((error) => {
        clearTimeout(timer); pending.delete(id); reject(error);
      });
    });
  }
  rl.on("line", (line) => {
    if (closed) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && ("result" in msg || "error" in msg)) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id); clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`App Server RPC ${msg.error.code}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.id !== undefined && msg.method) {
      if (handlers.serverRequest) handlers.serverRequest(msg);
      else write({ id: msg.id, error: { code: -32601, message: "Unsupported request" } }).catch(() => {});
    } else if (msg.method) handlers.notification(msg);
    else handlers.unknown(msg);
  });
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function signalTree(signal) {
    if (!proc.pid) return false;
    try {
      if (processGroup) process.kill(-proc.pid, signal);
      else proc.kill(signal);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      throw error;
    }
  }
  function treeExists() {
    if (!proc.pid) return false;
    if (!processGroup) return proc.exitCode === null && proc.signalCode === null;
    try { process.kill(-proc.pid, 0); return true; }
    catch (error) { if (error.code === "ESRCH") return false; throw error; }
  }
  function close({ graceMs = opts.graceMs ?? 250, killWaitMs = opts.killWaitMs ?? 100 } = {}) {
    if (closing) return closing;
    // Clamp caller values so even a malformed shutdown policy stays bounded.
    const bounded = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(value, 5000)) : fallback;
    closing = (async () => {
      fail(new Error("App Server transport closed"));
      rl.close(); proc.stdin.destroy();
      let forced = false;
      signalTree("SIGTERM");
      const deadline = Date.now() + bounded(graceMs, 250);
      while (treeExists() && Date.now() < deadline) await pause(Math.min(10, Math.max(1, deadline - Date.now())));
      if (treeExists()) { forced = true; signalTree("SIGKILL"); }
      const killDeadline = Date.now() + bounded(killWaitMs, 100);
      while (treeExists() && Date.now() < killDeadline) await pause(Math.min(10, Math.max(1, killDeadline - Date.now())));
      // Zombies can keep a group observable after SIGKILL. Do not claim a
      // confirmed exit merely because the pipes/direct child disappeared.
      return { containment: processGroup ? "process-group" : "direct-child-only", forced,
        completion: treeExists() ? "unknown" : "stopped" };
    })();
    return closing;
  }
  function unexpected(error) { fail(error); void close().catch(() => {}); }
  proc.on("error", (error) => unexpected(new Error(`Cannot start ${command}: ${error.code || "spawn failed"}`)));
  proc.stdin.on("error", () => unexpected(new Error("App Server input pipe closed")));
  proc.on("exit", (code, signal) => unexpected(new Error(`App Server exited (${code ?? signal})`)));
  return {
    proc, request,
    notify: (method, params) => write({ method, params: params ?? {} }),
    respond: (id, result) => write({ id, result }),
    respondError: (id, code, message) => write({ id, error: { code, message } }),
    on: (kind, fn) => { handlers[kind] = fn; },
    close,
  };
}
