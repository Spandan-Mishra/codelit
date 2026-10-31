// Pin the server to the build it starts with. `next build` owns and replaces
// .next; serving from it while another build runs loses active CSS/JS chunks.
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const source = path.resolve(root, process.env.CODELIT_DIST_DIR || ".next");
let buildId;
try {
  buildId = await readFile(path.join(source, "BUILD_ID"), "utf8");
} catch {
  console.error("No production build found. Run npm run build before npm start.");
  process.exit(1);
}
const runtimeRoot = path.join(root, ".codelit-runtime");
await mkdir(runtimeRoot, { recursive: true });
const runtime = await mkdtemp(path.join(runtimeRoot, "server-"));
try {
  await cp(source, runtime, {
    recursive: true,
    filter: (file) => !["cache", "dev"].includes(path.relative(source, file).split(path.sep)[0]),
  });
  if (await readFile(path.join(source, "BUILD_ID"), "utf8") !== buildId ||
      await readFile(path.join(runtime, "BUILD_ID"), "utf8") !== buildId) {
    throw new Error("The build changed during startup. Wait for npm run build to finish, then retry npm start.");
  }
} catch (error) {
  await rm(runtime, { recursive: true, force: true });
  throw error;
}
const child = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CODELIT_DIST_DIR: path.relative(root, runtime) },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", async (error) => {
  console.error(error.message);
  await rm(runtime, { recursive: true, force: true });
  process.exitCode = 1;
});
child.on("exit", async (code, signal) => {
  await rm(runtime, { recursive: true, force: true });
  process.exitCode = code ?? (signal ? 1 : 0);
});
