import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const DEFAULTS = Object.freeze({
  initialDelayMs: 40,
  chunkIntervalMs: 15,
  chunks: 8,
  errorRate: 0,
  jitterMs: 0,
  outputBytes: 128,
  seed: "agent-gateway-performance",
  maxRequestBytes: 1024 * 1024,
});

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function requestSettings(request, defaults) {
  return {
    initialDelayMs: boundedNumber(request.headers["x-fake-initial-delay-ms"], defaults.initialDelayMs, 0, 120000),
    chunkIntervalMs: boundedNumber(request.headers["x-fake-chunk-interval-ms"], defaults.chunkIntervalMs, 0, 60000),
    chunks: Math.trunc(boundedNumber(request.headers["x-fake-chunks"], defaults.chunks, 1, 10000)),
    errorRate: boundedNumber(request.headers["x-fake-error-rate"], defaults.errorRate, 0, 1),
    jitterMs: boundedNumber(request.headers["x-fake-jitter-ms"], defaults.jitterMs, 0, 60000),
    outputBytes: Math.trunc(boundedNumber(request.headers["x-fake-output-bytes"], defaults.outputBytes, 1, 8 * 1024 * 1024)),
  };
}

function deterministicUnit(seed, sequence, label) {
  const digest = createHash("sha256").update(`${seed}:${sequence}:${label}`).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

function wait(milliseconds, signal) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("request aborted"), { name: "AbortError" }));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function readJson(request, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw Object.assign(new Error("request too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!bytes) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("invalid JSON"), { status: 400 }); }
}

function json(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    ...headers,
  });
  response.end(payload);
}

async function writeWithBackpressure(response, value) {
  if (response.write(value)) return;
  await new Promise((resolve) => response.once("drain", resolve));
}

function outputText(bytes, sequence) {
  const prefix = `fake response ${sequence}: `;
  if (bytes <= prefix.length) return prefix.slice(0, bytes);
  return `${prefix}${"x".repeat(bytes - prefix.length)}`;
}

function splitText(text, chunks) {
  const result = [];
  for (let index = 0; index < chunks; index += 1) {
    const start = Math.floor(index * text.length / chunks);
    const end = Math.floor((index + 1) * text.length / chunks);
    result.push(text.slice(start, end));
  }
  return result;
}

function responseObject(id, model, text, createdAt) {
  return {
    id,
    object: "response",
    created_at: createdAt,
    status: "completed",
    model,
    output: [{
      id: `msg_${id.slice(-12)}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
    }],
    usage: { input_tokens: 12, output_tokens: Math.max(1, Math.ceil(text.length / 4)), total_tokens: 12 + Math.max(1, Math.ceil(text.length / 4)) },
  };
}

function chatObject(id, model, text, createdAt) {
  return {
    id,
    object: "chat.completion",
    created: createdAt,
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: Math.max(1, Math.ceil(text.length / 4)), total_tokens: 12 + Math.max(1, Math.ceil(text.length / 4)) },
  };
}

export async function startFakeAiProvider(options = {}) {
  const defaults = { ...DEFAULTS, ...options };
  const observations = [];
  const state = { totalRequests: 0, completedRequests: 0, errors: 0, cancelled: 0, activeRequests: 0, bytesSent: 0 };
  let sequence = 0;

  const server = http.createServer(async (request, response) => {
    const startedAt = performance.now();
    const requestSequence = ++sequence;
    state.totalRequests += 1;
    state.activeRequests += 1;
    let firstByteAt = null;
    let bytesSent = 0;
    let outcome = "completed";
    const abortController = new AbortController();
    request.once("aborted", () => abortController.abort());
    response.once("close", () => {
      if (!response.writableEnded) abortController.abort();
    });
    const originalWrite = response.write.bind(response);
    response.write = (chunk, ...args) => {
      if (firstByteAt === null) firstByteAt = performance.now();
      const size = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      bytesSent += size;
      state.bytesSent += size;
      return originalWrite(chunk, ...args);
    };

    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, { ok: true, provider: "fake-ai", activeRequests: state.activeRequests - 1 });
        return;
      }
      if (request.method === "GET" && url.pathname === "/metrics") {
        json(response, 200, { ...state, observations: observations.slice(-1000) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/__control/reset") {
        observations.splice(0);
        Object.assign(state, { totalRequests: 0, completedRequests: 0, errors: 0, cancelled: 0, activeRequests: 1, bytesSent: 0 });
        json(response, 200, { ok: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/models") {
        json(response, 200, { object: "list", data: [{ id: "fake-model", object: "model", created: 1735689600, owned_by: "agent-gateway-tests" }] });
        return;
      }
      const isResponses = request.method === "POST" && url.pathname === "/v1/responses";
      const isChat = request.method === "POST" && url.pathname === "/v1/chat/completions";
      if (!isResponses && !isChat) {
        json(response, 404, { error: { code: "not_found", message: "Fake provider route not found." } });
        return;
      }

      const body = await readJson(request, defaults.maxRequestBytes);
      const settings = requestSettings(request, defaults);
      const jitter = Math.round(deterministicUnit(defaults.seed, requestSequence, "jitter") * settings.jitterMs);
      await wait(settings.initialDelayMs + jitter, abortController.signal);
      if (deterministicUnit(defaults.seed, requestSequence, "error") < settings.errorRate) {
        outcome = "error";
        state.errors += 1;
        json(response, 503, { error: { code: "fake_provider_error", message: "Deterministic injected provider failure." } }, { "retry-after": "1" });
        return;
      }

      const id = `${isChat ? "chatcmpl" : "resp"}_${randomUUID().replaceAll("-", "")}`;
      const model = typeof body.model === "string" && body.model ? body.model : "fake-model";
      const createdAt = Math.floor(Date.now() / 1000);
      const text = outputText(settings.outputBytes, requestSequence);
      const stream = body.stream === true;
      if (!stream) {
        await wait(settings.chunkIntervalMs * settings.chunks, abortController.signal);
        json(response, 200, isChat ? chatObject(id, model, text, createdAt) : responseObject(id, model, text, createdAt), {
          "x-fake-provider-duration-ms": String(Math.round(performance.now() - startedAt)),
        });
        state.completedRequests += 1;
        return;
      }

      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-fake-request-sequence": String(requestSequence),
      });
      const chunks = splitText(text, settings.chunks);
      let eventSequence = 0;
      if (isResponses) {
        const base = responseObject(id, model, "", createdAt);
        base.status = "in_progress";
        await writeWithBackpressure(response, `event: response.created\ndata: ${JSON.stringify({ type: "response.created", sequence_number: eventSequence++, response: base })}\n\n`);
        for (const delta of chunks) {
          await wait(settings.chunkIntervalMs, abortController.signal);
          await writeWithBackpressure(response, `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", sequence_number: eventSequence++, output_index: 0, content_index: 0, delta })}\n\n`);
        }
        const completed = responseObject(id, model, text, createdAt);
        await writeWithBackpressure(response, `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", sequence_number: eventSequence++, response: completed })}\n\n`);
      } else {
        await writeWithBackpressure(response, `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: createdAt, model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`);
        for (const delta of chunks) {
          await wait(settings.chunkIntervalMs, abortController.signal);
          await writeWithBackpressure(response, `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: createdAt, model, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] })}\n\n`);
        }
        await writeWithBackpressure(response, `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: createdAt, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        await writeWithBackpressure(response, "data: [DONE]\n\n");
      }
      response.end();
      state.completedRequests += 1;
    } catch (error) {
      if (error?.name === "AbortError") {
        outcome = "cancelled";
        state.cancelled += 1;
        response.destroy();
      } else {
        outcome = "error";
        state.errors += 1;
        if (!response.headersSent) json(response, error?.status ?? 500, { error: { code: "fake_provider_request_error", message: error?.message ?? "Fake provider failed." } });
        else response.destroy(error);
      }
    } finally {
      state.activeRequests -= 1;
      observations.push({
        sequence: requestSequence,
        outcome,
        durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
        timeToFirstByteMs: firstByteAt === null ? null : Math.round((firstByteAt - startedAt) * 1000) / 1000,
        bytesSent,
      });
      if (observations.length > 10000) observations.splice(0, observations.length - 10000);
    }
  });
  server.requestTimeout = 0;
  server.headersTimeout = 10000;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve);
  });
  const address = server.address();
  const host = options.host ?? "127.0.0.1";
  const port = typeof address === "object" && address ? address.port : options.port;
  const urlHost = host.includes(":") ? `[${host}]` : host;
  return {
    server,
    url: `http://${urlHost}:${port}`,
    state,
    observations,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const provider = await startFakeAiProvider({
    host: process.env.FAKE_PROVIDER_HOST ?? "127.0.0.1",
    port: Number(process.env.FAKE_PROVIDER_PORT ?? 19090),
  });
  console.log(`Fake AI Provider listening at ${provider.url}`);
  const shutdown = async () => {
    await provider.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
