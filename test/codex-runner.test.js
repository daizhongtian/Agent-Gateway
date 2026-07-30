import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  CodexRunner,
  createCodexRunner,
  RunnerCancelledError,
  RunnerError,
  RunnerTimeoutError,
} from "../src/runner/codex-runner.js";

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.sent = [];
    this.sendError = null;
  }

  send(message, callback) {
    this.sent.push(message);
    callback?.(this.sendError);
  }
}

function runnerWith(child, overrides = {}) {
  let forkCall;
  const runner = new CodexRunner({
    workerPath: "maintained-test-worker.js",
    timeoutMs: 0,
    killGraceMs: 1_000,
    env: { PATH: "safe-path", API_TOKEN: "blocked", OTHER_SECRET: "blocked", TEMP: undefined },
    forkImpl(workerPath, args, options) {
      forkCall = { workerPath, args, options };
      return child;
    },
    ...overrides,
  });
  return { runner, forkCall: () => forkCall };
}

test("runner forwards safe environment, diagnostics, events, and a completed result", async () => {
  const child = new FakeChild();
  const events = [];
  const { runner, forkCall } = runnerWith(child, { exposeDiagnostics: true });
  const execution = runner.run({ projectPath: "C:\\project", prompt: "run" }, {
    onEvent(event) {
      events.push(event);
      if (event.kind === "sdk") throw new Error("observer failure is isolated");
    },
  });

  assert.equal(forkCall().workerPath, "maintained-test-worker.js");
  assert.equal(forkCall().options.env.PATH, "safe-path");
  assert.equal(forkCall().options.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal("API_TOKEN" in forkCall().options.env, false);
  assert.equal("OTHER_SECRET" in forkCall().options.env, false);

  child.stdout.write(`diagnostic ccc_live_${"s".repeat(32)}\n`);
  child.stderr.write("   \n");
  child.emit("message", null);
  child.emit("message", "not-an-object");
  child.emit("message", { type: "ready" });
  child.emit("message", { type: "ready" });
  child.emit("message", { type: "event", payload: { kind: "sdk" } });
  child.emit("message", { type: "completed", result: { content: "done", usage: {}, threadId: "thread" } });
  child.emit("message", { type: "event", payload: { ignored: true } });
  child.connected = false;
  child.emit("close", 0, null);

  assert.deepEqual(await execution.promise, { content: "done", usage: {}, threadId: "thread" });
  assert.equal(child.sent.filter((message) => message.type === "start").length, 1);
  assert.equal(events.some((event) => event.kind === "diagnostic" && !event.message.includes("super_secret")), true);
  assert.equal(execution.cancel(), false);
  await runner.close();
});

test("completed messages use a stable empty result when the worker omits one", async () => {
  const child = new FakeChild();
  const { runner } = runnerWith(child);
  const execution = runner.run({ projectPath: "C:\\project" });
  child.emit("message", { type: "completed" });
  child.emit("close", 0, null);
  assert.deepEqual(await execution.promise, { content: "", usage: null, threadId: null });
  await runner.close();
});

test("worker failure messages preserve public codes and supply safe defaults", async () => {
  for (const message of [
    { type: "failed", error: { code: "PUBLIC_FAILURE", message: "safe failure" } },
    { type: "failed" },
  ]) {
    const child = new FakeChild();
    const { runner } = runnerWith(child);
    const execution = runner.run({ projectPath: "C:\\project" });
    child.emit("message", message);
    child.emit("close", 1, null);
    await assert.rejects(execution.promise, (error) => {
      assert.equal(error instanceof RunnerError, true);
      if (message.error) return error.code === "PUBLIC_FAILURE" && error.message === "safe failure";
      return error.code === "CODEX_RUN_FAILED" && error.message === "Codex could not complete this task.";
    });
    await runner.close();
  }
});

test("spawn, IPC, and premature-exit failures have distinct stable codes", async () => {
  const scenarios = [
    {
      activate(child) { child.emit("error", new Error("private spawn detail")); child.emit("close", 1, null); },
      code: "WORKER_START_FAILED",
    },
    {
      activate(child) { child.sendError = new Error("closed"); child.emit("message", { type: "ready" }); },
      code: "WORKER_IPC_FAILED",
    },
    {
      activate(child) { child.emit("close", 0, null); },
      code: "WORKER_EXITED",
      message: "Codex task worker ended before returning a result.",
    },
    {
      activate(child) { child.emit("close", null, "SIGTERM"); },
      code: "WORKER_EXITED",
      message: "Codex task worker stopped unexpectedly.",
    },
  ];
  for (const scenario of scenarios) {
    const child = new FakeChild();
    const { runner } = runnerWith(child);
    const execution = runner.run({ projectPath: "C:\\project" });
    scenario.activate(child);
    await assert.rejects(execution.promise, (error) => (
      error.code === scenario.code && (!scenario.message || error.message === scenario.message)
    ));
    child.emit("close", 1, null);
    await runner.close();
  }
});

test("cancellation is idempotent when IPC is disconnected or throws", async () => {
  for (const configure of [
    (child) => { child.connected = false; },
    (child) => { child.send = () => { throw new Error("broken IPC"); }; },
  ]) {
    const child = new FakeChild();
    configure(child);
    const { runner } = runnerWith(child);
    const execution = runner.run({ projectPath: "C:\\project" });
    assert.equal(execution.cancel("user"), true);
    assert.equal(execution.cancel("again"), false);
    child.emit("close", null, "SIGKILL");
    await assert.rejects(execution.promise, RunnerCancelledError);
    await runner.close();
  }
});

test("cancel acknowledgements distinguish timeouts from user cancellation", async () => {
  for (const [reason, ErrorType] of [["timeout", RunnerTimeoutError], ["user", RunnerCancelledError]]) {
    const child = new FakeChild();
    const { runner } = runnerWith(child);
    const execution = runner.run({ projectPath: "C:\\project" });
    assert.equal(execution.cancel(reason), true);
    child.emit("message", { type: "cancelled" });
    child.emit("close", 0, null);
    await assert.rejects(execution.promise, ErrorType);
    await runner.close();
  }
});

test("runner factory defaults and close cancel all active executions", async () => {
  const children = [new FakeChild(), new FakeChild()];
  let index = 0;
  const runner = createCodexRunner({
    workerPath: "maintained-test-worker.js",
    timeoutMs: 0,
    killGraceMs: 1_000,
    env: {},
    forkImpl: () => {
      const child = children[index];
      index += 1;
      child.send = function send(message, callback) {
        this.sent.push(message);
        callback?.();
        if (message.type === "cancel") queueMicrotask(() => this.emit("close", null, "SIGKILL"));
      };
      return child;
    },
  });
  const executions = [
    runner.run({ projectPath: "C:\\one" }),
    runner.run({ projectPath: "C:\\two" }),
  ];
  await runner.close();
  const settled = await Promise.allSettled(executions.map((execution) => execution.promise));
  assert.equal(settled.every((entry) => entry.status === "rejected" && entry.reason.code === "TASK_CANCELLED"), true);
  assert.equal(children.every((child) => child.sent.some((message) => message.type === "cancel")), true);
});
