import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { CODING_AGENT_CONNECTORS, connectCodingAgent } from "../src/electron/coding-agent-connectors.js";

function completedChild(code = 0, errorOutput = "") {
  const child = new EventEmitter();
  child.stderr = new PassThrough();
  child.kill = () => true;
  queueMicrotask(() => {
    if (errorOutput) child.stderr.write(errorOutput);
    child.emit("close", code);
  });
  return child;
}

test("ChatGPT connector starts only the bundled Codex login command", async () => {
  const calls = [];
  const runtime = {
    executablePath: "C:\\Gateway\\codex.exe",
    pathDirectory: "C:\\Gateway\\codex-path",
  };
  const result = await connectCodingAgent("chatgpt-codex", {
    platform: "win32",
    arch: "x64",
    environment: { Path: "C:\\Windows" },
    findRuntime: () => runtime,
    spawnProcess: (file, args, options) => {
      calls.push({ file, args, options });
      return completedChild();
    },
  });

  assert.deepEqual(result, { ok: true, providerId: "chatgpt-codex", providerLabel: "ChatGPT" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, runtime.executablePath);
  assert.deepEqual(calls[0].args, ["login"]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.match(calls[0].options.env.Path, /codex-path/);
});

test("coding agent connector rejects unknown providers without spawning a process", async () => {
  let spawned = false;
  await assert.rejects(
    connectCodingAgent("arbitrary-command", {
      platform: "win32",
      findRuntime: () => ({ executablePath: "C:\\Gateway\\codex.exe" }),
      spawnProcess: () => {
        spawned = true;
        return completedChild();
      },
    }),
    (error) => error?.code === "UNSUPPORTED_CODING_AGENT",
  );
  assert.equal(spawned, false);
  assert.deepEqual(Object.keys(CODING_AGENT_CONNECTORS), ["chatgpt-codex"]);
});

test("ChatGPT connector reports an incomplete browser login", async () => {
  await assert.rejects(
    connectCodingAgent("chatgpt-codex", {
      platform: "win32",
      findRuntime: () => ({ executablePath: "C:\\Gateway\\codex.exe" }),
      spawnProcess: () => completedChild(1, "Login cancelled"),
    }),
    (error) => error?.code === "LOGIN_FAILED" && /cancelled/i.test(error.message),
  );
});
