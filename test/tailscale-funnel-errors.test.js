import assert from "node:assert/strict";
import test from "node:test";
import {
  serializeTailscaleError,
  tailscaleCommandCandidates,
  TailscaleFunnelController,
  TailscaleFunnelError,
} from "../src/electron/tailscale-funnel.js";

function connectedStatus(overrides = {}) {
  return JSON.stringify({
    Version: "1.90.1",
    BackendState: "Running",
    Self: { DNSName: "gateway.example.ts.net.", Online: true },
    ...overrides,
  });
}

function config({ hostPort = "gateway.example.ts.net:443", target = "http://127.0.0.1:4310", handlers = {} } = {}) {
  return JSON.stringify({
    AllowFunnel: { [hostPort]: true },
    Web: { [hostPort]: { Handlers: { "/": { Proxy: target }, ...handlers } } },
  });
}

function controllerFor(script, options = {}) {
  const calls = [];
  const controller = new TailscaleFunnelController({
    command: "tailscale-test",
    runCommand: async (command, args) => {
      calls.push(args.join(" "));
      const response = script[args.join(" ")];
      if (response instanceof Error) throw response;
      if (typeof response === "function") return { stdout: response(calls), stderr: "" };
      if (response === undefined) throw new Error(`Unexpected command: ${args.join(" ")}`);
      return { stdout: response, stderr: "" };
    },
    ...options,
  });
  return { controller, calls };
}

function commandError(message, options = {}) {
  return Object.assign(new Error(message), options);
}

test("Tailscale candidate and error normalization is deterministic across platforms", () => {
  assert.deepEqual(tailscaleCommandCandidates({ platform: "linux", environment: {} }), ["tailscale"]);
  assert.deepEqual(tailscaleCommandCandidates({
    platform: "darwin",
    environment: { TAILSCALE_PATH: " /opt/tailscale ", ProgramFiles: "/ignored" },
  }), ["/opt/tailscale", "tailscale"]);
  assert.deepEqual(serializeTailscaleError(null), {
    code: "TAILSCALE_COMMAND_FAILED",
    message: "Tailscale 操作失败。",
    actionUrl: null,
  });
  const withoutAction = new TailscaleFunnelError("SAFE", "safe");
  assert.deepEqual(serializeTailscaleError(withoutAction), { code: "SAFE", message: "safe", actionUrl: null });
});

test("command discovery skips missing executables but stops on real command failures", async () => {
  const attempts = [];
  const discovered = new TailscaleFunnelController({
    commandCandidates: ["missing-one", "missing-two", "working"],
    runCommand: async (command, args) => {
      attempts.push(command);
      if (command === "missing-one") throw commandError("not recognized as a command");
      if (command === "missing-two") throw commandError("unknown executable", { code: "UNKNOWN" });
      if (args[0] === "version") return { stdout: "1.2.3 details", stderr: "" };
      if (args[0] === "status") return { stdout: connectedStatus(), stderr: "" };
      return { stdout: "{}", stderr: "" };
    },
  });
  assert.equal((await discovered.status(4310)).version, "1.2.3");
  assert.deepEqual(attempts.slice(0, 3), ["missing-one", "missing-two", "working"]);

  const failed = new TailscaleFunnelController({
    commandCandidates: ["broken", "unused"],
    runCommand: async () => { throw commandError("permission denied", { stderr: "access denied" }); },
  });
  const status = await failed.status(4310);
  assert.equal(status.installed, true);
  assert.match(status.message, /access denied/);
});

test("status rejects invalid ports and classifies invalid service output", async () => {
  const { controller } = controllerFor({
    version: "",
    "status --json": "not-json",
  });
  for (const port of [0, 65_536, 1.5, "not-a-port"]) {
    await assert.rejects(() => controller.status(port), { code: "INVALID_PORT" });
  }
  const status = await controller.status(4310);
  assert.equal(status.installed, true);
  assert.equal(status.version, null);
  assert.equal(status.error.code, "TAILSCALE_INVALID_OUTPUT");
});

test("status distinguishes disconnected, unreadable, empty, and unusual Funnel routes", async () => {
  const disconnected = controllerFor({
    version: "1.0",
    "status --json": JSON.stringify({ Version: "network-version", BackendState: "Stopped", Self: { DNSName: 42 } }),
  }).controller;
  const stopped = await disconnected.status(4310);
  assert.equal(stopped.connected, false);
  assert.equal(stopped.version, "1.0");
  assert.equal(stopped.dnsName, null);
  assert.match(stopped.message, /未连接/);

  const unreadable = controllerFor({
    version: "1.0",
    "status --json": connectedStatus(),
    "funnel status --json": commandError("boom", { stderr: "service exploded\nwith detail" }),
  }).controller;
  assert.equal((await unreadable.status(4310)).error.code, "TAILSCALE_COMMAND_FAILED");

  const empty = controllerFor({
    version: "1.0",
    "status --json": connectedStatus(),
    "funnel status --json": commandError("no funnel config"),
  }).controller;
  assert.equal((await empty.status(4310)).active, false);

  const unusual = controllerFor({
    version: "1.0",
    "status --json": connectedStatus({ Self: { DNSName: "fallback.example.ts.net", Online: true } }),
    "funnel status --json": config({
      hostPort: "public.example.ts.net:8443",
      target: "https://remote.example.com:9443",
      handlers: { "/other": { Proxy: "http://127.0.0.1:99" } },
    }),
  }).controller;
  const routed = await unusual.status(4310);
  assert.equal(routed.conflict, true);
  assert.equal(routed.targetPort, 9443);
  assert.equal(routed.hasOtherHandlers, true);
  assert.equal(routed.publicUrl, null);

  const rootless = controllerFor({
    version: "1.0",
    "status --json": connectedStatus(),
    "funnel status --json": JSON.stringify({
      AllowFunnel: { "gateway.example.ts.net:443": true },
      Web: { "gateway.example.ts.net:443": { Handlers: { "/other": {} } } },
    }),
  }).controller;
  assert.match((await rootless.status(4310)).message, /没有可识别/);
});

test("enable reports installation, connection, permission, command, and verification failures", async () => {
  const missing = new TailscaleFunnelController({
    commandCandidates: ["missing"],
    runCommand: async () => { throw commandError("cannot find the file"); },
  });
  await assert.rejects(() => missing.enable(4310), (error) => (
    error.code === "TAILSCALE_NOT_INSTALLED" && error.actionUrl.includes("tailscale.com")
  ));

  for (const [failure, code] of [
    [commandError("administrator required", { stdout: "Visit https://login.example.com/path)." }), "TAILSCALE_ADMIN_REQUIRED"],
    [commandError("network unavailable"), "TAILSCALE_CONNECT_FAILED"],
  ]) {
    const { controller } = controllerFor({
      version: "1.0",
      "status --json": JSON.stringify({ BackendState: "Stopped", Self: { Online: false } }),
      "up --timeout=60s": failure,
    });
    await assert.rejects(() => controller.enable(4310), { code });
  }

  let statusCalls = 0;
  const notConnected = controllerFor({
    version: "1.0",
    "status --json": () => {
      statusCalls += 1;
      return JSON.stringify({ BackendState: "Stopped", Self: { Online: false } });
    },
    "up --timeout=60s": "",
  }).controller;
  await assert.rejects(() => notConnected.enable(4310), { code: "TAILSCALE_NOT_CONNECTED" });
  assert.equal(statusCalls, 2);

  for (const [failure, code] of [
    [commandError("elevated permission is required"), "TAILSCALE_ADMIN_REQUIRED"],
    [commandError("relay unavailable", { stderr: "relay unavailable https://help.example.com/guide," }), "TAILSCALE_ENABLE_FAILED"],
  ]) {
    const { controller } = controllerFor({
      version: "1.0",
      "status --json": connectedStatus(),
      "funnel status --json": "{}",
      "funnel --bg --yes --https=443 http://127.0.0.1:4310": failure,
    });
    await assert.rejects(() => controller.enable(4310), { code });
  }

  const unverifiable = controllerFor({
    version: "1.0",
    "status --json": connectedStatus(),
    "funnel status --json": "{}",
    "funnel --bg --yes --https=443 http://127.0.0.1:4310": "started",
  }).controller;
  await assert.rejects(() => unverifiable.enable(4310), { code: "TAILSCALE_ENABLE_UNVERIFIED" });
});

test("enable is idempotent while disable classifies failures and inactive routes", async () => {
  const active = controllerFor({
    version: "1.0",
    "status --json": connectedStatus(),
    "funnel status --json": config(),
  }).controller;
  assert.equal((await active.enable(4310)).active, true);

  const inactive = controllerFor({
    version: "1.0",
    "status --json": connectedStatus(),
    "funnel status --json": "{}",
  }).controller;
  assert.equal((await inactive.disable(4310)).active, false);

  for (const [failure, code] of [
    [commandError("access is denied"), "TAILSCALE_ADMIN_REQUIRED"],
    [commandError("cannot stop", { stdout: "See https://help.example.com/stop." }), "TAILSCALE_DISABLE_FAILED"],
  ]) {
    const { controller } = controllerFor({
      version: "1.0",
      "status --json": connectedStatus(),
      "funnel status --json": config(),
      "funnel --yes --https=443 off": failure,
    });
    await assert.rejects(() => controller.disable(4310), { code });
  }
});

test("repair rejects unavailable routes and classifies rebuild and verification failures", async () => {
  const unavailable = controllerFor({
    version: "1.0",
    "status --json": connectedStatus(),
    "funnel status --json": "{}",
  }).controller;
  await assert.rejects(() => unavailable.repair(4310), { code: "TAILSCALE_REPAIR_UNAVAILABLE" });

  for (const [failure, code] of [
    [commandError("administrator permission required"), "TAILSCALE_ADMIN_REQUIRED"],
    [commandError("repair command failed"), "TAILSCALE_REPAIR_FAILED"],
  ]) {
    const { controller } = controllerFor({
      version: "1.0",
      "status --json": connectedStatus(),
      "funnel status --json": config(),
      "funnel --yes --https=443 off": failure,
    });
    await assert.rejects(() => controller.repair(4310), { code });
  }

  let active = true;
  const unverifiable = controllerFor({
    version: "1.0",
    "status --json": connectedStatus(),
    "funnel status --json": () => (active ? config() : "{}"),
    "funnel --yes --https=443 off": () => { active = false; return ""; },
    "funnel --bg --yes --https=443 http://127.0.0.1:4310": "rebuilt",
  }).controller;
  await assert.rejects(() => unverifiable.repair(4310), { code: "TAILSCALE_REPAIR_UNVERIFIED" });
});
