import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { npmExecutable, runCommand } from "./lib/retry-command.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const includePackaged = process.argv.includes("--packaged");
const npm = npmExecutable();

const steps = [
  ["Install deterministic dependencies", process.execPath, ["scripts/install-locked-dependencies.mjs", "--all"]],
  ["Release configuration and syntax", npm, ["run", "release:preflight"]],
  ["Desktop tests and coverage", npm, ["run", "test:coverage"]],
  ["Platform backend and frontend", npm, ["run", "test:platform"]],
  ["Desktop visual smoke", npm, ["run", "test:visual"]],
  ["Isolated performance smoke", npm, ["run", "performance:smoke"]],
];

if (includePackaged) {
  steps.push(
    ["Build Windows release candidates", npm, ["run", "dist:all"]],
    ["Packaged application smoke", npm, ["run", "test:packaged"]],
    ["Release checksums", npm, ["run", "checksums"]],
  );
}

console.log(`[prepush:v3] Starting ${steps.length} deterministic checks${includePackaged ? " including packaged apps" : ""}.`);
for (const [label, command, args] of steps) {
  await runCommand(command, args, { cwd: projectRoot, label });
}
console.log("\n[prepush:v3] All checks passed. The commit is ready to push.");
