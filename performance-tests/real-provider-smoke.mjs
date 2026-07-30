import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { consumeSse } from "./lib/http-client.mjs";
import { summarizeSamples } from "./lib/metrics.mjs";
import { environmentSummary, writeReports } from "./lib/report.mjs";

if (!/^(?:1|true|yes)$/iu.test(process.env.PERFORMANCE_REAL_PROVIDER ?? "")) {
  throw new Error("Real-provider smoke is guarded. Set PERFORMANCE_REAL_PROVIDER=1 to spend real quota.");
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = String(process.env.PERFORMANCE_REAL_PROVIDER_BASE_URL ?? "").replace(/\/$/u, "");
const apiKey = process.env.PERFORMANCE_REAL_PROVIDER_API_KEY ?? process.env.OPENAI_API_KEY;
const model = process.env.PERFORMANCE_REAL_PROVIDER_MODEL;
if (!baseUrl) throw new Error("Set PERFORMANCE_REAL_PROVIDER_BASE_URL to an OpenAI-compatible /v1 endpoint.");
if (!apiKey) throw new Error("Set PERFORMANCE_REAL_PROVIDER_API_KEY (or OPENAI_API_KEY).");
if (!model) throw new Error("Set PERFORMANCE_REAL_PROVIDER_MODEL explicitly so releases never silently change models.");

const startedAtIso = new Date().toISOString();
const startedAt = performance.now();
const response = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  body: JSON.stringify({
    model,
    input: "Reply with exactly: performance smoke ok",
    stream: true,
    max_output_tokens: 32,
  }),
  signal: AbortSignal.timeout(Number(process.env.PERFORMANCE_REAL_PROVIDER_TIMEOUT_MS ?? 120000)),
});
let sample;
if (!response.ok) {
  await response.arrayBuffer();
  sample = { ok: false, status: response.status, latencyMs: performance.now() - startedAt, bytesReceived: 0 };
} else {
  const stream = await consumeSse(response, { startedAt });
  sample = {
    ok: stream.terminalSeen && !stream.failedTerminal && stream.sseOrderErrors === 0,
    status: response.status,
    latencyMs: stream.latencyMs,
    ttftMs: stream.ttftMs,
    bytesReceived: stream.bytesReceived,
    sseIntervalsMs: stream.sseIntervalsMs,
    sseOrderErrors: stream.sseOrderErrors,
  };
}
const elapsedMs = performance.now() - startedAt;
const summary = summarizeSamples([sample], elapsedMs);
const report = {
  schemaVersion: 1,
  suite: "real-provider-smoke",
  startedAt: startedAtIso,
  completedAt: new Date().toISOString(),
  environment: environmentSummary(),
  status: sample.ok ? "passed" : "failed",
  runs: [{
    profile: "release",
    target: "real-provider",
    stage: "single-streaming-request",
    concurrency: 1,
    configuredDurationSeconds: 0,
    elapsedMs,
    enforceThresholds: false,
    expectedErrorRate: 0,
    summary,
  }],
  thresholdChecks: [],
  regressionChecks: [{ status: "not-evaluated", reason: "Real-provider latency is informational because provider behavior is not deterministic." }],
  skipped: [],
  browserProbe: null,
  boundaryChecks: [],
  notes: ["This opt-in smoke sends exactly one small streaming request and consumes real provider quota."],
};
const paths = await writeReports(report, process.env.PERFORMANCE_OUTPUT_DIR ?? path.join(projectRoot, "artifacts", "performance"));
console.log(`[performance-real-provider] ${report.status.toUpperCase()} json=${paths.json}`);
if (!sample.ok) process.exitCode = 1;
