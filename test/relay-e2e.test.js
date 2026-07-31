import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { RelayAgent } from "../src/electron/relay-agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELAY_SERVER = path.resolve(__dirname, "../platform/relay/src/server.js");
const SECRET = "relay-test-secret-that-is-longer-than-thirty-two-characters";
const SLUG = "h-relaytest1234567890";
const REQUEST_ID = `req_${"a".repeat(32)}`;

test("public Relay forwards authenticated GET and POST requests to the desktop loopback Gateway", async (t) => {
  const presence = { assignment: null, ready: false, disconnects: 0 };
  const backend = http.createServer(async (request, response) => {
    assert.equal(request.headers["x-relay-secret"], SECRET);
    const url = new URL(request.url, "http://backend.test");
    if (url.pathname === "/internal/v1/relay/admit") {
      const body = await jsonBody(request);
      assert.equal(body.token, "ccc_tunnel_test-token");
      return writeJson(response, 200, {
        hostId: "11111111-1111-4111-8111-111111111111",
        deviceId: "22222222-2222-4222-8222-222222222222",
        slug: SLUG,
        protocolVersion: 1,
      });
    }
    if (url.pathname === "/internal/v1/relay/ready") {
      const body = await jsonBody(request);
      presence.assignment = body.assignment;
      presence.ready = true;
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === "/internal/v1/relay/heartbeat") {
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === "/internal/v1/relay/disconnect") {
      const body = await jsonBody(request);
      if (body.assignment === presence.assignment) presence.ready = false;
      presence.disconnects += 1;
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === `/internal/v1/relay/hosts/${SLUG}/authorize`) {
      return writeJson(response, 200, {
        allowed: presence.ready && url.searchParams.get("assignment") === presence.assignment,
      });
    }
    writeJson(response, 404, { error: { code: "NOT_FOUND" } });
  });

  const gatewayCalls = [];
  const gateway = http.createServer(async (request, response) => {
    const body = await textBody(request);
    gatewayCalls.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
    if (request.method === "GET" && request.url === "/v1/models") {
      return writeJson(response, 401, {
        error: { code: "invalid_api_key", message: "Invalid Gateway Key" },
      }, {
        "WWW-Authenticate": "Bearer",
        "X-Request-Id": REQUEST_ID,
      });
    }
    if (request.method === "POST" && request.url === "/v1/responses") {
      return writeJson(response, 200, { ok: true, received: JSON.parse(body) }, { "X-Request-Id": REQUEST_ID });
    }
    writeJson(response, 404, { error: { code: "NOT_FOUND" } });
  });

  const backendAddress = await listen(backend);
  const gatewayAddress = await listen(gateway);
  const relayPort = await reservePort();
  const child = spawn(process.execPath, [RELAY_SERVER], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(relayPort),
      BACKEND_URL: `http://127.0.0.1:${backendAddress.port}`,
      RELAY_INTERNAL_SECRET: SECRET,
      RELAY_NODE_ID: "relay-e2e",
      PUBLIC_HOST_DOMAIN: "api.example.test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childOutput = "";
  child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

  const agent = new RelayAgent({ reconnectBaseMs: 50 });
  t.after(async () => {
    agent.close();
    child.kill();
    await Promise.all([close(backend), close(gateway)]);
  });

  await waitFor(async () => (await fetch(`http://127.0.0.1:${relayPort}/health`).catch(() => null))?.ok, 5000, childOutput);
  await agent.start({
    localPort: gatewayAddress.port,
    getTicket: async () => ({
      token: "ccc_tunnel_test-token",
      relayUrl: `ws://127.0.0.1:${relayPort}/agent`,
      protocolVersion: 1,
    }),
  });

  const health = await fetch(`http://127.0.0.1:${relayPort}/h/${SLUG}/health`);
  const healthPayload = await health.json();
  if (health.status !== 200) throw new Error(`${JSON.stringify(healthPayload)}\n${childOutput}`);
  assert.equal(healthPayload.online, true);

  const models = await fetch(`http://127.0.0.1:${relayPort}/h/${SLUG}/v1/models`);
  assert.equal(models.status, 401);
  assert.equal(models.headers.get("www-authenticate"), "Bearer");
  assert.equal(models.headers.get("x-request-id"), REQUEST_ID);
  assert.equal((await models.json()).error.code, "invalid_api_key");

  const requestBody = { model: "gpt-test", input: "relay round trip" };
  const responses = await fetch(`http://127.0.0.1:${relayPort}/h/${SLUG}/v1/responses`, {
    method: "POST",
    headers: { Authorization: "Bearer ccc_live_test", "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const responsesPayload = await responses.json();
  if (responses.status !== 200) throw new Error(`${JSON.stringify(responsesPayload)}\n${childOutput}`);
  assert.deepEqual(responsesPayload.received, requestBody);
  assert.deepEqual(gatewayCalls.map(({ method, url }) => `${method} ${url}`), [
    "GET /v1/models",
    "POST /v1/responses",
  ]);
  assert.equal(gatewayCalls[1].authorization, "Bearer ccc_live_test");

  agent.stop();
  await waitFor(() => presence.disconnects > 0, 3000, childOutput);
  assert.equal(presence.ready, false);
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

async function reservePort() {
  const server = net.createServer();
  const address = await listen(server);
  await close(server);
  return address.port;
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function waitFor(check, timeoutMs, detail) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for Relay state.\n${detail}`);
}

async function jsonBody(request) {
  const value = await textBody(request);
  return value ? JSON.parse(value) : null;
}

async function textBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(response, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": body.length, ...headers });
  response.end(body);
}
