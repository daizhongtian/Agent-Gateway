import assert from "node:assert/strict";
import test from "node:test";
import { startFakeAiProvider } from "../performance-tests/fake-ai-provider.mjs";
import { consumeSse, providerHeaders } from "../performance-tests/lib/http-client.mjs";
import { compare, distribution, percentile } from "../performance-tests/lib/metrics.mjs";
import { evaluateRegression, evaluateThresholds } from "../performance-tests/lib/report.mjs";

test("performance statistics use deterministic nearest-rank percentiles", () => {
  assert.equal(percentile([5, 1, 2, 3, 4], 50), 3);
  assert.equal(percentile([5, 1, 2, 3, 4], 95), 5);
  assert.deepEqual(distribution([]), {
    count: 0, minMs: null, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null, meanMs: null,
  });
  assert.equal(compare(0.009, "<", 0.01), true);
  assert.equal(compare(null, "<", 1), null);
});

test("Fake AI Provider streams ordered configurable events and injects deterministic failures", async () => {
  const provider = await startFakeAiProvider({ initialDelayMs: 0, chunkIntervalMs: 0, chunks: 4, outputBytes: 64 });
  try {
    const startedAt = performance.now();
    const response = await fetch(`${provider.url}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", ...providerHeaders({ initialDelayMs: 0, chunkIntervalMs: 0, chunks: 4, errorRate: 0, outputBytes: 64 }) },
      body: JSON.stringify({ model: "fake-model", input: "test", stream: true }),
    });
    assert.equal(response.status, 200);
    const stream = await consumeSse(response, { startedAt });
    assert.equal(stream.terminalSeen, true);
    assert.equal(stream.sseOrderErrors, 0);
    assert.equal(stream.text.length, 64);
    assert.equal(stream.sseTokenIntervalsMs.length, 3);

    const failure = await fetch(`${provider.url}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", ...providerHeaders({ initialDelayMs: 0, errorRate: 1 }) },
      body: JSON.stringify({ model: "fake-model", input: "fail", stream: true }),
    });
    assert.equal(failure.status, 503);
  } finally {
    await provider.close();
  }
});

test("SSE measurement distinguishes a terminal provider failure from a successful stream", async () => {
  const response = new Response(
    'event: response.failed\ndata: {"type":"response.failed","sequence_number":0,"response":{"status":"failed"}}\n\n',
    { headers: { "content-type": "text/event-stream" } },
  );
  const stream = await consumeSse(response, { startedAt: performance.now() });
  assert.equal(stream.terminalSeen, true);
  assert.equal(stream.failedTerminal, true);
  assert.equal(stream.sseOrderErrors, 0);
});

test("threshold and baseline checks fail closed only for comparable numeric metrics", () => {
  const run = {
    profile: "normal",
    target: "gateway-health",
    stage: "steady",
    enforceThresholds: true,
    summary: { errorRate: 0, latency: { p95Ms: 250 } },
  };
  const thresholds = {
    rules: [{ id: "p95", description: "p95", profiles: ["normal"], targets: ["gateway-health"], metric: "latency.p95Ms", operator: "<", value: 300 }],
  };
  assert.equal(evaluateThresholds([run], thresholds)[0].status, "passed");
  const current = { environment: { comparisonKey: "same" }, runs: [run] };
  const baseline = {
    environment: { comparisonKey: "same" },
    runs: [{ ...run, summary: { ...run.summary, latency: { p95Ms: 200 } } }],
  };
  assert.equal(evaluateRegression(current, baseline, 0.2)[0].status, "failed");
  const noisyCurrent = { environment: { comparisonKey: "same" }, runs: [{ ...run, summary: { ...run.summary, latency: { p95Ms: 4.4 } } }] };
  const noisyBaseline = { environment: { comparisonKey: "same" }, runs: [{ ...run, summary: { ...run.summary, latency: { p95Ms: 3.2 } } }] };
  assert.equal(evaluateRegression(noisyCurrent, noisyBaseline, 0.2, 5)[0].status, "passed");
  assert.equal(evaluateRegression(current, { ...baseline, environment: { comparisonKey: "other" } }, 0.2)[0].status, "not-evaluated");
});
