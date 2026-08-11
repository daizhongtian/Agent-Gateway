import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isTransientNetworkFailure, normalizeSpawnCommand } from "../scripts/lib/retry-command.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(projectRoot, relativePath), "utf8");

test("retry classifier recognizes infrastructure failures only", () => {
  for (const message of [
    "npm ERR! code ECONNRESET",
    "HTTP 503 Service Unavailable",
    "Could not transfer artifact example:jar:1.0",
    "fatal: unable to access repository: Could not resolve host: github.com",
    "API rate limit exceeded",
  ]) {
    assert.equal(isTransientNetworkFailure(message), true, message);
  }
  for (const message of [
    "AssertionError: expected 200 but received 500",
    "SyntaxError: Unexpected token",
    "Tests: 1 failed, 20 passed",
    "HTTP 401 Unauthorized",
  ]) {
    assert.equal(isTransientNetworkFailure(message), false, message);
  }
});

test("Windows command shims run without enabling a general shell", () => {
  assert.deepEqual(
    normalizeSpawnCommand("npm.cmd", ["ci", "--no-audit"], "win32", "C:\\Windows\\System32\\cmd.exe"),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", "ci", "--no-audit"],
    },
  );
  assert.deepEqual(normalizeSpawnCommand("npm", ["ci"], "linux"), { command: "npm", args: ["ci"] });
});

test("V3 exposes one-command pre-push and release flows", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.scripts["ci:prepush"], "node scripts/prepush-v3.mjs");
  assert.equal(packageJson.scripts["release:v3:push"], "node scripts/push-v3-release.mjs");
  assert.match(read("scripts/push-v3-release.mjs"), /prepush-v3\.mjs", "--packaged"/u);
  assert.match(read("scripts/push-v3-release.mjs"), /git", \["push", "origin", "V3"\]/u);
});

test("V3 push performance gate is isolated from historical runner variance", () => {
  const workflow = read(".github/workflows/performance.yml");
  assert.match(workflow, /github\.event_name \}\}" == "push"[\s\S]+npm run performance:smoke/u);
  assert.match(workflow, /PROFILE="\$\{\{ inputs\.profile \|\| 'normal' \}\}"/u);
  assert.match(workflow, /schedule:/u);
});

test("release monitoring retries GitHub infrastructure failures", () => {
  const helper = read("scripts/publish-v3-release.mjs");
  assert.match(helper, /gh", \["auth", "token"\]/u);
  assert.match(helper, /\[500, 502, 503, 504\]/u);
  assert.match(helper, /AbortSignal\.timeout\(30_000\)/u);
});
