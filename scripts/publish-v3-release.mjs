import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const requiredWorkflows = ["CI", "Security gates", "Performance tests"];
const pollIntervalMs = 15_000;
const timeoutMs = 45 * 60_000;
const verifyOnly = process.argv.includes("--verify-only");

if (process.argv.includes("--help")) {
  console.log(`Usage: npm run release:v3 [-- --verify-only]

Without options, waits for the current V3 commit's required GitHub workflows,
creates and pushes its version tag, then waits for the public Latest Release.

--verify-only  Verify an existing tag and Latest Release without creating anything.`);
  process.exit(0);
}

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`.trim());
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function repositoryFromMetadata() {
  const repositoryUrl = packageJson.repository?.url ?? "";
  const match = repositoryUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/iu);
  if (!match) throw new Error("package.json repository must point to a GitHub repository");
  return `${match[1]}/${match[2]}`;
}

const repository = repositoryFromMetadata();
const apiHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "Agent-Gateway-V3-release-helper",
  "X-GitHub-Api-Version": "2022-11-28",
};
const apiToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (apiToken) apiHeaders.Authorization = `Bearer ${apiToken}`;

async function github(pathname, { allowNotFound = false } = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository}${pathname}`, {
    headers: apiHeaders,
  });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${pathname}: ${body.slice(0, 500)}`);
  }
  return response.json();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertStableVersion() {
  if (!/^\d+\.\d+\.\d+$/u.test(packageJson.version)) {
    throw new Error(`package.json version must be stable semver, received ${packageJson.version}`);
  }
  return `v${packageJson.version}`;
}

function assertLocalState() {
  const branch = runGit(["branch", "--show-current"]).stdout;
  if (branch !== "V3") throw new Error(`Release must run from V3, not ${branch || "detached HEAD"}`);

  const trackedChanges = runGit(["status", "--porcelain", "--untracked-files=no"]).stdout;
  if (trackedChanges) throw new Error(`Tracked worktree must be clean:\n${trackedChanges}`);

  runGit(["fetch", "origin", "V3", "--tags"]);
  const head = runGit(["rev-parse", "HEAD"]).stdout;
  const remote = runGit(["rev-parse", "origin/V3"]).stdout;
  if (head !== remote) {
    throw new Error(`Local V3 (${head}) must exactly match origin/V3 (${remote})`);
  }
  return head;
}

async function waitForWorkflows(commitSha) {
  const deadline = Date.now() + timeoutMs;
  let previousSummary = "";
  while (Date.now() < deadline) {
    const data = await github(`/actions/runs?head_sha=${encodeURIComponent(commitSha)}&event=push&per_page=100`);
    const selected = requiredWorkflows.map((name) =>
      data.workflow_runs
        .filter((run) => run.name === name && run.head_branch === "V3")
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0],
    );
    const summary = selected
      .map((run, index) => `${requiredWorkflows[index]}=${run ? `${run.status}/${run.conclusion || "pending"}` : "waiting"}`)
      .join(" | ");
    if (summary !== previousSummary) {
      console.log(`[release:v3] ${summary}`);
      previousSummary = summary;
    }

    for (const run of selected) {
      if (run?.status === "completed" && run.conclusion !== "success") {
        throw new Error(`${run.name} failed with ${run.conclusion}: ${run.html_url}`);
      }
    }
    if (selected.every((run) => run?.status === "completed" && run.conclusion === "success")) return;
    await sleep(pollIntervalMs);
  }
  throw new Error("Timed out waiting for CI, Security gates, and Performance tests");
}

function tagExistsLocally(tag) {
  return runGit(["show-ref", "--verify", "--quiet", `refs/tags/${tag}`], { allowFailure: true }).status === 0;
}

function tagExistsRemotely(tag) {
  return Boolean(runGit(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]).stdout);
}

function ensureReleaseTag(tag, commitSha) {
  const localExists = tagExistsLocally(tag);
  const remoteExists = tagExistsRemotely(tag);
  if (localExists) {
    const tagCommit = runGit(["rev-list", "-n", "1", tag]).stdout;
    if (tagCommit !== commitSha) {
      throw new Error(`${tag} points to ${tagCommit}, expected ${commitSha}`);
    }
  }
  if (remoteExists && !localExists) {
    throw new Error(`${tag} exists remotely but was not fetched locally`);
  }
  if (verifyOnly && (!localExists || !remoteExists)) {
    throw new Error(`${tag} must already exist locally and remotely in --verify-only mode`);
  }
  if (!localExists) {
    runGit(["tag", "-a", tag, commitSha, "-m", `Agent Gateway ${tag}`]);
    console.log(`[release:v3] Created ${tag} at ${commitSha}`);
  }
  if (!remoteExists) {
    runGit(["push", "origin", `refs/tags/${tag}`]);
    console.log(`[release:v3] Pushed ${tag}; GitHub is building the release`);
  } else {
    console.log(`[release:v3] Verified existing remote tag ${tag}`);
  }
}

async function waitForReleaseWorkflow(tag, commitSha) {
  const deadline = Date.now() + timeoutMs;
  let previousSummary = "";
  while (Date.now() < deadline) {
    const data = await github(`/actions/runs?head_sha=${encodeURIComponent(commitSha)}&event=push&per_page=100`);
    const run = data.workflow_runs
      .filter((item) => item.name === "Release Windows app" && item.head_branch === tag)
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];
    const summary = run ? `${run.status}/${run.conclusion || "pending"}` : "waiting";
    if (summary !== previousSummary) {
      console.log(`[release:v3] Release Windows app=${summary}`);
      previousSummary = summary;
    }
    if (run?.status === "completed" && run.conclusion !== "success") {
      throw new Error(`Release Windows app failed with ${run.conclusion}: ${run.html_url}`);
    }
    if (run?.status === "completed" && run.conclusion === "success") return;
    await sleep(pollIntervalMs);
  }
  throw new Error("Timed out waiting for the Release Windows app workflow");
}

async function verifyLatestRelease(tag) {
  const release = await github("/releases/latest", { allowNotFound: true });
  if (!release) throw new Error("GitHub does not have a public Latest Release");
  if (release.tag_name !== tag || release.draft || release.prerelease) {
    throw new Error(`Latest Release is ${release.tag_name}, expected stable ${tag}`);
  }
  const expectedAssets = [
    `Agent-Gateway-Portable-${packageJson.version}-x64.exe`,
    `Agent-Gateway-Setup-${packageJson.version}-x64.exe`,
    `Agent-Gateway-Setup-${packageJson.version}-x64.exe.blockmap`,
    "latest.yml",
    "SHA256SUMS.txt",
  ].sort();
  const actualAssets = release.assets.map((asset) => asset.name).sort();
  if (JSON.stringify(actualAssets) !== JSON.stringify(expectedAssets)) {
    throw new Error(`Latest Release assets differ:\n${actualAssets.join("\n")}`);
  }
  const invalidAsset = release.assets.find((asset) => asset.size <= 0 || asset.state !== "uploaded");
  if (invalidAsset) throw new Error(`Release asset ${invalidAsset.name} is incomplete`);
  console.log(`[release:v3] Published and verified ${release.html_url}`);
}

async function main() {
  const tag = assertStableVersion();
  let commitSha;
  if (verifyOnly) {
    runGit(["fetch", "origin", "V3", "--tags"]);
    if (!tagExistsLocally(tag) || !tagExistsRemotely(tag)) {
      throw new Error(`${tag} must already exist locally and remotely in --verify-only mode`);
    }
    commitSha = runGit(["rev-list", "-n", "1", tag]).stdout;
    console.log(`[release:v3] Verifying ${tag} at ${commitSha}`);
  } else {
    commitSha = assertLocalState();
    console.log(`[release:v3] V3=${commitSha} version=${packageJson.version}`);
  }
  await waitForWorkflows(commitSha);
  ensureReleaseTag(tag, commitSha);
  await waitForReleaseWorkflow(tag, commitSha);
  await verifyLatestRelease(tag);
}

main().catch((error) => {
  console.error(`[release:v3] ${error.message}`);
  process.exitCode = 1;
});
