import assert from "node:assert/strict";
import test from "node:test";
import {
  checkOnlineHost,
  checkOnlineHostWithRepair,
  isPublicIpv4,
  isPublicOnlineOrigin,
  normalizeOnlineHostProvider,
  resolvePublicIpv4,
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
    requirePublicOrigin: false,
  });
  assert.throws(
    () => normalizeOnlineHostProvider({ ...PROVIDER, baseUrl: "http://127.0.0.1:4310/v1" }),
    /HTTPS URL/,
  );
  assert.throws(
    () => normalizeOnlineHostProvider({ ...PROVIDER, healthUrl: "https://other.example/health" }),
    /provider base URL origin/,
  );

  for (const provider of [
    { ...PROVIDER, id: "Not Valid!" },
    { ...PROVIDER, label: "" },
    { ...PROVIDER, label: "x".repeat(81) },
    { ...PROVIDER, baseUrl: "https://owner:secret@example.com/v1" },
    { ...PROVIDER, baseUrl: "https://example.com/v1?unsafe=true" },
    { ...PROVIDER, modelsUrl: "https://other.example/v1/models" },
  ]) {
    assert.throws(() => normalizeOnlineHostProvider(provider), TypeError);
  }

  assert.equal(normalizeOnlineHostProvider({
    ...PROVIDER,
    baseUrl: "http://localhost:8088/custom///",
    allowLoopbackHttp: true,
  }).baseUrl, "http://localhost:8088/custom");
});

test("public origin classification excludes local, reserved, and documentation networks", () => {
  const privateAddresses = [
    "not-an-ip", "0.0.0.0", "10.1.2.3", "100.64.1.1", "127.0.0.1", "169.254.1.1",
    "172.16.0.1", "192.168.1.1", "198.18.0.1", "192.0.2.1", "198.51.100.1",
    "203.0.113.1", "224.0.0.1",
  ];
  for (const address of privateAddresses) assert.equal(isPublicIpv4(address), false, address);
  assert.equal(isPublicIpv4("1.1.1.1"), true);

  const nonPublicOrigins = [
    "invalid", "http://api.example.com/v1", "https://localhost/v1", "https://host.local/v1",
    "https://127.0.0.1/v1", "https://[::1]/v1", "https://[fc00::1]/v1", "https://single-label/v1",
  ];
  for (const origin of nonPublicOrigins) assert.equal(isPublicOnlineOrigin(origin), false, origin);
  assert.equal(isPublicOnlineOrigin(new URL("https://1.1.1.1/v1")), true);
  assert.equal(isPublicOnlineOrigin("https://[2606:4700:4700::1111]/v1"), true);
});

test("public DNS resolution falls back, filters unsafe answers, and removes duplicates", async () => {
  const urls = [];
  const addresses = await resolvePublicIpv4("gateway.example.com", {
    fetchImpl: async (url, init) => {
      urls.push(url.href);
      assert.equal(init.headers.Accept, "application/dns-json");
      if (urls.length === 1) return jsonResponse(503, { error: "try fallback" });
      return jsonResponse(200, {
        Answer: [
          { type: 1, data: "1.1.1.1" },
          { type: 1, data: "1.1.1.1" },
          { type: 1, data: "100.64.0.1" },
          { type: 28, data: "2606:4700:4700::1111" },
        ],
      });
    },
  });

  assert.deepEqual(addresses, ["1.1.1.1"]);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /name=gateway.example.com/);
  assert.match(urls[1], /type=A/);
  assert.equal(Object.isFrozen(addresses), true);
});

test("public DNS resolution reports a stable failure without leaking resolver errors", async () => {
  await assert.rejects(
    () => resolvePublicIpv4("gateway.example.com", {
      fetchImpl: async () => {
        throw new Error("internal resolver detail");
      },
    }),
    (error) => error.code === "ONLINE_HOST_PUBLIC_DNS_FAILED"
      && !error.message.includes("internal resolver detail"),
  );
  await assert.rejects(
    () => resolvePublicIpv4("gateway.example.com", { fetchImpl: {} }),
    /DNS fetch implementation is required/,
  );
});

test("refuses to label a localhost development route as an Online Host", async () => {
  let probeCalls = 0;
  const result = await checkOnlineHost({
    id: "coding-agent-platform",
    label: "Agent Gateway Platform",
    baseUrl: "http://localhost:8088/h/dev-host/v1",
    healthUrl: "http://localhost:8088/h/dev-host/health",
    modelsUrl: "http://localhost:8088/h/dev-host/v1/models",
    allowLoopbackHttp: true,
    requirePublicOrigin: true,
  }, {
    fetchImpl: async () => {
      probeCalls += 1;
      return jsonResponse(200, { ok: true });
    },
  });

  assert.equal(isPublicOnlineOrigin("http://localhost:8088/h/dev-host/v1"), false);
  assert.equal(isPublicOnlineOrigin("https://api.example.com/v1"), true);
  assert.equal(result.ok, false);
  assert.equal(result.online, false);
  assert.equal(result.error.code, "ONLINE_HOST_NOT_PUBLIC");
  assert.equal(probeCalls, 0);
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

test("health and models probes classify timeout, route, and Request ID failures", async () => {
  const healthFailure = await checkOnlineHost(PROVIDER, {
    fetchImpl: async () => jsonResponse(503, { error: { message: "  maintenance  " } }),
  });
  assert.equal(healthFailure.error.code, "ONLINE_HOST_HEALTH_FAILED");
  assert.equal(healthFailure.error.message, "maintenance");

  let call = 0;
  const invalidRequestId = await checkOnlineHost(PROVIDER, {
    fetchImpl: async () => (++call === 1
      ? jsonResponse(200, { ok: true })
      : jsonResponse(401, { error: { code: "invalid_api_key" } }, {
        "www-authenticate": "Bearer",
        "x-request-id": "not-a-request-id",
      })),
  });
  assert.equal(invalidRequestId.error.code, "OPENAI_ROUTE_NOT_READY");

  call = 0;
  const modelHostRejected = await checkOnlineHost(PROVIDER, {
    fetchImpl: async () => (++call === 1
      ? jsonResponse(200, { ok: true })
      : jsonResponse(421, { error: { code: "HOST_FORBIDDEN" } })),
  });
  assert.equal(modelHostRejected.error.code, "ONLINE_HOST_NOT_ALLOWED");

  const timeout = await checkOnlineHost(PROVIDER, {
    timeoutMs: 1,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  });
  assert.equal(timeout.error.code, "ONLINE_HOST_TIMEOUT");
});

test("models probe failures distinguish timeout and public TLS failures", async () => {
  let call = 0;
  const timeout = await checkOnlineHost(PROVIDER, {
    timeoutMs: 1,
    fetchImpl: async (_url, init) => {
      call += 1;
      if (call === 1) return jsonResponse(200, { ok: true });
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    },
  });
  assert.equal(timeout.error.code, "OPENAI_ROUTE_TIMEOUT");

  call = 0;
  const publicTls = await checkOnlineHost({ ...PROVIDER, forcePublicDns: true }, {
    resolvePublicAddresses: async () => ["1.1.1.1"],
    publicFetchImpl: async () => {
      call += 1;
      if (call === 1) return jsonResponse(200, { ok: true });
      const error = new Error("handshake failed");
      error.code = "ONLINE_HOST_PUBLIC_TLS_FAILED";
      throw error;
    },
  });
  assert.equal(publicTls.error.code, "OPENAI_ROUTE_PUBLIC_TLS_FAILED");
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

test("automatic repair reports repair errors and failed verification", async () => {
  const tlsFailure = async () => {
    const error = new Error("TLS failed");
    error.code = "ONLINE_HOST_PUBLIC_TLS_FAILED";
    throw error;
  };
  const baseOptions = {
    failureAttempts: 1,
    verificationAttempts: 2,
    retryDelayMs: 1,
    repairSettleMs: 1,
    resolvePublicAddresses: async () => ["1.1.1.1"],
    publicFetchImpl: tlsFailure,
  };

  const noRepair = await checkOnlineHostWithRepair({ ...PROVIDER, forcePublicDns: true }, baseOptions);
  assert.equal(noRepair.error.code, "ONLINE_HOST_PUBLIC_TLS_FAILED");
  assert.equal(noRepair.repair, undefined);

  const repairError = await checkOnlineHostWithRepair({ ...PROVIDER, forcePublicDns: true }, {
    ...baseOptions,
    repair: async () => { throw new Error("service restart denied"); },
  });
  assert.equal(repairError.error.code, "ONLINE_HOST_REPAIR_FAILED");
  assert.match(repairError.error.message, /service restart denied/);
  assert.deepEqual(repairError.repair, { attempted: true, succeeded: false });

  const waits = [];
  const verificationFailure = await checkOnlineHostWithRepair({ ...PROVIDER, forcePublicDns: true }, {
    ...baseOptions,
    waitImpl: async (milliseconds) => waits.push(milliseconds),
    repair: async () => {},
  });
  assert.equal(verificationFailure.ok, false);
  assert.deepEqual(verificationFailure.repair, { attempted: true, succeeded: false });
  assert.deepEqual(waits, [1, 1]);
});

