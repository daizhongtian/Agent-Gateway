import { randomBytes } from "node:crypto";
import { readdir, readFile, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { startServer } from "../src/server/app.js";
import { startFakeAiProvider } from "./fake-ai-provider.mjs";
import { runBrowserProbe } from "./lib/browser-probe.mjs";
import { FakeProviderRunner } from "./lib/fake-provider-runner.mjs";
import { consumeSse, jsonRequest, providerHeaders, timedFetch } from "./lib/http-client.mjs";
import { runLoadStage } from "./lib/load-engine.mjs";
import { summarizeSamples } from "./lib/metrics.mjs";
import {
  environmentSummary,
  evaluateRegression,
  evaluateThresholds,
  htmlReport,
  markdownReport,
  readBaseline,
  writeReports,
} from "./lib/report.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configDirectory = path.join(projectRoot, "performance-tests", "config");
const defaultOutputDirectory = path.join(projectRoot, "artifacts", "performance");

function parseArguments(argv) {
  const result = {
    suite: "local",
    profiles: null,
    outputDirectory: defaultOutputDirectory,
    baseline: null,
    writeBaseline: null,
    failOnThreshold: true,
    platform: "auto",
    browser: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--suite") result.suite = argv[++index];
    else if (value === "--profile" || value === "--profiles") result.profiles = argv[++index]?.split(",").filter(Boolean);
    else if (value === "--output") result.outputDirectory = path.resolve(argv[++index]);
    else if (value === "--baseline") result.baseline = path.resolve(argv[++index]);
    else if (value === "--write-baseline") result.writeBaseline = path.resolve(argv[++index]);
    else if (value === "--no-fail") result.failOnThreshold = false;
    else if (value === "--no-platform") result.platform = "off";
    else if (value === "--platform-url") result.platformUrl = argv[++index];
    else if (value === "--no-browser") result.browser = false;
    else throw new Error(`Unknown performance argument: ${value}`);
  }
  return result;
}

function enabled(value) {
  return /^(?:1|true|yes)$/iu.test(String(value ?? ""));
}

function authorization(token) {
  return { authorization: `Bearer ${token}` };
}

function clientUrl(handle) {
  return `http://127.0.0.1:${handle.port}`;
}

async function countTemporaryFiles(directory) {
  try {
    const entries = await readdir(directory, { recursive: true });
    return entries.length;
  } catch { return 0; }
}

async function activeConnections(server) {
  return new Promise((resolve) => server.getConnections((_error, count) => resolve(count ?? 0)));
}

async function createGatewayKey(baseUrl, adminToken, name) {
  const { response, payload } = await jsonRequest(`${baseUrl}/api/v1/api-keys`, {
    method: "POST",
    headers: authorization(adminToken),
    body: {
      name,
      model: "gpt-5.6-terra",
      effort: "high",
      speed: "standard",
      permission: "read-only",
    },
  });
  if (response.status !== 201 || !payload?.key) throw new Error(`Could not create performance Gateway key (${response.status}).`);
  return { key: payload.key, id: payload.id };
}

async function reachable(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/v1/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch { return false; }
}

async function collectOptionalMetrics() {
  const results = [];
  const token = process.env.PERFORMANCE_METRICS_TOKEN;
  const headers = token ? authorization(token) : {};
  for (const [metric, environmentName] of [
    ["databasePoolUsage", "PERFORMANCE_DATABASE_METRICS_URL"],
    ["relayReconnects", "PERFORMANCE_RELAY_METRICS_URL"],
  ]) {
    const url = process.env[environmentName];
    if (!url) continue;
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      let value = payload?.[metric] ?? payload?.value ?? payload?.usageRatio;
      if (metric === "databasePoolUsage" && !Number.isFinite(value)) {
        const active = Number(payload?.active ?? payload?.activeConnections);
        const maximum = Number(payload?.max ?? payload?.maximum ?? payload?.maximumPoolSize);
        if (Number.isFinite(active) && Number.isFinite(maximum) && maximum > 0) value = active / maximum;
      }
      if (metric === "relayReconnects" && !Number.isFinite(value)) value = payload?.reconnects;
      value = Number(value);
      if (!Number.isFinite(value)) throw new Error("response did not contain a supported numeric value");
      results.push({ metric, value });
    } catch (error) {
      results.push({ metric, reason: `${environmentName} could not be read: ${error.message}` });
    }
  }
  return results;
}

function capacityAnalysis(runs) {
  const groups = new Map();
  for (const run of runs.filter((entry) => entry.profile === "stress" && entry.target !== "gateway-cancellation")) {
    const values = groups.get(run.target) ?? [];
    values.push({
      stage: run.stage,
      concurrency: run.concurrency,
      throughputRps: run.summary.throughputRps,
      errorRate: run.summary.errorRate,
      p95Ms: run.summary.latency.p95Ms,
      addedP95Ms: run.summary.addedLatency.p95Ms,
    });
    groups.set(run.target, values);
  }
  return [...groups].map(([target, stages]) => {
    const stable = stages.filter((stage) => (stage.errorRate ?? 1) < 0.01
      && (target.includes("stream") ? (stage.addedP95Ms ?? Number.POSITIVE_INFINITY) < 250 : (stage.p95Ms ?? Number.POSITIVE_INFINITY) < 800));
    const unstable = stages.find((stage) => !stable.includes(stage));
    return {
      target,
      highestStableConcurrency: stable.length ? Math.max(...stable.map((stage) => stage.concurrency)) : null,
      peakThroughputRps: stages.length ? Math.max(...stages.map((stage) => stage.throughputRps ?? 0)) : null,
      saturationStage: unstable?.stage ?? null,
      limitReached: Boolean(unstable),
      stages,
    };
  });
}

function bottleneckAnalysis(runs) {
  return runs
    .filter((run) => run.enforceThresholds && ["full-chain-stream", "relay-preview-stream"].includes(run.target))
    .map((run) => {
      const providerP95Ms = run.summary.providerLatency.p95Ms;
      const addedP95Ms = run.summary.addedLatency.p95Ms;
      if (!Number.isFinite(providerP95Ms) || !Number.isFinite(addedP95Ms)) return null;
      const total = providerP95Ms + addedP95Ms;
      return {
        profile: run.profile,
        target: run.target,
        stage: run.stage,
        primary: providerP95Ms >= addedP95Ms ? "fake-provider" : "gateway-relay",
        providerP95Ms,
        gatewayRelayAddedP95Ms: addedP95Ms,
        providerShare: total > 0 ? Math.round(providerP95Ms / total * 10000) / 10000 : null,
      };
    })
    .filter(Boolean);
}

function faultInjectionChecks(runs) {
  return runs
    .filter((run) => Number(run.expectedErrorRate) > 0)
    .map((run) => {
      const expected = Number(run.expectedErrorRate);
      const actual = run.summary.errorRate;
      const tolerance = 0.08;
      return {
        id: "fake-provider-error-injection",
        description: "Observed errors track the configured deterministic Fake Provider failure rate.",
        profile: run.profile,
        target: run.target,
        stage: run.stage,
        metric: "errorRate",
        actual,
        operator: "within",
        expected,
        tolerance,
        status: Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance ? "passed" : "failed",
      };
    });
}

async function preparePlatform(baseUrl, allowRegistration) {
  const setupSamples = [];
  let accessToken = null;
  let username = process.env.PERFORMANCE_PLATFORM_USERNAME ?? null;
  const password = process.env.PERFORMANCE_PLATFORM_PASSWORD ?? null;
  if (username && password) {
    const startedAt = performance.now();
    const { response, payload } = await jsonRequest(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      body: { username, password, clientType: "desktop", termsAccepted: true },
    });
    setupSamples.push({ ok: response.ok, status: response.status, latencyMs: performance.now() - startedAt, bytesReceived: 0 });
    if (!response.ok || !payload?.accessToken) {
      throw new Error(`Performance platform login failed (${response.status}): ${payload?.error?.code ?? "missing_access_token"}`);
    }
    accessToken = payload.accessToken;
  } else if (allowRegistration) {
    const config = await fetch(`${baseUrl}/api/v1/platform/config`, { signal: AbortSignal.timeout(5000) }).then((response) => response.json());
    username = `perf_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`.slice(0, 32);
    const generatedPassword = `Perf-${randomBytes(18).toString("base64url")}!`;
    const startedAt = performance.now();
    const { response, payload } = await jsonRequest(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      body: {
        username,
        password: generatedPassword,
        displayName: "Performance Test",
        clientType: "desktop",
        termsAccepted: true,
        termsVersion: config.termsVersion,
      },
    });
    setupSamples.push({ ok: response.ok, status: response.status, latencyMs: performance.now() - startedAt, bytesReceived: 0 });
    if (!response.ok) throw new Error(`Performance platform registration failed (${response.status}): ${payload?.error?.code ?? "unknown"}`);
    accessToken = payload?.accessToken;
  }
  return { accessToken, username, setupSamples, cleanup: async () => {} };
}

async function provisionRelayPreview(platformUrl, accessToken) {
  if (!accessToken) throw new Error("Relay preview provisioning needs an authenticated platform session.");
  const headers = authorization(accessToken);
  const device = await jsonRequest(`${platformUrl}/api/v1/devices`, {
    method: "POST",
    headers,
    body: { name: "Performance Relay Device", platform: process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux" },
  });
  if (device.response.status !== 201) throw new Error(`Relay performance device creation failed (${device.response.status}).`);
  const deviceId = device.payload.id;
  let host = null;
  try {
    const pairing = await jsonRequest(`${platformUrl}/api/v1/devices/${deviceId}/pairing-code`, { method: "POST", headers });
    if (!pairing.response.ok) throw new Error(`Relay performance pairing code failed (${pairing.response.status}).`);
    const paired = await jsonRequest(`${platformUrl}/api/v1/desktop/pair`, {
      method: "POST",
      body: {
        code: pairing.payload.code,
        publicKey: "performance-test-public-key-material-0000000000000000",
        appVersion: "performance-tests",
        platform: process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux",
      },
    });
    if (!paired.response.ok) throw new Error(`Relay performance pairing failed (${paired.response.status}).`);
    const created = await jsonRequest(`${platformUrl}/api/v1/hosts`, {
      method: "POST",
      headers,
      body: { deviceId, displayName: "Performance Public Host" },
    });
    if (created.response.status !== 201) throw new Error(`Relay performance Host creation failed (${created.response.status}).`);
    host = created.payload;
    const online = await jsonRequest(`${platformUrl}/api/v1/hosts/${host.id}`, {
      method: "PATCH",
      headers,
      body: { displayName: host.displayName, desiredOnline: true },
    });
    if (!online.response.ok || online.payload?.status !== "online") {
      throw new Error(`Relay performance Host did not become online (${online.response.status}).`);
    }
    const publicBaseUrl = String(online.payload.openAiBaseUrl).replace(/\/$/u, "");
    const originOverride = process.env.PERFORMANCE_RELAY_ORIGIN_OVERRIDE;
    let relayBaseUrl = publicBaseUrl;
    if (originOverride) {
      const publicUrl = new URL(publicBaseUrl);
      const overrideUrl = new URL(originOverride);
      relayBaseUrl = new URL(`${publicUrl.pathname}${publicUrl.search}`, overrideUrl).href.replace(/\/$/u, "");
    }
    return {
      baseUrl: relayBaseUrl,
      async cleanup() {
        await jsonRequest(`${platformUrl}/api/v1/hosts/${host.id}/disable`, { method: "POST", headers }).catch(() => {});
        await fetch(`${platformUrl}/api/v1/devices/${deviceId}`, { method: "DELETE", headers }).catch(() => {});
      },
    };
  } catch (error) {
    await fetch(`${platformUrl}/api/v1/devices/${deviceId}`, { method: "DELETE", headers }).catch(() => {});
    throw error;
  }
}

function promptFor(profile, target, stage, requestIndex) {
  return `performance:${profile}:${target}:${stage}:${requestIndex}:${randomBytes(4).toString("hex")}`;
}

async function streamOperation(url, token, prompt, settings, signal, runner, includeProviderObservation) {
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? authorization(token) : {}),
      ...(!includeProviderObservation ? providerHeaders(settings) : {}),
    },
    body: JSON.stringify({ model: "fake-model", input: prompt, stream: true }),
    signal,
  });
  if (!response.ok) {
    await response.arrayBuffer().catch(() => new ArrayBuffer(0));
    return { ok: false, status: response.status, latencyMs: performance.now() - startedAt, bytesReceived: 0 };
  }
  const stream = await consumeSse(response, { startedAt });
  const provider = includeProviderObservation ? runner.takeObservation(prompt) : null;
  return {
    ok: stream.terminalSeen && !stream.failedTerminal && stream.sseOrderErrors === 0,
    status: response.status,
    latencyMs: stream.latencyMs,
    ttftMs: stream.ttftMs,
    bytesReceived: stream.bytesReceived,
    sseIntervalsMs: stream.sseIntervalsMs,
    sseTokenIntervalsMs: stream.sseTokenIntervalsMs,
    sseOrderErrors: stream.sseOrderErrors + (provider?.providerSseOrderErrors ?? 0),
    providerLatencyMs: provider?.providerLatencyMs ?? (!includeProviderObservation ? stream.latencyMs : null),
    providerTtftMs: provider?.providerTtftMs ?? (!includeProviderObservation ? stream.ttftMs : null),
    addedLatencyMs: provider ? Math.max(0, stream.latencyMs - provider.providerLatencyMs) : null,
    addedTtftMs: provider && Number.isFinite(stream.ttftMs) && Number.isFinite(provider.providerTtftMs)
      ? Math.max(0, stream.ttftMs - provider.providerTtftMs)
      : null,
  };
}

function targetFactory(target, context, profile) {
  if (target === "fake-provider") {
    return ({ requestIndex, stage, signal }) => streamOperation(
      `${context.provider.url}/v1/responses`,
      null,
      promptFor(profile, target, stage.name, requestIndex),
      stage.provider,
      signal,
      context.runner,
      false,
    );
  }
  if (target === "gateway-health") {
    return ({ signal }) => timedFetch(`${context.gatewayUrl}/api/v1/health`, { signal });
  }
  if (target === "gateway-models") {
    return ({ signal }) => timedFetch(`${context.gatewayUrl}/v1/models`, { headers: authorization(context.gatewayKey), signal });
  }
  if (target === "full-chain-stream") {
    return ({ requestIndex, stage, signal }) => streamOperation(
      `${context.gatewayUrl}/v1/responses`,
      context.gatewayKey,
      promptFor(profile, target, stage.name, requestIndex),
      stage.provider,
      signal,
      context.runner,
      true,
    );
  }
  if (target === "platform-control") {
    const routes = ["/api/v1/health", "/api/v1/readiness", "/api/v1/platform/config"];
    return ({ requestIndex, signal }) => timedFetch(`${context.platformUrl}${routes[requestIndex % routes.length]}`, { signal });
  }
  if (target === "platform-authenticated") {
    const routes = ["/api/v1/auth/session", "/api/v1/devices", "/api/v1/hosts"];
    return ({ requestIndex, signal }) => timedFetch(`${context.platformUrl}${routes[requestIndex % routes.length]}`, {
      headers: authorization(context.platformAccessToken),
      signal,
    });
  }
  if (target === "frontend-http") {
    let assets = null;
    return async ({ signal }) => {
      const startedAt = performance.now();
      const page = await fetch(`${context.platformUrl}/`, { signal });
      const html = await page.text();
      if (!assets) {
        assets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/giu)]
          .map((match) => new URL(match[1], context.platformUrl).href)
          .filter((url) => new URL(url).origin === new URL(context.platformUrl).origin);
      }
      const assetResponses = await Promise.all(assets.map((url) => fetch(url, { signal })));
      const bodies = await Promise.all(assetResponses.map((response) => response.arrayBuffer()));
      const ok = page.ok && assetResponses.every((response) => response.ok);
      return {
        ok,
        status: ok ? 200 : "asset-error",
        latencyMs: performance.now() - startedAt,
        bytesReceived: Buffer.byteLength(html) + bodies.reduce((sum, body) => sum + body.byteLength, 0),
      };
    };
  }
  if (target === "relay-preview-stream") {
    return ({ requestIndex, stage, signal }) => streamOperation(
      `${context.relayBaseUrl}/responses`,
      context.relayGatewayKey,
      promptFor(profile, target, stage.name, requestIndex),
      stage.provider,
      signal,
      context.runner,
      true,
    );
  }
  throw new Error(`Unknown performance target: ${target}`);
}

function targetAvailability(target, context) {
  if (target.startsWith("platform-") || target === "frontend-http") {
    if (!context.platformUrl) return "The platform was not reachable; set PERFORMANCE_PLATFORM_URL or start it on port 8088.";
  }
  if (target === "platform-authenticated" && !context.platformAccessToken) {
    return "No performance platform account was configured; set credentials or PERFORMANCE_ALLOW_PLATFORM_REGISTRATION=1.";
  }
  if (target === "relay-preview-stream" && !context.relayBaseUrl) {
    return "Production Relay is not implemented and the localhost Relay preview was not explicitly provisioned.";
  }
  return null;
}

async function cancellationProbe(context, profile) {
  context.runner.configure({ initialDelayMs: 5000, chunkIntervalMs: 100, chunks: 2, errorRate: 0, jitterMs: 0 });
  const created = await jsonRequest(`${context.gatewayUrl}/api/v1/external/tasks`, {
    method: "POST",
    headers: authorization(context.gatewayKey),
    body: { prompt: `performance-cancel-${randomBytes(5).toString("hex")}`, projectless: true },
  });
  if (created.response.status !== 202) throw new Error(`Cancellation probe task creation failed (${created.response.status}).`);
  const taskId = created.payload.id;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await jsonRequest(`${context.gatewayUrl}/api/v1/external/tasks/${taskId}`, { headers: authorization(context.gatewayKey) });
    if (state.payload?.status === "running") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const startedAt = performance.now();
  const cancelled = await jsonRequest(`${context.gatewayUrl}/api/v1/external/tasks/${taskId}/cancel`, {
    method: "POST",
    headers: authorization(context.gatewayKey),
  });
  let released = false;
  while (performance.now() - startedAt < 2500) {
    const state = await jsonRequest(`${context.gatewayUrl}/api/v1/external/tasks/${taskId}`, { headers: authorization(context.gatewayKey) });
    if (state.payload?.status === "cancelled" && !context.gateway.taskManager.active.has(taskId)) {
      released = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const latencyMs = performance.now() - startedAt;
  const sample = { ok: cancelled.response.status === 202 && released, status: released ? 202 : "not-released", latencyMs, bytesReceived: 0 };
  return {
    profile,
    target: "gateway-cancellation",
    stage: "cancel-and-release",
    concurrency: 1,
    configuredDurationSeconds: 0,
    elapsedMs: latencyMs,
    enforceThresholds: true,
    expectedErrorRate: 0,
    summary: summarizeSamples([sample], latencyMs),
  };
}

async function boundaryProbes(context) {
  context.runner.configure({ initialDelayMs: 100, chunkIntervalMs: 10, chunks: 2, errorRate: 0, jitterMs: 0 });
  const anonymous = await fetch(`${context.gatewayUrl}/v1/models`);
  const created = await jsonRequest(`${context.gatewayUrl}/api/v1/external/tasks`, {
    method: "POST",
    headers: authorization(context.gatewayKey),
    body: { prompt: `performance-isolation-${randomBytes(5).toString("hex")}`, projectless: true },
  });
  let crossAccountStatus = null;
  if (created.response.status === 202) {
    const cross = await fetch(`${context.gatewayUrl}/api/v1/external/tasks/${created.payload.id}`, {
      headers: authorization(context.secondGatewayKey),
    });
    crossAccountStatus = cross.status;
    await fetch(`${context.gatewayUrl}/api/v1/external/tasks/${created.payload.id}/cancel`, {
      method: "POST",
      headers: authorization(context.gatewayKey),
    }).catch(() => {});
  }
  return [
    { id: "anonymous-auth-burst-contract", status: anonymous.status === 401 ? "passed" : "failed", actual: anonymous.status, expected: 401 },
    { id: "cross-key-task-isolation", status: crossAccountStatus === 404 ? "passed" : "failed", actual: crossAccountStatus, expected: 404 },
  ];
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const workloads = JSON.parse(await readFile(path.join(configDirectory, "workloads.json"), "utf8"));
  const thresholds = JSON.parse(await readFile(path.join(configDirectory, "thresholds.json"), "utf8"));
  const selectedProfiles = options.profiles ?? workloads.suites[options.suite];
  if (!selectedProfiles?.length) throw new Error(`Unknown or empty performance suite: ${options.suite}`);
  for (const profile of selectedProfiles) if (!workloads.profiles[profile]) throw new Error(`Unknown performance profile: ${profile}`);

  const startedAt = new Date().toISOString();
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-gateway-performance-"));
  const provider = await startFakeAiProvider({ port: Number(process.env.PERFORMANCE_FAKE_PROVIDER_PORT ?? 0) });
  const runner = new FakeProviderRunner({ baseUrl: provider.url });
  const adminToken = `perf_admin_${randomBytes(32).toString("base64url")}`;
  const gatewayHost = process.env.PERFORMANCE_GATEWAY_HOST ?? "127.0.0.1";
  const gateway = await startServer({
    mode: "desktop",
    host: gatewayHost,
    port: Number(process.env.PERFORMANCE_GATEWAY_PORT ?? 0),
    authMode: "token",
    apiToken: adminToken,
    allowedProjectRoots: [projectRoot],
    scratchRoot: path.join(temporaryRoot, "scratch"),
    attachmentUploadRoot: path.join(temporaryRoot, "attachments"),
    maxConcurrentTasks: Number(process.env.PERFORMANCE_GATEWAY_CONCURRENCY ?? 32),
    maxQueuedTasks: Number(process.env.PERFORMANCE_GATEWAY_QUEUE ?? 5000),
    maxSseConnections: Number(process.env.PERFORMANCE_GATEWAY_SSE_CONNECTIONS ?? 1024),
    taskHistoryLimit: 10000,
    runner,
    logger: { error: console.error, warn: console.warn, info: () => {}, debug: () => {} },
  });
  const gatewayUrl = clientUrl(gateway);
  const firstKey = await createGatewayKey(gatewayUrl, adminToken, "Performance primary");
  const secondKey = await createGatewayKey(gatewayUrl, adminToken, "Performance isolation");
  const secrets = [adminToken, firstKey.key, secondKey.key];
  let relay = null;
  let platform = null;
  const runs = [];
  const skipped = [];
  let browserProbe = null;
  let boundaryChecks = [];
  let fatalError = null;

  try {
    const candidatePlatformUrl = String(options.platformUrl ?? process.env.PERFORMANCE_PLATFORM_URL ?? "http://127.0.0.1:8088").replace(/\/$/u, "");
    if (options.platform !== "off" && await reachable(candidatePlatformUrl)) {
      platform = await preparePlatform(candidatePlatformUrl, enabled(process.env.PERFORMANCE_ALLOW_PLATFORM_REGISTRATION));
      platform.baseUrl = candidatePlatformUrl;
      if (platform.accessToken) secrets.push(platform.accessToken);
    }
    if (process.env.PERFORMANCE_RELAY_BASE_URL && process.env.PERFORMANCE_RELAY_API_KEY) {
      relay = { baseUrl: process.env.PERFORMANCE_RELAY_BASE_URL.replace(/\/$/u, ""), key: process.env.PERFORMANCE_RELAY_API_KEY, cleanup: async () => {} };
      secrets.push(relay.key);
    } else if (platform && enabled(process.env.PERFORMANCE_RELAY_PREVIEW)) {
      relay = await provisionRelayPreview(platform.baseUrl, platform.accessToken);
      relay.key = firstKey.key;
    }

    const context = {
      provider,
      runner,
      gateway,
      gatewayUrl,
      gatewayKey: firstKey.key,
      secondGatewayKey: secondKey.key,
      platformUrl: platform?.baseUrl ?? null,
      platformAccessToken: platform?.accessToken ?? null,
      relayBaseUrl: relay?.baseUrl ?? null,
      relayGatewayKey: relay?.key ?? null,
    };
    const setupSummary = platform?.setupSamples?.length
      ? summarizeSamples(platform.setupSamples, platform.setupSamples.reduce((sum, sample) => sum + sample.latencyMs, 0))
      : null;
    if (setupSummary) {
      runs.push({
        profile: "setup",
        target: "platform-auth-login-or-register",
        stage: "single-sample",
        concurrency: 1,
        configuredDurationSeconds: 0,
        elapsedMs: setupSummary.latency?.meanMs ?? 0,
        enforceThresholds: false,
        expectedErrorRate: 0,
        summary: setupSummary,
      });
    }

    boundaryChecks = await boundaryProbes(context);
    runs.push(await cancellationProbe(context, selectedProfiles[0]));

    const skippedKeys = new Set();
    for (const profileName of selectedProfiles) {
      const profile = workloads.profiles[profileName];
      console.log(`[performance] profile=${profileName} targets=${profile.targets.join(",")}`);
      for (const target of profile.targets) {
        const reason = targetAvailability(target, context);
        if (reason) {
          if (!skippedKeys.has(target)) skipped.push({ target, reason });
          skippedKeys.add(target);
          continue;
        }
        const operation = targetFactory(target, context, profileName);
        for (const stage of profile.stages) {
          console.log(`[performance] ${profileName}/${target}/${stage.name} concurrency=${stage.concurrency}`);
          const stageResult = await runLoadStage({
            target,
            stage,
            operation,
            configure: async (nextStage) => runner.configure(nextStage.provider),
            sampleResources: async () => ({
              activeSockets: await activeConnections(gateway.server),
              activeTasks: gateway.taskManager.active.size,
              queuedTasks: gateway.taskManager.queue.length,
              temporaryFiles: await countTemporaryFiles(temporaryRoot),
            }),
            onProgress: ({ requests }) => console.log(`[performance] ${profileName}/${target}/${stage.name}: ${requests} requests`),
          });
          runs.push({ profile: profileName, ...stageResult });
        }
      }
    }

    if (options.browser && platform?.baseUrl) {
      browserProbe = await runBrowserProbe(projectRoot, platform.baseUrl).catch((error) => ({ skipped: true, reason: error.message }));
      if (browserProbe.skipped) skipped.push({ target: "frontend-browser", reason: browserProbe.reason });
    } else {
      skipped.push({ target: "frontend-browser", reason: options.browser ? "Platform unavailable." : "Disabled by --no-browser." });
    }

    const environment = environmentSummary();
    const optionalMetrics = await collectOptionalMetrics();
    const thresholdChecks = [
      ...evaluateThresholds(runs, thresholds, optionalMetrics),
      ...faultInjectionChecks(runs),
    ];
    const baseline = await readBaseline(options.baseline);
    const partialReport = {
      schemaVersion: 1,
      suite: options.profiles ? selectedProfiles.join(",") : options.suite,
      startedAt,
      completedAt: new Date().toISOString(),
      environment,
      runs,
      skipped,
      browserProbe,
      boundaryChecks,
      optionalMetrics,
      capacityAnalysis: capacityAnalysis(runs),
      bottleneckAnalysis: bottleneckAnalysis(runs),
      thresholdChecks,
      notes: [
        "Fake Provider latency and end-to-end latency are measured independently; added latency excludes provider time.",
        "Platform control-plane and frontend targets run only when the platform URL is reachable.",
        "Production Relay WebSocket/multiplexing metrics are not claimed because the repository currently contains only the localhost Relay preview and a protocol draft.",
        "Real-provider smoke is an explicit release-only command and is not part of repeatable load profiles.",
        "CPU and memory values in this report cover the Node harness plus its in-process Local Gateway; container metrics require deployment observability endpoints.",
      ],
    };
    const regressionChecks = evaluateRegression(
      partialReport,
      baseline,
      thresholds.baselineRegressionMax,
      thresholds.baselineRegressionMinAbsoluteMs,
    );
    const failed = thresholdChecks.some((check) => check.status === "failed")
      || regressionChecks.some((check) => check.status === "failed")
      || boundaryChecks.some((check) => check.status === "failed");
    const report = { ...partialReport, regressionChecks, status: failed ? "failed" : "passed" };
    const serialized = JSON.stringify(report);
    const leaked = secrets.find((secret) => secret && serialized.includes(secret));
    if (leaked) throw new Error("A generated credential leaked into the performance report.");
    const reportPaths = await writeReports(report, options.outputDirectory);
    if (options.writeBaseline && !failed) {
      await mkdir(path.dirname(options.writeBaseline), { recursive: true });
      const baselineStem = options.writeBaseline.replace(/\.json$/iu, "");
      await Promise.all([
        writeFile(options.writeBaseline, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
        writeFile(`${baselineStem}.md`, `${markdownReport(report)}\n`, "utf8"),
        writeFile(`${baselineStem}.html`, htmlReport(report), "utf8"),
      ]);
    }
    console.log(`[performance] ${report.status.toUpperCase()} json=${reportPaths.json}`);
    console.log(`[performance] markdown=${reportPaths.markdown}`);
    console.log(`[performance] html=${reportPaths.html}`);
    if (failed && options.failOnThreshold) process.exitCode = 1;
  } catch (error) {
    fatalError = error;
    throw error;
  } finally {
    await relay?.cleanup?.().catch((error) => console.warn(`[performance] Relay cleanup failed: ${error.message}`));
    await platform?.cleanup?.().catch(() => {});
    await gateway.close().catch((error) => { if (!fatalError) throw error; });
    await provider.close().catch((error) => { if (!fatalError) throw error; });
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3 }).catch((error) => {
      console.warn(`[performance] Temporary cleanup failed: ${error.message}`);
    });
  }
}

await run();
