import { spawn } from "node:child_process";
import { access, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class ExecutionUnavailableError extends Error {
  readonly code = "EXECUTION_UNAVAILABLE";
  readonly retryable = true;
  constructor(message = "Isolated execution is unavailable; retry after the sandbox is restored.") {
    super(message);
    this.name = "ExecutionUnavailableError";
  }
}
export function isExecutionUnavailable(error: unknown): error is ExecutionUnavailableError {
  return error instanceof ExecutionUnavailableError;
}

export const EXECUTION_LIMITS = {
  runMs: 3000, compileAndRunMs: 15000, outputBytes: 256 * 1024,
  addressSpaceBytes: 2 * 1024 ** 3, fileBytes: 16 * 1024 ** 2,
  shmBytes: 4 * 1024 ** 2, tmpBytes: 32 * 1024 ** 2, workBytes: 64 * 1024 ** 2, maxConcurrent: 2,
} as const;

export interface SandboxResult { stdout: string; stderr: string; failure?: string }
let active = 0;

async function processLimit(): Promise<number> {
  // RLIMIT_NPROC counts every thread for the host UID, including unrelated web
  // workers. Reserve a small allowance above the current baseline on shared dev
  // hosts. Deploy under a dedicated non-root UID for a stable process bound.
  if (process.getuid?.() === 0) throw new ExecutionUnavailableError("Isolated execution requires a non-root service UID.");
  const uid = String(process.getuid?.());
  const entries = await readdir("/proc");
  const counts = await Promise.all(entries.filter(p => /^\d+$/.test(p)).map(async p => {
    try {
      const status = await readFile(`/proc/${p}/status`, "utf8");
      return status.match(/^Uid:\s+(\d+)/m)?.[1] === uid ? Number(status.match(/^Threads:\s+(\d+)/m)?.[1] ?? 1) : 0;
    } catch { return 0; } // A process can exit during enumeration.
  }));
  return counts.reduce((a, b) => a + b, 0) + 64;
}

async function launch(args: string[], timeout: number): Promise<SandboxResult> {
  const nproc = await processLimit();
  return new Promise((resolve, reject) => {
    // Only this trusted launcher runs on the host. No candidate bytes are shell arguments.
    const child = spawn("/usr/bin/prlimit", [
      `--as=${EXECUTION_LIMITS.addressSpaceBytes}`, "--cpu=12", `--nproc=${nproc}`, "--nofile=64",
      `--fsize=${EXECUTION_LIMITS.fileBytes}`, "--core=0", "--", "/usr/bin/bwrap", ...args,
    ], { detached: true, env: { NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", bytes = 0, failure: string | undefined;
    const kill = (why: string) => {
      failure ??= why;
      if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ } }
    };
    const timer = setTimeout(() => kill("execution wall-clock limit exceeded"), timeout);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > EXECUTION_LIMITS.outputBytes) kill("execution output limit exceeded");
      else stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > EXECUTION_LIMITS.outputBytes) kill("execution output limit exceeded");
      else stderr += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new ExecutionUnavailableError());
    });
    // close waits for inherited pipes too; timer kills the entire launcher group.
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (/^(bwrap|prlimit):/m.test(stderr)) return reject(new ExecutionUnavailableError());
      resolve({ stdout, stderr, failure: failure ?? (code === 0 ? undefined : `execution failed (${signal ?? code}): ${stderr.trim().slice(-2000)}`) });
    });
  });
}

async function baseArgs(dir: string): Promise<string[]> {
  await Promise.all(["/usr/bin/bwrap", "/usr/bin/prlimit"].map(p => access(p, constants.X_OK)));
  const args = [
    "--unshare-user", "--unshare-pid", "--unshare-net", "--unshare-ipc", "--unshare-uts", "--unshare-cgroup",
    "--disable-userns", "--die-with-parent", "--cap-drop", "ALL", "--clearenv",
    "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "HOME", "/tmp", "--setenv", "LANG", "C.UTF-8",
  ];
  // Deliberately omit /usr/local, /etc, /home, app files, host /tmp, sockets and credentials.
  for (const p of ["/usr/bin", "/usr/lib", "/usr/include", "/usr/lib64"]) {
    try { await access(p); args.push("--ro-bind", p, p); } catch { /* optional system directory */ }
  }
  for (const p of ["/bin", "/lib", "/lib64"]) {
    try { args.push("--ro-bind", await realpath(p), p); } catch { /* optional ABI directory */ }
  }
  args.push("--proc", "/proc", "--dev", "/dev", "--size", String(EXECUTION_LIMITS.shmBytes), "--tmpfs", "/dev/shm",
    "--remount-ro", "/dev", "--remount-ro", "/proc", "--size", String(EXECUTION_LIMITS.tmpBytes), "--tmpfs", "/tmp",
    "--size", String(EXECUTION_LIMITS.workBytes), "--tmpfs", "/work", "--ro-bind", dir, "/submission", "--chdir", "/work");
  return args;
}

/** No host execution fallback. All source, including C++ compiler input, stays inside namespaces. */
export async function runSandbox(language: "js" | "python" | "cpp", files: Record<string, string>): Promise<SandboxResult> {
  if (active >= EXECUTION_LIMITS.maxConcurrent) throw new ExecutionUnavailableError("Isolated execution is busy; retry shortly.");
  active++;
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), "codelit-isolated-"));
    await Promise.all(Object.entries(files).map(([name, content]) => {
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new ExecutionUnavailableError();
      return writeFile(join(dir!, name), content, { mode: 0o600 });
    }));
    const args = await baseArgs(dir);
    const runtime = language === "js" ? "/runtime/node" : language === "python" ? "/usr/bin/python3" : "/usr/bin/g++";
    if (language === "js") {
      await access(process.execPath, constants.X_OK);
      args.push("--ro-bind", await realpath(process.execPath), runtime);
    } else await access(runtime, constants.X_OK);
    args.push("--remount-ro", "/");
    // Run the selected runtime in the exact sandbox before candidate execution. A broken
    // namespace, dynamic loader or missing compiler is infrastructure, never a wrong answer.
    const probeCommand = language === "js"
      ? [runtime, "--jitless", "--max-old-space-size=128", "-e", "require('node:fs'); require('node:process')"]
      : language === "python"
        ? [runtime, "-I", "-B", "-c", "import io, contextlib"]
        : ["/usr/bin/sh", "-c", "printf '#include <vector>\\nint main(){std::vector<int> v;return v.size();}\\n' | g++ -x c++ - -o /work/probe && /work/probe"];
    const probe = await launch([...args, "--", ...probeCommand], 4000);
    if (probe.failure) throw new ExecutionUnavailableError();
    const command = language === "js"
      ? [runtime, "--jitless", "--max-old-space-size=128", "/submission/driver.cjs"]
      : language === "python"
        ? [runtime, "-I", "-B", "/submission/driver.py"]
        : ["/usr/bin/sh", "-c", "g++ -std=c++17 -O2 -o /work/sol /submission/solution.cpp && exec /usr/bin/timeout -s KILL 3 /work/sol"];
    return await launch([...args, "--", ...command], language === "cpp" ? EXECUTION_LIMITS.compileAndRunMs : EXECUTION_LIMITS.runMs);
  } catch (error) {
    if (isExecutionUnavailable(error)) throw error;
    throw new ExecutionUnavailableError();
  } finally {
    try { if (dir) await rm(dir, { recursive: true, force: true }); } finally { active--; }
  }
}
