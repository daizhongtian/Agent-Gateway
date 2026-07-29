import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PlatformClient } from "../src/electron/platform-client.js";

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
