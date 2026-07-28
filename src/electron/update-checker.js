const DEFAULT_REPOSITORY = "daizhongtian/Agent-Gateway";
const DEFAULT_TIMEOUT_MS = 8_000;

function parseVersion(value) {
  const normalized = String(value ?? "").trim().replace(/^v/i, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(normalized);
  if (!match) throw new Error(`Unsupported version: ${value}`);
  return {
    text: normalized,
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] > b.parts[index] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true });
}

function safeReleaseUrl(value, repository) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("GitHub returned an invalid release URL.");
  }
  const expectedPath = `/${repository.toLowerCase()}/releases/`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.toLowerCase().startsWith(expectedPath)) {
    throw new Error("GitHub returned an unexpected release URL.");
  }
  return url.href;
}

export async function checkForUpdates(options = {}) {
  const currentVersion = parseVersion(options.currentVersion).text;
  const repository = String(options.repository ?? DEFAULT_REPOSITORY).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("The update repository is invalid.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Update checks are not supported by this runtime.");
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.min(30_000, Math.max(1_000, Number(options.timeoutMs)))
    : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases/latest`, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
      "User-Agent": `Agent-Gateway/${currentVersion}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (response.status === 404) {
      return { checked: true, available: false, currentVersion, latestVersion: null, releaseUrl: null };
    }
    if (!response.ok) throw new Error(`GitHub update check failed (${response.status}).`);
    const body = await response.json();
    if (!body || typeof body !== "object" || body.draft === true || body.prerelease === true) {
      throw new Error("GitHub returned an invalid stable release.");
    }
    const latestVersion = parseVersion(body.tag_name).text;
    const releaseUrl = safeReleaseUrl(body.html_url, repository);
    return {
      checked: true,
      available: compareVersions(latestVersion, currentVersion) > 0,
      currentVersion,
      latestVersion,
      releaseUrl,
      name: typeof body.name === "string" ? body.name.slice(0, 200) : null,
      publishedAt: Number.isNaN(Date.parse(body.published_at)) ? null : body.published_at,
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The update check timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
