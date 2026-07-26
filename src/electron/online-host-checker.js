const DEFAULT_TIMEOUT_MS = 12_000;
const REQUEST_ID_PATTERN = /^req_[a-f0-9]{32}$/;
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
  });
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
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");

  const checks = [];
  let health;
  try {
    health = await runProbe(fetchImpl, provider.healthUrl, timeoutMs);
  } catch (error) {
    const timedOut = error?.name === "AbortError" || /timed out/i.test(String(error?.message ?? ""));
    return failedResult(
      provider,
      checks,
      timedOut ? "ONLINE_HOST_TIMEOUT" : "ONLINE_HOST_UNREACHABLE",
      timedOut ? "公网请求超时，请检查隧道和网络连接。" : "无法连接公网 Host，请检查隧道、DNS 和 HTTPS 状态。",
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
    return failedResult(
      provider,
      checks,
      timedOut ? "OPENAI_ROUTE_TIMEOUT" : "OPENAI_ROUTE_UNREACHABLE",
      timedOut ? "OpenAI 兼容路由检查超时。" : "公网已连接，但无法检查 OpenAI 兼容路由。",
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
    error: null,
    message: "公网 Host、OpenAI 兼容路由、Gateway Key 鉴权和 Request ID 均正常。",
  });
}

