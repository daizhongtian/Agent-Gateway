import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testFiles = readdirSync(path.join(projectRoot, "test"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
  .map((entry) => path.join("test", entry.name))
  .sort((left, right) => left.localeCompare(right, "en"));

if (testFiles.length === 0) throw new Error("No test/*.test.js files were found.");
const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: projectRoot,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
