import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  executeCodexTask,
  resolvePackagedCodexRuntime,
} from "../src/runner/worker.js";

function fakeSdk(events, capture = {}, threadId = "thread-fallback") {
  return {
    Codex: class {
      constructor(options) { capture.client = options; }
      startThread(options) {
        capture.thread = options;
        return {
          id: threadId,
          async runStreamed(input, options) {
            capture.input = input;
            capture.signal = options.signal;
            capture.turn = options;
            return {
              events: (async function* stream() {
                for (const event of events) yield event;
              }()),
            };
          },
        };
      }
    },
  };
}

test("packaged runtime resolution rejects unsupported layouts and accepts the fallback binary", async () => {
  assert.equal(resolvePackagedCodexRuntime(null, "win32", "x64"), null);
  assert.equal(resolvePackagedCodexRuntime("C:\\resources", "linux", "x64"), null);

  const resources = await mkdtemp(path.join(os.tmpdir(), "agent-gateway-worker-runtime-"));
  const root = path.join(
    resources, "app.asar.unpacked", "node_modules", "@openai", "codex-win32-arm64",
    "vendor", "aarch64-pc-windows-msvc",
  );
  try {
    await mkdir(path.join(root, "bin"), { recursive: true });
    await mkdir(path.join(root, "codex"), { recursive: true });
    await mkdir(path.join(root, "bin", "codex.exe"));
    await writeFile(path.join(root, "codex", "codex.exe"), "placeholder");
    const runtime = resolvePackagedCodexRuntime(resources, "win32", "arm64");
    assert.equal(runtime.executablePath, path.join(root, "codex", "codex.exe"));
    assert.equal(runtime.pathDirectory, null);
  } finally {
    await rm(resources, { recursive: true, force: true });
  }
});

test("SDK task execution maps runtime, attachments, images, events, and usage without a real model call", async () => {
  const capture = {};
  const emitted = [];
  const controller = new AbortController();
  const task = {
    prompt: "Inspect the attachments",
    model: "test-model",
    effort: "high",
    speed: "fast",
    permission: "read-only",
    imagePaths: ["C:\\images\\one.png", "relative.png", 42],
    attachments: [
      null,
      { name: "report.pdf", kind: "pdf", path: "C:\\files\\report.pdf" },
      { name: "notes.txt", kind: "text", path: "C:\\files\\notes.txt", extractedTextPath: "C:\\files\\notes.extracted.txt" },
      { name: "ignored" },
      { path: "C:\\files\\unnamed.bin" },
    ],
  };
  const events = [
    { type: "thread.started", thread_id: "thread-live" },
    { type: "item.completed", item: { type: "tool_call", text: "ignored" } },
    { type: "item.completed", item: { type: "agent_message" } },
    { type: "turn.completed", usage: { input_tokens: 2, output_tokens: 1 } },
  ];

  const result = await executeCodexTask(task, {
    loadSdk: async () => fakeSdk(events, capture),
    packagedRuntime: { executablePath: "C:\\runtime\\codex.exe", pathDirectory: "C:\\runtime\\codex-path" },
    signal: controller.signal,
    emit: (event) => emitted.push(event),
  });

  assert.equal(capture.client.codexPathOverride, "C:\\runtime\\codex.exe");
  assert.match(capture.client.env.Path ?? capture.client.env.PATH, /codex-path/);
  assert.equal(capture.client.config.service_tier, "fast");
  assert.deepEqual(capture.client.config.shell_environment_policy.exclude, ["OPENAI_API_KEY", "CODEX_API_KEY", "API_TOKEN"]);
  assert.equal(Array.isArray(capture.input), true);
  assert.equal(capture.input[0].type, "text");
  assert.match(capture.input[0].text, /report\.pdf/);
  assert.match(capture.input[0].text, /no embedded PDF text was extracted/);
  assert.match(capture.input[0].text, /notes\.extracted\.txt/);
  assert.match(capture.input[0].text, /attachment-3/);
  assert.deepEqual(capture.input.slice(1), [{ type: "local_image", path: "C:\\images\\one.png" }]);
  assert.equal(emitted.length, events.length);
  assert.deepEqual(result, {
    content: "",
    usage: { input_tokens: 2, output_tokens: 1 },
    threadId: "thread-live",
  });
});

test("SDK probing validates construction without starting a thread", async () => {
  let starts = 0;
  class ProbeCodex {
    startThread() { starts += 1; }
  }
  const result = await executeCodexTask({ probeSdk: true, speed: "standard" }, {
    loadSdk: async () => ({ Codex: ProbeCodex }),
    packagedRuntime: null,
  });
  assert.deepEqual(result, { content: "SDK_RESOLVED", usage: null, threadId: null });
  assert.equal(starts, 0);
});

test("SDK task execution returns the thread fallback and plain prompt", async () => {
  const capture = {};
  const result = await executeCodexTask({ prompt: "plain", attachments: {}, imagePaths: {} }, {
    loadSdk: async () => fakeSdk([
      { type: "item.completed", item: { type: "agent_message", text: "done" } },
      { type: "turn.completed" },
    ], capture, "fallback-id"),
    packagedRuntime: null,
  });
  assert.equal(capture.input, "plain");
  assert.deepEqual(result, { content: "done", usage: null, threadId: "fallback-id" });
});

test("SDK task execution forwards a structured output schema to the Codex turn", async () => {
  const capture = {};
  const outputSchema = {
    type: "object",
    properties: { type: { type: "string", enum: ["message", "function_calls"] } },
    required: ["type"],
    additionalProperties: false,
  };
  await executeCodexTask({ prompt: "choose", outputSchema }, {
    loadSdk: async () => fakeSdk([
      { type: "item.completed", item: { type: "agent_message", text: '{"type":"message"}' } },
      { type: "turn.completed" },
    ], capture),
    packagedRuntime: null,
  });
  assert.deepEqual(capture.turn.outputSchema, outputSchema);
});

test("SDK stream failures are classified and incomplete streams are rejected", async () => {
  const cases = [
    [[{ type: "turn.failed" }], "CODEX_TURN_FAILED", "Codex turn failed"],
    [[{ type: "error", message: "provider unavailable" }], "CODEX_STREAM_FAILED", "provider unavailable"],
    [[{ type: "error" }], "CODEX_STREAM_FAILED", "Codex stream failed"],
  ];
  for (const [events, code, message] of cases) {
    await assert.rejects(() => executeCodexTask({ prompt: "fail" }, {
      loadSdk: async () => fakeSdk(events),
      packagedRuntime: null,
    }), (error) => error.code === code && error.message === message);
  }
  await assert.rejects(() => executeCodexTask({ prompt: "incomplete" }, {
    loadSdk: async () => fakeSdk([{ type: "thread.started", thread_id: "thread" }]),
    packagedRuntime: null,
  }), /ended before turn completion/);
});

test("an aborted SDK task is rejected after its stream ends", async () => {
  const controller = new AbortController();
  controller.abort("test cancellation");
  await assert.rejects(() => executeCodexTask({ prompt: "cancel" }, {
    loadSdk: async () => fakeSdk([{ type: "turn.completed" }]),
    packagedRuntime: null,
    signal: controller.signal,
  }), (error) => error.name === "AbortError");
});
