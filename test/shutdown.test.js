import assert from "node:assert/strict";
import test from "node:test";
import { waitForShutdown } from "../src/electron/shutdown.js";

test("strict shutdown rejects instead of continuing after a timeout", async () => {
  await assert.rejects(
    waitForShutdown(() => new Promise(() => {}), { timeoutMs: 10, rejectOnTimeout: true }),
    (error) => error?.code === "SERVER_STOP_TIMEOUT",
  );
});

test("normal application exit may continue after a shutdown timeout", async () => {
  const result = await waitForShutdown(() => new Promise(() => {}), { timeoutMs: 10 });
  assert.deepEqual(result, { timedOut: true });
});

test("a completed shutdown is reported before its timeout", async () => {
  const result = await waitForShutdown(() => Promise.resolve(), { timeoutMs: 1_000, rejectOnTimeout: true });
  assert.deepEqual(result, { timedOut: false });
});
