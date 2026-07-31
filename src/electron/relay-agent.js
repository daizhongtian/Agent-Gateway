import http from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";

const PROTOCOL = "ccc-relay-v1";
const CONTROL_LIMIT_BYTES = 16 * 1024;
const DEFAULT_CHUNK_BYTES = 64 * 1024;
const DEFAULT_WINDOW_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 36 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;
const ALLOWED_ROUTES = new Map([
  ["GET /v1/models", true],
  ["POST /v1/responses", true],
  ["POST /v1/chat/completions", true],
]);
const REQUEST_HEADERS = new Set([
  "authorization", "content-type", "accept", "openai-beta", "openai-organization",
  "openai-project", "x-client-request-id",
]);
const RESPONSE_HEADERS = new Set([
  "content-type", "cache-control", "x-request-id", "x-accel-buffering", "www-authenticate",
]);

export class RelayAgent {
  constructor({ WebSocketImpl = WebSocket, httpModule = http, reconnectBaseMs = 1000 } = {}) {
    this.WebSocketImpl = WebSocketImpl;
    this.httpModule = httpModule;
    this.reconnectBaseMs = reconnectBaseMs;
    this.httpAgent = new httpModule.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4 });
    this.socket = null;
    this.streams = new Map();
    this.desired = false;
    this.ready = false;
    this.connecting = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.getTicket = null;
    this.localPort = null;
    this.limits = { maxStreams: 8, maxChunkBytes: DEFAULT_CHUNK_BYTES, windowBytes: DEFAULT_WINDOW_BYTES };
  }

  async start({ getTicket, localPort }) {
    if (typeof getTicket !== "function") throw new TypeError("RelayAgent requires a Tunnel Token provider.");
    if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
      throw new TypeError("RelayAgent requires an active loopback Gateway port.");
    }
    this.desired = true;
    this.getTicket = getTicket;
    this.localPort = localPort;
    if (this.ready && this.socket?.readyState === this.WebSocketImpl.OPEN) return this.status();
    if (!this.connecting) {
      this.connecting = this.#connectOnce().finally(() => {
        this.connecting = null;
      });
    }
    try {
      await this.connecting;
    } catch (error) {
      this.#scheduleReconnect();
      throw error;
    }
    return this.status();
  }

  stop() {
    this.desired = false;
    this.ready = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < this.WebSocketImpl.CLOSING) socket.close(1000, "Online Host disabled");
    this.#abortStreams();
    return this.status();
  }

  close() {
    this.stop();
    this.httpAgent.destroy();
  }

  status() {
    return Object.freeze({ desired: this.desired, ready: this.ready, streams: this.streams.size });
  }

  async #connectOnce() {
    const ticket = await this.getTicket();
    const url = safeRelayUrl(ticket?.relayUrl);
    if (!ticket?.token || Number(ticket.protocolVersion) !== 1) throw new Error("The platform returned an invalid Tunnel Token.");
    const socket = new this.WebSocketImpl(url, PROTOCOL, {
      headers: { Authorization: `Bearer ${ticket.token}` },
      handshakeTimeout: 10_000,
      maxPayload: DEFAULT_CHUNK_BYTES + 16,
      perMessageDeflate: false,
    });
    this.socket = socket;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      const timer = setTimeout(() => {
        socket.close(4002, "Relay READY timeout");
        finish(reject, new Error("Relay connection timed out."));
      }, 15_000);
      timer.unref?.();
      socket.on("message", (data, isBinary) => {
        try {
          if (isBinary) this.#handleRequestBinary(socket, Buffer.from(data));
          else {
            const frame = parseControl(data);
            if (frame.type === "READY") {
              clearTimeout(timer);
              this.ready = true;
              this.reconnectAttempt = 0;
              finish(resolve);
            }
            this.#handleControl(socket, frame);
          }
        } catch {
          socket.close(4003, "invalid relay frame");
        }
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        finish(reject, new Error("The Relay connection failed.", { cause: error }));
      });
      socket.once("close", () => {
        clearTimeout(timer);
        if (this.socket === socket) {
          this.socket = null;
          this.ready = false;
        }
        this.#abortStreams();
        finish(reject, new Error("The Relay disconnected before becoming ready."));
        if (this.desired) this.#scheduleReconnect();
      });
    });
  }

  #scheduleReconnect() {
    if (this.reconnectTimer || this.connecting || !this.desired) return;
    const delay = Math.min(30_000, this.reconnectBaseMs * (2 ** Math.min(this.reconnectAttempt++, 5)));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.desired || this.connecting) return;
      this.connecting = this.#connectOnce().finally(() => { this.connecting = null; });
      void this.connecting.catch(() => {
        const retry = setTimeout(() => this.#scheduleReconnect(), 0);
        retry.unref?.();
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  #handleControl(socket, frame) {
    switch (frame.type) {
      case "WELCOME": {
        if (Number(frame.payload?.protocolVersion) !== 1) throw new Error("unsupported relay protocol");
        this.limits = {
          maxStreams: boundedInteger(frame.payload?.maxStreams, 1, 32, 8),
          maxChunkBytes: boundedInteger(frame.payload?.maxChunkBytes, 1024, DEFAULT_CHUNK_BYTES, DEFAULT_CHUNK_BYTES),
          windowBytes: boundedInteger(frame.payload?.windowBytes, 64 * 1024, DEFAULT_WINDOW_BYTES * 2, DEFAULT_WINDOW_BYTES),
        };
        sendControl(socket, { version: 1, type: "READY", sequence: 0, payload: { gatewayPort: this.localPort } });
        return;
      }
      case "READY":
        return;
      case "PING":
        sendControl(socket, { version: 1, type: "PONG", sequence: 0, payload: frame.payload || {} });
        return;
      case "PONG":
        return;
      case "REQUEST_START":
        this.#openLocalRequest(socket, frame);
        return;
      case "REQUEST_END": {
        const state = this.#requireStream(frame.streamId);
        state.requestChain = state.requestChain.then(() => {
          state.requestEnded = true;
          state.localRequest.end();
          this.#finishIfComplete(state);
        });
        return;
      }
      case "WINDOW_UPDATE": {
        const state = this.streams.get(String(frame.streamId || ""));
        // A credit update can cross RESPONSE_END on the wire. The stream has
        // already released all resources, so the late credit is harmless.
        if (!state || state.closed) return;
        if (frame.payload?.direction !== "response") throw new Error("invalid window direction");
        const bytes = boundedInteger(frame.payload?.bytes, 1, this.limits.windowBytes, 0);
        if (!bytes) throw new Error("invalid window update");
        state.responseCredit = Math.min(this.limits.windowBytes * 2, state.responseCredit + bytes);
        state.responseCreditWaiters.splice(0).forEach((resolve) => resolve());
        return;
      }
      case "CANCEL":
        this.#cancelStream(frame.streamId);
        return;
      case "GO_AWAY":
        socket.close(1001, "Relay draining");
        return;
      default:
        throw new Error("unsupported relay frame");
    }
  }

  #openLocalRequest(socket, frame) {
    if (!isUuid(frame.streamId) || this.streams.has(frame.streamId) || this.streams.size >= this.limits.maxStreams) {
      throw new Error("invalid stream admission");
    }
    const method = String(frame.payload?.method || "").toUpperCase();
    const path = String(frame.payload?.path || "");
    if (!ALLOWED_ROUTES.has(`${method} ${path}`)) {
      sendControl(socket, envelope("ERROR", frame.streamId, { code: "ROUTE_NOT_ALLOWED" }));
      return;
    }
    const headers = filteredHeaders(frame.payload?.headers || {}, REQUEST_HEADERS);
    headers.host = `127.0.0.1:${this.localPort}`;
    const localRequest = this.httpModule.request({
      protocol: "http:",
      hostname: "127.0.0.1",
      port: this.localPort,
      method,
      path,
      headers,
      agent: this.httpAgent,
      timeout: 31 * 60 * 1000,
    });
    const state = {
      id: frame.streamId,
      socket,
      localRequest,
      localResponse: null,
      requestBytes: 0,
      responseBytes: 0,
      requestChain: Promise.resolve(),
      requestEnded: false,
      responseEnded: false,
      responseCredit: 0,
      responseCreditWaiters: [],
      closed: false,
    };
    this.streams.set(state.id, state);
    localRequest.on("response", (response) => {
      state.localResponse = response;
      sendControl(socket, envelope("RESPONSE_START", state.id, {
        status: response.statusCode || 502,
        headers: filteredHeaders(response.headers, RESPONSE_HEADERS),
      }));
      void this.#pumpLocalResponse(state).catch(() => this.#failLocalStream(state, "LOCAL_RESPONSE_FAILED"));
    });
    localRequest.on("timeout", () => localRequest.destroy(new Error("local Gateway timeout")));
    localRequest.on("error", () => this.#failLocalStream(state, "LOCAL_GATEWAY_UNREACHABLE"));
    sendControl(socket, envelope("WINDOW_UPDATE", state.id, { direction: "request", bytes: this.limits.windowBytes }));
  }

  #handleRequestBinary(socket, frame) {
    if (frame.length < 17 || frame.length > this.limits.maxChunkBytes + 16) throw new Error("invalid binary frame");
    const id = bytesToUuid(frame.subarray(0, 16));
    const state = this.#requireStream(id);
    if (state.socket !== socket || state.requestEnded) throw new Error("invalid request body state");
    const chunk = frame.subarray(16);
    state.requestBytes += chunk.length;
    if (state.requestBytes > MAX_REQUEST_BYTES) {
      this.#failLocalStream(state, "REQUEST_TOO_LARGE");
      return;
    }
    state.requestChain = state.requestChain.then(async () => {
      if (state.closed) return;
      if (!state.localRequest.write(chunk)) await once(state.localRequest, "drain");
      if (!state.closed) sendControl(socket, envelope("WINDOW_UPDATE", id, { direction: "request", bytes: chunk.length }));
    }).catch(() => this.#failLocalStream(state, "LOCAL_REQUEST_FAILED"));
  }

  async #pumpLocalResponse(state) {
    for await (const input of state.localResponse) {
      let chunk = Buffer.from(input);
      state.responseBytes += chunk.length;
      if (state.responseBytes > MAX_RESPONSE_BYTES) throw new Error("response too large");
      while (chunk.length > 0 && !state.closed) {
        const allowance = await this.#takeResponseCredit(state, Math.min(chunk.length, this.limits.maxChunkBytes));
        const part = chunk.subarray(0, allowance);
        chunk = chunk.subarray(allowance);
        await sendBinary(state.socket, state.id, part, this.limits.windowBytes);
      }
    }
    if (!state.closed) {
      state.responseEnded = true;
      sendControl(state.socket, envelope("RESPONSE_END", state.id));
      this.#finishIfComplete(state);
    }
  }

  async #takeResponseCredit(state, wanted) {
    while (!state.closed && state.responseCredit <= 0) {
      await new Promise((resolve) => state.responseCreditWaiters.push(resolve));
    }
    if (state.closed) throw new Error("stream closed");
    const granted = Math.min(wanted, state.responseCredit);
    state.responseCredit -= granted;
    return granted;
  }

  #failLocalStream(state, code) {
    if (state.closed) return;
    sendControl(state.socket, envelope("ERROR", state.id, { code }));
    this.#closeStream(state);
  }

  #cancelStream(id) {
    const state = this.streams.get(String(id || ""));
    if (state) this.#closeStream(state);
  }

  #finishIfComplete(state) {
    if (state.requestEnded && state.responseEnded) this.#closeStream(state, false);
  }

  #closeStream(state, abort = true) {
    if (state.closed) return;
    state.closed = true;
    this.streams.delete(state.id);
    state.responseCreditWaiters.splice(0).forEach((resolve) => resolve());
    if (abort) {
      state.localRequest.destroy();
      state.localResponse?.destroy();
    }
  }

  #abortStreams() {
    for (const state of [...this.streams.values()]) this.#closeStream(state);
  }

  #requireStream(id) {
    const state = this.streams.get(String(id || ""));
    if (!state || state.closed) throw new Error("unknown stream");
    return state;
  }
}

function safeRelayUrl(value) {
  const url = new URL(String(value || ""));
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if ((url.protocol !== "wss:" && !(loopback && url.protocol === "ws:"))
    || url.username || url.password || url.search || url.hash || url.pathname !== "/agent") {
    throw new Error("The platform returned an unsafe Relay URL.");
  }
  return url.href;
}

function envelope(type, streamId, payload = {}) {
  return { version: 1, type, streamId, sequence: 0, payload };
}

function sendControl(socket, frame) {
  if (socket.readyState !== socket.OPEN && socket.readyState !== WebSocket.OPEN) return false;
  const text = JSON.stringify(frame);
  if (Buffer.byteLength(text) > CONTROL_LIMIT_BYTES) throw new Error("control frame too large");
  socket.send(text);
  return true;
}

async function sendBinary(socket, id, chunk, windowBytes) {
  while (socket.bufferedAmount > windowBytes * 2) await new Promise((resolve) => setTimeout(resolve, 5));
  const payload = Buffer.concat([uuidToBytes(id), chunk]);
  await new Promise((resolve, reject) => socket.send(payload, { binary: true }, (error) => error ? reject(error) : resolve()));
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

function uuidToBytes(value) {
  const hex = String(value).replaceAll("-", "");
  if (!/^[a-f0-9]{32}$/i.test(hex)) throw new Error("invalid stream id");
  return Buffer.from(hex, "hex");
}

function bytesToUuid(buffer) {
  const hex = buffer.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isUuid(value) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value || ""));
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

export { safeRelayUrl };
