import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PlatformClient } from "../src/electron/platform-client.js";

const email = process.env.PLATFORM_SMOKE_EMAIL;
const password = process.env.PLATFORM_SMOKE_PASSWORD;
if (!email || !password) {
  throw new Error("Set PLATFORM_SMOKE_EMAIL and PLATFORM_SMOKE_PASSWORD to a disposable local platform account.");
}

const directory = mkdtempSync(path.join(os.tmpdir(), "cag-v3-platform-smoke-"));
const protector = Object.freeze({
  encrypt: (value) => Buffer.from(value, "utf8").toString("base64"),
  decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
});
const client = new PlatformClient({
  userDataPath: directory,
  secretProtector: protector,
  baseUrl: process.env.CODING_AGENT_PLATFORM_URL || "http://localhost:8088",
  appVersion: "3.0.0-smoke",
  deviceName: "V3 Local Smoke Desktop",
});

let enabled = false;
try {
  await client.login(email, password);
  const online = await client.setOnline(true);
  enabled = true;
  const response = await fetch(`${online.host.openAiBaseUrl}/models`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const responseText = await response.text();
  assert.equal(
    response.status,
    401,
    `the forwarded models route ${online.host.openAiBaseUrl}/models must enforce the Gateway key; received ${response.status}: ${responseText.slice(0, 300)}`,
  );
  assert.match(response.headers.get("x-request-id") || "", /^req_[a-f0-9]{32}$/);
  console.log(JSON.stringify({
    ok: true,
    online: online.online,
    baseUrl: online.host.openAiBaseUrl,
    modelsStatus: response.status,
    requestIdVerified: true,
  }));
} finally {
  if (enabled) await client.setOnline(false).catch(() => {});
  await client.logout().catch(() => {});
  rmSync(directory, { recursive: true, force: true });
}
