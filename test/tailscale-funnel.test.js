import assert from "node:assert/strict";
import test from "node:test";
import {
  serializeTailscaleError,
  tailscaleCommandCandidates,
  TailscaleFunnelController,
  TailscaleFunnelError,
} from "../src/electron/tailscale-funnel.js";

function connectedStatus(dnsName = "codex-host.example.ts.net.") {
  return JSON.stringify({
    Version: "1.90.1",
    BackendState: "Running",
    Self: { DNSName: dnsName, Online: true },
  });
}

function funnelConfig(target = "http://127.0.0.1:4310") {
  return JSON.stringify({
    TCP: { 443: { HTTPS: true } },
    Web: {
      "codex-host.example.ts.net:443": {
        Handlers: { "/": { Proxy: target } },
      },
    },
    AllowFunnel: { "codex-host.example.ts.net:443": true },
  });
}

function scriptedController(script) {
  const calls = [];
  const controller = new TailscaleFunnelController({
    command: "tailscale-test",
    runCommand: async (command, args) => {
      calls.push({ command, args });
      const key = args.join(" ");
      const response = script[key];
      if (response instanceof Error) throw response;
      if (response === undefined) throw new Error(`Unexpected command: ${key}`);
      const stdout = typeof response === "function" ? response(calls) : response;
      return { stdout, stderr: "" };
    },
  });
  return { controller, calls };
}

test("Tailscale executable discovery prefers an explicit path and known Windows installs", () => {
  assert.deepEqual(
    tailscaleCommandCandidates({
      platform: "win32",
      environment: {
        TAILSCALE_PATH: "D:\\Apps\\tailscale.exe",
        ProgramFiles: "C:\\Program Files",
        LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local",
      },
    }),
    [
      "D:\\Apps\\tailscale.exe",
      "C:\\Program Files\\Tailscale\\tailscale.exe",
      "C:\\Users\\alice\\AppData\\Local\\Tailscale\\tailscale.exe",
      "tailscale.exe",
      "tailscale",
    ],
  );
});

test("status reports an active Funnel and OpenAI base URL", async () => {
  const { controller, calls } = scriptedController({
    version: "1.90.1\n",
    "status --json": connectedStatus(),
    "funnel status --json": funnelConfig(),
  });

  const status = await controller.status(4310);
  assert.equal(status.installed, true);
  assert.equal(status.connected, true);
  assert.equal(status.active, true);
  assert.equal(status.online, true);
  assert.equal(status.conflict, false);
  assert.equal(status.publicUrl, "https://codex-host.example.ts.net");
  assert.equal(status.baseUrl, "https://codex-host.example.ts.net/v1");
  assert.equal(status.targetPort, 4310);
  assert.equal(calls.length, 3);
});

test("status refuses to take over a Funnel owned by another local service", async () => {
  const { controller } = scriptedController({
    version: "1.90.1\n",
    "status --json": connectedStatus(),
    "funnel status --json": funnelConfig("http://127.0.0.1:9000"),
  });

  const status = await controller.status(4310);
  assert.equal(status.active, false);
  assert.equal(status.conflict, true);
  assert.equal(status.targetPort, 9000);
  await assert.rejects(() => controller.enable(4310), { code: "TAILSCALE_FUNNEL_CONFLICT" });
});

test("enable starts a persistent HTTPS Funnel and verifies the resulting route", async () => {
  let active = false;
  const script = {
    version: "1.90.1\n",
    "status --json": connectedStatus(),
    "funnel status --json": () => (active ? funnelConfig() : "{}"),
    "funnel --bg --yes --https=443 http://127.0.0.1:4310": () => {
      active = true;
      return "Available on the internet\nhttps://codex-host.example.ts.net\n";
    },
  };
  const { controller, calls } = scriptedController(script);

  const status = await controller.enable(4310);
  assert.equal(status.active, true);
  assert.equal(status.baseUrl, "https://codex-host.example.ts.net/v1");
  assert.ok(calls.some(({ args }) => args.join(" ") === "funnel --bg --yes --https=443 http://127.0.0.1:4310"));
});

test("disable removes only the verified local API Funnel route", async () => {
  let active = true;
  const script = {
    version: "1.90.1\n",
    "status --json": connectedStatus(),
    "funnel status --json": () => (active ? funnelConfig() : "{}"),
    "funnel --https=443 http://127.0.0.1:4310 off": () => {
      active = false;
      return "";
    },
  };
  const { controller, calls } = scriptedController(script);

  const status = await controller.disable(4310);
  assert.equal(status.active, false);
  assert.ok(calls.some(({ args }) => args.join(" ") === "funnel --https=443 http://127.0.0.1:4310 off"));
});

test("missing and disconnected clients produce safe status and structured errors", async () => {
  const missing = new TailscaleFunnelController({
    commandCandidates: ["missing-tailscale"],
    runCommand: async () => {
      const error = new Error("spawn missing-tailscale ENOENT");
      error.code = "ENOENT";
      throw error;
    },
  });
  const missingStatus = await missing.status(4310);
  assert.equal(missingStatus.installed, false);
  assert.equal(missingStatus.error.code, "TAILSCALE_NOT_INSTALLED");

  let connected = false;
  const { controller, calls } = scriptedController({
    version: "1.90.1\n",
    "status --json": () => (connected
      ? connectedStatus()
      : JSON.stringify({ BackendState: "NeedsLogin", Self: { Online: false } })),
    "up --timeout=60s": () => {
      connected = true;
      return "";
    },
    "funnel status --json": "{}",
    "funnel --bg --yes --https=443 http://127.0.0.1:4310": () => funnelConfig(),
  });
  const disconnected = await controller.status(4310);
  assert.equal(disconnected.installed, true);
  assert.equal(disconnected.connected, false);
  assert.match(disconnected.message, /尚未登录/);
  await assert.rejects(() => controller.enable(4310), { code: "TAILSCALE_ENABLE_UNVERIFIED" });
  assert.ok(calls.some(({ args }) => args.join(" ") === "up --timeout=60s"));

  assert.deepEqual(
    serializeTailscaleError(new TailscaleFunnelError("TEST", "safe", { actionUrl: "https://example.com/" })),
    { code: "TEST", message: "safe", actionUrl: "https://example.com/" },
  );
});
