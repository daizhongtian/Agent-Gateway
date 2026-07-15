import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { WebSocket } from "ws";
import { startServer } from "../src/server/app.js";
import { ApiKeyStore } from "../src/server/api-key-store.js";
import { createAuth } from "../src/server/auth.js";
import { loadServerConfig } from "../src/server/config.js";
import { ProjectRegistry } from "../src/server/projects.js";
import { TaskManager } from "../src/server/task-manager.js";
import { CodexRunner, RunnerCancelledError, RunnerTimeoutError } from "../src/runner/codex-runner.js";
import { executeCodexTask, resolvePackagedCodexRuntime } from "../src/runner/worker.js";
import { normalizeApprovalPolicy, redactSecrets } from "../src/runner/protocol.js";

const PROJECT_ROOT = path.resolve(".");

class FakeRunner {
  constructor({ complete = true } = {}) {
    this.complete = complete;
    this.executions = new Set();
  }

  run(task, options = {}) {
    this.lastTask = task;
    let finished = false;
    let rejectPromise;
    const execution = {
      promise: new Promise((resolve, reject) => {
        rejectPromise = reject;
        if (this.complete) {
          setImmediate(() => {
            if (finished) return;
            options.onEvent?.({ kind: "sdk", event: { type: "thread.started", thread_id: "thread_test" } });
            options.onEvent?.({ kind: "sdk", event: { type: "turn.started" } });
            options.onEvent?.({
              kind: "sdk",
              event: { type: "item.completed", item: { id: "message_1", type: "agent_message", text: "测试完成" } },
            });
            options.onEvent?.({
              kind: "sdk",
              event: {
                type: "turn.completed",
                usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 1 },
              },
            });
            finished = true;
            resolve({
              content: "测试完成",
              threadId: "thread_test",
              usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 1 },
            });
          });
        }
      }),
      cancel: () => {
        if (finished) return false;
        finished = true;
        rejectPromise(new RunnerCancelledError());
        return true;
      },
    };
    this.executions.add(execution);
    execution.promise.finally(() => this.executions.delete(execution)).catch(() => {});
    return execution;
  }

  async close() {
    for (const execution of [...this.executions]) execution.cancel();
    await Promise.allSettled([...this.executions].map((execution) => execution.promise));
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

async function waitForTask(baseUrl, id, headers = {}) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { payload } = await jsonRequest(baseUrl, `/api/v1/tasks/${id}`, { headers });
    if (["completed", "failed", "cancelled"].includes(payload.status)) return payload;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Task did not reach a terminal state");
}

async function waitForExternalTask(baseUrl, id, headers = {}) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { response, payload } = await jsonRequest(baseUrl, `/api/v1/external/tasks/${id}`, { headers });
    assert.equal(response.status, 200);
    if (["completed", "failed", "cancelled"].includes(payload.status)) return payload;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("External task did not reach a terminal state");
}

function rawHttpStatus(baseUrl, pathname, headers) {
  const target = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "GET",
      headers,
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
    request.end();
  });
}

test("server exposes the UI, model catalog, task API, and completed SSE history", async () => {
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    allowedProjectRoots: [PROJECT_ROOT],
    runner: new FakeRunner(),
  });
  try {
    const index = await fetch(`${handle.url}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /Codex Control Center/);
    assert.match(index.headers.get("content-security-policy"), /object-src 'none'/);
    assert.equal(await rawHttpStatus(handle.url, "/health", {
      host: "evil.example",
      origin: "http://evil.example",
    }), 421);

    const { response: modelsResponse, payload: models } = await jsonRequest(handle.url, "/api/v1/models");
    assert.equal(modelsResponse.status, 200);
    assert.deepEqual(models.models.map((model) => model.label), [
      "5.6 Sol", "5.6 Terra", "5.6 Luna", "5.5", "5.4", "5.4 Mini", "5.3 Codex Spark",
    ]);

    const { response: projectResponse, payload: project } = await jsonRequest(handle.url, "/api/v1/projects", {
      method: "POST",
      body: { name: "SDK test", path: PROJECT_ROOT },
    });
    assert.equal(projectResponse.status, 201);
    assert.equal(project.path, PROJECT_ROOT);

    const { response: taskResponse, payload: task } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: {
        prompt: "只返回测试完成",
        projectId: project.id,
        model: "gpt-5.6-sol",
        effort: "ultra",
        speed: "standard",
        sandboxMode: "workspace-write",
        approvalPolicy: "untrusted",
      },
    });
    assert.equal(taskResponse.status, 202);
    const completed = await waitForTask(handle.url, task.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.result.content, "测试完成");
    assert.equal(completed.approvalPolicy, "untrusted");

    const events = await fetch(`${handle.url}/api/v1/tasks/${task.id}/events`);
    const eventText = await events.text();
    assert.match(eventText, /event: result/);
    assert.match(eventText, /event: done/);

    const { payload: history } = await jsonRequest(handle.url, "/api/v1/tasks");
    assert.equal(history.tasks[0].promptPreview, "只返回测试完成");
  } finally {
    await handle.close();
  }
});

test("projectless tasks use an isolated temporary workspace and clean it after completion", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codex-control-projectless-test-"));
  const scratchRoot = path.join(temporaryRoot, "scratch");
  const runner = new FakeRunner();
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    scratchRoot,
    runner,
  });
  try {
    const { response, payload: created } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: {
        prompt: "无项目任务",
        projectless: true,
        model: "gpt-5.6-sol",
        approvalPolicy: "untrusted",
      },
    });
    assert.equal(response.status, 202);
    assert.equal(created.projectless, true);
    assert.equal(created.projectId, null);
    assert.equal(created.projectPath, null);
    assert.equal(created.project.projectless, true);
    const completed = await waitForTask(handle.url, created.id);
    assert.equal(completed.status, "completed");
    assert.ok(runner.lastTask.projectPath.startsWith(scratchRoot));
    assert.deepEqual(await readdir(scratchRoot), []);
  } finally {
    await handle.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("queued and running projectless cancellations clean every scratch workspace", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codex-control-projectless-cancel-"));
  const scratchRoot = path.join(temporaryRoot, "scratch");
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    scratchRoot,
    maxConcurrentTasks: 1,
    maxQueuedTasks: 3,
    runner: new FakeRunner({ complete: false }),
  });
  try {
    const { payload: running } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: { prompt: "running scratch", projectless: true, approvalPolicy: "untrusted" },
    });
    const { payload: queued } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: { prompt: "queued scratch", projectless: true, approvalPolicy: "untrusted" },
    });
    assert.equal(handle.taskManager.get(running.id).status, "running");
    assert.equal(handle.taskManager.get(queued.id).status, "queued");
    assert.equal((await readdir(scratchRoot)).length, 2);

    const { payload: queuedCancelled } = await jsonRequest(
      handle.url,
      `/api/v1/tasks/${queued.id}/cancel`,
      { method: "POST" },
    );
    assert.equal(queuedCancelled.status, "cancelled");
    assert.equal((await readdir(scratchRoot)).length, 1);

    await jsonRequest(handle.url, `/api/v1/tasks/${running.id}/cancel`, { method: "POST" });
    assert.equal((await waitForTask(handle.url, running.id)).status, "cancelled");
    assert.deepEqual(await readdir(scratchRoot), []);
  } finally {
    await handle.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("timed-out projectless tasks fail safely and release their scratch workspace", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codex-control-projectless-timeout-"));
  const scratchRoot = path.join(temporaryRoot, "scratch");
  const timeoutRunner = {
    run() {
      return {
        promise: Promise.reject(new RunnerTimeoutError()),
        cancel: () => false,
      };
    },
    async close() {},
  };
  const handle = await startServer({ mode: "desktop", port: 0, scratchRoot, runner: timeoutRunner });
  try {
    const { payload: task } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: { prompt: "timeout scratch", projectless: true, approvalPolicy: "untrusted" },
    });
    const failed = await waitForTask(handle.url, task.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.error.code, "TASK_TIMEOUT");
    assert.deepEqual(await readdir(scratchRoot), []);
  } finally {
    await handle.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("non-loopback deployments require strong authentication and allowed roots", () => {
  assert.throws(
    () => loadServerConfig({ host: "0.0.0.0", authMode: "none" }),
    /Bearer token is required/,
  );
  assert.throws(
    () => loadServerConfig({
      host: "0.0.0.0",
      authMode: "token",
      apiToken: "short-token",
      allowedProjectRoots: [PROJECT_ROOT],
    }),
    /at least 32 characters/,
  );
  const config = loadServerConfig({
    env: {
      HOST: "0.0.0.0",
      AUTH_MODE: "token",
      API_TOKEN: "a".repeat(32),
      ALLOWED_PROJECT_ROOTS: `${PROJECT_ROOT},${os.tmpdir()}`,
    },
  });
  assert.equal(config.allowedProjectRoots.length, 2);
  assert.doesNotThrow(() => loadServerConfig({
    host: "0.0.0.0",
    authMode: "token",
    resolveToken: async () => null,
    allowedProjectRoots: [PROJECT_ROOT],
  }));
});

test("token auth and WebSocket origin checks are enforced", async () => {
  const token = "t".repeat(40);
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    authMode: "token",
    apiToken: token,
    allowedProjectRoots: [PROJECT_ROOT],
    runner: new FakeRunner(),
  });
  try {
    assert.equal((await fetch(`${handle.url}/api/v1/models`)).status, 401);
    assert.equal((await fetch(`${handle.url}/api/v1/models`, {
      headers: { authorization: `Bearer ${token}` },
    })).status, 200);
    assert.equal((await fetch(`${handle.url}/api/v1/models`, {
      headers: { authorization: `Bearer ${token}`, origin: "http://evil.example" },
    })).status, 403);

    const wsUrl = handle.url.replace(/^http/, "ws") + "/ws";
    const socket = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${token}` }, origin: handle.url });
    const messagePromise = once(socket, "message");
    await once(socket, "open");
    const [welcome] = await messagePromise;
    assert.equal(JSON.parse(welcome.toString()).type, "welcome");
    socket.close();
    await once(socket, "close");

    const rejectedStatus = await new Promise((resolve, reject) => {
      const rejected = new WebSocket(wsUrl, {
        headers: { authorization: `Bearer ${token}` },
        origin: "http://evil.example",
      });
      rejected.once("unexpected-response", (_request, response) => {
        const status = response.statusCode;
        response.resume();
        resolve(status);
      });
      rejected.once("open", () => reject(new Error("Forbidden WebSocket origin was accepted")));
      rejected.once("error", () => {});
    });
    assert.equal(rejectedStatus, 403);
  } finally {
    await handle.close();
  }
});

test("WebSocket ping, validation, subscription, and live task events work", async () => {
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    runner: new FakeRunner({ complete: false }),
  });
  let socket;
  const nextMessage = (predicate) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket?.off("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 2_000);
    const onMessage = (buffer) => {
      const message = JSON.parse(buffer.toString("utf8"));
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
  try {
    const { payload: task } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: { prompt: "websocket task", projectless: true, approvalPolicy: "untrusted" },
    });
    socket = new WebSocket(handle.url.replace(/^http/, "ws") + "/ws");
    const welcome = nextMessage((message) => message.type === "welcome");
    await once(socket, "open");
    assert.equal((await welcome).version, "0.2.0");

    const invalid = nextMessage((message) => message.type === "error");
    socket.send(JSON.stringify({ type: "unknown" }));
    assert.equal((await invalid).error.code, "INVALID_MESSAGE");

    const pong = nextMessage((message) => message.type === "pong");
    socket.send(JSON.stringify({ type: "ping" }));
    assert.ok((await pong).timestamp);

    const subscribed = nextMessage((message) => message.type === "subscribed");
    socket.send(JSON.stringify({ type: "subscribe", taskId: task.id, after: 0 }));
    assert.equal((await subscribed).taskId, task.id);

    const done = nextMessage((message) => message.type === "done" && message.taskId === task.id);
    await jsonRequest(handle.url, `/api/v1/tasks/${task.id}/cancel`, { method: "POST" });
    assert.equal((await done).data.status, "cancelled");
  } finally {
    socket?.close();
    await handle.close();
  }
});

test("CORS preflight and JSON body limits are enforced", async () => {
  const trustedOrigin = "https://trusted.example";
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    corsOrigins: [trustedOrigin],
    bodyLimit: "128b",
    runner: new FakeRunner(),
  });
  try {
    const preflight = await fetch(`${handle.url}/api/v1/models`, {
      method: "OPTIONS",
      headers: {
        origin: trustedOrigin,
        "access-control-request-method": "GET",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), trustedOrigin);
    assert.equal((await fetch(`${handle.url}/api/v1/models`, {
      headers: { origin: "https://evil.example" },
    })).status, 403);

    const oversized = await fetch(`${handle.url}/api/v1/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "x".repeat(1_000), projectless: true }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, "REQUEST_TOO_LARGE");
  } finally {
    await handle.close();
  }
});

test("nested external token resolvers authenticate scoped API users", async () => {
  const token = "external-token-for-test";
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    auth: {
      mode: "token",
      resolveToken: async (candidate) => candidate === token
        ? { sub: "external-viewer", role: "viewer" }
        : null,
    },
    allowedProjectRoots: [PROJECT_ROOT],
    runner: new FakeRunner(),
  });
  try {
    const headers = { authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${handle.url}/api/v1/models`, { headers })).status, 200);
    assert.equal((await fetch(`${handle.url}/api/v1/projects`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ path: PROJECT_ROOT }),
    })).status, 403);
  } finally {
    await handle.close();
  }
});

test("token registries assign distinct fallback owners", async () => {
  const auth = createAuth({
    mode: "token",
    tokens: new Map([
      ["first-token", { role: "operator" }],
      ["second-token", { role: "operator" }],
    ]),
  });
  const first = await auth.resolveAuthorization("Bearer first-token", {});
  const second = await auth.resolveAuthorization("Bearer second-token", {});
  assert.notEqual(first.sub, second.sub);
});

test("projects are owner-isolated and revalidated after a junction or symlink replacement", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-projects-"));
  const original = path.join(root, "original");
  const replacement = path.join(root, "replacement");
  await mkdir(original);
  await mkdir(replacement);
  try {
    const registry = new ProjectRegistry({ allowedRoots: [root] });
    const project = registry.register({ path: original }, { ownerId: "owner-a" });
    assert.throws(() => registry.get(project.id, { ownerId: "owner-b" }), /Project not found/);
    assert.equal(registry.list({ ownerId: "owner-b" }).length, 0);

    await rm(original, { recursive: true });
    try {
      await symlink(replacement, original, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (error?.code === "EPERM") {
        t.skip("Creating a junction/symlink is not permitted in this environment");
        return;
      }
      throw error;
    }
    assert.throws(
      () => registry.revalidate(project.id, { ownerId: "owner-a" }),
      /different location/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("task queue and SSE connections have hard limits", async () => {
  const runner = new FakeRunner({ complete: false });
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    allowedProjectRoots: [PROJECT_ROOT],
    maxQueuedTasks: 1,
    maxSseConnections: 1,
    runner,
  });
  const streamAbort = new AbortController();
  try {
    const { payload: project } = await jsonRequest(handle.url, "/api/v1/projects", {
      method: "POST",
      body: { path: PROJECT_ROOT },
    });
    const { payload: task } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: { prompt: "等待取消", projectId: project.id, approvalPolicy: "untrusted" },
    });
    const { response: rejected } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: { prompt: "队列应拒绝", projectId: project.id, approvalPolicy: "untrusted" },
    });
    assert.equal(rejected.status, 429);

    const firstStream = await fetch(`${handle.url}/api/v1/tasks/${task.id}/events`, { signal: streamAbort.signal });
    assert.equal(firstStream.status, 200);
    const secondStream = await fetch(`${handle.url}/api/v1/tasks/${task.id}/events`);
    assert.equal(secondStream.status, 429);
    streamAbort.abort();

    const { response: cancelled } = await jsonRequest(handle.url, `/api/v1/tasks/${task.id}/cancel`, { method: "POST" });
    assert.equal(cancelled.status, 202);
  } finally {
    streamAbort.abort();
    await handle.close();
  }
});

test("SDK worker maps API key, speed, environment policy, and approval defaults", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-secret";
  let codexOptions;
  let threadOptions;
  class MockCodex {
    constructor(options) {
      codexOptions = options;
    }
    startThread(options) {
      threadOptions = options;
      return {
        id: "thread_mock",
        async runStreamed() {
          return {
            events: (async function* events() {
              yield { type: "thread.started", thread_id: "thread_mock" };
              yield { type: "item.completed", item: { id: "m", type: "agent_message", text: "ok" } };
              yield {
                type: "turn.completed",
                usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
              };
            })(),
          };
        },
      };
    }
  }
  try {
    const result = await executeCodexTask({
      prompt: "test",
      projectPath: PROJECT_ROOT,
      model: "gpt-5.6-sol",
      effort: "ultra",
      speed: "fast",
      permission: "workspace-write",
      approvalPolicy: "untrusted",
      skipGitRepoCheck: true,
    }, {
      loadSdk: async () => ({ Codex: MockCodex }),
      packagedRuntime: { executablePath: "C:\\packaged\\codex.exe", pathDirectory: null },
    });
    assert.equal(result.content, "ok");
    assert.equal(codexOptions.apiKey, "sk-test-not-a-real-secret");
    assert.equal(codexOptions.config.service_tier, "fast");
    assert.equal(codexOptions.codexPathOverride, "C:\\packaged\\codex.exe");
    assert.ok(codexOptions.config.shell_environment_policy.exclude.includes("OPENAI_API_KEY"));
    assert.equal(threadOptions.modelReasoningEffort, "xhigh");
    assert.equal(threadOptions.approvalPolicy, "untrusted");
    assert.equal(normalizeApprovalPolicy(undefined, "workspace-write"), "untrusted");
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("packaged Codex runtime resolves from app.asar.unpacked", async () => {
  const resources = await mkdtemp(path.join(os.tmpdir(), "codex-control-resources-"));
  const runtimeRoot = path.join(
    resources,
    "app.asar.unpacked",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
  );
  try {
    await mkdir(path.join(runtimeRoot, "bin"), { recursive: true });
    await mkdir(path.join(runtimeRoot, "codex-path"));
    await writeFile(path.join(runtimeRoot, "bin", "codex.exe"), "test executable placeholder");
    const runtime = resolvePackagedCodexRuntime(resources, "win32", "x64");
    assert.equal(runtime.executablePath, path.join(runtimeRoot, "bin", "codex.exe"));
    assert.equal(runtime.pathDirectory, path.join(runtimeRoot, "codex-path"));
  } finally {
    await rm(resources, { recursive: true, force: true });
  }
});

test("cancelling a runner before worker readiness never starts the task", async () => {
  class DeferredChild extends EventEmitter {
    constructor() {
      super();
      this.connected = true;
      this.stdout = new PassThrough();
      this.stderr = new PassThrough();
      this.sent = [];
    }

    send(message, callback) {
      this.sent.push(message);
      callback?.();
    }
  }

  const child = new DeferredChild();
  const runner = new CodexRunner({
    workerPath: "fake-worker.js",
    forkImpl: () => child,
    timeoutMs: 0,
    killGraceMs: 25,
    env: {},
  });
  const execution = runner.run({ projectPath: PROJECT_ROOT });
  const rejected = assert.rejects(execution.promise, (error) => error.code === "TASK_CANCELLED");
  assert.equal(execution.cancel("user"), true);
  child.emit("message", { type: "ready" });
  assert.equal(child.sent.some((message) => message.type === "start"), false);
  child.emit("close", null, "SIGKILL");
  await rejected;
  await runner.close();
});

test("runner timeout sends cancellation to the worker and rejects with TASK_TIMEOUT", async () => {
  class TimeoutChild extends EventEmitter {
    constructor() {
      super();
      this.connected = true;
      this.stdout = new PassThrough();
      this.stderr = new PassThrough();
      this.sent = [];
    }

    send(message, callback) {
      this.sent.push(message);
      callback?.();
    }
  }

  const child = new TimeoutChild();
  const runner = new CodexRunner({
    workerPath: "fake-worker.js",
    forkImpl: () => child,
    timeoutMs: 20,
    killGraceMs: 1_000,
    env: {},
  });
  const execution = runner.run({ projectPath: PROJECT_ROOT });
  const rejected = assert.rejects(execution.promise, (error) => error.code === "TASK_TIMEOUT");
  child.emit("message", { type: "ready" });
  for (let attempt = 0; attempt < 40 && !child.sent.some((message) => message.type === "cancel"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(child.sent.some((message) => message.type === "start"), true);
  assert.equal(child.sent.some((message) => message.type === "cancel" && message.reason === "timeout"), true);
  child.emit("message", { type: "cancelled" });
  child.connected = false;
  child.emit("close", 0, null);
  await rejected;
  await runner.close();
});

test("TaskManager rejects interactive approval policies", async () => {
  const registry = new ProjectRegistry({ allowedRoots: [PROJECT_ROOT] });
  const project = registry.register({ path: PROJECT_ROOT }, { ownerId: "owner-a" });
  const runner = new FakeRunner({ complete: false });
  const manager = new TaskManager({ runner, projects: registry, maxQueued: 2, requireExplicitProject: true });
  try {
    assert.throws(() => manager.create({
      prompt: "test",
      projectId: project.id,
      approvalPolicy: "on-request",
    }, { ownerId: "owner-a" }), (error) => error.code === "INTERACTIVE_APPROVAL_UNSUPPORTED");
  } finally {
    await manager.close();
  }
});

test("an authorized admin task revalidates another owner's project before execution", async () => {
  const registry = new ProjectRegistry({ allowedRoots: [PROJECT_ROOT] });
  const project = registry.register({ path: PROJECT_ROOT }, { ownerId: "project-owner" });
  const runner = new FakeRunner();
  const manager = new TaskManager({ runner, projects: registry, maxQueued: 2, requireExplicitProject: true });
  try {
    const created = manager.create({
      prompt: "admin task",
      projectId: project.id,
      approvalPolicy: "untrusted",
    }, { ownerId: "admin-user", allowAllProjects: true });
    for (let attempt = 0; attempt < 40 && manager.get(created.id).status !== "completed"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(manager.get(created.id).status, "completed");
  } finally {
    await manager.close();
  }
});

test("preflight failures obey the task history limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-prune-"));
  const projectPath = path.join(root, "project");
  await mkdir(projectPath);
  const registry = new ProjectRegistry({ allowedRoots: [root] });
  const project = registry.register({ path: projectPath }, { ownerId: "owner-a" });
  const manager = new TaskManager({
    runner: new FakeRunner(),
    projects: registry,
    maxConcurrent: 1,
    maxQueued: 100,
    historyLimit: 10,
    requireExplicitProject: true,
  });
  try {
    await rm(projectPath, { recursive: true, force: true });
    for (let index = 0; index < 25; index += 1) {
      manager.create({
        prompt: `preflight failure ${index}`,
        projectId: project.id,
        approvalPolicy: "untrusted",
      }, { ownerId: "owner-a" });
    }
    assert.equal(manager.tasks.size, 10);
    assert.equal([...manager.tasks.values()].every((task) => task.status === "failed"), true);
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid JSON is reported as a client error", async () => {
  const handle = await startServer({ mode: "desktop", port: 0, runner: new FakeRunner() });
  try {
    const response = await fetch(`${handle.url}/api/v1/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_JSON");
  } finally {
    await handle.close();
  }
});

test("Electron desktop sessions protect the internal API while generated keys use the external API", async () => {
  const desktopSessionToken = "desktop-session-" + "s".repeat(32);
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    desktopSessionToken,
    runner: new FakeRunner(),
  });
  try {
    assert.equal((await fetch(`${handle.url}/health`)).status, 200);
    assert.equal((await fetch(`${handle.url}/api/v1/models`)).status, 401);
    assert.equal((await fetch(`${handle.url}/api/v1/models`, {
      headers: { cookie: "codex_desktop_session=wrong" },
    })).status, 401);

    const sessionHeaders = { cookie: `codex_desktop_session=${desktopSessionToken}` };
    assert.equal((await fetch(`${handle.url}/api/v1/models`, { headers: sessionHeaders })).status, 200);
    const { response: createResponse, payload: createdKey } = await jsonRequest(handle.url, "/api/v1/api-keys", {
      method: "POST",
      headers: sessionHeaders,
      body: { model: "gpt-5.6-sol", effort: "high", speed: "standard", permission: "read-only" },
    });
    assert.equal(createResponse.status, 201);
    assert.equal((await fetch(`${handle.url}/api/v1/external/profile`, {
      headers: { authorization: `Bearer ${createdKey.key}` },
    })).status, 200);
  } finally {
    await handle.close();
  }
});

test("gateway API keys persist as hashes, lock task presets, isolate owners, and revoke immediately", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-api-keys-"));
  const storePath = path.join(root, "gateway-api-keys.json");
  const runner = new FakeRunner();
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    apiKeyStorePath: storePath,
    allowedProjectRoots: [PROJECT_ROOT],
    runner,
  });
  try {
    const { response: projectResponse, payload: project } = await jsonRequest(handle.url, "/api/v1/projects", {
      method: "POST",
      body: { name: "Gateway project", path: PROJECT_ROOT },
    });
    assert.equal(projectResponse.status, 201);

    const { response: keyResponse, payload: createdKey } = await jsonRequest(handle.url, "/api/v1/api-keys", {
      method: "POST",
      body: {
        name: "Read-only automation",
        model: "gpt-5.6-sol",
        effort: "ultra",
        speed: "fast",
        permission: "read-only",
      },
    });
    assert.equal(keyResponse.status, 201);
    assert.match(createdKey.key, /^ccc_live_[A-Za-z0-9_-]{40,64}$/);
    assert.equal(redactSecrets(`token=${createdKey.key}`), "token=[REDACTED]");
    assert.equal(createdKey.preset.effort, "xhigh");
    assert.equal(createdKey.preset.permission, "read-only");
    const firstHeaders = { authorization: `Bearer ${createdKey.key}` };

    const { response: secondResponse, payload: secondKey } = await jsonRequest(handle.url, "/api/v1/api-keys", {
      method: "POST",
      body: {
        name: "Second automation",
        model: "gpt-5.4",
        effort: "medium",
        speed: "standard",
        permission: "workspace-write",
      },
    });
    assert.equal(secondResponse.status, 201);
    const secondHeaders = { authorization: `Bearer ${secondKey.key}` };

    const stored = await readFile(storePath, "utf8");
    assert.doesNotMatch(stored, new RegExp(createdKey.key));
    assert.doesNotMatch(stored, new RegExp(secondKey.key));
    assert.match(stored, /"keyHash": "[a-f0-9]{64}"/);

    const { response: listResponse, payload: listed } = await jsonRequest(handle.url, "/api/v1/api-keys");
    assert.equal(listResponse.status, 200);
    assert.equal(listed.apiKeys.length, 2);
    assert.equal("key" in listed.apiKeys[0], false);
    assert.doesNotMatch(JSON.stringify(listed), /keyHash/);

    assert.equal((await fetch(`${handle.url}/api/v1/external/profile`)).status, 401);
    assert.equal((await fetch(`${handle.url}/api/v1/models`, {
      headers: { authorization: "Bearer ccc_live_invalid_invalid_invalid_invalid_invalid_invalid" },
    })).status, 401);

    const { response: profileResponse, payload: profile } = await jsonRequest(
      handle.url,
      "/api/v1/external/profile",
      { headers: firstHeaders },
    );
    assert.equal(profileResponse.status, 200);
    assert.equal(profile.preset.model, "gpt-5.6-sol");
    assert.equal(profile.preset.effort, "xhigh");
    assert.ok(profile.projects.some((candidate) => candidate.id === project.id));

    const { response: taskResponse, payload: task } = await jsonRequest(handle.url, "/api/v1/external/tasks", {
      method: "POST",
      headers: firstHeaders,
      body: {
        prompt: "Run with the key preset",
        projectId: project.id,
      },
    });
    assert.equal(taskResponse.status, 202);
    assert.equal(task.model, "gpt-5.6-sol");
    assert.equal(task.effort, "xhigh");
    assert.equal(task.speed, "fast");
    assert.equal(task.permission, "read-only");
    assert.equal(task.credentialId, createdKey.id);
    const completed = await waitForExternalTask(handle.url, task.id, firstHeaders);
    assert.equal(completed.status, "completed");
    assert.equal(runner.lastTask.model, "gpt-5.6-sol");
    assert.equal(runner.lastTask.effort, "xhigh");
    assert.equal(runner.lastTask.permission, "read-only");

    const { response: conflictResponse, payload: conflictPayload } = await jsonRequest(
      handle.url,
      "/api/v1/external/tasks",
      {
        method: "POST",
        headers: firstHeaders,
        body: { prompt: "Try another model", projectless: true, model: "gpt-5.4" },
      },
    );
    assert.equal(conflictResponse.status, 409);
    assert.equal(conflictPayload.error.code, "API_KEY_PRESET_CONFLICT");

    const { response: approvalConflict, payload: approvalPayload } = await jsonRequest(
      handle.url,
      "/api/v1/external/tasks",
      {
        method: "POST",
        headers: firstHeaders,
        body: { prompt: "Try another approval policy", projectless: true, approvalPolicy: "untrusted" },
      },
    );
    assert.equal(approvalConflict.status, 409);
    assert.deepEqual(approvalPayload.error.details.fields, ["approvalPolicy"]);

    const { response: networkResponse } = await jsonRequest(handle.url, "/api/v1/external/tasks", {
      method: "POST",
      headers: firstHeaders,
      body: { prompt: "Try network", projectless: true, networkAccessEnabled: true },
    });
    assert.equal(networkResponse.status, 403);
    assert.equal((await fetch(`${handle.url}/api/v1/external/tasks/${task.id}`, {
      headers: secondHeaders,
    })).status, 404);
    assert.equal((await fetch(`${handle.url}/api/v1/api-keys`, { headers: firstHeaders })).status, 403);
    assert.equal((await fetch(`${handle.url}/api/v1/projects`, {
      method: "POST",
      headers: { ...firstHeaders, "content-type": "application/json" },
      body: JSON.stringify({ path: PROJECT_ROOT }),
    })).status, 403);
    assert.equal((await fetch(`${handle.url}/api/v1/projects/select`, {
      method: "POST",
      headers: { ...firstHeaders, "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id }),
    })).status, 403);

    const restartedBeforeRevoke = new ApiKeyStore({ filePath: storePath });
    assert.equal(restartedBeforeRevoke.resolve(createdKey.key)?.credentialId, createdKey.id);

    const { response: revokeResponse, payload: revoked } = await jsonRequest(
      handle.url,
      `/api/v1/api-keys/${encodeURIComponent(createdKey.id)}/revoke`,
      { method: "POST" },
    );
    assert.equal(revokeResponse.status, 200);
    assert.equal(revoked.active, false);
    assert.equal((await fetch(`${handle.url}/api/v1/external/profile`, { headers: firstHeaders })).status, 401);
    assert.equal(restartedBeforeRevoke.resolve(createdKey.key), null);

    const restartedAfterRevoke = new ApiKeyStore({ filePath: storePath });
    assert.equal(restartedAfterRevoke.resolve(createdKey.key), null);
    assert.equal(restartedAfterRevoke.resolve(secondKey.key)?.credentialId, secondKey.id);
  } finally {
    await handle.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("gateway API key limits and repeated revocation are deterministic", () => {
  const store = new ApiKeyStore();
  const input = {
    model: "gpt-5.6-sol",
    effort: "low",
    speed: "standard",
    permission: "read-only",
  };
  const keys = Array.from({ length: 100 }, (_, index) => store.create({
    ...input,
    name: `limit test ${index}`,
  }));
  assert.equal(store.list().length, 100);
  assert.throws(
    () => store.create({ ...input, name: "one too many" }),
    (error) => error?.code === "API_KEY_LIMIT_REACHED",
  );
  const first = store.revoke(keys[0].id);
  const second = store.revoke(keys[0].id);
  assert.equal(first.revokedAt, second.revokedAt);
  assert.equal(second.active, false);
  assert.doesNotThrow(() => store.create({ ...input, name: "replacement" }));
});

test("revoking a gateway key cancels its active tasks and closes authenticated WebSockets", async () => {
  const runner = new FakeRunner({ complete: false });
  const handle = await startServer({ mode: "desktop", port: 0, runner });
  try {
    const { payload: createdKey } = await jsonRequest(handle.url, "/api/v1/api-keys", {
      method: "POST",
      body: {
        model: "gpt-5.6-sol",
        effort: "high",
        speed: "standard",
        permission: "read-only",
      },
    });
    const headers = { authorization: `Bearer ${createdKey.key}` };
    const { response: taskResponse, payload: task } = await jsonRequest(handle.url, "/api/v1/external/tasks", {
      method: "POST",
      headers,
      body: { prompt: "Stay active until revoked", projectless: true },
    });
    assert.equal(taskResponse.status, 202);
    assert.equal(handle.taskManager.get(task.id).status, "running");

    const socket = new WebSocket(handle.url.replace(/^http/, "ws") + "/ws", { headers });
    await once(socket, "open");
    const closed = once(socket, "close");
    const { response: revokeResponse, payload: revoked } = await jsonRequest(
      handle.url,
      `/api/v1/api-keys/${encodeURIComponent(createdKey.id)}/revoke`,
      { method: "POST" },
    );
    assert.equal(revokeResponse.status, 200);
    assert.equal(revoked.cancelledTasks, 1);
    assert.equal(revoked.closedConnections, 1);
    const [closeCode] = await closed;
    assert.equal(closeCode, 4003);

    for (let attempt = 0; attempt < 40 && handle.taskManager.get(task.id).status !== "cancelled"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(handle.taskManager.get(task.id).status, "cancelled");
  } finally {
    await handle.close();
  }
});

test("API key store recovers a crashed stale writer lock without stealing a live lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-api-key-lock-"));
  const storePath = path.join(root, "gateway-api-keys.json");
  const lockPath = `${storePath}.lock`;
  try {
    await mkdir(lockPath);
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleAt, staleAt);
    const store = new ApiKeyStore({ filePath: storePath, lockStaleMs: 5_000 });
    const created = store.create({
      model: "gpt-5.6-sol",
      effort: "high",
      speed: "standard",
      permission: "read-only",
    });
    assert.match(created.key, /^ccc_live_/);
    await assert.rejects(readFile(lockPath), (error) => error?.code === "ENOENT");

    await mkdir(lockPath);
    assert.throws(
      () => store.revoke(created.id),
      (error) => error?.code === "API_KEY_STORE_BUSY",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("gateway key revocation propagates to tasks, SSE, and WebSockets in another server instance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-api-key-cluster-"));
  const storePath = path.join(root, "gateway-api-keys.json");
  const first = await startServer({
    mode: "desktop",
    port: 0,
    apiKeyStorePath: storePath,
    apiKeyRevocationPollMs: 20,
    runner: new FakeRunner({ complete: false }),
  });
  const second = await startServer({
    mode: "desktop",
    port: 0,
    apiKeyStorePath: storePath,
    apiKeyRevocationPollMs: 20,
    runner: new FakeRunner({ complete: false }),
  });
  const timeout = (promise, message) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 2_000)),
  ]);
  try {
    const { payload: createdKey } = await jsonRequest(first.url, "/api/v1/api-keys", {
      method: "POST",
      body: {
        model: "gpt-5.6-sol",
        effort: "high",
        speed: "standard",
        permission: "read-only",
      },
    });
    const headers = { authorization: `Bearer ${createdKey.key}` };
    const { payload: task } = await jsonRequest(second.url, "/api/v1/external/tasks", {
      method: "POST",
      headers,
      body: { prompt: "Wait for cross-instance revocation", projectless: true },
    });
    assert.equal(second.taskManager.get(task.id).status, "running");

    const socket = new WebSocket(second.url.replace(/^http/, "ws") + "/ws", { headers });
    await once(socket, "open");
    const socketClosed = once(socket, "close");

    const stream = await fetch(`${second.url}/api/v1/external/tasks/${task.id}/events`, { headers });
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    const streamEnded = (async () => {
      while (!(await reader.read()).done) {
        // Drain the stream until revocation closes it.
      }
    })();

    const { response: revokeResponse } = await jsonRequest(
      first.url,
      `/api/v1/api-keys/${encodeURIComponent(createdKey.id)}/revoke`,
      { method: "POST" },
    );
    assert.equal(revokeResponse.status, 200);
    const [closeCode] = await timeout(socketClosed, "Remote WebSocket was not closed after revocation");
    assert.equal(closeCode, 4003);
    await timeout(streamEnded, "Remote SSE stream was not closed after revocation");

    for (let attempt = 0; attempt < 100 && second.taskManager.get(task.id).status !== "cancelled"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(second.taskManager.get(task.id).status, "cancelled");
  } finally {
    await Promise.allSettled([first.close(), second.close()]);
    await rm(root, { recursive: true, force: true });
  }
});
