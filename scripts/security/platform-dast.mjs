import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const composeFile = path.join(root, "platform", "compose.yaml");
const profile = process.argv.includes("--quick") ? "quick" : "full";
const suffix = `${process.pid}-${randomBytes(3).toString("hex")}`;
const project = `agent-gateway-security-${suffix}`;
const platformPort = 20_000 + (process.pid % 10_000);
const postgresPort = 30_000 + (process.pid % 10_000);
const baseUrl = `http://127.0.0.1:${platformPort}`;
const password = `Dast-${randomBytes(18).toString("base64url")}!`;
const composeEnvironment = {
  ...process.env,
  PLATFORM_PORT: String(platformPort),
  POSTGRES_PORT: String(postgresPort),
  POSTGRES_PASSWORD: randomBytes(32).toString("base64url"),
  FRONTEND_ORIGIN: baseUrl,
  PUBLIC_HOST_URL_TEMPLATE: `${baseUrl}/h/{slug}/v1`,
  SECURE_COOKIES: "false",
  RELAY_ENABLED: "false",
  LOCAL_PROXY_ENABLED: "false",
};

function compose(...args) {
  assert.match(project, /^agent-gateway-security-[a-z0-9-]+$/, "unsafe disposable Compose project name");
  const result = spawnSync("docker", ["compose", "-f", composeFile, "-p", project, ...args], {
    cwd: root,
    env: composeEnvironment,
    encoding: "utf8",
    stdio: args.includes("logs") ? "pipe" : "inherit",
    timeout: 10 * 60_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`docker compose ${args.join(" ")} failed with exit code ${result.status}`);
  return result.stdout ?? "";
}

async function request(route, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${route}`, { redirect: "manual", ...options, headers, signal: AbortSignal.timeout(15_000) });
}

async function jsonRequest(route, options = {}) {
  const response = await request(route, options);
  let body = null;
  try { body = await response.json(); } catch { /* Negative tests can return an empty body. */ }
  return { response, body };
}

async function register(label, termsVersion, clientType = "desktop") {
  const email = `security-${label}-${suffix}@example.invalid`;
  const result = await jsonRequest("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      displayName: `Security ${label}`,
      clientType,
      termsAccepted: true,
      termsVersion,
    }),
  });
  assert.equal(result.response.status, 201, `register ${label}: ${JSON.stringify(result.body)}`);
  if (clientType === "desktop") assert.ok(result.body?.accessToken, "desktop registration must issue an access token");
  else assert.equal(result.body?.accessToken, undefined, "browser registration leaked an access token into JSON");
  return {
    email,
    accessToken: result.body.accessToken,
    csrfToken: result.body.csrfToken,
    cookie: (result.response.headers.getSetCookie?.() ?? [])
      .map((value) => value.split(";", 1)[0])
      .join("; "),
  };
}

function bearer(session) {
  return { authorization: `Bearer ${session.accessToken}` };
}

async function expectNoServerError(route, options, label) {
  const response = await request(route, options);
  assert.ok(response.status < 500, `${label} returned ${response.status}`);
  return response;
}

async function waitForHealth(attempts = 45) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await request("/api/v1/health");
      if (response.ok) return;
    } catch { /* Container is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("platform did not recover before the health deadline");
}

async function run() {
  console.log(`Starting disposable ${profile} security environment ${project} on ${baseUrl}`);
  compose("up", "-d", "--build", "--wait");

  const health = await request("/api/v1/health");
  assert.equal(health.status, 200);
  assert.match(health.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  const frameOptions = (health.headers.get("x-frame-options") ?? "")
    .split(",")
    .map((value) => value.trim());
  assert.ok(frameOptions.length > 0 && frameOptions.every((value) => value === "DENY"));
  assert.ok(health.headers.get("x-request-id"));
  const hostileOrigin = await request("/api/v1/health", { headers: { origin: "https://attacker.invalid" } });
  assert.equal(hostileOrigin.status, 403, "untrusted CORS origin was accepted");
  assert.equal(hostileOrigin.headers.get("access-control-allow-origin"), null, "untrusted CORS origin was reflected");

  const anonymous = await request("/api/v1/devices");
  assert.equal(anonymous.status, 401);
  const config = await jsonRequest("/api/v1/platform/config");
  assert.equal(config.response.status, 200);
  assert.match(config.body?.termsVersion ?? "", /^\d{4}-\d{2}-\d{2}$/);
  const normalUser = await register("tenant-a", config.body.termsVersion);
  const otherUser = await register("tenant-b", config.body.termsVersion);
  const browserUser = await register("browser-csrf", config.body.termsVersion, "browser");

  const csrfRejected = await request("/api/v1/account", {
    method: "PATCH",
    headers: { cookie: browserUser.cookie },
    body: JSON.stringify({ displayName: "CSRF should fail" }),
  });
  assert.equal(csrfRejected.status, 403, "cookie state change without CSRF was accepted");

  const created = await jsonRequest("/api/v1/devices", {
    method: "POST",
    headers: bearer(normalUser),
    body: JSON.stringify({ name: "Disposable security device", platform: "windows" }),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const deviceId = created.body.id;

  for (const [method, route] of [
    ["PATCH", `/api/v1/devices/${deviceId}`],
    ["POST", `/api/v1/devices/${deviceId}/pairing-code`],
    ["DELETE", `/api/v1/devices/${deviceId}`],
  ]) {
    const result = await request(route, {
      method,
      headers: bearer(otherUser),
      body: method === "PATCH" ? JSON.stringify({ name: "Cross tenant" }) : undefined,
    });
    assert.ok([403, 404].includes(result.status), `cross-tenant ${method} ${route} returned ${result.status}`);
  }

  const admin = await request("/api/v1/admin/overview", { headers: bearer(normalUser) });
  assert.equal(admin.status, 403, "normal user reached admin overview");
  const relayUnknown = await request("/h/not-a-host/v1/files");
  assert.equal(relayUnknown.status, 404, "an unapproved relay route was exposed");

  const malformedCases = [
    ["invalid JSON", "/api/v1/auth/login", { method: "POST", body: "{" }],
    ["wrong content type", "/api/v1/auth/login", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }],
    ["oversized email", "/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email: `${"x".repeat(400)}@invalid`, password }) }],
    ["invalid UUID", "/api/v1/devices/not-a-uuid", { method: "DELETE", headers: bearer(normalUser) }],
    ["path traversal identifier", "/api/v1/devices/..%2F..%2Fadmin", { method: "DELETE", headers: bearer(normalUser) }],
    ["unknown property flood", "/api/v1/devices", { method: "POST", headers: bearer(normalUser), body: JSON.stringify(Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`p${index}`, "x"]))) }],
    ["deep JSON", "/api/v1/auth/login", { method: "POST", body: `${"[".repeat(80)}0${"]".repeat(80)}` }],
  ];
  for (const [label, route, options] of malformedCases) await expectNoServerError(route, options, label);

  const bursts = await Promise.all(Array.from({ length: 100 }, () => request("/api/v1/health")));
  assert.equal(bursts.filter((response) => response.status >= 500).length, 0, "health burst caused server failures");
  await waitForHealth(5);

  let rateLimited = false;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const response = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: `missing-${suffix}@example.invalid`, password }),
    });
    if (response.status === 429) {
      rateLimited = true;
      assert.ok(Number(response.headers.get("retry-after")) >= 1);
      break;
    }
  }
  assert.equal(rateLimited, true, "sensitive login endpoint did not rate limit the request burst");

  if (profile === "full") {
    compose("restart", "backend");
    await waitForHealth();
    let devices = await jsonRequest("/api/v1/devices", { headers: bearer(normalUser) });
    assert.equal(devices.response.status, 200);
    assert.ok(devices.body.some((device) => device.id === deviceId), "backend restart lost persisted device data");

    compose("restart", "database", "backend");
    await waitForHealth();
    devices = await jsonRequest("/api/v1/devices", { headers: bearer(normalUser) });
    assert.equal(devices.response.status, 200);
    assert.ok(devices.body.some((device) => device.id === deviceId), "database restart lost persisted device data");
  }

  console.log(`Disposable ${profile} platform DAST passed.`);
}

let failure;
try {
  await run();
} catch (error) {
  failure = error;
  try {
    const logs = compose("logs", "--no-color");
    console.error(logs.slice(-30_000));
  } catch (logError) {
    console.error(`Could not capture Compose logs: ${logError.message}`);
  }
} finally {
  try { compose("down", "--volumes", "--remove-orphans"); } catch (cleanupError) {
    if (!failure) failure = cleanupError;
    else console.error(`Cleanup also failed: ${cleanupError.message}`);
  }
}
if (failure) throw failure;
