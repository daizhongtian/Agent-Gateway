import os from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

export function percentile(values, percentileValue) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (!sorted.length) return null;
  const rank = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return round(sorted[Math.min(rank, sorted.length - 1)]);
}

export function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

export function distribution(values) {
  const finite = values.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (!finite.length) return { count: 0, minMs: null, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null, meanMs: null };
  const ranked = (percentileValue) => {
    const rank = Math.max(0, Math.ceil((percentileValue / 100) * finite.length) - 1);
    return round(finite[Math.min(rank, finite.length - 1)]);
  };
  return {
    count: finite.length,
    minMs: round(finite[0]),
    p50Ms: ranked(50),
    p95Ms: ranked(95),
    p99Ms: ranked(99),
    maxMs: round(finite.at(-1)),
    meanMs: round(finite.reduce((sum, value) => sum + value, 0) / finite.length),
  };
}

function cpuSnapshot() {
  return os.cpus().map((cpu) => ({ ...cpu.times }));
}

function hostCpuPercent(before, after) {
  let idle = 0;
  let total = 0;
  for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
    const left = before[index];
    const right = after[index];
    idle += right.idle - left.idle;
    total += Object.keys(right).reduce((sum, key) => sum + right[key] - left[key], 0);
  }
  return total > 0 ? round(((total - idle) / total) * 100) : null;
}

function linearTrendPerMinute(samples, valueKey) {
  const points = samples.filter((sample) => Number.isFinite(sample.atMs) && Number.isFinite(sample[valueKey]));
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, point) => sum + point.atMs, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point[valueKey], 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.atMs - meanX) * (point[valueKey] - meanY);
    denominator += (point.atMs - meanX) ** 2;
  }
  return denominator > 0 ? round(numerator / denominator * 60000) : null;
}

export function startResourceMonitor(sampleExtra = async () => ({}), intervalMs = 100) {
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  const startedAt = performance.now();
  const processCpu = process.cpuUsage();
  const hostCpu = cpuSnapshot();
  const startMemory = process.memoryUsage();
  const startHandles = typeof process._getActiveHandles === "function" ? process._getActiveHandles().length : null;
  const samples = [];
  eventLoop.enable();

  const capture = async () => {
    const memory = process.memoryUsage();
    let extra = {};
    try { extra = await sampleExtra(); } catch { /* Resource probes are best effort. */ }
    samples.push({
      atMs: round(performance.now() - startedAt),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      ...extra,
    });
  };
  void capture();
  const timer = setInterval(() => { void capture(); }, intervalMs);
  timer.unref?.();

  return async () => {
    clearInterval(timer);
    await capture();
    eventLoop.disable();
    const elapsedMs = performance.now() - startedAt;
    const usedCpu = process.cpuUsage(processCpu);
    const cpuMicros = usedCpu.user + usedCpu.system;
    const endMemory = process.memoryUsage();
    const peakRss = Math.max(startMemory.rss, endMemory.rss, ...samples.map((sample) => sample.rssBytes));
    const memoryDriftRatio = startMemory.rss > 0 ? (endMemory.rss - startMemory.rss) / startMemory.rss : null;
    const endHandles = typeof process._getActiveHandles === "function" ? process._getActiveHandles().length : null;
    return {
      elapsedMs: round(elapsedMs),
      processCpuPercent: round(cpuMicros / (elapsedMs * 1000) * 100),
      hostCpuPercent: hostCpuPercent(hostCpu, cpuSnapshot()),
      rssStartBytes: startMemory.rss,
      rssEndBytes: endMemory.rss,
      rssPeakBytes: peakRss,
      heapUsedStartBytes: startMemory.heapUsed,
      heapUsedEndBytes: endMemory.heapUsed,
      memoryDriftRatio: round(memoryDriftRatio, 5),
      rssTrendBytesPerMinute: linearTrendPerMinute(samples, "rssBytes"),
      heapTrendBytesPerMinute: linearTrendPerMinute(samples, "heapUsedBytes"),
      activeHandlesStart: startHandles,
      activeHandlesEnd: endHandles,
      activeHandleDrift: startHandles === null || endHandles === null ? null : endHandles - startHandles,
      eventLoopDelayP95Ms: round(eventLoop.percentile(95) / 1e6),
      eventLoopDelayP99Ms: round(eventLoop.percentile(99) / 1e6),
      eventLoopDelayMaxMs: round(eventLoop.max / 1e6),
      maxActiveSockets: samples.length ? Math.max(...samples.map((sample) => sample.activeSockets ?? 0)) : null,
      maxActiveTasks: samples.length ? Math.max(...samples.map((sample) => sample.activeTasks ?? 0)) : null,
      maxQueuedTasks: samples.length ? Math.max(...samples.map((sample) => sample.queuedTasks ?? 0)) : null,
      maxTemporaryFiles: samples.length ? Math.max(...samples.map((sample) => sample.temporaryFiles ?? 0)) : null,
    };
  };
}

export function summarizeSamples(samples, elapsedMs, resources = null) {
  const successful = samples.filter((sample) => sample.ok);
  const errors = samples.length - successful.length;
  return {
    requests: samples.length,
    successfulRequests: successful.length,
    errors,
    errorRate: samples.length ? round(errors / samples.length, 6) : null,
    throughputRps: elapsedMs > 0 ? round(samples.length / (elapsedMs / 1000)) : null,
    latency: distribution(samples.map((sample) => sample.latencyMs)),
    timeToFirstToken: distribution(samples.map((sample) => sample.ttftMs)),
    providerLatency: distribution(samples.map((sample) => sample.providerLatencyMs)),
    providerTimeToFirstToken: distribution(samples.map((sample) => sample.providerTtftMs)),
    addedLatency: distribution(samples.map((sample) => sample.addedLatencyMs)),
    addedTimeToFirstToken: distribution(samples.map((sample) => sample.addedTtftMs)),
    sseInterval: distribution(samples.flatMap((sample) => sample.sseIntervalsMs ?? [])),
    sseTokenInterval: distribution(samples.flatMap((sample) => sample.sseTokenIntervalsMs ?? [])),
    sseOrderErrors: samples.reduce((sum, sample) => sum + (sample.sseOrderErrors ?? 0), 0),
    bytesReceived: samples.reduce((sum, sample) => sum + (sample.bytesReceived ?? 0), 0),
    statuses: Object.fromEntries([...new Set(samples.map((sample) => String(sample.status ?? "error")))]
      .map((status) => [status, samples.filter((sample) => String(sample.status ?? "error") === status).length])),
    resources,
  };
}

export function getMetric(object, path) {
  return String(path).split(".").reduce((value, key) => value?.[key], object);
}

export function compare(actual, operator, expected) {
  if (!Number.isFinite(actual)) return null;
  if (operator === "<") return actual < expected;
  if (operator === "<=") return actual <= expected;
  if (operator === ">") return actual > expected;
  if (operator === ">=") return actual >= expected;
  if (operator === "=") return actual === expected;
  throw new Error(`Unsupported threshold operator: ${operator}`);
}
