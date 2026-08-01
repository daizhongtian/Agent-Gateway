import assert from "node:assert/strict";
import test from "node:test";
import { checkForUpdates, compareVersions } from "../src/electron/update-checker.js";

test("semantic versions are compared without treating prereleases as stable", () => {
  assert.equal(compareVersions("1.0.1", "1.0.0"), 1);
  assert.equal(compareVersions("1.1.0", "1.2.0"), -1);
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
  assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1);
  assert.throws(() => compareVersions("latest", "1.0.0"), /Unsupported version/);
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
      html_url: "https://github.com/daizhongtian/Agent-Gateway/releases/tag/v1.1.0",
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

test("update checks reject invalid configuration, runtime, responses, and timeouts", async () => {
  await assert.rejects(() => checkForUpdates({
    currentVersion: "1.0.0",
    repository: "invalid repository",
    fetchImpl: async () => assert.fail("must validate first"),
  }), /repository is invalid/);
  await assert.rejects(() => checkForUpdates({ currentVersion: "1.0.0", fetchImpl: 42 }), /not supported/);
  await assert.rejects(() => checkForUpdates({
    currentVersion: "1.0.0",
    fetchImpl: async () => ({ ok: false, status: 503 }),
  }), /failed \(503\)/);
  for (const body of [null, { draft: true }, { prerelease: true }]) {
    await assert.rejects(() => checkForUpdates({
      currentVersion: "1.0.0",
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => body }),
    }), /invalid stable release/);
  }
  await assert.rejects(() => checkForUpdates({
    currentVersion: "1.0.0",
    timeoutMs: 1,
    fetchImpl: async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; },
  }), /timed out/);
});

test("current releases return safe optional metadata", async () => {
  const result = await checkForUpdates({
    currentVersion: "1.0.0",
    repository: "daizhongtian/Agent-Gateway",
    timeoutMs: Number.NaN,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "1.0.0",
        html_url: "https://github.com/daizhongtian/Agent-Gateway/releases/tag/v1.0.0",
        draft: false,
        prerelease: false,
        name: 42,
        published_at: "not-a-date",
      }),
    }),
  });
  assert.equal(result.available, false);
  assert.equal(result.name, null);
  assert.equal(result.publishedAt, null);
});

test("portable release assets are returned only with exact trusted GitHub metadata", async () => {
  const portableName = "Agent-Gateway-Portable-3.0.7-x64.exe";
  const sha256 = "a".repeat(64);
  const result = await checkForUpdates({
    currentVersion: "3.0.6",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v3.0.7",
        html_url: "https://github.com/daizhongtian/Agent-Gateway/releases/tag/v3.0.7",
        draft: false,
        prerelease: false,
        published_at: "2026-08-01T00:00:00.000Z",
        assets: [
          {
            name: portableName,
            browser_download_url: `https://github.com/daizhongtian/Agent-Gateway/releases/download/v3.0.7/${portableName}`,
            size: 123,
            digest: `sha256:${sha256}`,
          },
          {
            name: "SHA256SUMS.txt",
            browser_download_url: "https://github.com/daizhongtian/Agent-Gateway/releases/download/v3.0.7/SHA256SUMS.txt",
            size: 200,
          },
        ],
      }),
    }),
  });
  assert.equal(result.portableAsset.name, portableName);
  assert.equal(result.portableAsset.sha256, sha256);
  assert.equal(result.checksumsAsset.name, "SHA256SUMS.txt");

  await assert.rejects(() => checkForUpdates({
    currentVersion: "3.0.6",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v3.0.7",
        html_url: "https://github.com/daizhongtian/Agent-Gateway/releases/tag/v3.0.7",
        draft: false,
        prerelease: false,
        published_at: "2026-08-01T00:00:00.000Z",
        assets: [{
          name: portableName,
          browser_download_url: `https://example.com/${portableName}`,
          size: 123,
        }],
      }),
    }),
  }), /unexpected release asset URL/);
});
