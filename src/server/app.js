import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { ApiKeyStore } from "./api-key-store.js";
import { canAccessOwner, createAuth, hasScope } from "./auth.js";
import { isLoopbackHost, loadServerConfig } from "./config.js";
import { asyncRoute, HttpError } from "./errors.js";
import { listModels, resolveModel } from "./models.js";
import { AttachmentUploadStore } from "./attachment-upload-store.js";
import { ProjectRegistry } from "./projects.js";
import { TaskManager } from "./task-manager.js";
import { UsageStore } from "./usage-store.js";
import { createOpenAICompatibilityRouter, publicOpenAIError } from "./openai-compat.js";
import { createCodexRunner } from "../runner/codex-runner.js";
import {
  normalizeApprovalPolicy,
  normalizeEffort,
  normalizePermission,
  normalizeSpeed,
} from "../runner/protocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../../public");
const TERMINAL_TASK_STATES = new Set(["completed", "failed", "cancelled"]);
const APP_VERSION = JSON.parse(readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")).version;
const MAX_WS_BUFFERED_BYTES = 1024 * 1024;
const MAX_WS_SUBSCRIPTIONS = 32;

function requestOriginAllowed(origin, host, config) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host) return true;
    return config.corsOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}

function requestHostAllowed(host, config) {
  if (!config.loopback) return true;
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase().replace(/\.$/, "");
    if (isLoopbackHost(hostname)) return true;
    if (config.allowedHosts.includes(hostname)) return true;
    return config.isAllowedHost?.(hostname) === true;
  } catch {
    return false;
  }
}

function securityHeaders(_request, response, next) {
  response.set({
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self' ws: wss:",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  next();
}

function requestId(request, response, next) {
  request.requestId = `req_${randomUUID().replaceAll("-", "")}`;
  response.set("X-Request-Id", request.requestId);
  next();
}

function cors(config) {
  return (request, response, next) => {
    if (!requestHostAllowed(request.get("host"), config)) {
      next(new HttpError(421, "HOST_FORBIDDEN", "The request Host is not allowed for this local service."));
      return;
    }
    const origin = request.get("origin");
    if (origin && !requestOriginAllowed(origin, request.get("host"), config)) {
      next(new HttpError(403, "ORIGIN_FORBIDDEN", "This request origin is not allowed."));
      return;
    }
    if (origin) {
      response.set("Access-Control-Allow-Origin", origin);
      response.set("Vary", "Origin");
      response.set(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, Last-Event-ID, X-File-Name, X-Client-Request-Id, OpenAI-Beta, OpenAI-Organization, OpenAI-Project",
      );
      response.set("Access-Control-Expose-Headers", "X-Request-Id");
      response.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      response.set("Access-Control-Max-Age", "600");
    }
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    next();
  };
}

function principalContext(principal) {
  return {
    ownerId: principal.projectOwnerId ?? principal.sub,
    allowAll: hasScope(principal, "*"),
  };
}

function taskInputForPrincipal(input, principal) {
  const preset = principal?.taskPreset;
  if (!preset || !input || typeof input !== "object" || Array.isArray(input)) return input;
  const conflicts = [];
  try {
    if (input.model !== undefined && resolveModel(input.model).id !== preset.model) conflicts.push("model");
    if (input.effort !== undefined && normalizeEffort(input.effort) !== preset.effort) conflicts.push("effort");
    if (input.speed !== undefined && normalizeSpeed(input.speed) !== preset.speed) conflicts.push("speed");
    if (input.permission !== undefined && normalizePermission(input.permission) !== preset.permission) {
      conflicts.push("permission");
    }
    if (input.sandboxMode !== undefined && normalizePermission(input.sandboxMode) !== preset.permission) {
      conflicts.push("sandboxMode");
    }
    if (input.approvalPolicy !== undefined
      && normalizeApprovalPolicy(input.approvalPolicy, preset.permission) !== preset.approvalPolicy) {
      conflicts.push("approvalPolicy");
    }
  } catch (error) {
    throw new HttpError(
      400,
      "INVALID_TASK_OPTIONS",
      error instanceof Error ? error.message : "Task options are invalid.",
    );
  }
  if (conflicts.length) {
    throw new HttpError(
      409,
      "API_KEY_PRESET_CONFLICT",
      `This API key is locked to its saved ${conflicts.join(", ")} setting.`,
      { fields: conflicts },
    );
  }
  return {
    ...input,
    model: preset.model,
    effort: preset.effort,
    speed: preset.speed,
    permission: preset.permission,
    sandboxMode: preset.permission,
    approvalPolicy: preset.approvalPolicy,
  };
}

function ensureTaskAccess(task, principal) {
  if (!canAccessOwner(principal, task.ownerId)) {
    throw new HttpError(404, "NOT_FOUND", "Task not found.");
  }
  return task;
}

function parseEventCursor(request) {
  const raw = request.get("last-event-id") ?? request.query.after ?? 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function writeSse(response, event) {
  const accepted = response.write(
    `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
  response.flush?.();
  return accepted;
}

function publicError(error) {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.expose ? error.message : "The request could not be completed.",
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
    };
  }
  if (error?.type === "entity.parse.failed") {
    return { status: 400, body: { error: { code: "INVALID_JSON", message: "The request body is not valid JSON." } } };
  }
  if (error?.type === "entity.too.large") {
    return { status: 413, body: { error: { code: "REQUEST_TOO_LARGE", message: "The request body is too large." } } };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "The server could not complete the request." } },
  };
}

function rejectUpgrade(socket, status, message) {
  if (!socket.writable) return socket.destroy();
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

function serverUrl(host, port) {
  const displayHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${displayHost}:${port}`;
}

function uploadedFileName(request) {
  const value = request.get("x-file-name");
  if (!value || value.length > 1_024) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function createServerApp(options = {}) {
  const config = options.config ?? loadServerConfig(options);
  const logger = options.logger ?? console;
  const projectRegistry = options.projectRegistry ?? new ProjectRegistry({
    allowedRoots: config.allowedProjectRoots,
    initialProjects: config.initialProjects,
  });
  const runner = options.runner ?? createCodexRunner({ timeoutMs: config.taskTimeoutMs });
  const usageStore = options.usageStore ?? new UsageStore({ filePath: config.usageStorePath });
  const attachmentStore = options.attachmentStore ?? options.imageStore ?? new AttachmentUploadStore({
    root: config.attachmentUploadRoot,
    maxBytes: config.maxFileBytes,
    maxFiles: config.maxTaskFiles,
    maxImages: config.maxTaskImages,
    maxTotalBytes: config.maxTaskAttachmentBytes,
    ttlMs: config.attachmentUploadTtlMs,
  });
  const taskManager = options.taskManager ?? new TaskManager({
    runner,
    projects: projectRegistry,
    maxConcurrent: config.maxConcurrentTasks,
    maxQueued: config.maxQueuedTasks,
    timeoutMs: config.taskTimeoutMs,
    historyLimit: config.taskHistoryLimit,
    eventHistoryLimit: config.eventHistoryLimit,
    eventHistoryBytes: config.eventHistoryBytes,
    requireExplicitProject: config.authMode === "token",
    scratchRoot: config.scratchRoot,
    usageStore,
    attachmentStore,
    logger,
  });
  const apiKeyStore = options.apiKeyStore ?? new ApiKeyStore({
    filePath: config.apiKeyStorePath,
    secretProtector: options.apiKeySecretProtector,
  });
  apiKeyStore.purgeRevoked();
  const externalTokenResolver = options.resolveToken ?? options.auth?.resolveToken;
  const auth = options.authService ?? createAuth({
    mode: config.authMode,
    apiToken: config.apiToken,
    tokens: config.tokens,
    sessionToken: options.desktopSessionToken,
    resolveToken: async (token, request) => apiKeyStore.resolve(token)
      ?? (externalTokenResolver ? externalTokenResolver(token, request) : null),
  });
  const credentialSockets = new Map();
  const credentialStreams = new Map();
  const closeCredentialSockets = (credentialId, code = 4003, reason = "API key deleted") => {
    const sockets = credentialSockets.get(credentialId);
    if (!sockets) return 0;
    const count = sockets.size;
    for (const webSocket of [...sockets]) webSocket.close(code, reason);
    credentialSockets.delete(credentialId);
    return count;
  };
  const registerCredentialStream = (credentialId, close) => {
    if (!credentialId) return () => {};
    const streams = credentialStreams.get(credentialId) ?? new Set();
    streams.add(close);
    credentialStreams.set(credentialId, streams);
    return () => {
      streams.delete(close);
      if (!streams.size) credentialStreams.delete(credentialId);
    };
  };
  const closeCredentialStreams = (credentialId) => {
    const streams = credentialStreams.get(credentialId);
    if (!streams) return 0;
    const count = streams.size;
    for (const close of [...streams]) close();
    credentialStreams.delete(credentialId);
    return count;
  };
  const closeCredentialConnections = (credentialId, options = {}) => (
    closeCredentialSockets(credentialId, options.code, options.reason) + closeCredentialStreams(credentialId)
  );
  const disconnectGatewayClients = () => {
    const credentialIds = new Set([
      ...credentialSockets.keys(),
      ...credentialStreams.keys(),
      ...taskManager.activeCredentialIds(),
    ]);
    let cancelledTasks = 0;
    let closedConnections = 0;
    for (const credentialId of credentialIds) {
      cancelledTasks += taskManager.cancelByCredential(credentialId);
      closedConnections += closeCredentialConnections(credentialId, {
        code: 4004,
        reason: "Gateway host disabled",
      });
    }
    return { cancelledTasks, closedConnections };
  };
  const revalidateCredentials = () => {
    const credentialIds = new Set([
      ...credentialSockets.keys(),
      ...credentialStreams.keys(),
      ...taskManager.activeCredentialIds(),
    ]);
    if (!credentialIds.size) return;
    try {
      if (!apiKeyStore.gatewayStatus().enabled) {
        disconnectGatewayClients();
        return;
      }
      for (const credentialId of apiKeyStore.inactiveCredentialIds(credentialIds)) {
        taskManager.cancelByCredential(credentialId);
        closeCredentialConnections(credentialId);
      }
    } catch (error) {
      logger.error?.("[server] API key revalidation failed", error);
    }
  };
  const revocationPollMs = Number.isFinite(options.apiKeyRevocationPollMs)
    ? Math.max(10, Number(options.apiKeyRevocationPollMs))
    : 1_000;
  const credentialRevalidationTimer = apiKeyStore.filePath
    ? setInterval(revalidateCredentials, revocationPollMs)
    : null;
  credentialRevalidationTimer?.unref?.();
  const stopCredentialRevalidation = () => clearInterval(credentialRevalidationTimer);

  const app = express();
  if (config.trustProxy) app.set("trust proxy", true);
  app.disable("x-powered-by");
  app.use(requestId);
  app.use(securityHeaders);
  app.use(cors(config));
  const jsonBody = express.json({ limit: config.bodyLimit, strict: true });
  app.use((request, response, next) => {
    if (/^\/api\/v1\/(?:external\/)?uploads\/(?:files|images)(?:\/|$)/.test(request.path)) {
      next();
      return;
    }
    jsonBody(request, response, next);
  });

  const health = (_request, response) => response.json({
    ok: true,
    status: "ok",
    version: APP_VERSION,
    uptimeSeconds: Math.floor(process.uptime()),
    activeTasks: taskManager.active.size,
    queuedTasks: taskManager.queue.length,
  });
  app.get("/health", health);
  app.get("/api/v1/health", health);

  const api = express.Router();
  api.use(auth.authenticate);

  api.get("/models", auth.requireScope("models:read"), (_request, response) => {
    response.json({
      models: listModels(),
      efforts: ["low", "medium", "high", "xhigh"],
      speeds: ["standard", "fast"],
      permissions: ["read-only", "workspace-write", "danger-full-access"],
      approvalPolicies: ["untrusted", "never"],
      supportsProjectless: true,
      supportsImages: true,
      supportsFiles: true,
      imageLimits: attachmentStore.imageLimits(),
      fileLimits: attachmentStore.limits(),
    });
  });

  const fileBody = express.raw({ type: () => true, limit: config.maxFileBytes });
  const uploadFile = asyncRoute(async (request, response) => {
    const file = await attachmentStore.create({
      ownerId: request.auth.sub,
      body: request.body,
      mimeType: request.get("content-type"),
      fileName: uploadedFileName(request),
    });
    response.status(201).json({ file, limits: attachmentStore.limits() });
  });
  const uploadImage = asyncRoute(async (request, response) => {
    const image = await attachmentStore.create({
      ownerId: request.auth.sub,
      body: request.body,
      mimeType: request.get("content-type"),
      fileName: uploadedFileName(request),
      imageOnly: true,
    });
    response.status(201).json({ image, limits: attachmentStore.imageLimits() });
  });
  const discardUpload = (request, response, next) => {
    try {
      response.json(attachmentStore.discard(request.params.id, request.auth.sub));
    } catch (error) {
      next(error);
    }
  };

  api.post("/uploads/files", auth.requireScope("tasks:write"), fileBody, uploadFile);
  api.delete("/uploads/files/:id", auth.requireScope("tasks:write"), discardUpload);
  api.post("/uploads/images", auth.requireScope("tasks:write"), fileBody, uploadImage);
  api.delete("/uploads/images/:id", auth.requireScope("tasks:write"), discardUpload);

  const usageSnapshot = () => usageStore.snapshot({
    activeCount: taskManager.activeCountForUsageGeneration(usageStore.generation),
  });

  api.get("/usage", auth.requireScope("usage:read"), (_request, response) => {
    response.json(usageSnapshot());
  });

  api.post("/usage/reset", auth.requireScope("usage:manage"), (_request, response, next) => {
    try {
      usageStore.reset();
      response.json(usageSnapshot());
    } catch (error) {
      next(error);
    }
  });

  const gatewaySnapshot = (details = {}) => ({
    ...apiKeyStore.gatewayStatus(),
    activeTasks: taskManager.activeCredentialIds().size,
    activeConnections: [...credentialSockets.values()].reduce((total, sockets) => total + sockets.size, 0)
      + [...credentialStreams.values()].reduce((total, streams) => total + streams.size, 0),
    ...details,
  });

  api.get("/gateway", auth.requireScope("api-keys:manage"), (_request, response) => {
    response.json(gatewaySnapshot());
  });

  api.post("/gateway", auth.requireScope("api-keys:manage"), (request, response, next) => {
    try {
      const status = apiKeyStore.setGatewayEnabled(request.body?.enabled);
      const disconnected = status.enabled
        ? { cancelledTasks: 0, closedConnections: 0 }
        : disconnectGatewayClients();
      response.json(gatewaySnapshot(disconnected));
    } catch (error) {
      next(error);
    }
  });

  api.get("/api-keys", auth.requireScope("api-keys:manage"), (request, response) => {
    response.json({
      apiKeys: apiKeyStore.list({
        ownerId: request.auth.sub,
        allowAll: hasScope(request.auth, "*"),
      }),
    });
  });

  api.post("/api-keys", auth.requireScope("api-keys:manage"), (request, response, next) => {
    try {
      response.status(201).json(apiKeyStore.create(request.body, {
        ownerId: request.auth.sub,
        allowAll: hasScope(request.auth, "*"),
      }));
    } catch (error) {
      next(error);
    }
  });

  api.get("/api-keys/:id/secret", auth.requireScope("api-keys:manage"), (request, response, next) => {
    try {
      response.json(apiKeyStore.reveal(request.params.id, {
        ownerId: request.auth.sub,
        allowAll: hasScope(request.auth, "*"),
      }));
    } catch (error) {
      next(error);
    }
  });

  const deleteApiKey = (request, response, next) => {
    try {
      const deleted = apiKeyStore.remove(request.params.id, {
        ownerId: request.auth.sub,
        allowAll: hasScope(request.auth, "*"),
      });
      const cancelledTasks = taskManager.cancelByCredential(request.params.id);
      attachmentStore.discardOwner(`api-key:${request.params.id}`);
      const closedConnections = closeCredentialConnections(request.params.id);
      usageStore.deleteCredential(request.params.id);
      response.json({ ...deleted, cancelledTasks, closedConnections });
    } catch (error) {
      next(error);
    }
  };

  api.delete("/api-keys/:id", auth.requireScope("api-keys:manage"), deleteApiKey);
  // Compatibility route for older clients. Revocation now permanently deletes the key.
  api.post("/api-keys/:id/revoke", auth.requireScope("api-keys:manage"), deleteApiKey);

  api.get("/projects", auth.requireScope("projects:read"), (request, response) => {
    response.json({ projects: projectRegistry.list(principalContext(request.auth)) });
  });

  api.post("/projects", auth.requireScope("projects:write"), (request, response) => {
    const project = projectRegistry.register(request.body, principalContext(request.auth));
    response.status(201).json(project);
  });

  api.post("/projects/select", auth.requireScope("projects:write"), (request, response) => {
    response.json(projectRegistry.select(request.body, principalContext(request.auth)));
  });

  const listTasks = (request, response) => {
    const ownerId = hasScope(request.auth, "*") ? undefined : request.auth.sub;
    response.json({
      tasks: taskManager.list({ ownerId, status: request.query.status, limit: request.query.limit }),
    });
  };

  const createTaskForRequest = (request, input, options = {}) => {
    const taskInput = taskInputForPrincipal(input, request.auth);
    const permission = normalizePermission(taskInput?.permission ?? taskInput?.sandboxMode ?? "workspace-write");
    if (permission === "danger-full-access") {
      if (!hasScope(request.auth, "tasks:dangerous")) {
        throw new HttpError(403, "DANGEROUS_TASK_FORBIDDEN", "This token cannot run full-access tasks.");
      }
      if (!config.loopback && !config.allowDangerousTasks) {
        throw new HttpError(403, "DANGEROUS_TASKS_DISABLED", "Full-access tasks are disabled for remote deployments.");
      }
    }
    if (taskInput?.networkAccessEnabled === true) {
      if (!hasScope(request.auth, "tasks:network")) {
        throw new HttpError(403, "TASK_NETWORK_FORBIDDEN", "This token cannot enable task network access.");
      }
      if (!config.loopback && !config.allowTaskNetwork) {
        throw new HttpError(403, "TASK_NETWORK_DISABLED", "Task network access is disabled for remote deployments.");
      }
    }
    return taskManager.create(taskInput, {
      ownerId: request.auth.sub,
      projectOwnerId: request.auth.projectOwnerId ?? request.auth.sub,
      credentialId: request.auth.credentialId,
      allowAllProjects: hasScope(request.auth, "*"),
      requireExplicitProject: options.requireExplicitProject === true || Boolean(request.auth.credentialId),
    });
  };

  const submitTask = (request, response, next, options = {}) => {
    try {
      const task = createTaskForRequest(request, request.body, options);
      response.status(202).json(task);
    } catch (error) {
      next(error);
    }
  };

  const getTask = (request, response) => {
    const task = ensureTaskAccess(taskManager.get(request.params.id), request.auth);
    response.json(taskManager.public(task));
  };

  const cancelTask = (request, response) => {
    ensureTaskAccess(taskManager.get(request.params.id), request.auth);
    response.status(202).json(taskManager.cancel(request.params.id));
  };

  let sseConnections = 0;
  const acquireSseConnection = () => {
    if (sseConnections >= config.maxSseConnections) {
      throw new HttpError(429, "SSE_LIMIT_REACHED", "Too many event stream connections are open.");
    }
    sseConnections += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      sseConnections -= 1;
    };
  };
  const streamTaskEvents = (request, response, next) => {
    try {
      const task = ensureTaskAccess(taskManager.get(request.params.id), request.auth);
      const release = acquireSseConnection();
      response.status(200).set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders();
      if (!response.write(": connected\n\n")) {
        release();
        response.end();
        return;
      }

      const cursor = parseEventCursor(request);
      for (const event of taskManager.eventsAfter(task.id, cursor)) {
        if (!writeSse(response, event)) {
          release();
          response.end();
          return;
        }
      }
      if (TERMINAL_TASK_STATES.has(task.status)) {
        release();
        response.end();
        return;
      }

      let unsubscribe = () => {};
      let stopOnManagerClose = () => {};
      let unregisterCredentialStream = () => {};
      let closed = false;
      let heartbeat;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        stopOnManagerClose();
        stopOnManagerClose = () => {};
        unregisterCredentialStream();
        unregisterCredentialStream = () => {};
        release();
        if (!response.writableEnded) response.end();
      };
      unregisterCredentialStream = registerCredentialStream(request.auth.credentialId, close);
      heartbeat = setInterval(() => {
        if (!response.write(": keepalive\n\n")) close();
      }, 15_000);
      heartbeat.unref?.();
      unsubscribe = taskManager.subscribe(task.id, (event) => {
        if (response.writableEnded) return;
        if (!writeSse(response, event)) {
          close();
          return;
        }
        if (event.type === "done") close();
      });
      stopOnManagerClose = taskManager.onClose(close);
      request.once("close", () => {
        close();
      });
    } catch (error) {
      next(error);
    }
  };

  api.get("/tasks", auth.requireScope("tasks:read"), listTasks);
  api.post("/tasks", auth.requireScope("tasks:write"), (request, response, next) => {
    submitTask(request, response, next);
  });
  api.get("/tasks/:id", auth.requireScope("tasks:read"), getTask);
  api.post("/tasks/:id/cancel", auth.requireScope("tasks:cancel"), cancelTask);
  api.get("/tasks/:id/events", auth.requireScope("tasks:read"), streamTaskEvents);

  const externalApi = express.Router();
  externalApi.use((_request, _response, next) => {
    if (!apiKeyStore.gatewayStatus().enabled) {
      next(new HttpError(503, "GATEWAY_DISABLED", "The external API Host is currently turned off."));
      return;
    }
    next();
  });
  externalApi.use(auth.authenticateToken);
  externalApi.get("/profile", auth.requireScope("models:read"), (request, response) => {
    response.json({
      credentialId: request.auth.credentialId ?? null,
      preset: request.auth.taskPreset ? { ...request.auth.taskPreset } : null,
      projects: hasScope(request.auth, "projects:read")
        ? projectRegistry.list(principalContext(request.auth))
        : [],
      imageLimits: attachmentStore.imageLimits(),
      fileLimits: attachmentStore.limits(),
      endpoints: {
        uploadFile: "/api/v1/external/uploads/files",
        uploadImage: "/api/v1/external/uploads/images",
        createTask: "/api/v1/external/tasks",
        task: "/api/v1/external/tasks/:id",
        events: "/api/v1/external/tasks/:id/events",
      },
    });
  });
  externalApi.get("/projects", auth.requireScope("projects:read"), (request, response) => {
    response.json({ projects: projectRegistry.list(principalContext(request.auth)) });
  });
  externalApi.post("/uploads/files", auth.requireScope("tasks:write"), fileBody, uploadFile);
  externalApi.delete("/uploads/files/:id", auth.requireScope("tasks:write"), discardUpload);
  externalApi.post("/uploads/images", auth.requireScope("tasks:write"), fileBody, uploadImage);
  externalApi.delete("/uploads/images/:id", auth.requireScope("tasks:write"), discardUpload);
  externalApi.get("/tasks", auth.requireScope("tasks:read"), listTasks);
  externalApi.post("/tasks", auth.requireScope("tasks:write"), (request, response, next) => {
    submitTask(request, response, next, { requireExplicitProject: true });
  });
  externalApi.get("/tasks/:id", auth.requireScope("tasks:read"), getTask);
  externalApi.post("/tasks/:id/cancel", auth.requireScope("tasks:cancel"), cancelTask);
  externalApi.get("/tasks/:id/events", auth.requireScope("tasks:read"), streamTaskEvents);

  app.use("/api/v1/external", externalApi);
  app.use("/api/v1", api);
  app.use("/v1", createOpenAICompatibilityRouter({
    auth,
    apiKeyStore,
    taskManager,
    createTask: (request, input) => createTaskForRequest(request, input),
    registerCredentialStream,
    acquireStream: acquireSseConnection,
  }));
  app.use(express.static(PUBLIC_DIR, {
    dotfiles: "deny",
    etag: true,
    index: "index.html",
    maxAge: options.mode === "desktop" ? 0 : "1h",
    setHeaders(response, filePath) {
      if (path.basename(filePath) === "index.html") response.set("Cache-Control", "no-store");
    },
  }));
  app.get("*path", (request, response, next) => {
    if (request.accepts("html")
      && !request.path.startsWith("/api/")
      && request.path !== "/v1"
      && !request.path.startsWith("/v1/")) {
      response.sendFile(path.join(PUBLIC_DIR, "index.html"));
      return;
    }
    next();
  });
  app.use((request, _response, next) => {
    next(new HttpError(404, "NOT_FOUND", `No route exists for ${request.method} ${request.path}.`));
  });
  app.use((error, request, response, _next) => {
    const openAICompatible = /^\/v1(?:\/|$)/.test(request.originalUrl ?? request.path);
    const normalized = openAICompatible ? publicOpenAIError(error) : publicError(error);
    if (normalized.status >= 500 && error?.code !== "GATEWAY_DISABLED") {
      logger.error?.("[server] request failed", error);
    }
    if (response.headersSent) {
      response.end();
      return;
    }
    if (openAICompatible && normalized.status === 401) {
      response.set("WWW-Authenticate", 'Bearer realm="openai-compatible-api"');
    }
    if (openAICompatible && normalized.status === 429) response.set("Retry-After", "1");
    response.status(normalized.status).json(normalized.body);
  });

  const server = http.createServer(app);
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.maxRequestsPerSocket = 1_000;

  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  server.on("upgrade", async (request, socket, head) => {
    try {
      const target = new URL(request.url ?? "/", "http://localhost");
      if (target.pathname !== "/ws") {
        rejectUpgrade(socket, 404, "Not Found");
        return;
      }
      if (!requestOriginAllowed(request.headers.origin, request.headers.host, config)) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      if (!requestHostAllowed(request.headers.host, config)) {
        rejectUpgrade(socket, 421, "Misdirected Request");
        return;
      }
      if (webSocketServer.clients.size >= config.maxSseConnections) {
        rejectUpgrade(socket, 429, "Too Many Requests");
        return;
      }
      const principal = await auth.resolveAuthorization(request.headers.authorization, request);
      if (!principal || !hasScope(principal, "tasks:read")) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      if (principal.credentialId && !apiKeyStore.gatewayStatus().enabled) {
        rejectUpgrade(socket, 503, "Service Unavailable");
        return;
      }
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        webSocketServer.emit("connection", webSocket, request, principal);
      });
    } catch {
      rejectUpgrade(socket, 400, "Bad Request");
    }
  });

  webSocketServer.on("connection", (webSocket, _request, principal) => {
    const subscriptions = new Map();
    const credentialId = principal.credentialId;
    if (credentialId) {
      const sockets = credentialSockets.get(credentialId) ?? new Set();
      sockets.add(webSocket);
      credentialSockets.set(credentialId, sockets);
    }
    const send = (value) => {
      if (webSocket.readyState !== WebSocket.OPEN) return false;
      if (webSocket.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
        webSocket.close(1013, "Client is not consuming events quickly enough.");
        return false;
      }
      webSocket.send(JSON.stringify(value));
      return true;
    };
    const unsubscribe = (taskId) => {
      subscriptions.get(taskId)?.();
      subscriptions.delete(taskId);
    };
    send({ type: "welcome", version: APP_VERSION });
    webSocket.on("message", (buffer) => {
      try {
        const message = JSON.parse(buffer.toString("utf8"));
        if (message.type === "ping") {
          send({ type: "pong", timestamp: new Date().toISOString() });
          return;
        }
        if (message.type === "unsubscribe" && typeof message.taskId === "string") {
          unsubscribe(message.taskId);
          return;
        }
        if (message.type !== "subscribe" || typeof message.taskId !== "string") {
          send({ type: "error", error: { code: "INVALID_MESSAGE", message: "Expected a task subscription." } });
          return;
        }
        const task = ensureTaskAccess(taskManager.get(message.taskId), principal);
        if (!subscriptions.has(task.id) && subscriptions.size >= MAX_WS_SUBSCRIPTIONS) {
          send({ type: "error", error: { code: "SUBSCRIPTION_LIMIT", message: "Too many task subscriptions are open." } });
          return;
        }
        unsubscribe(task.id);
        for (const event of taskManager.eventsAfter(task.id, Number(message.after) || 0)) {
          if (!send(event)) return;
        }
        if (!TERMINAL_TASK_STATES.has(task.status)) {
          const stop = taskManager.subscribe(task.id, (event) => {
            send(event);
            if (event.type === "done") unsubscribe(task.id);
          });
          subscriptions.set(task.id, stop);
        }
        send({ type: "subscribed", taskId: task.id });
      } catch (error) {
        const normalized = publicError(error);
        send({ type: "error", error: normalized.body.error });
      }
    });
    webSocket.once("close", () => {
      for (const stop of subscriptions.values()) stop();
      subscriptions.clear();
      if (credentialId) {
        const sockets = credentialSockets.get(credentialId);
        sockets?.delete(webSocket);
        if (!sockets?.size) credentialSockets.delete(credentialId);
      }
    });
  });

  return {
    app,
    server,
    webSocketServer,
    config,
    auth,
    runner,
    taskManager,
    projectRegistry,
    apiKeyStore,
    usageStore,
    attachmentStore,
    imageStore: attachmentStore,
    gatewaySnapshot,
    disconnectGatewayClients,
    stopCredentialRevalidation,
  };
}

export async function startServer(options = {}) {
  const components = createServerApp(options);
  const {
    server,
    webSocketServer,
    taskManager,
    attachmentStore,
    config,
    stopCredentialRevalidation,
  } = components;
  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(config.port, config.host);
    });
  } catch (error) {
    stopCredentialRevalidation();
    await taskManager.close();
    attachmentStore.close();
    throw error;
  }
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  let closePromise = null;
  const close = () => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      stopCredentialRevalidation();
      await taskManager.close();
      attachmentStore.close();
      for (const client of webSocketServer.clients) client.terminate();
      await new Promise((resolve) => webSocketServer.close(() => resolve()));
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
          else resolve();
        });
        server.closeAllConnections?.();
        server.closeIdleConnections?.();
      });
    })();
    return closePromise;
  };
  return {
    ...components,
    host: config.host,
    port,
    url: serverUrl(config.host, port),
    close,
  };
}
