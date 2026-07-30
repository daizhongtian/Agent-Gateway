import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { startServer } from "../src/server/app.js";
import { createAesSecretProtector } from "../src/server/secret-protector.js";

const REQUEST_ID = /^req_[a-f0-9]{32}$/;
const KEY_PATTERN = /^ccc_live_[A-Za-z0-9_-]{40,64}$/;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zlq8AAAAASUVORK5CYII=",
  "base64",
);

const suppliedKey = String(process.env.AGENT_GATEWAY_LIVE_KEY ?? "").trim();
delete process.env.AGENT_GATEWAY_LIVE_KEY;
assert.match(
  suppliedKey,
  KEY_PATTERN,
  "Set AGENT_GATEWAY_LIVE_KEY to a live ccc_live_... key. The test never writes or prints it.",
);

const suppliedBaseUrl = String(process.env.AGENT_GATEWAY_LIVE_BASE_URL ?? "http://127.0.0.1:4310")
  .trim()
  .replace(/\/+$/, "");
const timeoutMs = positiveInteger(process.env.AGENT_GATEWAY_LIVE_TIMEOUT_MS, 10 * 60_000);
const results = [];

function positiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  assert.ok(Number.isSafeInteger(parsed) && parsed > 0, "Live timeout must be a positive integer.");
  return parsed;
}

function tokenCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function usageTotal(usage) {
  return tokenCount(usage?.total_tokens
    ?? usage?.totalTokens
    ?? (tokenCount(usage?.input_tokens ?? usage?.inputTokens)
      + tokenCount(usage?.output_tokens ?? usage?.outputTokens)));
}

function liveHeaders(key = suppliedKey, extra = {}) {
  return { authorization: `Bearer ${key}`, ...extra };
}

function assertRequestId(response) {
  assert.match(response.headers.get("x-request-id") ?? "", REQUEST_ID);
}

async function fetchTimed(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? timeoutMs);
  timer.unref?.();
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function jsonRequest(baseUrl, pathname, options = {}) {
  const headers = new Headers(options.headers ?? {});
  let body = options.body;
  if (body !== undefined && typeof body !== "string" && !Buffer.isBuffer(body)) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }
  const response = await fetchTimed(`${baseUrl}${pathname}`, { ...options, headers, body });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`${pathname} returned non-JSON content with HTTP ${response.status}.`);
    }
  }
  return { response, payload };
}

async function profile(baseUrl = suppliedBaseUrl, key = suppliedKey) {
  const { response, payload } = await jsonRequest(baseUrl, "/api/v1/external/profile", {
    headers: liveHeaders(key),
  });
  assert.equal(response.status, 200);
  assertRequestId(response);
  assert.ok(payload?.credentialId);
  assert.ok(payload?.preset?.model);
  assert.ok(payload?.apiKeySettings);
  return payload;
}

async function waitFor(check, message, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? timeoutMs);
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await check();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 200));
  }
  throw new Error(`${message}${lastValue === undefined ? "" : ` (last value: ${JSON.stringify(lastValue)})`}`);
}

async function assertUsageRecorded(beforeTokens, expectedDelta, label) {
  assert.ok(expectedDelta > 0, `${label} did not report positive token usage.`);
  const updated = await waitFor(async () => {
    const current = await profile();
    const used = tokenCount(current.apiKeySettings.tokensUsed);
    return used >= beforeTokens + expectedDelta ? current : null;
  }, `${label} usage was not persisted.`);
  const actualDelta = tokenCount(updated.apiKeySettings.tokensUsed) - beforeTokens;
  assert.equal(actualDelta, expectedDelta, `${label} persisted token count differs from response usage.`);
  return tokenCount(updated.apiKeySettings.tokensUsed);
}

function parseResponseEvents(source) {
  return source.split(/\r?\n\r?\n/).map((block) => {
    const event = block.split(/\r?\n/).find((line) => line.startsWith("event: "))?.slice(7);
    const data = block.split(/\r?\n/).find((line) => line.startsWith("data: "))?.slice(6);
    if (!event || !data) return null;
    return { event, data: JSON.parse(data) };
  }).filter(Boolean);
}

function parseChatChunks(source) {
  return source.split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .map((data) => (data === "[DONE]" ? data : JSON.parse(data)));
}

async function record(name, operation) {
  const started = Date.now();
  const details = await operation();
  results.push({ name, ok: true, durationMs: Date.now() - started, ...(details ?? {}) });
}

async function waitForTask(taskId, key = suppliedKey, baseUrl = suppliedBaseUrl) {
  return waitFor(async () => {
    const { response, payload } = await jsonRequest(
      baseUrl,
      `/api/v1/external/tasks/${encodeURIComponent(taskId)}`,
      { headers: liveHeaders(key) },
    );
    assert.equal(response.status, 200);
    assertRequestId(response);
    return TERMINAL.has(payload?.status) ? payload : null;
  }, `Task ${taskId} did not finish.`);
}

async function websocketCheck(taskId) {
  const wsUrl = suppliedBaseUrl.replace(/^http/i, "ws") + "/ws";
  const socket = new WebSocket(wsUrl, { headers: liveHeaders() });
  const messages = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket live check timed out.")), 15_000);
    timer.unref?.();
    socket.on("message", (buffer) => {
      const message = JSON.parse(buffer.toString("utf8"));
      messages.push(message);
      if (message.type === "welcome") {
        socket.send(JSON.stringify({ type: "ping" }));
        socket.send(JSON.stringify({ type: "subscribe", taskId, after: 0 }));
      }
      if (messages.some((item) => item.type === "pong")
        && messages.some((item) => item.type === "subscribed" && item.taskId === taskId)
        && messages.some((item) => item.type === "done")) {
        clearTimeout(timer);
        resolve();
      }
    });
    socket.once("error", reject);
  });
  socket.close();
  assert.ok(messages.some((message) => message.type === "welcome"));
  assert.ok(messages.some((message) => message.type === "pong"));
  return messages.length;
}

async function testSuppliedHost() {
  let currentProfile;
  let currentTokens;
  let model;

  await record("models, authentication, Request ID, and zero-token metadata", async () => {
    const unauthorized = await jsonRequest(suppliedBaseUrl, "/v1/models");
    assert.equal(unauthorized.response.status, 401);
    assertRequestId(unauthorized.response);
    assert.equal(unauthorized.payload?.error?.type, "authentication_error");

    const invalid = await jsonRequest(suppliedBaseUrl, "/v1/models", {
      headers: liveHeaders(`ccc_live_${"A".repeat(43)}`),
    });
    assert.equal(invalid.response.status, 401);
    assertRequestId(invalid.response);

    currentProfile = await profile();
    currentTokens = tokenCount(currentProfile.apiKeySettings.tokensUsed);
    model = currentProfile.preset.model;
    const models = await jsonRequest(suppliedBaseUrl, "/v1/models", { headers: liveHeaders() });
    assert.equal(models.response.status, 200);
    assertRequestId(models.response);
    assert.deepEqual(models.payload?.data?.map((entry) => entry.id), [model]);
    const after = await profile();
    assert.equal(tokenCount(after.apiKeySettings.tokensUsed), currentTokens);
    return { model, startingTokens: currentTokens };
  });

  await record("Responses JSON and exact token accounting", async () => {
    const response = await jsonRequest(suppliedBaseUrl, "/v1/responses", {
      method: "POST",
      headers: liveHeaders(),
      body: { model, input: "Reply with exactly LIVE_RESPONSES_OK", store: false },
    });
    assert.equal(response.response.status, 200);
    assertRequestId(response.response);
    assert.equal(response.payload?.object, "response");
    assert.equal(response.payload?.status, "completed");
    assert.ok(response.payload?.output?.[0]?.content?.[0]?.text);
    const delta = usageTotal(response.payload?.usage);
    currentTokens = await assertUsageRecorded(currentTokens, delta, "Responses JSON");
    return { tokens: delta };
  });

  await record("Chat Completions JSON and exact token accounting", async () => {
    const response = await jsonRequest(suppliedBaseUrl, "/v1/chat/completions", {
      method: "POST",
      headers: liveHeaders(),
      body: { model, messages: [{ role: "user", content: "Reply with exactly LIVE_CHAT_OK" }] },
    });
    assert.equal(response.response.status, 200);
    assertRequestId(response.response);
    assert.equal(response.payload?.object, "chat.completion");
    assert.ok(response.payload?.choices?.[0]?.message?.content);
    const delta = usageTotal(response.payload?.usage);
    currentTokens = await assertUsageRecorded(currentTokens, delta, "Chat Completions JSON");
    return { tokens: delta };
  });

  await record("Responses SSE with real image input and exact token accounting", async () => {
    const response = await fetchTimed(`${suppliedBaseUrl}/v1/responses`, {
      method: "POST",
      headers: liveHeaders(undefined, { "content-type": "application/json" }),
      body: JSON.stringify({
        model,
        stream: true,
        store: false,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: "Confirm the attached image was received. Reply with IMAGE_OK." },
            { type: "input_image", image_url: `data:image/png;base64,${PNG.toString("base64")}` },
          ],
        }],
      }),
    });
    assert.equal(response.status, 200);
    assertRequestId(response);
    assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
    const events = parseResponseEvents(await response.text());
    assert.ok(events.some((event) => event.event === "response.created"));
    const completed = events.findLast((event) => event.event === "response.completed");
    assert.ok(completed?.data?.response);
    const delta = usageTotal(completed.data.response.usage);
    currentTokens = await assertUsageRecorded(currentTokens, delta, "Responses image SSE");
    return { tokens: delta, eventCount: events.length };
  });

  await record("Chat Completions SSE and exact token accounting", async () => {
    const response = await fetchTimed(`${suppliedBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: liveHeaders(undefined, { "content-type": "application/json" }),
      body: JSON.stringify({
        model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "user", content: "Reply with exactly LIVE_CHAT_STREAM_OK" }],
      }),
    });
    assert.equal(response.status, 200);
    assertRequestId(response);
    const chunks = parseChatChunks(await response.text());
    assert.equal(chunks.at(-1), "[DONE]");
    const usageChunk = chunks.find((chunk) => chunk !== "[DONE]" && chunk.usage);
    assert.ok(usageChunk?.usage);
    const delta = usageTotal(usageChunk.usage);
    currentTokens = await assertUsageRecorded(currentTokens, delta, "Chat Completions SSE");
    return { tokens: delta, chunkCount: chunks.length };
  });

  await record("native async task, attachment, polling, SSE, and WebSocket", async () => {
    const marker = `ATTACHMENT_${randomBytes(6).toString("hex")}`;
    const upload = await jsonRequest(suppliedBaseUrl, "/api/v1/external/uploads/files", {
      method: "POST",
      headers: liveHeaders(undefined, {
        "content-type": "text/plain; charset=utf-8",
        "x-file-name": "live-test.txt",
      }),
      body: `The verification marker is ${marker}.`,
    });
    assert.equal(upload.response.status, 201);
    assertRequestId(upload.response);
    assert.ok(upload.payload?.file?.id);

    const created = await jsonRequest(suppliedBaseUrl, "/api/v1/external/tasks", {
      method: "POST",
      headers: liveHeaders(),
      body: {
        prompt: "Read the attached text file and return its verification marker.",
        projectless: true,
        fileIds: [upload.payload.file.id],
      },
    });
    assert.equal(created.response.status, 202);
    assertRequestId(created.response);
    const task = await waitForTask(created.payload.id);
    assert.equal(task.status, "completed", JSON.stringify(task.error ?? {}));
    assert.match(task.result?.content ?? "", new RegExp(marker));
    const delta = usageTotal(task.usage);
    currentTokens = await assertUsageRecorded(currentTokens, delta, "native async task");

    const eventStream = await fetchTimed(
      `${suppliedBaseUrl}/api/v1/external/tasks/${encodeURIComponent(task.id)}/events`,
      { headers: liveHeaders() },
    );
    assert.equal(eventStream.status, 200);
    assertRequestId(eventStream);
    const eventText = await eventStream.text();
    assert.match(eventText, /event: done/);
    const websocketMessages = await websocketCheck(task.id);
    return { tokens: delta, websocketMessages };
  });

  await record("upload cleanup, preset enforcement, and non-billable errors", async () => {
    const before = currentTokens;
    const uploaded = await jsonRequest(suppliedBaseUrl, "/api/v1/external/uploads/images", {
      method: "POST",
      headers: liveHeaders(undefined, { "content-type": "image/png", "x-file-name": "cleanup.png" }),
      body: PNG,
    });
    assert.equal(uploaded.response.status, 201);
    assert.ok(uploaded.payload?.image?.id);
    const discarded = await jsonRequest(
      suppliedBaseUrl,
      `/api/v1/external/uploads/images/${encodeURIComponent(uploaded.payload.image.id)}`,
      { method: "DELETE", headers: liveHeaders() },
    );
    assert.equal(discarded.response.status, 200);

    const conflict = await jsonRequest(suppliedBaseUrl, "/api/v1/external/tasks", {
      method: "POST",
      headers: liveHeaders(),
      body: { prompt: "Must not run", projectless: true, model: "gpt-5.4" },
    });
    assert.equal(conflict.response.status, model === "gpt-5.4" ? 202 : 409);
    if (conflict.response.status === 202) {
      const cancelled = await jsonRequest(
        suppliedBaseUrl,
        `/api/v1/external/tasks/${encodeURIComponent(conflict.payload.id)}/cancel`,
        { method: "POST", headers: liveHeaders() },
      );
      assert.equal(cancelled.response.status, 202);
      await waitForTask(conflict.payload.id);
    }

    const unsupported = await jsonRequest(suppliedBaseUrl, "/v1/responses", {
      method: "POST",
      headers: liveHeaders(),
      body: { model, input: "Must not run", tools: [{ type: "function", name: "blocked" }] },
    });
    assert.equal(unsupported.response.status, 400);
    assertRequestId(unsupported.response);
    assert.equal(unsupported.payload?.error?.code, "unsupported_parameter");
    const after = await profile();
    if (conflict.response.status !== 202) {
      assert.equal(tokenCount(after.apiKeySettings.tokensUsed), before);
    }
    currentTokens = tokenCount(after.apiKeySettings.tokensUsed);
    return { endingTokens: currentTokens };
  });

  return { model, startTokens: results[0].startingTokens, endTokens: currentTokens };
}

async function disposablePolicyServer(model) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-gateway-live-policy-"));
  const adminToken = randomBytes(32).toString("base64url");
  const handle = await startServer({
    host: "127.0.0.1",
    port: 0,
    authMode: "token",
    apiToken: adminToken,
    apiKeyStorePath: path.join(root, "api-keys.json"),
    usageStorePath: path.join(root, "usage.json"),
    attachmentUploadRoot: path.join(root, "uploads"),
    scratchRoot: path.join(root, "scratch"),
    apiKeySecretProtector: createAesSecretProtector(randomBytes(32).toString("hex")),
    apiKeyRevocationPollMs: 25,
    taskTimeoutMs: timeoutMs,
    logger: { error() {}, debug() {} },
  });
  const adminHeaders = liveHeaders(adminToken);
  const createKey = async (body) => {
    const created = await jsonRequest(handle.url, "/api/v1/api-keys", {
      method: "POST",
      headers: adminHeaders,
      body: {
        name: "Disposable live policy test",
        model,
        effort: "low",
        speed: "standard",
        permission: "read-only",
        ...body,
      },
    });
    assert.equal(created.response.status, 201);
    assert.match(created.payload?.key ?? "", KEY_PATTERN);
    return created.payload;
  };
  return {
    root,
    handle,
    adminToken,
    adminHeaders,
    createKey,
    async close() {
      await handle.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function testRealPolicies(model) {
  const server = await disposablePolicyServer(model);
  try {
    await record("real token limit crossing, enforcement, update, and gateway switch", async () => {
      const limited = await server.createKey({ tokenLimit: 1 });
      const headers = liveHeaders(limited.key);
      const first = await jsonRequest(server.handle.url, "/v1/responses", {
        method: "POST",
        headers,
        body: { model, input: "Reply with exactly LIMIT_FIRST_OK", store: false },
      });
      assert.equal(first.response.status, 200);
      const spent = usageTotal(first.payload?.usage);
      assert.ok(spent > 1);

      const keyProfile = await jsonRequest(server.handle.url, "/api/v1/external/profile", { headers });
      assert.equal(keyProfile.response.status, 200);
      assert.equal(keyProfile.payload.apiKeySettings.tokensUsed, spent);
      assert.equal(keyProfile.payload.apiKeySettings.tokensRemaining, 0);
      assert.equal(keyProfile.payload.apiKeySettings.limitReached, true);

      for (const [pathname, body] of [
        ["/v1/responses", { model, input: "Must be blocked" }],
        ["/v1/chat/completions", { model, messages: [{ role: "user", content: "Must be blocked" }] }],
      ]) {
        const blocked = await jsonRequest(server.handle.url, pathname, { method: "POST", headers, body });
        assert.equal(blocked.response.status, 429);
        assertRequestId(blocked.response);
        assert.equal(blocked.payload?.error?.code, "api_key_token_limit_reached");
      }
      const models = await jsonRequest(server.handle.url, "/v1/models", { headers });
      assert.equal(models.response.status, 200, "Model discovery must remain available at the token limit.");

      const raised = await jsonRequest(
        server.handle.url,
        `/api/v1/api-keys/${encodeURIComponent(limited.id)}`,
        {
          method: "PATCH",
          headers: server.adminHeaders,
          body: { tokenLimit: spent + 1_000_000 },
        },
      );
      assert.equal(raised.response.status, 200);
      assert.equal(raised.payload.limitReached, false);

      const disabled = await jsonRequest(server.handle.url, "/api/v1/gateway", {
        method: "POST",
        headers: server.adminHeaders,
        body: { enabled: false },
      });
      assert.equal(disabled.response.status, 200);
      const unavailable = await jsonRequest(server.handle.url, "/v1/models", { headers });
      assert.equal(unavailable.response.status, 503);
      assertRequestId(unavailable.response);
      assert.equal(unavailable.payload?.error?.code, "gateway_disabled");
      const enabled = await jsonRequest(server.handle.url, "/api/v1/gateway", {
        method: "POST",
        headers: server.adminHeaders,
        body: { enabled: true },
      });
      assert.equal(enabled.response.status, 200);
      assert.equal((await jsonRequest(server.handle.url, "/v1/models", { headers })).response.status, 200);
      return { spentTokens: spent };
    });

    await record("Disable after permanently deletes the key", async () => {
      const expiresAt = new Date(Date.now() + 1_500).toISOString();
      const expiring = await server.createKey({ expiresAt });
      const headers = liveHeaders(expiring.key);
      assert.equal((await jsonRequest(server.handle.url, "/v1/models", { headers })).response.status, 200);

      await waitFor(async () => {
        const listed = await jsonRequest(server.handle.url, "/api/v1/api-keys", {
          headers: server.adminHeaders,
        });
        assert.equal(listed.response.status, 200);
        return listed.payload.apiKeys.some((entry) => entry.id === expiring.id) ? null : listed.payload;
      }, "Expired key was not permanently deleted.", { timeoutMs: 15_000, intervalMs: 100 });

      const rejected = await jsonRequest(server.handle.url, "/v1/models", { headers });
      assert.equal(rejected.response.status, 401);
      assertRequestId(rejected.response);
      assert.equal(rejected.payload?.error?.type, "authentication_error");
      return { deleted: true };
    });

    await record("real worker cancellation", async () => {
      const cancellable = await server.createKey({ tokenLimit: 1_000_000 });
      const headers = liveHeaders(cancellable.key);
      const created = await jsonRequest(server.handle.url, "/api/v1/external/tasks", {
        method: "POST",
        headers,
        body: {
          prompt: "Analyze the integers from 1 through 100000 and prepare a long report.",
          projectless: true,
        },
      });
      assert.equal(created.response.status, 202);
      const cancelled = await jsonRequest(
        server.handle.url,
        `/api/v1/external/tasks/${encodeURIComponent(created.payload.id)}/cancel`,
        { method: "POST", headers },
      );
      assert.equal(cancelled.response.status, 202);
      const terminal = await waitForTask(created.payload.id, cancellable.key, server.handle.url);
      assert.equal(terminal.status, "cancelled");
      return { status: terminal.status };
    });
  } finally {
    await server.close();
  }
}

let summary;
try {
  const supplied = await testSuppliedHost();
  await testRealPolicies(supplied.model);
  summary = {
    ok: true,
    baseUrl: suppliedBaseUrl,
    model: supplied.model,
    startingTokens: supplied.startTokens,
    endingTokens: supplied.endTokens,
    recordedTokenDelta: supplied.endTokens - supplied.startTokens,
    checks: results,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  summary = {
    ok: false,
    baseUrl: suppliedBaseUrl,
    failedAfter: results,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    },
  };
  process.stderr.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = 1;
}
