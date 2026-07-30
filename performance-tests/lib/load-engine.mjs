import { performance } from "node:perf_hooks";
import { startResourceMonitor, summarizeSamples } from "./metrics.mjs";

function errorSample(error, startedAt) {
  const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
  return {
    ok: false,
    status: timeout ? "timeout" : "client-error",
    latencyMs: performance.now() - startedAt,
    errorCode: timeout ? "REQUEST_TIMEOUT" : String(error?.code ?? error?.name ?? "CLIENT_ERROR"),
  };
}

export async function runLoadStage({
  target,
  stage,
  operation,
  configure,
  sampleResources,
  onProgress = () => {},
}) {
  await configure?.(stage);
  const durationScale = Number(process.env.PERF_DURATION_SCALE ?? 1);
  if (!Number.isFinite(durationScale) || durationScale <= 0 || durationScale > 100) {
    throw new Error("PERF_DURATION_SCALE must be greater than 0 and no more than 100.");
  }
  const configuredDuration = Number(stage.durationEnvironment
    ? process.env[stage.durationEnvironment] ?? stage.durationSeconds
    : stage.durationSeconds);
  const durationSeconds = configuredDuration * durationScale;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`Invalid duration for ${target}/${stage.name}.`);
  }
  const durationMs = durationSeconds * 1000;
  const concurrency = Math.max(1, Number(stage.concurrency) || 1);
  const maxRequests = Math.max(concurrency, Number(stage.maxRequests) || Number.MAX_SAFE_INTEGER);
  const deadline = performance.now() + durationMs;
  const requestsPerSecond = Number(stage.requestsPerSecond ?? 0);
  if (requestsPerSecond < 0 || !Number.isFinite(requestsPerSecond)) {
    throw new Error(`Invalid requestsPerSecond for ${target}/${stage.name}.`);
  }
  const samples = [];
  let issued = 0;
  let lastProgressAt = performance.now();
  const stopResourceMonitor = startResourceMonitor(sampleResources);
  const startedAt = performance.now();

  async function worker(workerId) {
    while (performance.now() < deadline && issued < maxRequests) {
      const requestIndex = issued;
      issued += 1;
      if (requestsPerSecond > 0) {
        const scheduledAt = startedAt + requestIndex * (1000 / requestsPerSecond);
        const delayMs = scheduledAt - performance.now();
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (performance.now() >= deadline) break;
      }
      const requestStartedAt = performance.now();
      let sample;
      try {
        sample = await operation({
          requestIndex,
          workerId,
          stage,
          signal: AbortSignal.timeout(stage.requestTimeoutMs ?? 30000),
        });
      } catch (error) {
        sample = errorSample(error, requestStartedAt);
      }
      samples.push({ ...sample, requestIndex });
      const now = performance.now();
      if (now - lastProgressAt >= 5000) {
        lastProgressAt = now;
        onProgress({ target, stage: stage.name, requests: samples.length });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, workerId) => worker(workerId)));
  const elapsedMs = performance.now() - startedAt;
  const resources = await stopResourceMonitor();
  return {
    target,
    stage: stage.name,
    concurrency,
    configuredDurationSeconds: durationSeconds,
    elapsedMs,
    enforceThresholds: stage.enforceThresholds === true,
    expectedErrorRate: stage.expectedErrorRate ?? 0,
    summary: summarizeSamples(samples, elapsedMs, resources),
  };
}
