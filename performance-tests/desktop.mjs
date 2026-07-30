import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { distribution, round } from "./lib/metrics.mjs";
import { environmentSummary, writeReports } from "./lib/report.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const durationSeconds = Math.max(3, Number(process.env.PERFORMANCE_DESKTOP_DURATION_SECONDS ?? 15));
const timeoutMs = (durationSeconds + 30) * 1000;
const outputDirectory = path.resolve(process.env.PERFORMANCE_OUTPUT_DIR ?? path.join(projectRoot, "artifacts", "performance"));

function electronExecutable() {
  const executable = process.platform === "win32" ? "electron.exe" : "electron";
  const candidate = path.join(projectRoot, "node_modules", "electron", "dist", executable);
  if (!existsSync(candidate)) throw new Error("Electron is not installed. Run npm ci first.");
  return candidate;
}

function windowsTreeSample(rootPid) {
  const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = `$rootPid=${rootPid};$all=@(Get-CimInstance Win32_Process);$ids=@($rootPid);do{$before=$ids.Count;$children=@($all|Where-Object{$ids -contains [int]$_.ParentProcessId}|ForEach-Object{[int]$_.ProcessId});$ids=@($ids+$children|Select-Object -Unique)}while($ids.Count -gt $before);$p=@(Get-Process -Id $ids -ErrorAction SilentlyContinue);[pscustomobject]@{rssBytes=[long](($p|Measure-Object WorkingSet64 -Sum).Sum);cpuSeconds=[double](($p|Measure-Object CPU -Sum).Sum);processes=$p.Count}|ConvertTo-Json -Compress`;
  return new Promise((resolve) => {
    execFile(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 10000 }, (error, stdout) => {
      if (error) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

async function processTreeSample(rootPid) {
  if (process.platform === "win32") return windowsTreeSample(rootPid);
  // Cross-platform fallback reports only the Electron browser process. Weekly
  // Windows CI is the canonical source for full desktop process-tree metrics.
  try {
    const result = await new Promise((resolve, reject) => {
      execFile("ps", ["-o", "rss=,time=", "-p", String(rootPid)], { timeout: 5000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    const rssKiB = Number(String(result).trim().split(/\s+/u)[0]);
    return { rssBytes: Number.isFinite(rssKiB) ? rssKiB * 1024 : null, cpuSeconds: null, processes: 1 };
  } catch { return null; }
}

async function main() {
  const temporaryUserData = await mkdtemp(path.join(os.tmpdir(), "agent-gateway-desktop-performance-"));
  const startedAtIso = new Date().toISOString();
  const startedAt = performance.now();
  const output = [];
  const samples = [];
  let rendererReadyAt = null;
  let resolveRendererReady;
  const rendererReady = new Promise((resolve) => { resolveRendererReady = resolve; });
  let exitCode = null;
  let exitSignal = null;
  let childExitedAt = null;
  const child = spawn(electronExecutable(), ["."], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CODEX_DESKTOP_SMOKE_TEST: "1",
      CODEX_DESKTOP_SMOKE_DURATION_MS: String(durationSeconds * 1000),
      CODEX_DESKTOP_TEST_USER_DATA: temporaryUserData,
      CODEX_DESKTOP_PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const observe = (streamName, chunk) => {
    const text = chunk.toString("utf8");
    output.push(`${streamName}: ${text}`);
    if (text.includes("[electron-smoke] renderer ready:") && rendererReadyAt === null) {
      rendererReadyAt = performance.now();
      resolveRendererReady();
    }
  };
  child.stdout?.on("data", (chunk) => observe("stdout", chunk));
  child.stderr?.on("data", (chunk) => observe("stderr", chunk));

  let sampling = true;
  const samplingPromise = (async () => {
    await Promise.race([rendererReady, new Promise((resolve) => child.once("exit", resolve))]);
    while (sampling && child.exitCode === null && child.signalCode === null) {
      const resource = await processTreeSample(child.pid);
      if (!sampling || child.exitCode !== null || child.signalCode !== null) break;
      if (resource && resource.processes > 0 && resource.rssBytes > 0) {
        samples.push({ atMs: performance.now() - startedAt, ...resource });
      }
      if (!sampling) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  })();
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      childExitedAt = performance.now();
      resolve();
    });
  });
  let timeoutHandle;
  const timeout = new Promise((_resolve, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`Electron performance probe timed out after ${timeoutMs} ms.`)), timeoutMs);
  });
  try {
    await Promise.race([exited, timeout]);
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    sampling = false;
    await samplingPromise;
  }

  const completedAt = childExitedAt ?? performance.now();
  const startupMs = rendererReadyAt === null ? null : rendererReadyAt - startedAt;
  const readySamples = rendererReadyAt === null ? [] : samples.filter((sample) => sample.atMs >= rendererReadyAt - startedAt + 1000);
  const rssValues = samples.map((sample) => sample.rssBytes).filter(Number.isFinite);
  const idleRssValues = readySamples.map((sample) => sample.rssBytes).filter(Number.isFinite);
  const firstCpu = readySamples.find((sample) => Number.isFinite(sample.cpuSeconds));
  const lastCpu = readySamples.findLast((sample) => Number.isFinite(sample.cpuSeconds));
  const cpuPercent = firstCpu && lastCpu && lastCpu.atMs > firstCpu.atMs
    ? (lastCpu.cpuSeconds - firstCpu.cpuSeconds) / ((lastCpu.atMs - firstCpu.atMs) / 1000) * 100
    : null;
  const ok = exitCode === 0 && exitSignal === null && startupMs !== null;
  const resources = {
    processTreePeakRssBytes: rssValues.length ? Math.max(...rssValues) : null,
    idleRssStartBytes: idleRssValues[0] ?? null,
    idleRssEndBytes: idleRssValues.at(-1) ?? null,
    idleMemoryDriftRatio: idleRssValues.length > 1 && idleRssValues[0] > 0
      ? round((idleRssValues.at(-1) - idleRssValues[0]) / idleRssValues[0], 5)
      : null,
    processTreeCpuPercent: round(cpuPercent),
    maxProcessCount: samples.length ? Math.max(...samples.map((sample) => sample.processes ?? 0)) : null,
    sampleCount: samples.length,
  };
  const summary = {
    requests: 1,
    successfulRequests: ok ? 1 : 0,
    errors: ok ? 0 : 1,
    errorRate: ok ? 0 : 1,
    throughputRps: null,
    latency: distribution(startupMs === null ? [] : [startupMs]),
    timeToFirstToken: distribution([]),
    providerLatency: distribution([]),
    providerTimeToFirstToken: distribution([]),
    addedLatency: distribution([]),
    addedTimeToFirstToken: distribution([]),
    sseInterval: distribution([]),
    sseOrderErrors: 0,
    bytesReceived: 0,
    statuses: { [ok ? "ready" : "failed"]: 1 },
    resources,
  };
  const report = {
    schemaVersion: 1,
    suite: "desktop",
    startedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    environment: environmentSummary(),
    status: ok ? "passed" : "failed",
    runs: [{
      profile: "desktop",
      target: "electron-desktop",
      stage: `startup-and-${durationSeconds}s-idle`,
      concurrency: 1,
      configuredDurationSeconds: durationSeconds,
      elapsedMs: completedAt - startedAt,
      enforceThresholds: false,
      expectedErrorRate: 0,
      summary,
    }],
    thresholdChecks: [],
    regressionChecks: [{ status: "not-evaluated", reason: "Use the generated JSON as a machine-specific Electron baseline." }],
    skipped: [],
    browserProbe: null,
    boundaryChecks: [],
    notes: [
      "Electron startup ends when the renderer reports ready.",
      "Idle resource sampling continues for the configured duration; set PERFORMANCE_DESKTOP_DURATION_SECONDS for a longer soak.",
      process.platform === "win32" ? "Windows metrics include the Electron process tree." : "Non-Windows fallback memory metrics cover only the browser process.",
    ],
  };
  const paths = await writeReports(report, outputDirectory);
  console.log(`[performance-desktop] ${report.status.toUpperCase()} startupMs=${round(startupMs)} peakRssBytes=${resources.processTreePeakRssBytes}`);
  console.log(`[performance-desktop] json=${paths.json}`);
  await rm(temporaryUserData, { recursive: true, force: true, maxRetries: 3 });
  if (!ok) {
    console.error(output.join("\n").slice(-20000));
    process.exitCode = 1;
  }
}

await main();
