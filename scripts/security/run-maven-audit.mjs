import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const backend = path.join(root, "platform", "backend");
const executable = process.platform === "win32" ? "mvnw.cmd" : "./mvnw";
const resolveOnly = process.argv.includes("--resolve-only");
const goals = resolveOnly
  ? ["-B", "-DskipTests", "dependency:tree"]
  : ["-B", "-DskipTests", "org.owasp:dependency-check-maven:12.2.2:check"];
const result = spawnSync(executable, goals, {
  cwd: backend,
  encoding: "utf8",
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
