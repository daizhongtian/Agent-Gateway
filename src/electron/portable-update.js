import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAX_PORTABLE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CHECKSUM_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;

function assertDownloadResponse(response) {
  let url;
  try {
    url = new URL(response?.url);
  } catch {
    throw new Error("The portable update download returned an invalid URL.");
  }
  const trustedHost = url.hostname === "github.com" || url.hostname.endsWith(".githubusercontent.com");
  if (url.protocol !== "https:" || !trustedHost || url.username || url.password) {
    throw new Error("The portable update download left the trusted GitHub origin.");
  }
  if (!response.ok) throw new Error(`The portable update download failed (HTTP ${response.status}).`);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function parseChecksumFile(text, fileName) {
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (match && match[2] === fileName) return match[1].toLowerCase();
  }
  return null;
}

async function readChecksums(asset, fetchImpl, signal) {
  if (!asset?.url) return null;
  const response = await fetchImpl(asset.url, { method: "GET", redirect: "follow", signal });
  assertDownloadResponse(response);
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CHECKSUM_BYTES) {
    throw new Error("The release checksum file is unexpectedly large.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_CHECKSUM_BYTES) {
    throw new Error("The release checksum file is unexpectedly large.");
  }
  return text;
}

async function availableTarget(directory, fileName, expectedSha256) {
  const parsed = path.parse(fileName);
  for (let index = 0; index < 100; index += 1) {
    const candidateName = index === 0 ? fileName : `${parsed.name} (${index})${parsed.ext}`;
    const candidate = path.join(directory, candidateName);
    try {
      await access(candidate);
      if (await sha256File(candidate) === expectedSha256) {
        return { filePath: candidate, fileName: candidateName, reused: true };
      }
    } catch (error) {
      if (error?.code === "ENOENT") return { filePath: candidate, fileName: candidateName, reused: false };
      throw error;
    }
  }
  throw new Error("Too many portable update files already exist in the Downloads folder.");
}

function validateRelease(release) {
  const asset = release?.portableAsset;
  if (!release?.available || !/^\d+\.\d+\.\d+$/.test(String(release.latestVersion ?? ""))) {
    throw new Error("No portable update is available.");
  }
  const expectedName = `Agent-Gateway-Portable-${release.latestVersion}-x64.exe`;
  if (asset?.name !== expectedName || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_PORTABLE_BYTES) {
    throw new Error("The GitHub Release does not contain a valid Portable update.");
  }
  return asset;
}

export async function downloadPortableUpdate(release, options = {}) {
  const asset = validateRelease(release);
  if (typeof options.destinationDirectory !== "string" || !options.destinationDirectory.trim()) {
    throw new Error("A safe Downloads directory is required.");
  }
  const destinationDirectory = path.resolve(options.destinationDirectory);
  if (!destinationDirectory || destinationDirectory === path.parse(destinationDirectory).root) {
    throw new Error("A safe Downloads directory is required.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Portable update downloads are unavailable in this runtime.");
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(10_000, Math.min(DEFAULT_TIMEOUT_MS, Number(options.timeoutMs)))
    : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    const checksums = await readChecksums(release.checksumsAsset, fetchImpl, controller.signal);
    const checksumFromFile = checksums ? parseChecksumFile(checksums, asset.name) : null;
    const expectedSha256 = asset.sha256 ?? checksumFromFile;
    if (!expectedSha256 || (asset.sha256 && checksumFromFile && asset.sha256 !== checksumFromFile)) {
      throw new Error("The Portable update checksum is missing or inconsistent.");
    }

    const target = await availableTarget(destinationDirectory, asset.name, expectedSha256);
    if (target.reused) {
      options.onProgress?.({ percent: 100, transferred: asset.size, total: asset.size, bytesPerSecond: 0 });
      return Object.freeze(target);
    }

    const temporaryPath = path.join(destinationDirectory, `.${asset.name}.${randomUUID()}.download`);
    let transferred = 0;
    let lastReportedAt = 0;
    let lastReportedPercent = -1;
    const startedAt = Date.now();
    const hash = createHash("sha256");
    try {
      const response = await fetchImpl(asset.url, { method: "GET", redirect: "follow", signal: controller.signal });
      assertDownloadResponse(response);
      if (!response.body) throw new Error("The Portable update response did not contain a download stream.");
      const declaredLength = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_PORTABLE_BYTES) {
        throw new Error("The Portable update is unexpectedly large.");
      }

      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          transferred += chunk.length;
          if (transferred > asset.size || transferred > MAX_PORTABLE_BYTES) {
            callback(new Error("The Portable update exceeded its declared size."));
            return;
          }
          hash.update(chunk);
          const percent = Math.min(100, (transferred / asset.size) * 100);
          const now = Date.now();
          if (percent >= 100 || percent - lastReportedPercent >= 0.5 || now - lastReportedAt >= 250) {
            const seconds = Math.max((now - startedAt) / 1_000, 0.001);
            options.onProgress?.({
              percent,
              transferred,
              total: asset.size,
              bytesPerSecond: Math.round(transferred / seconds),
            });
            lastReportedAt = now;
            lastReportedPercent = percent;
          }
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }));
      if (transferred !== asset.size) throw new Error("The Portable update size did not match the GitHub Release metadata.");
      if (hash.digest("hex") !== expectedSha256) throw new Error("The Portable update checksum verification failed.");
      await rename(temporaryPath, target.filePath);
      return Object.freeze(target);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The Portable update download timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const portableUpdateInternals = Object.freeze({ parseChecksumFile, validateRelease });
