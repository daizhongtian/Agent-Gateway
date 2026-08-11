import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { npmExecutable, runCommand } from "./lib/retry-command.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendOnly = process.argv.includes("--frontend-only");
const includeFrontend = frontendOnly || process.argv.includes("--all");
const npm = npmExecutable();
const commonArgs = ["--prefer-offline", "--no-audit"];

async function install(label, args) {
  await runCommand(npm, ["ci", ...args, ...commonArgs], {
    cwd: projectRoot,
    label,
    networkRetries: 2,
  });
}

if (!frontendOnly) await install("Install locked desktop dependencies", []);
if (includeFrontend) await install("Install locked platform frontend dependencies", ["--prefix", "platform/frontend"]);

console.log("\n[install] Locked dependencies are ready.");
