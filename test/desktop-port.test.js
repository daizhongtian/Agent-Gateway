import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import {
  checkLoopbackPort,
  DEFAULT_DESKTOP_PORT,
  desktopPortManagedByEnvironment,
  parseDesktopPort,
  resolveDesktopPort,
  selectDesktopPort,
} from "../src/electron/desktop-port.js";

test("desktop port defaults to 4310 and supports an explicit test override", () => {
  assert.equal(DEFAULT_DESKTOP_PORT, 4310);
  assert.equal(resolveDesktopPort({ environment: {}, preferences: {} }), 4310);
  assert.equal(resolveDesktopPort({ environment: {}, preferences: { port: 5210 } }), 5210);
  assert.equal(resolveDesktopPort({ environment: { CODEX_DESKTOP_PORT: "0" }, preferences: { port: 5210 } }), 0);
  assert.equal(desktopPortManagedByEnvironment({ CODEX_DESKTOP_PORT: "61084" }), true);
  assert.equal(desktopPortManagedByEnvironment({}), false);
});

test("desktop port validation rejects invalid user and environment values", () => {
  assert.equal(parseDesktopPort("4310"), 4310);
  assert.throws(() => parseDesktopPort(0), /between 1 and 65535/);
  assert.throws(() => parseDesktopPort(65_536), /between 1 and 65535/);
  assert.throws(
    () => resolveDesktopPort({ environment: { CODEX_DESKTOP_PORT: "invalid" } }),
    /CODEX_DESKTOP_PORT/,
  );
});

test("desktop port availability detects a loopback port already in use", async (t) => {
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => blocker.close());
  const address = blocker.address();
  assert.ok(address && typeof address === "object");
  const occupied = await checkLoopbackPort(address.port);
  assert.deepEqual(occupied, { available: false, port: address.port, code: "EADDRINUSE" });
});

test("desktop port availability accepts a released loopback port", async () => {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())));
  const available = await checkLoopbackPort(address.port);
  assert.deepEqual(available, { available: true, port: address.port, code: null });
});

test("desktop startup falls back to an ephemeral port when the configured port is occupied", async () => {
  const calls = [];
  const selected = await selectDesktopPort(4310, {
    checkPort: async (port) => {
      calls.push(port);
      return { available: false, port, code: "EADDRINUSE" };
    },
  });
  assert.deepEqual(selected, {
    requestedPort: 4310,
    port: 0,
    fallback: true,
    code: "EADDRINUSE",
  });
  assert.deepEqual(calls, [4310]);
});

test("explicit desktop ports remain strict when fallback is disabled", async () => {
  const selected = await selectDesktopPort(4310, {
    allowFallback: false,
    checkPort: async () => ({ available: false, port: 4310, code: "EADDRINUSE" }),
  });
  assert.deepEqual(selected, {
    requestedPort: 4310,
    port: 4310,
    fallback: false,
    code: null,
  });
});
