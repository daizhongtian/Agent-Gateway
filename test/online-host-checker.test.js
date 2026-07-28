import assert from "node:assert/strict";
import test from "node:test";
import {
  checkOnlineHost,
  checkOnlineHostWithRepair,
  normalizeOnlineHostProvider,
} from "../src/electron/online-host-checker.js";

const PROVIDER = Object.freeze({
  id: "tailscale-funnel",
  label: "Tailscale Funnel",
  baseUrl: "https://codex-host.example.ts.net/v1",
});

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("normalizes a provider into same-origin health and models probes", () => {
  assert.deepEqual(normalizeOnlineHostProvider(PROVIDER), {
    id: "tailscale-funnel",
    label: "Tailscale Funnel",
    baseUrl: "https://codex-host.example.ts.net/v1",
    healthUrl: "https://codex-host.example.ts.net/health",
    modelsUrl: "https://codex-host.example.ts.net/v1/models",
    forcePublicDns: false,
  });
  assert.throws(
    () => normalizeOnlineHostProvider({ ...PROVIDER, baseUrl: "http://127.0.0.1:4310/v1" }),
    /HTTPS URL/,
  );
  assert.throws(
    () => normalizeOnlineHostProvider({ ...PROVIDER, healthUrl: "https://other.example/health" }),
    /provider base URL origin/,
  );
});

test("verifies public health, OpenAI authentication, and Request ID without sending a key", async () => {
  const calls = [];
  const result = await checkOnlineHost(PROVIDER, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/health")) return jsonResponse(200, { ok: true });
      return jsonResponse(401, {
        error: { message: "Invalid API key.", type: "invalid_request_error", param: null, code: "invalid_api_key" },
      }, {
        "x-request-id": "req_0123456789abcdef0123456789abcdef",
        "www-authenticate": "Bearer realm=\"Agent Gateway\"",
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.online, true);
  assert.equal(result.apiReady, true);
  assert.equal(result.providerId, "tailscale-funnel");
  assert.equal(result.requestId, "req_0123456789abcdef0123456789abcdef");
  assert.deepEqual(result.checks.map(({ name, status, ok }) => ({ name, status, ok })), [
    { name: "health", status: 200, ok: true },
    { name: "models_auth", status: 401, ok: true },
  ]);
  assert.equal(calls.length, 2);
  assert.equal(calls.some(({ options }) => "authorization" in options.headers), false);
  assert.ok(calls.every(({ options }) => options.redirect === "error"));
});

test("reports a Host allowlist failure distinctly", async () => {
  const result = await checkOnlineHost(PROVIDER, {
    fetchImpl: async () => jsonResponse(421, {
      error: { code: "HOST_FORBIDDEN", message: "The request Host is not allowed." },
    }, { "x-request-id": "req_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.online, true);
  assert.equal(result.error.code, "ONLINE_HOST_NOT_ALLOWED");
  assert.equal(result.checks.length, 1);
});

test("treats an unauthenticated models success as a security failure", async () => {
  let call = 0;
  const result = await checkOnlineHost(PROVIDER, {
    fetchImpl: async () => {
      call += 1;
      return call === 1
        ? jsonResponse(200, { ok: true })
        : jsonResponse(200, { object: "list", data: [] }, { "x-request-id": "req_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ONLINE_HOST_AUTH_BYPASSED");
});

test("returns a safe unreachable result when the public request fails", async () => {
  const result = await checkOnlineHost(PROVIDER, {
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND private-internal-detail");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.online, false);
  assert.equal(result.error.code, "ONLINE_HOST_UNREACHABLE");
  assert.doesNotMatch(result.error.message, /private-internal-detail/);
});

test("forces Tailscale checks through public DNS instead of MagicDNS", async () => {
  const calls = [];
  const result = await checkOnlineHost({ ...PROVIDER, forcePublicDns: true }, {
    fetchImpl: async () => {
      throw new Error("The system resolver must not be used for public probes.");
    },
    resolvePublicAddresses: async (hostname) => {
      assert.equal(hostname, "codex-host.example.ts.net");
      return ["185.40.234.55", "185.40.234.75"];
    },
    publicFetchImpl: async (url, options, route) => {
      calls.push({ url, options, route });
      if (url.endsWith("/health")) return jsonResponse(200, { ok: true });
      return jsonResponse(401, {
        error: { message: "Invalid API key.", type: "invalid_request_error", param: null, code: "invalid_api_key" },
      }, {
        "x-request-id": "req_cccccccccccccccccccccccccccccccc",
        "www-authenticate": "Bearer realm=\"Agent Gateway\"",
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.networkPath, "public-edge");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ route }) => route.hostname === "codex-host.example.ts.net"));
  assert.ok(calls.every(({ route }) => route.addresses[0] === "185.40.234.55"));
});

test("rejects a Tailnet-only MagicDNS address as a public route", async () => {
  const result = await checkOnlineHost({ ...PROVIDER, forcePublicDns: true }, {
    resolvePublicAddresses: async () => ["100.84.17.19"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.online, false);
  assert.equal(result.networkPath, "public-edge");
  assert.equal(result.error.code, "ONLINE_HOST_PUBLIC_DNS_FAILED");
});

test("repairs a Funnel only after repeated public TLS failures and verifies recovery", async () => {
  let repaired = false;
  let repairCalls = 0;
  let publicCalls = 0;
  const result = await checkOnlineHostWithRepair({ ...PROVIDER, forcePublicDns: true }, {
    failureAttempts: 3,
    verificationAttempts: 1,
    retryDelayMs: 0,
    repairSettleMs: 0,
    waitImpl: async () => {},
    resolvePublicAddresses: async () => ["185.40.234.55"],
    publicFetchImpl: async (url) => {
      publicCalls += 1;
      if (!repaired) {
        const error = new Error("TLS handshake failed");
        error.code = "ONLINE_HOST_PUBLIC_TLS_FAILED";
        throw error;
      }
      if (url.endsWith("/health")) return jsonResponse(200, { ok: true });
      return jsonResponse(401, {
        error: { message: "Invalid API key.", type: "invalid_request_error", param: null, code: "invalid_api_key" },
      }, {
        "x-request-id": "req_dddddddddddddddddddddddddddddddd",
        "www-authenticate": "Bearer realm=\"Agent Gateway\"",
      });
    },
    repair: async () => {
      repairCalls += 1;
      repaired = true;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.repair, { attempted: true, succeeded: true });
  assert.equal(repairCalls, 1);
  assert.equal(publicCalls, 5);
});

