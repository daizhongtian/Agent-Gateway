import crypto from "node:crypto";
import http from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";

const PROTOCOL = "ccc-relay-v1";
const PORT = positiveInteger(process.env.PORT, 8092);
const HOST = String(process.env.HOST || "0.0.0.0");
const BACKEND_URL = normalizedHttpUrl(process.env.BACKEND_URL || "http://backend:8080");
const INTERNAL_SECRET = String(process.env.RELAY_INTERNAL_SECRET || "");
const NODE_ID = normalizedNodeId(process.env.RELAY_NODE_ID || `relay-${process.pid}`);
const PUBLIC_HOST_DOMAIN = String(process.env.PUBLIC_HOST_DOMAIN || "api.agentgatewayplatform.cc").toLowerCase();
const MAX_GLOBAL_STREAMS = positiveInteger(process.env.MAX_GLOBAL_STREAMS, 32);
const MAX_AGENT_STREAMS = positiveInteger(process.env.MAX_AGENT_STREAMS, 8);
const MAX_REQUEST_BYTES = 36 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;
const WINDOW_BYTES = 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024;
const STREAM_DEADLINE_MS = 31 * 60 * 1000;
const CONTROL_LIMIT_BYTES = 16 * 1024;
const REQUEST_HEADERS = new Set([
  "authorization", "content-type", "accept", "openai-beta", "openai-organization",
  "openai-project", "x-client-request-id",
]);
const RESPONSE_HEADERS = new Set([
  "content-type", "cache-control", "x-request-id", "x-accel-buffering", "www-authenticate",
]);
const PATH_ROUTE = /^\/h\/(h-[a-z0-9-]{16,32})\/(health|v1\/models|v1\/responses|v1\/chat\/completions)\/?$/;
const PUBLIC_PATHS = new Map([
  ["health", "GET"],
  ["v1/models", "GET"],
  ["v1/responses", "POST"],
  ["v1/chat/completions", "POST"],
]);

if (INTERNAL_SECRET.length < 32) throw new Error("RELAY_INTERNAL_SECRET must contain at least 32 characters.");

const agents = new Map();
const streams = new Map();
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_CHUNK_BYTES + 16,
  perMessageDeflate: false,
  handleProtocols(protocols) {
    return protocols.has(PROTOCOL) ? PROTOCOL : false;
  },
});

const server = http.createServer((request, response) => {
  void handleHttp(request, response).catch((error) => {
    console.error("[relay] HTTP request failed", safeError(error));
    if (!response.headersSent) writeError(response, 500, "RELAY_INTERNAL_ERROR", "The Relay could not process the request.");
    else response.destroy();
  });
});

server.on("upgrade", (request, socket, head) => {
  void handleUpgrade(request, socket, head).catch((error) => {
    const status = Number(error?.status) || 401;
    const reason = status === 503 ? "Service Unavailable" : "Unauthorized";
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  });
});

wss.on("connection", (socket, _request, admission) => initializeAgent(socket, admission));

const heartbeatTimer = setInterval(() => {
  const now = Date.now();
  for (const record of agents.values()) {
    if (now - record.lastPongAt > 50_000) {
      record.socket.close(4000, "heartbeat timeout");
      continue;
    }
    sendControl(record.socket, { version: 1, type: "PING", sequence: record.sequence++, payload: { at: now } });
  }
}, 20_000);
heartbeatTimer.unref();

server.listen(PORT, HOST, () => console.info(`[relay] ${NODE_ID} listening on ${HOST}:${PORT}`));

async function handleHttp(request, response) {
  setBaseHeaders(response);
  if (request.method === "GET" && request.url === "/health") {
    return writeJson(response, 200, { ok: true, node: NODE_ID, agents: agents.size, streams: streams.size });
  }
  const route = parsePublicRoute(request);
  if (!route || PUBLIC_PATHS.get(route.path) !== request.method) {
    return writeError(response, 404, "NOT_FOUND", "The requested Relay route does not exist.");
  }
  const record = agents.get(route.slug);
  if (!record?.ready || record.socket.readyState !== WebSocket.OPEN) {
    return writeError(response, 503, "HOST_OFFLINE", "The Host is offline.");
  }
  const authorization = await backendCall(
    `/internal/v1/relay/hosts/${encodeURIComponent(route.slug)}/authorize?assignment=${encodeURIComponent(record.assignment)}`,
    { method: "GET" },
  );
  if (!authorization?.allowed || agents.get(route.slug) !== record) {
    return writeError(response, 503, "HOST_OFFLINE", "The Host is offline.");
  }
  if (route.path === "health") {
    return writeJson(response, 200, { ok: true, online: true, relay: NODE_ID });
  }
  if (streams.size >= MAX_GLOBAL_STREAMS || record.streams.size >= MAX_AGENT_STREAMS) {
    response.setHeader("Retry-After", "2");
    return writeError(response, 429, "RELAY_BUSY", "The Relay is at its concurrent request limit.");
  }
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_REQUEST_BYTES) {
    return writeError(response, 413, "REQUEST_TOO_LARGE", "The request body exceeds 36 MiB.");
  }
  openStream(record, request, response, route);
}

function openStream(record, request, response, route) {
  const id = crypto.randomUUID();
  const state = {
    id,
    record,
    request,
    response,
    requestCredit: 0,
    requestCreditWaiters: [],
    responseBytes: 0,
    responseStarted: false,
    responseChain: Promise.resolve(),
    closed: false,
    deadline: null,
  };
  streams.set(id, state);
  record.streams.set(id, state);
  state.deadline = setTimeout(() => failStream(state, 504, "RELAY_TIMEOUT", "The Relay request timed out."), STREAM_DEADLINE_MS);
  state.deadline.unref();
  response.on("close", () => {
    if (!response.writableFinished) {
      sendControl(record.socket, envelope("CANCEL", id, { reason: "caller_closed" }));
      closeStream(state);
    }
  });
  sendControl(record.socket, envelope("REQUEST_START", id, {
    method: request.method,
    path: `/${route.path}`,
    headers: filteredHeaders(request.headers, REQUEST_HEADERS),
  }));
  sendControl(record.socket, envelope("WINDOW_UPDATE", id, { direction: "response", bytes: WINDOW_BYTES }));
  void pumpRequestBody(state).catch((error) => failStream(state, 502, "REQUEST_FORWARD_FAILED", "The request could not be forwarded.", error));
}

async function pumpRequestBody(state) {
  let total = 0;
  for await (const input of state.request) {
    let chunk = Buffer.from(input);
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) {
      failStream(state, 413, "REQUEST_TOO_LARGE", "The request body exceeds 36 MiB.");
      return;
    }
    while (chunk.length > 0 && !state.closed) {
      const allowance = await takeRequestCredit(state, Math.min(chunk.length, MAX_CHUNK_BYTES));
      const part = chunk.subarray(0, allowance);
      chunk = chunk.subarray(allowance);
      await sendBinary(state.record.socket, state.id, part);
    }
  }
  if (!state.closed) sendControl(state.record.socket, envelope("REQUEST_END", state.id));
}

async function takeRequestCredit(state, wanted) {
  while (!state.closed && state.requestCredit <= 0) {
    await new Promise((resolve) => state.requestCreditWaiters.push(resolve));
  }
  if (state.closed) throw new Error("stream closed");
  const granted = Math.min(wanted, state.requestCredit);
  state.requestCredit -= granted;
  return granted;
}

async function handleUpgrade(request, socket, head) {
  const url = new URL(request.url || "/", "http://relay.invalid");
  if (url.pathname !== "/agent" || url.search || request.method !== "GET") throw httpError(404);
  const protocols = String(request.headers["sec-websocket-protocol"] || "").split(",").map((value) => value.trim());
  if (!protocols.includes(PROTOCOL)) throw httpError(401);
  const match = /^Bearer\s+(ccc_tunnel_[A-Za-z0-9_-]+)$/.exec(String(request.headers.authorization || ""));
  if (!match) throw httpError(401);
  const admission = await backendCall("/internal/v1/relay/admit", {
    method: "POST",
    body: { token: match[1] },
  });
  admission.connectionId = crypto.randomUUID();
  admission.assignment = `${NODE_ID}:${admission.connectionId}`;
  await new Promise((resolve) => wss.handleUpgrade(request, socket, head, (webSocket) => {
    wss.emit("connection", webSocket, request, admission);
    resolve();
  }));
}

function initializeAgent(socket, admission) {
  const record = {
    ...admission,
    socket,
    ready: false,
    sequence: 1,
    lastPongAt: Date.now(),
    streams: new Map(),
    readyTimer: null,
  };
  record.readyTimer = setTimeout(() => socket.close(4002, "READY timeout"), 10_000);
  record.readyTimer.unref();
  sendControl(socket, {
    version: 1,
    type: "WELCOME",
    sequence: 0,
    payload: {
      protocolVersion: 1,
      connectionId: record.connectionId,
      maxStreams: MAX_AGENT_STREAMS,
      maxChunkBytes: MAX_CHUNK_BYTES,
      windowBytes: WINDOW_BYTES,
      heartbeatMs: 20_000,
    },
  });
  socket.on("message", (data, isBinary) => {
    try {
      if (isBinary) handleResponseBinary(record, Buffer.from(data));
      else void handleAgentControl(record, parseControl(data)).catch(() => socket.close(4003, "invalid relay frame"));
    } catch {
      socket.close(4003, "invalid relay frame");
    }
  });
  socket.on("close", () => void closeAgent(record));
  socket.on("error", () => {});
}

async function handleAgentControl(record, frame) {
  switch (frame.type) {
    case "READY": {
      if (record.ready || frame.version !== 1) throw new Error("unexpected READY");
      await backendCall("/internal/v1/relay/ready", { method: "POST", body: presence(record) });
      const previous = agents.get(record.slug);
      agents.set(record.slug, record);
      record.ready = true;
      record.lastPongAt = Date.now();
      clearTimeout(record.readyTimer);
      if (previous && previous !== record) previous.socket.close(4001, "replaced by a newer connection");
      sendControl(record.socket, { version: 1, type: "READY", sequence: record.sequence++, payload: { online: true } });
      return;
    }
    case "PONG":
      record.lastPongAt = Date.now();
      if (record.ready) await backendCall("/internal/v1/relay/heartbeat", { method: "POST", body: presence(record) });
      return;
    case "PING":
      sendControl(record.socket, { version: 1, type: "PONG", sequence: record.sequence++, payload: frame.payload || {} });
      return;
    case "WINDOW_UPDATE": {
      const state = requireStream(record, frame.streamId);
      const bytes = positiveFrameBytes(frame.payload?.bytes);
      if (frame.payload?.direction !== "request") throw new Error("invalid window direction");
      state.requestCredit = Math.min(WINDOW_BYTES * 2, state.requestCredit + bytes);
      state.requestCreditWaiters.splice(0).forEach((resolve) => resolve());
      return;
    }
    case "RESPONSE_START":
      queueResponseControl(record, frame, async (state) => {
        if (state.responseStarted) throw new Error("duplicate response");
        const status = Number(frame.payload?.status);
        if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error("invalid response status");
        state.responseStarted = true;
        state.response.writeHead(status, filteredHeaders(frame.payload?.headers || {}, RESPONSE_HEADERS));
      });
      return;
    case "RESPONSE_END":
      queueResponseControl(record, frame, async (state) => {
        if (!state.responseStarted) throw new Error("response not started");
        state.response.end();
        closeStream(state);
      });
      return;
    case "ERROR": {
      const state = requireStream(record, frame.streamId);
      failStream(state, 502, "LOCAL_GATEWAY_ERROR", "The desktop Gateway could not process the request.");
      return;
    }
    default:
      throw new Error("unsupported frame");
  }
}

function handleResponseBinary(record, frame) {
  if (frame.length < 17 || frame.length > MAX_CHUNK_BYTES + 16) throw new Error("invalid binary frame");
  const id = bytesToUuid(frame.subarray(0, 16));
  const state = requireStream(record, id);
  const chunk = frame.subarray(16);
  state.responseChain = state.responseChain.then(async () => {
    if (state.closed || !state.responseStarted) throw new Error("response not started");
    state.responseBytes += chunk.length;
    if (state.responseBytes > MAX_RESPONSE_BYTES) throw new Error("response too large");
    if (!state.response.write(chunk)) await once(state.response, "drain");
    if (!state.closed) sendControl(record.socket, envelope("WINDOW_UPDATE", id, { direction: "response", bytes: chunk.length }));
  }).catch((error) => failStream(state, 502, "RESPONSE_FORWARD_FAILED", "The response could not be forwarded.", error));
}

function queueResponseControl(record, frame, operation) {
  const state = requireStream(record, frame.streamId);
  state.responseChain = state.responseChain.then(() => operation(state))
    .catch((error) => failStream(state, 502, "INVALID_AGENT_RESPONSE", "The desktop returned an invalid response.", error));
}

async function closeAgent(record) {
  clearTimeout(record.readyTimer);
  if (agents.get(record.slug) === record) agents.delete(record.slug);
  for (const state of [...record.streams.values()]) failStream(state, 503, "HOST_DISCONNECTED", "The Host disconnected.");
  if (record.ready) {
    try {
      await backendCall("/internal/v1/relay/disconnect", { method: "POST", body: presence(record) });
    } catch (error) {
      console.warn("[relay] presence disconnect failed", safeError(error));
    }
  }
}

function closeStream(state) {
  if (state.closed) return;
  state.closed = true;
  clearTimeout(state.deadline);
  streams.delete(state.id);
  state.record.streams.delete(state.id);
  state.requestCreditWaiters.splice(0).forEach((resolve) => resolve());
}

function failStream(state, status, code, message, _error = null) {
  if (state.closed) return;
  sendControl(state.record.socket, envelope("CANCEL", state.id, { reason: code }));
  if (!state.response.headersSent) writeError(state.response, status, code, message);
  else state.response.destroy();
  state.request.destroy();
  closeStream(state);
}

function requireStream(record, id) {
  const state = record.streams.get(String(id || ""));
  if (!state || state.closed) throw new Error("unknown stream");
  return state;
}

function parsePublicRoute(request) {
  const url = new URL(request.url || "/", "http://relay.invalid");
  if (url.search) return null;
  const pathMatch = PATH_ROUTE.exec(url.pathname);
  if (pathMatch) return { slug: pathMatch[1], path: pathMatch[2] };
  const host = String(request.headers.host || "").split(":")[0].toLowerCase();
  const suffix = `.${PUBLIC_HOST_DOMAIN}`;
  if (!host.endsWith(suffix)) return null;
  const slug = host.slice(0, -suffix.length);
  if (!/^h-[a-z0-9-]{16,32}$/.test(slug)) return null;
  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  return PUBLIC_PATHS.has(path) ? { slug, path } : null;
}

async function backendCall(pathname, { method = "POST", body } = {}) {
  const response = await fetch(`${BACKEND_URL}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Relay-Secret": INTERNAL_SECRET,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.code || `backend HTTP ${response.status}`);
    error.status = response.status === 503 ? 503 : 401;
    throw error;
  }
  return payload;
}

function presence(record) {
  return { hostId: record.hostId, deviceId: record.deviceId, assignment: record.assignment };
}

function envelope(type, streamId, payload = {}) {
  return { version: 1, type, streamId, sequence: 0, payload };
}

function sendControl(socket, frame) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  const text = JSON.stringify(frame);
  if (Buffer.byteLength(text) > CONTROL_LIMIT_BYTES) throw new Error("control frame too large");
  socket.send(text);
  return true;
}

async function sendBinary(socket, id, chunk) {
  if (socket.readyState !== WebSocket.OPEN) throw new Error("agent disconnected");
  while (socket.bufferedAmount > WINDOW_BYTES * 2) await new Promise((resolve) => setTimeout(resolve, 5));
  const frame = Buffer.concat([uuidToBytes(id), chunk]);
  await new Promise((resolve, reject) => socket.send(frame, { binary: true }, (error) => error ? reject(error) : resolve()));
}

function parseControl(data) {
  const buffer = Buffer.from(data);
  if (buffer.length === 0 || buffer.length > CONTROL_LIMIT_BYTES) throw new Error("invalid control frame");
  const frame = JSON.parse(buffer.toString("utf8"));
  if (!frame || frame.version !== 1 || typeof frame.type !== "string") throw new Error("invalid control frame");
  return frame;
}

function filteredHeaders(input, allowlist) {
  const output = {};
  for (const [rawName, rawValue] of Object.entries(input || {})) {
    const name = String(rawName).toLowerCase();
    if (!allowlist.has(name)) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const safe = values.map((value) => String(value)).filter((value) => value.length <= 8192);
    if (safe.length === 1) output[name] = safe[0];
    else if (safe.length > 1) output[name] = safe;
  }
  return output;
}

function writeError(response, status, code, message) {
  writeJson(response, status, { error: { code, message } });
}

function writeJson(response, status, payload) {
  if (response.writableEnded) return;
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length });
  response.end(body);
}

function setBaseHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
}

function uuidToBytes(value) {
  const hex = String(value).replaceAll("-", "");
  if (!/^[a-f0-9]{32}$/i.test(hex)) throw new Error("invalid stream id");
  return Buffer.from(hex, "hex");
}

function bytesToUuid(buffer) {
  const hex = buffer.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function positiveFrameBytes(value) {
  const bytes = Number(value);
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > WINDOW_BYTES) throw new Error("invalid window update");
  return bytes;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizedHttpUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("BACKEND_URL must use HTTP or HTTPS.");
  return url.href.replace(/\/$/, "");
}

function normalizedNodeId(value) {
  const nodeId = String(value).trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(nodeId)) throw new Error("RELAY_NODE_ID is invalid.");
  return nodeId;
}

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function safeError(error) {
  return { name: error?.name || "Error", message: String(error?.message || "relay failure").slice(0, 300) };
}

export { server };
