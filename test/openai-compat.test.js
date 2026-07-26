import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { startServer } from "../src/server/app.js";

const ADMIN_TOKEN = "openai-compat-admin-token-1234567890";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zlq8AAAAASUVORK5CYII=",
  "base64",
);

function imageDataUrl(buffer = PNG, mimeType = "image/png") {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

class StreamingFakeRunner {
  constructor() {
    this.calls = 0;
  }

  run(_task, options = {}) {
    this.calls += 1;
    const call = this.calls;
    let cancelled = false;
    const content = "Hello from Codex";
    const usage = {
      input_tokens: 12,
      cached_input_tokens: 3,
      output_tokens: 4,
      reasoning_output_tokens: 1,
    };
    const promise = (async () => {
      await new Promise((resolve) => setImmediate(resolve));
      if (cancelled) throw new Error("cancelled");
      options.onEvent?.({
        kind: "sdk",
        event: { type: "thread.started", thread_id: `thread_${call}` },
      });
      options.onEvent?.({ kind: "sdk", event: { type: "turn.started" } });
      options.onEvent?.({
        kind: "sdk",
        event: { type: "item.started", item: { id: `message_${call}`, type: "agent_message", text: "" } },
      });
      options.onEvent?.({
        kind: "sdk",
        event: { type: "item.updated", item: { id: `message_${call}`, type: "agent_message", text: "Hello " } },
      });
      await new Promise((resolve) => setImmediate(resolve));
      options.onEvent?.({
        kind: "sdk",
        event: { type: "item.updated", item: { id: `message_${call}`, type: "agent_message", text: "Hello from " } },
      });
      options.onEvent?.({
        kind: "sdk",
        event: { type: "item.completed", item: { id: `message_${call}`, type: "agent_message", text: content } },
      });
      options.onEvent?.({ kind: "sdk", event: { type: "turn.completed", usage } });
      return { content, usage, threadId: `thread_${call}` };
    })();
    return {
      promise,
      cancel: () => {
        if (cancelled) return false;
        cancelled = true;
        return true;
      },
    };
  }

  async close() {}
}

class FailingRunner {
  run() {
    const error = new Error("private backend failure details");
    error.code = "CODEX_TEST_FAILURE";
    return { promise: Promise.reject(error), cancel: () => false };
  }

  async close() {}
}

class ImageCapturingRunner extends StreamingFakeRunner {
  constructor() {
    super();
    this.tasks = [];
    this.imageReads = [];
  }

  run(task, options = {}) {
    this.tasks.push(task);
    this.imageReads.push(Promise.all((task.imagePaths ?? []).map((imagePath) => readFile(imagePath))));
    return super.run(task, options);
  }
}

async function jsonRequest(baseUrl, pathname, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body && typeof options.body !== "string") {
    headers.set("content-type", "application/json");
    options = { ...options, body: JSON.stringify(options.body) };
  }
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function createGatewayKey(handle, model = "gpt-5.6-terra") {
  const { response, payload } = await jsonRequest(handle.url, "/api/v1/api-keys", {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: {
      name: "OpenAI compatibility test",
      model,
      effort: "high",
      speed: "standard",
      permission: "read-only",
    },
  });
  assert.equal(response.status, 201);
  return payload.key;
}

function gatewayHeaders(key) {
  return { authorization: `Bearer ${key}` };
}

function parseResponseEvents(source) {
  return source
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const event = block.split(/\r?\n/).find((line) => line.startsWith("event: "))?.slice(7);
      const data = block.split(/\r?\n/).find((line) => line.startsWith("data: "))?.slice(6);
      return event && data ? { event, data: JSON.parse(data) } : null;
    })
    .filter(Boolean);
}

function parseChatData(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .map((data) => (data === "[DONE]" ? data : JSON.parse(data)));
}

async function startCompatibilityServer(options = {}) {
  return startServer({
    mode: "desktop",
    port: 0,
    authMode: "token",
    apiToken: ADMIN_TOKEN,
    runner: new StreamingFakeRunner(),
    ...options,
  });
}

test("OpenAI models, Responses, and Chat Completions return compatible non-streaming objects", async () => {
  const handle = await startCompatibilityServer();
  try {
    const key = await createGatewayKey(handle);
    const headers = gatewayHeaders(key);

    const { response: modelsResponse, payload: models } = await jsonRequest(handle.url, "/v1/models", { headers });
    assert.equal(modelsResponse.status, 200);
    assert.match(modelsResponse.headers.get("x-request-id"), /^req_[a-f0-9]{32}$/);
    assert.deepEqual(models, {
      object: "list",
      data: [{
        id: "gpt-5.6-terra",
        object: "model",
        created: 1_735_689_600,
        owned_by: "codex-control-center",
      }],
    });

    const { response: responseResult, payload: responseBody } = await jsonRequest(handle.url, "/v1/responses", {
      method: "POST",
      headers,
      body: { model: "unchanged-client-model", input: "Say hello" },
    });
    assert.equal(responseResult.status, 200);
    assert.match(responseResult.headers.get("x-request-id"), /^req_[a-f0-9]{32}$/);
    assert.equal(responseBody.object, "response");
    assert.equal(responseBody.status, "completed");
    assert.equal(responseBody.model, "gpt-5.6-terra");
    assert.equal(responseBody.output[0].content[0].text, "Hello from Codex");
    assert.deepEqual(responseBody.usage, {
      input_tokens: 12,
      input_tokens_details: { cached_tokens: 3 },
      output_tokens: 4,
      output_tokens_details: { reasoning_tokens: 1 },
      total_tokens: 16,
    });

    const { response: chatResult, payload: chatBody } = await jsonRequest(handle.url, "/v1/chat/completions", {
      method: "POST",
      headers,
      body: {
        model: "unchanged-client-model",
        messages: [
          { role: "system", content: "Be concise" },
          { role: "user", content: "Say hello" },
        ],
      },
    });
    assert.equal(chatResult.status, 200);
    assert.equal(chatBody.object, "chat.completion");
    assert.equal(chatBody.model, "gpt-5.6-terra");
    assert.equal(chatBody.choices[0].message.content, "Hello from Codex");
    assert.equal(chatBody.choices[0].finish_reason, "stop");
    assert.deepEqual(chatBody.usage, {
      prompt_tokens: 12,
      completion_tokens: 4,
      total_tokens: 16,
      prompt_tokens_details: { cached_tokens: 3 },
      completion_tokens_details: { reasoning_tokens: 1 },
    });

    const { response: nativeResponse, payload: nativeTask } = await jsonRequest(
      handle.url,
      "/api/v1/external/tasks",
      {
        method: "POST",
        headers,
        body: { prompt: "Native API remains available", projectless: true },
      },
    );
    assert.equal(nativeResponse.status, 202);
    assert.ok(["queued", "running"].includes(nativeTask.status));
  } finally {
    await handle.close();
  }
});

test("Responses and Chat Completions stream compatible SSE events and usage", async () => {
  const handle = await startCompatibilityServer();
  try {
    const key = await createGatewayKey(handle, "gpt-5.6-sol");
    const headers = { ...gatewayHeaders(key), "content-type": "application/json" };

    const responsesStream = await fetch(`${handle.url}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "client-model", input: "Say hello", stream: true }),
    });
    assert.equal(responsesStream.status, 200);
    assert.match(responsesStream.headers.get("content-type"), /^text\/event-stream/);
    const responseEvents = parseResponseEvents(await responsesStream.text());
    assert.equal(responseEvents[0].event, "response.created");
    assert.equal(responseEvents.at(-1).event, "response.completed");
    assert.deepEqual(
      responseEvents.map((entry) => entry.data.sequence_number),
      responseEvents.map((_entry, index) => index),
    );
    assert.equal(
      responseEvents
        .filter((entry) => entry.event === "response.output_text.delta")
        .map((entry) => entry.data.delta)
        .join(""),
      "Hello from Codex",
    );
    assert.equal(responseEvents.at(-1).data.response.output[0].content[0].text, "Hello from Codex");

    const chatStream = await fetch(`${handle.url}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "client-model",
        messages: [{ role: "user", content: "Say hello" }],
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
    assert.equal(chatStream.status, 200);
    const chunks = parseChatData(await chatStream.text());
    assert.deepEqual(chunks[0].choices[0].delta, { role: "assistant", content: "" });
    assert.equal(
      chunks
        .filter((chunk) => chunk !== "[DONE]" && chunk.choices?.[0]?.delta?.content)
        .map((chunk) => chunk.choices[0].delta.content)
        .join(""),
      "Hello from Codex",
    );
    assert.equal(chunks.find((chunk) => chunk !== "[DONE]" && chunk.choices?.[0]?.finish_reason === "stop").object,
      "chat.completion.chunk");
    const usageChunk = chunks.find((chunk) => chunk !== "[DONE]" && chunk.choices?.length === 0);
    assert.equal(usageChunk.usage.total_tokens, 16);
    assert.equal(chunks.at(-1), "[DONE]");
  } finally {
    await handle.close();
  }
});

test("OpenAI image data URLs reach Codex tasks for normal and streaming Responses and Chat calls", async () => {
  const runner = new ImageCapturingRunner();
  const handle = await startCompatibilityServer({ runner });
  try {
    const key = await createGatewayKey(handle, "gpt-5.6-sol");
    const headers = { ...gatewayHeaders(key), "content-type": "application/json" };
    const largePng = Buffer.concat([PNG, Buffer.alloc(1_100_000)]);

    const responseNormal = await fetch(`${handle.url}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "client-model",
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: "Describe this image" },
            { type: "input_image", image_url: imageDataUrl(largePng), detail: "high" },
          ],
        }],
      }),
    });
    assert.equal(responseNormal.status, 200);
    assert.equal((await responseNormal.json()).status, "completed");

    const responseStream = await fetch(`${handle.url}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "client-model",
        input: [{ type: "input_image", image_url: imageDataUrl() }],
        stream: true,
      }),
    });
    assert.equal(responseStream.status, 200);
    assert.equal(parseResponseEvents(await responseStream.text()).at(-1).event, "response.completed");

    const chatNormal = await fetch(`${handle.url}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "client-model",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "What is shown?" },
            { type: "image_url", image_url: { url: imageDataUrl(), detail: "auto" } },
          ],
        }],
      }),
    });
    assert.equal(chatNormal.status, 200);
    assert.equal((await chatNormal.json()).object, "chat.completion");

    const chatStream = await fetch(`${handle.url}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "client-model",
        messages: [{
          role: "user",
          content: [{ type: "image_url", image_url: imageDataUrl() }],
        }],
        stream: true,
      }),
    });
    assert.equal(chatStream.status, 200);
    assert.equal(parseChatData(await chatStream.text()).at(-1), "[DONE]");

    assert.equal(runner.tasks.length, 4);
    assert.deepEqual(runner.tasks.map((task) => task.imagePaths.length), [1, 1, 1, 1]);
    assert.match(runner.tasks[0].prompt, /Describe this image/);
    assert.match(runner.tasks[0].prompt, /\[Image 1 attached\]/);
    assert.match(runner.tasks[1].prompt, /\[Image 1 attached\]/);
    const captured = await Promise.all(runner.imageReads);
    assert.equal(captured[0][0].length, largePng.length);
    assert.deepEqual(captured.slice(1).map((entry) => entry[0]), [PNG, PNG, PNG]);
    for (const task of runner.tasks) {
      await assert.rejects(readFile(task.imagePaths[0]), (error) => error?.code === "ENOENT");
    }
  } finally {
    await handle.close();
  }
});

test("OpenAI compatibility errors include the OpenAI shape and request ID", async () => {
  const handle = await startCompatibilityServer();
  try {
    const unauthorized = await fetch(`${handle.url}/v1/models`);
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("x-request-id"), /^req_[a-f0-9]{32}$/);
    assert.match(unauthorized.headers.get("www-authenticate"), /^Bearer /);
    assert.deepEqual(await unauthorized.json(), {
      error: {
        message: "A valid Bearer API key is required.",
        type: "authentication_error",
        param: null,
        code: "invalid_api_key",
      },
    });

    const key = await createGatewayKey(handle);
    const headers = { ...gatewayHeaders(key), "content-type": "application/json" };
    const invalid = await fetch(`${handle.url}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "client-model", input: [{ type: "input_image", image_url: "x" }] }),
    });
    assert.equal(invalid.status, 400);
    assert.match(invalid.headers.get("x-request-id"), /^req_[a-f0-9]{32}$/);
    const invalidBody = await invalid.json();
    assert.equal(invalidBody.error.type, "invalid_request_error");
    assert.equal(invalidBody.error.code, "remote_image_url_unsupported");
    assert.equal(invalidBody.error.param, "input[0].image_url");

    const invalidImage = await fetch(`${handle.url}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "client-model",
        messages: [{
          role: "user",
          content: [{
            type: "image_url",
            image_url: { url: "data:image/png;base64,not-valid-base64" },
          }],
        }],
      }),
    });
    assert.equal(invalidImage.status, 400);
    const invalidImageBody = await invalidImage.json();
    assert.equal(invalidImageBody.error.code, "invalid_image_data");
    assert.equal(invalidImageBody.error.param, "messages[0].content[0].image_url.url");

    const partiallyValid = await fetch(`${handle.url}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "client-model",
        input: [{
          role: "user",
          content: [
            { type: "input_image", image_url: imageDataUrl() },
            { type: "input_image", image_url: "data:image/png;base64,invalid" },
          ],
        }],
      }),
    });
    assert.equal(partiallyValid.status, 400);
    assert.equal((await partiallyValid.json()).error.code, "invalid_image_data");
    assert.equal(handle.attachmentStore.uploads.size, 0);

    const tooManyImages = await fetch(`${handle.url}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "client-model",
        input: Array.from({ length: 5 }, () => ({ type: "input_image", image_url: imageDataUrl() })),
      }),
    });
    assert.equal(tooManyImages.status, 400);
    assert.equal((await tooManyImages.json()).error.code, "too_many_images");
    assert.equal(handle.attachmentStore.uploads.size, 0);

    const malformed = await fetch(`${handle.url}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: "{bad-json",
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, "invalid_json");

    const missing = await fetch(`${handle.url}/v1/not-a-route`, {
      headers: gatewayHeaders(key),
    });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "not_found");

    const disabled = await jsonRequest(handle.url, "/api/v1/gateway", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      body: { enabled: false },
    });
    assert.equal(disabled.response.status, 200);
    const unavailable = await fetch(`${handle.url}/v1/models`, { headers: gatewayHeaders(key) });
    assert.equal(unavailable.status, 503);
    assert.match(unavailable.headers.get("x-request-id"), /^req_[a-f0-9]{32}$/);
    const unavailableBody = await unavailable.json();
    assert.equal(unavailableBody.error.type, "server_error");
    assert.equal(unavailableBody.error.code, "gateway_disabled");
    assert.equal(unavailableBody.error.message, "The external API Host is currently turned off.");
  } finally {
    await handle.close();
  }
});

test("model execution failures are converted for non-streaming and streaming clients", async () => {
  const handle = await startCompatibilityServer({
    runner: new FailingRunner(),
    logger: { error() {}, debug() {} },
  });
  try {
    const key = await createGatewayKey(handle);
    const headers = { ...gatewayHeaders(key), "content-type": "application/json" };
    const failed = await fetch(`${handle.url}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "client-model", input: "Fail" }),
    });
    assert.equal(failed.status, 500);
    assert.match(failed.headers.get("x-request-id"), /^req_[a-f0-9]{32}$/);
    assert.deepEqual(await failed.json(), {
      error: {
        message: "The model failed to generate a response.",
        type: "server_error",
        param: null,
        code: "codex_test_failure",
      },
    });

    const streamed = await fetch(`${handle.url}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "client-model", input: "Fail", stream: true }),
    });
    assert.equal(streamed.status, 200);
    const events = parseResponseEvents(await streamed.text());
    assert.equal(events.at(-1).event, "response.failed");
    assert.equal(events.at(-1).data.response.status, "failed");
    assert.equal(events.at(-1).data.response.error.code, "codex_test_failure");
    assert.equal(events.at(-1).data.response.error.message, "The model failed to generate a response.");
  } finally {
    await handle.close();
  }
});
