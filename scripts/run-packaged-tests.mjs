import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "artifacts", "packaged");
const builder = path.join(projectRoot, "node_modules", "electron-builder", "cli.js");

assert.equal(process.platform, "win32", "Fresh packaged tests are Windows-only.");

function run(label, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", (error) => reject(new Error(`${label} could not start: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolve();
      else reject(new Error(`${label} failed with exit code ${code ?? "none"} and signal ${signal ?? "none"}.`));
    });
  });
}

await rm(outputDirectory, { recursive: true, force: true });
await run("release configuration check", [path.join(projectRoot, "scripts", "check-release.mjs")]);
await run("isolated Windows package build", [
  builder,
  "--win",
  "portable",
  "nsis",
  "--x64",
  "--publish",
  "never",
  `--config.directories.output=${outputDirectory}`,
]);
await run("packaged application smoke tests", [path.join(projectRoot, "scripts", "packaged-smoke.mjs")], {
  ...process.env,
  CODEX_PACKAGED_SMOKE_RELEASE_DIR: outputDirectory,
});

console.log(`Fresh packaged tests passed using isolated artifacts in ${outputDirectory}.`);
