import assert from "node:assert/strict";
import test from "node:test";
import {
  closeBrowserAuthorizationServer,
  runPlatformBrowserAuthorization,
} from "../src/electron/platform-browser-auth.js";

test("browser authorization server cleanup cannot block the desktop IPC indefinitely", async () => {
  const calls = [];
  const server = {
    listening: true,
    close: () => calls.push("close"),
    closeIdleConnections: () => calls.push("idle"),
    closeAllConnections: () => calls.push("all"),
  };

  await closeBrowserAuthorizationServer(server, 10);

  assert.deepEqual(calls, ["close", "idle", "all"]);
});

test("browser authorization uses a loopback callback, state, and PKCE without putting tokens in the URL", async () => {
  let opened;
  let exchanged;
  const result = await runPlatformBrowserAuthorization({
    platformBaseUrl: "http://localhost:8088",
    timeoutMs: 2_000,
    openExternal: async (value) => {
      opened = new URL(value);
      const callback = new URL("http://127.0.0.1/callback");
      callback.port = opened.searchParams.get("callback_port");
      callback.searchParams.set("state", opened.searchParams.get("state"));
      callback.searchParams.set("code", "ccc_dac_one-time-code");
      const response = await fetch(callback);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("connection"), "close");
    },
    exchangeAuthorization: async (code, verifier) => {
      exchanged = { code, verifier };
      return { signedIn: true };
    },
  });

  assert.equal(opened.origin, "http://localhost:8088");
  assert.equal(opened.searchParams.get("desktop_auth"), "1");
  assert.match(opened.searchParams.get("state"), /^[A-Za-z0-9_-]{43}$/);
  assert.match(opened.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(opened.searchParams.has("access_token"), false);
  assert.equal(exchanged.code, "ccc_dac_one-time-code");
  assert.match(exchanged.verifier, /^[A-Za-z0-9_-]{64}$/);
  assert.deepEqual(result, { signedIn: true });
});

test("browser authorization ignores a callback with the wrong state", async () => {
  await assert.rejects(
    runPlatformBrowserAuthorization({
      platformBaseUrl: "http://localhost:8088",
      timeoutMs: 80,
      openExternal: async (value) => {
        const opened = new URL(value);
        const callback = new URL("http://127.0.0.1/callback?state=wrong&code=stolen");
        callback.port = opened.searchParams.get("callback_port");
        const response = await fetch(callback);
        assert.equal(response.status, 400);
      },
      exchangeAuthorization: async () => assert.fail("wrong-state callback must not be exchanged"),
    }),
    /timed out/,
  );
});
