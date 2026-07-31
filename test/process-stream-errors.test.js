import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { protectProcessLoggingStreams } from "../src/electron/process-stream-errors.js";

test("closed Electron logging pipes cannot crash the main process", () => {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  protectProcessLoggingStreams({ stdout, stderr });
  protectProcessLoggingStreams({ stdout, stderr });

  assert.equal(stdout.listenerCount("error"), 1);
  assert.equal(stderr.listenerCount("error"), 1);
  assert.doesNotThrow(() => stdout.emit("error", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })));
  assert.doesNotThrow(() => stderr.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" })));
});
