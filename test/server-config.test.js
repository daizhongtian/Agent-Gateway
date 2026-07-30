import assert from "node:assert/strict";
import test from "node:test";
import { isLoopbackHost, loadServerConfig } from "../src/server/config.js";

test("server configuration normalizes local defaults, arrays, and legacy aliases", () => {
  const defaults = loadServerConfig({ env: {} });
  assert.equal(defaults.host, "127.0.0.1");
  assert.equal(defaults.port, 0);
  assert.equal(defaults.authMode, "none");
  assert.equal(defaults.loopback, true);

  const configured = loadServerConfig({
    env: {},
    host: "[::1]",
    allowedHosts: [" Example.COM. ", "localhost"],
    allowedProjectRoots: [" C:\\project ", ""],
    corsOrigins: [" https://app.example.com ", ""],
    imageUploadRoot: " C:\\uploads ",
    maxImageBytes: 2_048,
    imageUploadTtlMs: 10_000,
  });
  assert.deepEqual(configured.allowedHosts, ["example.com", "localhost"]);
  assert.deepEqual(configured.allowedProjectRoots, ["C:\\project"]);
  assert.deepEqual(configured.corsOrigins, ["https://app.example.com"]);
  assert.equal(configured.attachmentUploadRoot, "C:\\uploads");
  assert.equal(configured.maxFileBytes, 2_048);
  assert.equal(configured.attachmentUploadTtlMs, 10_000);
});

test("server token registries infer authentication for Map, array, object, and resolver sources", () => {
  const registries = [
    new Map([["map-token", {}]]),
    [{ token: "array-token" }, null, {}],
    { "object-token": {} },
  ];
  for (const tokens of registries) {
    assert.equal(loadServerConfig({ env: {}, tokens }).authMode, "token");
  }
  assert.equal(loadServerConfig({ env: {}, resolveToken: async () => null }).authMode, "token");
});

test("server configuration rejects invalid hostnames and numeric values", () => {
  for (const allowedHosts of ["", "bad host", "example.com:443", "x".repeat(254)]) {
    if (!allowedHosts) {
      assert.deepEqual(loadServerConfig({ env: {}, allowedHosts }).allowedHosts, []);
    } else {
      assert.throws(() => loadServerConfig({ env: {}, allowedHosts }), /valid hostnames/);
    }
  }
  for (const port of [-1, 1.5, 70_000]) {
    assert.throws(() => loadServerConfig({ env: {}, port }), /Invalid numeric server configuration/);
  }
});

test("loopback classification accepts IPv4 and IPv6 loopback forms only", () => {
  for (const host of ["localhost", "127.0.0.42", "[::1]", "0:0:0:0:0:0:0:1"]) {
    assert.equal(isLoopbackHost(host), true);
  }
  assert.equal(isLoopbackHost("0.0.0.0"), false);
});
