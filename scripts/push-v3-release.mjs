import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runCommand } from "./lib/retry-command.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const tag = `v${packageJson.version}`;

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8", windowsHide: true });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`.trim());
  }
  return { status: result.status ?? 1, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function assertCommittedV3() {
  const branch = git(["branch", "--show-current"]).stdout;
  if (branch !== "V3") throw new Error(`One-command release must run from V3, not ${branch || "detached HEAD"}`);
  const changes = git(["status", "--porcelain", "--untracked-files=no"]).stdout;
  if (changes) throw new Error(`Commit tracked changes before releasing:\n${changes}`);
  if (!/^\d+\.\d+\.\d+$/u.test(packageJson.version)) throw new Error(`Invalid stable version: ${packageJson.version}`);
}

function assertNoDivergenceOrReusedTag() {
  const head = git(["rev-parse", "HEAD"]).stdout;
  const counts = git(["rev-list", "--left-right", "--count", `origin/V3...${head}`]).stdout.split(/\s+/u).map(Number);
  const [behind, ahead] = counts;
  if (behind > 0) throw new Error(`Local V3 is behind origin/V3 by ${behind} commit(s); update it before releasing.`);

  const remoteTag = git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]).stdout;
  if (remoteTag) {
    const remoteTagCommit = git(["rev-list", "-n", "1", tag], { allowFailure: true }).stdout;
    if (!remoteTagCommit || remoteTagCommit !== head) {
      throw new Error(`${tag} already belongs to another commit. Bump package.json and package-lock.json before pushing.`);
    }
  }
  console.log(`[release:v3:push] V3 is ${ahead} commit(s) ahead; version ${packageJson.version} is safe to validate.`);
}

async function main() {
  assertCommittedV3();
  await runCommand("git", ["fetch", "origin", "V3", "--tags"], {
    cwd: projectRoot,
    label: "Refresh origin/V3 and release tags",
    networkRetries: 2,
  });
  assertNoDivergenceOrReusedTag();
  await runCommand(process.execPath, ["scripts/prepush-v3.mjs", "--packaged"], {
    cwd: projectRoot,
    label: "Run complete local release candidate checks",
  });
  assertCommittedV3();
  await runCommand("git", ["push", "origin", "V3"], {
    cwd: projectRoot,
    label: "Push validated V3 commit",
    networkRetries: 2,
  });
  await runCommand(process.execPath, ["scripts/publish-v3-release.mjs"], {
    cwd: projectRoot,
    label: "Wait for GitHub gates and publish the release",
  });
}

main().catch((error) => {
  console.error(`\n[release:v3:push] ${error.message}`);
  process.exitCode = 1;
});
