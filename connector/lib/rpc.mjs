// JSON-RPC 2.0 over stdio (JSONL) for the Codex App Server.
// Requests carry ids; server-initiated approval/other requests arrive
// without our id and are routed to onServerRequest. Unknown notifications
// are surfaced to onUnknown, never dropped silently, never crash the loop.

import { spawn } from "node:child_process";
import readline from "node:readline";

export function startRpc(command, args, opts = {}) {
  const proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
  const rl = readline.createInterface({ input: proc.stdout });
  let nextId = 1;
  const pending = new Map();
  const handlers = { notification: () => {}, serverRequest: null, unknown: () => {}, exit: () => {} };

  function send(obj) {
    return new Promise((resolve, reject) => {
      if (obj.id !== undefined) pending.set(obj.id, { resolve, reject });
      proc.stdin.write(JSON.stringify(obj) + "\n", (err) => {
        if (err) {
          pending.delete(obj.id);
          reject(err);
        } else if (obj.id === undefined) resolve(null);
      });
    });
  }

  rl.on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`rpc ${msg.error.code}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    if (msg.id !== undefined && msg.method) {
      // Server-initiated request (approvals): holder must respond exactly once.
      if (handlers.serverRequest) handlers.serverRequest(msg);
      else send({ id: msg.id, result: null }).catch(() => {});
      return;
    }
    if (msg.method) handlers.notification(msg);
    else handlers.unknown(msg);
  });

  proc.on("exit", (code, signal) => {
    for (const [, p] of pending) p.reject(new Error(`transport exited (${code ?? signal})`));
    pending.clear();
    handlers.exit(code, signal);
  });

  return {
    proc,
    request: (method, params) => send({ method, id: nextId++, params: params ?? {} }),
    notify: (method, params) => send({ method, params: params ?? {} }),
    respond: (id, result) => send({ id, result }),
    respondError: (id, code, message) => send({ id, error: { code, message } }),
    on: (kind, fn) => { handlers[kind] = fn; },
    close: () => { try { proc.stdin.end(); } catch {} proc.kill(); },
  };
}
