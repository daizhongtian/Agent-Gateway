import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { downloadPortableUpdate, portableUpdateInternals } from "../src/electron/portable-update.js";

function response(url, body, options = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    url,
    headers: new Headers({ "content-length": String(bytes.length) }),
    body: Readable.toWeb(Readable.from([bytes])),
    async text() { return bytes.toString("utf8"); },
  };
}

test("portable checksum files are parsed only for the exact release asset", () => {
  const hash = "a".repeat(64);
  assert.equal(portableUpdateInternals.parseChecksumFile(`${hash}  app.exe\n`, "app.exe"), hash);
  assert.equal(portableUpdateInternals.parseChecksumFile(`${hash} *other.exe\n`, "app.exe"), null);
  assert.throws(() => portableUpdateInternals.validateRelease({ available: false }), /No portable update/);
});

test("Portable updates stream to Downloads, verify SHA-256, and safely reuse an identical file", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-gateway-update-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from("verified portable update");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const fileName = "Agent-Gateway-Portable-3.0.7-x64.exe";
  const release = {
    available: true,
    latestVersion: "3.0.7",
    portableAsset: {
      name: fileName,
      url: `https://github.com/daizhongtian/Agent-Gateway/releases/download/v3.0.7/${fileName}`,
      size: bytes.length,
      sha256,
    },
    checksumsAsset: {
      url: "https://github.com/daizhongtian/Agent-Gateway/releases/download/v3.0.7/SHA256SUMS.txt",
    },
  };
  let binaryDownloads = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith("SHA256SUMS.txt")) {
      return response(url, `${sha256}  ${fileName}\n`);
    }
    binaryDownloads += 1;
    return response(`https://release-assets.githubusercontent.com/github-production-release-asset/${fileName}`, bytes);
  };
  const progress = [];

  const first = await downloadPortableUpdate(release, {
    destinationDirectory: directory,
    fetchImpl,
    onProgress: (value) => progress.push(value),
  });
  assert.equal(first.fileName, fileName);
  assert.deepEqual(await readFile(first.filePath), bytes);
  assert.equal(progress.at(-1).percent, 100);

  const second = await downloadPortableUpdate(release, { destinationDirectory: directory, fetchImpl });
  assert.equal(second.reused, true);
  assert.equal(second.filePath, first.filePath);
  assert.equal(binaryDownloads, 1);
});

test("Portable updates reject corrupt content and remove partial downloads", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-gateway-update-bad-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const expected = Buffer.from("expected");
  const corrupt = Buffer.from("corrupt!");
  const sha256 = createHash("sha256").update(expected).digest("hex");
  const fileName = "Agent-Gateway-Portable-3.0.7-x64.exe";
  const release = {
    available: true,
    latestVersion: "3.0.7",
    portableAsset: {
      name: fileName,
      url: `https://github.com/daizhongtian/Agent-Gateway/releases/download/v3.0.7/${fileName}`,
      size: corrupt.length,
      sha256,
    },
  };

  await assert.rejects(() => downloadPortableUpdate(release, {
    destinationDirectory: directory,
    fetchImpl: async () => response(`https://release-assets.githubusercontent.com/assets/${fileName}`, corrupt),
  }), /checksum verification failed/);
  assert.deepEqual(await readdir(directory), []);
  await assert.rejects(() => downloadPortableUpdate(release, { destinationDirectory: "" }), /Downloads directory/);
});
