import https from "node:https";
import { isIP } from "node:net";

const DEFAULT_TIMEOUT_MS = 12_000;
const PUBLIC_DNS_ENDPOINTS = Object.freeze([
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
]);
const MAX_PROBE_BODY_BYTES = 64 * 1024;
const REQUEST_ID_PATTERN = /^req_[a-f0-9]{32}$/;
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REPAIRABLE_PUBLIC_CODES = new Set([
  "ONLINE_HOST_PUBLIC_TLS_FAILED",
  "OPENAI_ROUTE_PUBLIC_TLS_FAILED",
]);

function safeUrl(value, label) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new TypeError(`${label} must be a valid HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new TypeError(`${label} must be a credential-free HTTPS URL without a query or fragment.`);
  }
  return url;
}

function sameOriginUrl(value, baseUrl, label) {
  const url = safeUrl(value, label);
  if (url.origin !== baseUrl.origin) throw new TypeError(`${label} must use the provider base URL origin.`);
  return url;
}

export function normalizeOnlineHostProvider(provider = {}) {
  const id = String(provider.id ?? "").trim().toLowerCase();
  const label = String(provider.label ?? "").trim();
  if (!PROVIDER_ID_PATTERN.test(id)) throw new TypeError("Online Host provider id is invalid.");
  if (!label || label.length > 80) throw new TypeError("Online Host provider label is invalid.");

  const baseUrl = safeUrl(provider.baseUrl, "Online Host base URL");
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "") || "/v1";
  const healthUrl = sameOriginUrl(provider.healthUrl ?? new URL("/health", baseUrl).href, baseUrl, "Health URL");
  const modelsUrl = sameOriginUrl(
    provider.modelsUrl ?? `${baseUrl.href.replace(/\/+$/, "")}/models`,
    baseUrl,
    "Models URL",
  );

  return Object.freeze({
    id,
    label,
    baseUrl: baseUrl.href.replace(/\/+$/, ""),
    healthUrl: healthUrl.href,
    modelsUrl: modelsUrl.href,
    forcePublicDns: provider.forcePublicDns === true,
  });
}

export function isPublicIpv4(value) {
  if (isIP(value) !== 4) return false;
  const [a, b, c] = value.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export async function resolvePublicIpv4(hostname, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  if (typeof fetchImpl !== "function") throw new TypeError("A DNS fetch implementation is required.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Public DNS lookup timed out.")), timeoutMs);
  try {
    for (const endpoint of PUBLIC_DNS_ENDPOINTS) {
      try {
        const url = new URL(endpoint);
        url.searchParams.set("name", hostname);
        url.searchParams.set("type", "A");
        const response = await fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/dns-json" },
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) continue;
        const payload = await response.json();
        const addresses = [...new Set(
          (Array.isArray(payload?.Answer) ? payload.Answer : [])
            .filter((answer) => Number(answer?.type) === 1)
            .map((answer) => String(answer?.data ?? "").trim())
            .filter(isPublicIpv4),
        )];
        if (addresses.length > 0) return Object.freeze(addresses);
      } catch (error) {
        if (controller.signal.aborted) throw error;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  const error = new Error("Public DNS did not return a routable IPv4 address.");
  error.code = "ONLINE_HOST_PUBLIC_DNS_FAILED";
  throw error;
}

function nodeHeaders(headers = {}) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return Object.fromEntries(new Headers(headers).entries());
}

function requestPublicHttpsOnce(urlValue, init, address) {
  const url = new URL(urlValue);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bodyBytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      init.signal?.removeEventListener("abort", abortRequest);
      callback(value);
    };
    const request = https.request(url, {
      method: init.method ?? "GET",
      headers: nodeHeaders(init.headers),
      servername: url.hostname,
      lookup(_hostname, lookupOptions, callback) {
        if (lookupOptions?.all) callback(null, [{ address, family: 4 }]);
        else callback(null, address, 4);
      },
    }, (response) => {
      response.on("data", (chunk) => {
        bodyBytes += chunk.length;
        if (bodyBytes > MAX_PROBE_BODY_BYTES) {
          request.destroy(new Error("Online Host response exceeded the probe limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
          else if (value !== undefined) headers.set(name, String(value));
        }
        finish(resolve, new Response(Buffer.concat(chunks), {
          status: response.statusCode ?? 502,
          statusText: response.statusMessage ?? "",
          headers,
        }));
      });
    });
    const abortRequest = () => request.destroy(
      init.signal?.reason instanceof Error ? init.signal.reason : new DOMException("Aborted", "AbortError"),
    );
    request.once("error", (error) => finish(reject, error));
    if (init.signal?.aborted) abortRequest();
    else init.signal?.addEventListener("abort", abortRequest, { once: true });
    request.end();
  });
}

async function fetchThroughPublicEdge(url, init, route) {
  let lastError = null;
  for (const address of route.addresses) {
    try {
      return await requestPublicHttpsOnce(url, init, address);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      lastError = error;
    }
  }
  const error = new Error("The real public TLS route could not complete a secure handshake.", { cause: lastError });
  error.code = "ONLINE_HOST_PUBLIC_TLS_FAILED";
  throw error;
}

async function responsePayload(response) {
  try {
    const text = await response.text();
    if (!text || text.length > 64 * 1024) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function remoteError(payload, fallback) {
  const message = payload?.error?.message;
  return typeof message === "string" && message.trim() ? message.trim().slice(0, 500) : fallback;
}

async function runProbe(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Online Host check timed out.")), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    return Object.freeze({
      status: response.status,
      latencyMs: Math.max(0, Date.now() - startedAt),
      requestId: response.headers.get("x-request-id"),
      authenticate: response.headers.get("www-authenticate"),
      payload: await responsePayload(response),
    });
  } finally {
    clearTimeout(timer);
  }
}

function failedResult(provider, checks, code, message) {
  return Object.freeze({
    ok: false,
    online: checks.some((check) => check.status > 0),
    apiReady: false,
    checkedAt: new Date().toISOString(),
    providerId: provider.id,
    providerLabel: provider.label,
    baseUrl: provider.baseUrl,
    latencyMs: checks.reduce((total, check) => total + (check.latencyMs || 0), 0),
    requestId: checks.findLast((check) => check.requestId)?.requestId ?? null,
    checks: Object.freeze(checks),
    networkPath: provider.forcePublicDns ? "public-edge" : "system-dns",
    error: Object.freeze({ code, message }),
  });
}

function publicCheck(check) {
  return Object.freeze({
    name: check.name,
    status: check.status,
    ok: check.ok,
    latencyMs: check.latencyMs,
    requestId: check.requestId,
  });
}

export async function checkOnlineHost(providerInput, options = {}) {
  const provider = normalizeOnlineHostProvider(providerInput);
  let fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");

  if (provider.forcePublicDns) {
    const hostname = new URL(provider.baseUrl).hostname;
    let addresses;
    try {
      const resolver = options.resolvePublicAddresses ?? resolvePublicIpv4;
      addresses = await resolver(hostname, {
        fetchImpl: options.dnsFetchImpl ?? globalThis.fetch,
        timeoutMs,
      });
      if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some((address) => !isPublicIpv4(address))) {
        throw Object.assign(new Error("Public DNS returned no routable address."), {
          code: "ONLINE_HOST_PUBLIC_DNS_FAILED",
        });
      }
    } catch {
      return failedResult(
        provider,
        [],
        "ONLINE_HOST_PUBLIC_DNS_FAILED",
        "无法从公共 DNS 获取 Funnel 公网地址，未使用 Tailnet 内部地址进行替代检测。",
      );
    }
    const publicFetchImpl = options.publicFetchImpl ?? fetchThroughPublicEdge;
    const route = Object.freeze({ hostname, addresses: Object.freeze([...addresses]) });
    fetchImpl = (url, init) => publicFetchImpl(url, init, route);
  }

  const checks = [];
  let health;
  try {
    health = await runProbe(fetchImpl, provider.healthUrl, timeoutMs);
  } catch (error) {
    const timedOut = error?.name === "AbortError" || /timed out/i.test(String(error?.message ?? ""));
    const publicTlsFailed = provider.forcePublicDns && error?.code === "ONLINE_HOST_PUBLIC_TLS_FAILED";
    return failedResult(
      provider,
      checks,
      publicTlsFailed ? "ONLINE_HOST_PUBLIC_TLS_FAILED" : timedOut ? "ONLINE_HOST_TIMEOUT" : "ONLINE_HOST_UNREACHABLE",
      publicTlsFailed
        ? "真实公网 TLS 握手失败；Tailnet 内部地址可能仍然可用，但其他设备无法连接。"
        : timedOut ? "公网请求超时，请检查隧道和网络连接。" : "无法连接公网 Host，请检查隧道、DNS 和 HTTPS 状态。",
    );
  }
  const healthCheck = publicCheck({
    name: "health",
    status: health.status,
    ok: health.status === 200 && health.payload?.ok === true,
    latencyMs: health.latencyMs,
    requestId: health.requestId,
  });
  checks.push(healthCheck);
  if (!healthCheck.ok) {
    const hostRejected = health.status === 421 || health.payload?.error?.code === "HOST_FORBIDDEN";
    return failedResult(
      provider,
      checks,
      hostRejected ? "ONLINE_HOST_NOT_ALLOWED" : "ONLINE_HOST_HEALTH_FAILED",
      hostRejected
        ? "公网域名尚未加入应用 Host 白名单，请刷新渠道状态后重试。"
        : remoteError(health.payload, `公网健康检查返回 HTTP ${health.status}。`),
    );
  }

  let models;
  try {
    models = await runProbe(fetchImpl, provider.modelsUrl, timeoutMs);
  } catch (error) {
    const timedOut = error?.name === "AbortError" || /timed out/i.test(String(error?.message ?? ""));
    const publicTlsFailed = provider.forcePublicDns && error?.code === "ONLINE_HOST_PUBLIC_TLS_FAILED";
    return failedResult(
      provider,
      checks,
      publicTlsFailed ? "OPENAI_ROUTE_PUBLIC_TLS_FAILED" : timedOut ? "OPENAI_ROUTE_TIMEOUT" : "OPENAI_ROUTE_UNREACHABLE",
      publicTlsFailed
        ? "健康检查后真实公网 TLS 再次失败，Funnel 公网链路不稳定。"
        : timedOut ? "OpenAI 兼容路由检查超时。" : "公网已连接，但无法检查 OpenAI 兼容路由。",
    );
  }
  const requestIdValid = REQUEST_ID_PATTERN.test(models.requestId ?? "");
  const authenticationRequired = models.status === 401
    && /^Bearer\b/i.test(models.authenticate ?? "")
    && models.payload?.error?.code === "invalid_api_key";
  const modelsCheck = publicCheck({
    name: "models_auth",
    status: models.status,
    ok: authenticationRequired && requestIdValid,
    latencyMs: models.latencyMs,
    requestId: models.requestId,
  });
  checks.push(modelsCheck);
  if (!modelsCheck.ok) {
    if (models.status === 200) {
      return failedResult(provider, checks, "ONLINE_HOST_AUTH_BYPASSED", "公网模型接口未要求 Gateway Key，请立即关闭公网 Host 并检查鉴权配置。");
    }
    const hostRejected = models.status === 421 || models.payload?.error?.code === "HOST_FORBIDDEN";
    return failedResult(
      provider,
      checks,
      hostRejected ? "ONLINE_HOST_NOT_ALLOWED" : "OPENAI_ROUTE_NOT_READY",
      hostRejected
        ? "公网域名尚未加入应用 Host 白名单，请刷新渠道状态后重试。"
        : remoteError(models.payload, `OpenAI 兼容路由返回 HTTP ${models.status}，或缺少有效 Request ID。`),
    );
  }

  return Object.freeze({
    ok: true,
    online: true,
    apiReady: true,
    checkedAt: new Date().toISOString(),
    providerId: provider.id,
    providerLabel: provider.label,
    baseUrl: provider.baseUrl,
    latencyMs: checks.reduce((total, check) => total + check.latencyMs, 0),
    requestId: models.requestId,
    checks: Object.freeze(checks),
    networkPath: provider.forcePublicDns ? "public-edge" : "system-dns",
    error: null,
    message: "公网 Host、OpenAI 兼容路由、Gateway Key 鉴权和 Request ID 均正常。",
  });
}

function withRepair(result, repair) {
  return Object.freeze({ ...result, repair: Object.freeze(repair) });
}

export async function checkOnlineHostWithRepair(providerInput, options = {}) {
  const failureAttempts = Number.isInteger(options.failureAttempts) && options.failureAttempts > 0
    ? options.failureAttempts
    : 3;
  const verificationAttempts = Number.isInteger(options.verificationAttempts) && options.verificationAttempts > 0
    ? options.verificationAttempts
    : 2;
  const retryDelayMs = Number.isInteger(options.retryDelayMs) && options.retryDelayMs >= 0
    ? options.retryDelayMs
    : 750;
  const repairSettleMs = Number.isInteger(options.repairSettleMs) && options.repairSettleMs >= 0
    ? options.repairSettleMs
    : 8_000;
  const waitImpl = options.waitImpl ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const repair = options.repair;
  const checkOptions = { ...options };
  for (const key of [
    "failureAttempts",
    "verificationAttempts",
    "retryDelayMs",
    "repairSettleMs",
    "waitImpl",
    "repair",
  ]) delete checkOptions[key];

  let result;
  for (let attempt = 1; attempt <= failureAttempts; attempt += 1) {
    result = await checkOnlineHost(providerInput, checkOptions);
    if (result.ok || !REPAIRABLE_PUBLIC_CODES.has(result.error?.code)) return result;
    if (attempt < failureAttempts && retryDelayMs > 0) await waitImpl(retryDelayMs);
  }
  if (typeof repair !== "function") return result;

  try {
    await repair();
  } catch (error) {
    const message = typeof error?.message === "string" && error.message.trim()
      ? error.message.trim().slice(0, 500)
      : "自动修复未完成。";
    return withRepair({
      ...result,
      error: Object.freeze({
        code: "ONLINE_HOST_REPAIR_FAILED",
        message: `真实公网 TLS 连续失败，自动修复 Funnel 未完成：${message}`,
      }),
    }, { attempted: true, succeeded: false });
  }

  if (repairSettleMs > 0) await waitImpl(repairSettleMs);
  let verified = result;
  for (let attempt = 1; attempt <= verificationAttempts; attempt += 1) {
    verified = await checkOnlineHost(providerInput, checkOptions);
    if (verified.ok) return withRepair(verified, { attempted: true, succeeded: true });
    if (attempt < verificationAttempts && retryDelayMs > 0) await waitImpl(retryDelayMs);
  }
  return withRepair(verified, { attempted: true, succeeded: false });
}

