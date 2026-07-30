import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PlatformClient, PlatformRequestError } from "../src/electron/platform-client.js";

const protector = Object.freeze({
  encrypt: (value) => Buffer.from(value, "utf8").toString("base64"),
  decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
});

function jsonResponse(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? {} : { "content-type": "application/json" },
  });
}

function authResponse() {
  return {
    user: { id: "user-1", email: "owner@example.com", displayName: "owner" },
    accessToken: "ccc_at_secret-access",
    refreshToken: "ccc_rt_secret-refresh",
    accessExpiresAt: "2026-07-27T22:00:00Z",
    refreshExpiresAt: "2026-08-27T22:00:00Z",
  };
}

test("desktop platform registration sends explicit legal consent and restores the encrypted session", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cag-platform-session-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/auth/register")) return jsonResponse(authResponse(), 201);
    if (pathname.endsWith("/auth/session")) return jsonResponse({ user: authResponse().user, accessExpiresAt: null });
    if (pathname.endsWith("/hosts")) return jsonResponse([]);
    return jsonResponse({ error: { code: "UNEXPECTED", message: pathname } }, 500);
  };

  const first = new PlatformClient({
    userDataPath: directory,
    secretProtector: protector,
    fetchImpl,
    baseUrl: "http://localhost:8088",
    appVersion: "3.0.0",
  });
  const registered = await first.register("Owner@Example.com", "a-secure-password", {
    termsAccepted: true,
    termsVersion: "2026-07-29",
  });
  assert.equal(registered.signedIn, true);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    email: "owner@example.com",
    password: "a-secure-password",
    clientType: "desktop",
    termsAccepted: true,
    termsVersion: "2026-07-29",
  });
  const stored = readFileSync(path.join(directory, "platform-session.json"), "utf8");
  assert.equal(stored.includes("ccc_rt_secret-refresh"), false);

  const restored = new PlatformClient({ userDataPath: directory, secretProtector: protector, fetchImpl });
  const status = await restored.getStatus();
  assert.equal(status.signedIn, true);
  assert.equal(status.user.email, "owner@example.com");
  assert.equal(calls[1].init.headers.Authorization, "Bearer ccc_at_secret-access");
});

test("platform credentials can use HTTP only for the localhost development platform", () => {
  assert.throws(
    () => new PlatformClient({
      userDataPath: os.tmpdir(),
      secretProtector: protector,
      baseUrl: "http://platform.example.com",
    }),
    /must use HTTPS/,
  );
  assert.doesNotThrow(() => new PlatformClient({
    userDataPath: os.tmpdir(),
    secretProtector: protector,
    baseUrl: "http://127.0.0.1:8088",
  }));

  for (const baseUrl of [
    "ftp://platform.example.com",
    "https://owner:secret@platform.example.com",
    "https://platform.example.com?tenant=other",
    "https://platform.example.com#session",
  ]) {
    assert.throws(
      () => new PlatformClient({ userDataPath: os.tmpdir(), secretProtector: protector, baseUrl }),
      /must use HTTPS/,
    );
  }
  assert.throws(() => new PlatformClient({ secretProtector: protector }), /requires storage/);
  assert.throws(
    () => new PlatformClient({ userDataPath: os.tmpdir(), secretProtector: {}, fetchImpl: null }),
    /requires storage/,
  );
});

test("platform credential validation rejects malformed and unsafe account input", async () => {
  const client = new PlatformClient({
    userDataPath: os.tmpdir(),
    secretProtector: protector,
    fetchImpl: async () => assert.fail("invalid credentials must not reach the platform"),
  });

  await assert.rejects(() => client.login("not-an-email", "secret"), /valid email/);
  await assert.rejects(() => client.login(`${"a".repeat(315)}@x.test`, "secret"), /valid email/);
  await assert.rejects(() => client.login("owner@example.com", ""), /Enter your password/);
  await assert.rejects(() => client.login("owner@example.com", "x".repeat(73)), /Enter your password/);
  await assert.rejects(() => client.register("owner@example.com", "too-short"), /at least 12/);
});

test("desktop browser authorization exchanges only the one-time code and PKCE verifier", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cag-platform-browser-exchange-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const client = new PlatformClient({
    userDataPath: directory,
    secretProtector: protector,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(authResponse());
    },
  });

  const status = await client.exchangeDesktopAuthorization("ccc_dac_one-time", "a".repeat(64));

  assert.equal(status.signedIn, true);
  assert.equal(new URL(calls[0].url).pathname, "/api/v1/auth/desktop/exchange");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    code: "ccc_dac_one-time",
    codeVerifier: "a".repeat(64),
  });
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test("Online Host automatically enrolls the desktop, pairs it, creates a Host, and enables it", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cag-platform-online-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const paths = [];
  const host = {
    id: "host-1",
    deviceId: "device-1",
    displayName: "Test PC Host",
    status: "offline",
    desiredOnline: false,
    openAiBaseUrl: "http://localhost:8088/h/h-test/v1",
  };
  const fetchImpl = async (url, init) => {
    const pathname = new URL(url).pathname;
    paths.push(`${init.method} ${pathname}`);
    if (pathname.endsWith("/auth/login")) return jsonResponse(authResponse());
    if (pathname.endsWith("/devices") && init.method === "GET") return jsonResponse([]);
    if (pathname.endsWith("/devices") && init.method === "POST") {
      return jsonResponse({ id: "device-1", name: "Test PC", status: "pending" }, 201);
    }
    if (pathname.endsWith("/pairing-code")) return jsonResponse({ code: "ABCD-1234", deviceId: "device-1" });
    if (pathname.endsWith("/desktop/pair")) return jsonResponse({ deviceId: "device-1", deviceSecret: "device-secret" });
    if (pathname.endsWith("/hosts") && init.method === "GET") return jsonResponse([]);
    if (pathname.endsWith("/hosts") && init.method === "POST") return jsonResponse(host, 201);
    if (pathname.endsWith("/hosts/host-1") && init.method === "PATCH") {
      return jsonResponse({ ...host, status: "online", desiredOnline: true });
    }
    return jsonResponse({ error: { code: "UNEXPECTED", message: pathname } }, 500);
  };
  const client = new PlatformClient({
    userDataPath: directory,
    secretProtector: protector,
    fetchImpl,
    deviceName: "Test PC",
    appVersion: "3.0.0",
  });
  await client.login("owner@example.com", "a-secure-password", {
    termsAccepted: true,
    termsVersion: "2026-07-29",
  });
  const result = await client.setOnline(true);

  assert.equal(result.online, true);
  assert.equal(result.host.openAiBaseUrl, "http://localhost:8088/h/h-test/v1");
  assert.deepEqual(paths, [
    "POST /api/v1/auth/login",
    "GET /api/v1/devices",
    "POST /api/v1/devices",
    "POST /api/v1/devices/device-1/pairing-code",
    "POST /api/v1/desktop/pair",
    "GET /api/v1/hosts",
    "POST /api/v1/hosts",
    "PATCH /api/v1/hosts/host-1",
  ]);
});

test("expired access tokens refresh once and retry with the new access token", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cag-platform-refresh-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  let sessionAttempts = 0;
  const client = new PlatformClient({
    userDataPath: directory,
    secretProtector: protector,
    fetchImpl: async (url, init) => {
      const pathname = new URL(url).pathname;
      calls.push({ pathname, authorization: init.headers.Authorization, body: init.body });
      if (pathname.endsWith("/auth/login")) return jsonResponse(authResponse());
      if (pathname.endsWith("/auth/refresh")) {
        return jsonResponse({ ...authResponse(), accessToken: "ccc_at_refreshed" });
      }
      if (pathname.endsWith("/auth/session") && sessionAttempts++ === 0) {
        return jsonResponse({ error: { code: "ACCESS_EXPIRED", message: "expired" } }, 401);
      }
      if (pathname.endsWith("/auth/session")) return jsonResponse({ user: authResponse().user });
      if (pathname.endsWith("/hosts")) return jsonResponse([]);
      return jsonResponse(null, 204);
    },
  });

  await client.login("owner@example.com", "a-secure-password");
  const status = await client.getStatus();

  assert.equal(status.signedIn, true);
  assert.deepEqual(JSON.parse(calls[2].body), {
    refreshToken: "ccc_rt_secret-refresh",
    clientType: "desktop",
  });
  assert.equal(calls[4].authorization, "Bearer ccc_at_refreshed");
  assert.equal(calls.filter((call) => call.pathname.endsWith("/auth/refresh")).length, 1);
});

test("invalid platform sessions are cleared while temporary outages preserve sign-in", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cag-platform-status-errors-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let behavior = "login";
  const client = new PlatformClient({
    userDataPath: directory,
    secretProtector: protector,
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith("/auth/login")) return jsonResponse(authResponse());
      if (behavior === "offline") throw new Error("network down");
      if (behavior === "forbidden") {
        return jsonResponse({ error: { code: "SESSION_REVOKED", message: "revoked" } }, 403);
      }
      return jsonResponse({ error: { code: "UNEXPECTED", message: pathname } }, 500);
    },
  });

  await client.login("owner@example.com", "a-secure-password");
  behavior = "offline";
  const offline = await client.getStatus();
  assert.equal(offline.signedIn, true);
  assert.equal(offline.error.code, "PLATFORM_UNREACHABLE");

  behavior = "forbidden";
  const revoked = await client.getStatus();
  assert.equal(revoked.signedIn, false);
  assert.equal(revoked.error.code, "SESSION_REVOKED");
});

test("logout always clears local credentials and incomplete sessions are rejected", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cag-platform-logout-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let offline = false;
  const client = new PlatformClient({
    userDataPath: directory,
    secretProtector: protector,
    fetchImpl: async (url) => {
      if (offline) throw new Error("platform unavailable");
      if (new URL(url).pathname.endsWith("/auth/login")) return jsonResponse(authResponse());
      return jsonResponse(null, 204);
    },
  });
  await client.login("owner@example.com", "a-secure-password");
  offline = true;
  assert.equal((await client.logout()).signedIn, false);

  const incomplete = new PlatformClient({
    userDataPath: directory,
    secretProtector: protector,
    fetchImpl: async () => jsonResponse({ accessToken: "only-one-field" }),
  });
  await assert.rejects(
    () => incomplete.login("owner@example.com", "a-secure-password"),
    /incomplete desktop session/,
  );
});

test("Online Host reuses devices and hosts, enables disabled hosts, and can disable them", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cag-platform-existing-host-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const requests = [];
  const device = { id: "device-existing", name: "Office PC", status: "active" };
  const disabledHost = {
    id: "host-existing",
    deviceId: device.id,
    displayName: "Office Host",
    status: "disabled",
    desiredOnline: false,
  };
  let desiredOnline = false;
  const client = new PlatformClient({
    userDataPath: directory,
    secretProtector: protector,
    fetchImpl: async (url, init) => {
      const pathname = new URL(url).pathname;
      requests.push(`${init.method} ${pathname}`);
      if (pathname.endsWith("/auth/login")) return jsonResponse(authResponse());
      if (pathname.endsWith("/devices")) return jsonResponse([device]);
      if (pathname.endsWith("/hosts") && init.method === "GET") {
        return jsonResponse([{ ...disabledHost, status: desiredOnline ? "online" : "disabled", desiredOnline }]);
      }
      if (pathname.endsWith("/enable")) return jsonResponse({ ...disabledHost, status: "offline" });
      if (pathname.endsWith("/hosts/host-existing") && init.method === "PATCH") {
        desiredOnline = JSON.parse(init.body).desiredOnline;
        return jsonResponse({ ...disabledHost, status: desiredOnline ? "online" : "offline", desiredOnline });
      }
      return jsonResponse({ error: { code: "UNEXPECTED", message: pathname } }, 500);
    },
  });

  await client.login("owner@example.com", "a-secure-password");
  assert.equal((await client.setOnline(true)).online, true);
  assert.equal((await client.setOnline(false)).online, false);
  assert.equal(requests.some((entry) => entry.includes("pairing-code")), false);
  assert.equal(requests.includes("POST /api/v1/hosts/host-existing/enable"), true);
});

test("Online Host requires authentication and handles absent hosts during disable", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cag-platform-disable-empty-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const client = new PlatformClient({
    userDataPath: directory,
    secretProtector: protector,
    fetchImpl: async (url) => {
      if (new URL(url).pathname.endsWith("/auth/login")) return jsonResponse(authResponse());
      return jsonResponse([]);
    },
  });

  await assert.rejects(
    () => client.setOnline(true),
    (error) => error instanceof PlatformRequestError
      && error.status === 401
      && error.code === "PLATFORM_LOGIN_REQUIRED",
  );
  await client.login("owner@example.com", "a-secure-password");
  const result = await client.setOnline(false);
  assert.equal(result.host, null);
  assert.equal(result.online, false);
});

test("corrupt or unsupported persisted sessions are ignored safely", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cag-platform-corrupt-session-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sessionPath = path.join(directory, "platform-session.json");

  for (const content of [
    "not json",
    JSON.stringify({ version: 2, encrypted: "ignored" }),
    JSON.stringify({ version: 1, encrypted: protector.encrypt("not json") }),
  ]) {
    writeFileSync(sessionPath, content, "utf8");
    const client = new PlatformClient({ userDataPath: directory, secretProtector: protector });
    assert.equal(client.status().signedIn, false);
  }
});
