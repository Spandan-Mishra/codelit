import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

// A dependency-free npm package from the same version as this server. Only
// the public package manifest, entrypoint and runtime modules are included.
export async function GET() {
  const root = path.join(process.cwd(), "connector");
  const modules = (await readdir(path.join(root, "lib"))).filter((name) => /^[a-zA-Z0-9_-]+\.mjs$/.test(name));
  const { stdout } = await exec("tar", [
    "-czf", "-", "--transform=s,^,package/,", "-C", root,
    "package.json", "README.md", "bin/codelit-connect.mjs", ...modules.map((m) => `lib/${m}`),
  ], { encoding: "buffer", maxBuffer: 2 * 1024 * 1024 });
  return new Response(new Uint8Array(stdout), { headers: {
    "Content-Type": "application/gzip",
    "Content-Disposition": 'attachment; filename="codelit-connect.tgz"',
    "Cache-Control": "no-store",
  } });
}
