import os from "node:os";
import path from "node:path";

// Isolates connector identity/state only. Codex's own login/config is untouched.
export function configDir() {
  return process.env.CODELIT_CONFIG_DIR
    ? path.resolve(process.env.CODELIT_CONFIG_DIR)
    : path.join(os.homedir(), ".codelit");
}
