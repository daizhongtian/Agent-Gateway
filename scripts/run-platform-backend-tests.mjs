import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.join(root, "platform", "backend");
const command = process.platform === "win32" ? "mvnw.cmd" : "./mvnw";
const result = spawnSync(command, ["-B", "clean", "verify"], {
  cwd: backend,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
