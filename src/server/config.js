import os from "node:os";
import path from "node:path";

function integer(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid numeric server configuration (${min}-${max}).`);
  }
  return parsed;
}

function list(value, separator = ",") {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  return value.split(separator).map((item) => item.trim()).filter(Boolean);
}

function projectRootList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  const separator = /[;,\r\n]+/;
  return value.split(separator).map((item) => item.trim()).filter(Boolean);
}

function registryTokens(registry) {
  if (registry instanceof Map) return [...registry.keys()].map(String);
  if (Array.isArray(registry)) return registry.map((entry) => entry?.token).filter(Boolean).map(String);
  if (registry && typeof registry === "object") return Object.keys(registry);
  return [];
}

export function isLoopbackHost(host) {
  const normalized = String(host).trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost"
    || normalized === "::1"
    || normalized === "0:0:0:0:0:0:0:1"
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

export function loadServerConfig(options = {}) {
  const env = options.env ?? process.env;
  const host = options.host ?? env.HOST ?? "127.0.0.1";
  const apiToken = options.apiToken ?? options.auth?.token ?? env.API_TOKEN ?? "";
  const tokens = options.tokens ?? options.auth?.tokens ?? [];
  const configuredTokens = [apiToken, ...registryTokens(tokens)].filter(Boolean);
  const hasTokenResolver = typeof (options.resolveToken ?? options.auth?.resolveToken) === "function";
  const inferredAuth = configuredTokens.length || hasTokenResolver
    ? "token"
    : "none";
  const authMode = String(options.authMode ?? options.auth?.mode ?? env.AUTH_MODE ?? inferredAuth).toLowerCase();
  if (authMode !== "none" && authMode !== "token") throw new Error("AUTH_MODE must be none or token.");

  const allowedProjectRoots = projectRootList(
    options.allowedProjectRoots ?? env.ALLOWED_PROJECT_ROOTS,
  );
  const loopback = isLoopbackHost(host);
  if (!loopback && authMode !== "token") {
    throw new Error("A Bearer token is required when listening on a non-loopback address.");
  }
  if (authMode === "token" && configuredTokens.length === 0 && !hasTokenResolver) {
    throw new Error("AUTH_MODE=token requires API_TOKEN or a token registry.");
  }
  if (!loopback && configuredTokens.some((token) => token.length < 32)) {
    throw new Error("Non-loopback API tokens must contain at least 32 characters.");
  }
  if (!loopback && allowedProjectRoots.length === 0) {
    throw new Error("ALLOWED_PROJECT_ROOTS is required when listening on a non-loopback address.");
  }
  const configuredApiKeyStorePath = options.apiKeyStorePath ?? env.API_KEY_STORE_PATH;
  const apiKeyStorePath = typeof configuredApiKeyStorePath === "string" && configuredApiKeyStorePath.trim()
    ? configuredApiKeyStorePath.trim()
    : (options.mode === "standalone"
      ? path.join(os.homedir(), ".codex-control-center", "api-keys.json")
      : null);
  const configuredUsageStorePath = options.usageStorePath ?? env.USAGE_STORE_PATH;
  const usageStorePath = typeof configuredUsageStorePath === "string" && configuredUsageStorePath.trim()
    ? configuredUsageStorePath.trim()
    : (options.mode === "standalone"
      ? path.join(os.homedir(), ".codex-control-center", "usage-stats.json")
      : null);
  const configuredAttachmentUploadRoot = options.attachmentUploadRoot
    ?? options.imageUploadRoot
    ?? env.ATTACHMENT_UPLOAD_ROOT
    ?? env.IMAGE_UPLOAD_ROOT;
  const attachmentUploadRoot = typeof configuredAttachmentUploadRoot === "string" && configuredAttachmentUploadRoot.trim()
    ? configuredAttachmentUploadRoot.trim()
    : path.join(os.tmpdir(), "codex-control-center-attachments");

  return {
    host,
    port: integer(options.port ?? env.PORT, options.mode === "standalone" ? 4310 : 0, { max: 65_535 }),
    loopback,
    authMode,
    apiToken,
    tokens,
    allowedProjectRoots,
    corsOrigins: list(options.corsOrigins ?? env.CORS_ORIGINS),
    trustProxy: options.trustProxy ?? /^(?:1|true|yes)$/i.test(String(env.TRUST_PROXY ?? "false")),
    allowDangerousTasks: options.allowDangerousTasks
      ?? /^(?:1|true|yes)$/i.test(String(env.ALLOW_DANGEROUS_TASKS ?? "false")),
    allowTaskNetwork: options.allowTaskNetwork
      ?? /^(?:1|true|yes)$/i.test(String(env.ALLOW_TASK_NETWORK ?? "false")),
    maxConcurrentTasks: integer(options.maxConcurrentTasks ?? env.MAX_CONCURRENT_TASKS, 2, { min: 1, max: 32 }),
    maxQueuedTasks: integer(options.maxQueuedTasks ?? env.MAX_QUEUED_TASKS, 50, { min: 1, max: 10_000 }),
    maxSseConnections: integer(options.maxSseConnections ?? env.MAX_SSE_CONNECTIONS, 100, { min: 1, max: 10_000 }),
    taskTimeoutMs: integer(options.taskTimeoutMs ?? env.TASK_TIMEOUT_MS, 30 * 60 * 1_000, { min: 1_000 }),
    taskHistoryLimit: integer(options.taskHistoryLimit ?? env.TASK_HISTORY_LIMIT, 200, { min: 10, max: 10_000 }),
    eventHistoryLimit: integer(options.eventHistoryLimit ?? env.EVENT_HISTORY_LIMIT, 500, { min: 100, max: 20_000 }),
    eventHistoryBytes: integer(options.eventHistoryBytes ?? env.EVENT_HISTORY_BYTES, 2 * 1024 * 1024, { min: 65_536, max: 64 * 1024 * 1024 }),
    maxTaskFiles: integer(options.maxTaskFiles ?? env.MAX_TASK_FILES, 12, { min: 1, max: 32 }),
    maxTaskImages: integer(options.maxTaskImages ?? env.MAX_TASK_IMAGES, 4, { min: 1, max: 16 }),
    maxFileBytes: integer(options.maxFileBytes ?? options.maxImageBytes ?? env.MAX_FILE_BYTES ?? env.MAX_IMAGE_BYTES, 25 * 1024 * 1024, { min: 1024, max: 100 * 1024 * 1024 }),
    maxTaskAttachmentBytes: integer(options.maxTaskAttachmentBytes ?? env.MAX_TASK_ATTACHMENT_BYTES, 100 * 1024 * 1024, { min: 1024, max: 512 * 1024 * 1024 }),
    attachmentUploadTtlMs: integer(options.attachmentUploadTtlMs ?? options.imageUploadTtlMs ?? env.ATTACHMENT_UPLOAD_TTL_MS ?? env.IMAGE_UPLOAD_TTL_MS, 30 * 60 * 1_000, { min: 10_000, max: 24 * 60 * 60 * 1_000 }),
    logLevel: String(options.logLevel ?? env.LOG_LEVEL ?? "info").toLowerCase(),
    bodyLimit: options.bodyLimit ?? "1mb",
    openAiCompatBodyLimit: options.openAiCompatBodyLimit ?? env.OPENAI_COMPAT_BODY_LIMIT ?? "36mb",
    initialProjects: options.initialProjects ?? [],
    scratchRoot: options.scratchRoot ?? env.SCRATCH_ROOT,
    apiKeyStorePath,
    usageStorePath,
    attachmentUploadRoot,
    // Deprecated aliases retained for callers that construct config objects directly.
    imageUploadRoot: attachmentUploadRoot,
    maxImageBytes: integer(options.maxFileBytes ?? options.maxImageBytes ?? env.MAX_FILE_BYTES ?? env.MAX_IMAGE_BYTES, 25 * 1024 * 1024, { min: 1024, max: 100 * 1024 * 1024 }),
    imageUploadTtlMs: integer(options.attachmentUploadTtlMs ?? options.imageUploadTtlMs ?? env.ATTACHMENT_UPLOAD_TTL_MS ?? env.IMAGE_UPLOAD_TTL_MS, 30 * 60 * 1_000, { min: 10_000, max: 24 * 60 * 60 * 1_000 }),
  };
}
