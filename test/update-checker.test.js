import assert from "node:assert/strict";
import test from "node:test";
import { checkForUpdates, compareVersions } from "../src/electron/update-checker.js";

test("semantic versions are compared without treating prereleases as stable", () => {
  assert.equal(compareVersions("1.0.1", "1.0.0"), 1);
  assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
});

test("update checks accept only stable releases from the configured GitHub repository", async () => {
  const result = await checkForUpdates({
    currentVersion: "1.0.0",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          tag_name: "v1.1.0",
          html_url: "https://github.com/daizhongtian/codex_sdk/releases/tag/v1.1.0",
          draft: false,
          prerelease: false,
          name: "Version 1.1.0",
          published_at: "2026-07-17T00:00:00.000Z",
        };
      },
    }),
  });
  assert.equal(result.available, true);
  assert.equal(result.latestVersion, "1.1.0");
});

test("a repository without releases is a valid no-update result", async () => {
  const result = await checkForUpdates({
    currentVersion: "1.0.0",
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.deepEqual(result, {
    checked: true,
    available: false,
    currentVersion: "1.0.0",
    latestVersion: null,
    releaseUrl: null,
  });
});

test("release links cannot escape the configured GitHub repository", async () => {
  await assert.rejects(checkForUpdates({
    currentVersion: "1.0.0",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          tag_name: "v1.1.0",
          html_url: "https://example.com/malware.exe",
          draft: false,
          prerelease: false,
          published_at: "2026-07-17T00:00:00.000Z",
        };
      },
    }),
  }), /unexpected release URL/);
});
