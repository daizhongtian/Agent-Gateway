import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { compare, getMetric, round } from "./metrics.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function valueText(value) {
  if (value === null || value === undefined) return "n/a";
  if (typeof value === "number") return String(round(value));
  return String(value);
}

export function environmentSummary() {
  const cpu = os.cpus()[0]?.model?.replace(/\s+/gu, " ").trim() ?? "unknown";
  return {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    node: process.version,
    cpu,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    comparisonKey: `${process.platform}-${process.arch}-node${process.versions.node.split(".")[0]}-${os.cpus().length}`,
  };
}

export function evaluateThresholds(runs, thresholds, unavailableMetrics = []) {
  const checks = [];
  for (const run of runs) {
    if (!run.enforceThresholds) continue;
    for (const rule of thresholds.rules ?? []) {
      if (!rule.profiles.includes(run.profile) || !rule.targets.includes(run.target)) continue;
      const actual = getMetric(run.summary, rule.metric);
      const passed = compare(actual, rule.operator, rule.value);
      checks.push({
        id: rule.id,
        description: rule.description,
        profile: run.profile,
        target: run.target,
        stage: run.stage,
        metric: rule.metric,
        actual: Number.isFinite(actual) ? round(actual, 6) : null,
        operator: rule.operator,
        expected: rule.value,
        status: passed === null ? "not-evaluated" : passed ? "passed" : "failed",
      });
    }
  }
  for (const requirement of thresholds.availability ?? []) {
    const supplied = unavailableMetrics.find((entry) => entry.metric === requirement.metric);
    checks.push({
      id: requirement.id,
      description: requirement.description,
      profile: "environment",
      target: "optional-observability",
      stage: "availability",
      metric: requirement.metric,
      actual: supplied?.value ?? null,
      operator: requirement.operator,
      expected: requirement.value,
      status: supplied?.value === undefined
        ? "not-evaluated"
        : compare(supplied.value, requirement.operator, requirement.value) ? "passed" : "failed",
      reason: supplied?.reason ?? `Set ${requirement.environment} to collect this deployment-specific metric.`,
    });
  }
  return checks;
}

export function evaluateRegression(current, baseline, maxRegression, minAbsoluteRegressionMs = 0) {
  if (!baseline) return [{ status: "not-evaluated", reason: "No baseline file was supplied." }];
  if (baseline.environment?.comparisonKey !== current.environment?.comparisonKey) {
    return [{
      status: "not-evaluated",
      reason: `Baseline environment ${baseline.environment?.comparisonKey ?? "unknown"} does not match ${current.environment?.comparisonKey}.`,
    }];
  }
  const baselineRuns = new Map((baseline.runs ?? []).map((run) => [
    `${run.profile}/${run.target}/${run.stage}`,
    run,
  ]));
  const checks = [];
  for (const run of current.runs) {
    if (!run.enforceThresholds) continue;
    const previous = baselineRuns.get(`${run.profile}/${run.target}/${run.stage}`);
    if (!previous) continue;
    for (const metric of ["latency.p95Ms", "addedLatency.p95Ms", "timeToFirstToken.p95Ms", "addedTimeToFirstToken.p95Ms"]) {
      const actual = getMetric(run.summary, metric);
      const expected = getMetric(previous.summary, metric);
      if (!Number.isFinite(actual) || !Number.isFinite(expected) || expected <= 0) continue;
      const changeRatio = (actual - expected) / expected;
      const absoluteChangeMs = actual - expected;
      checks.push({
        profile: run.profile,
        target: run.target,
        stage: run.stage,
        metric,
        baseline: round(expected),
        actual: round(actual),
        changeRatio: round(changeRatio, 5),
        absoluteChangeMs: round(absoluteChangeMs),
        allowedRegression: maxRegression,
        absoluteNoiseFloorMs: minAbsoluteRegressionMs,
        status: changeRatio < maxRegression || absoluteChangeMs < minAbsoluteRegressionMs ? "passed" : "failed",
      });
    }
  }
  return checks.length ? checks : [{ status: "not-evaluated", reason: "No matching baseline stages and metrics were found." }];
}

export async function readBaseline(filePath) {
  if (!filePath) return null;
  try { return JSON.parse(await readFile(path.resolve(filePath), "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function markdownReport(report) {
  const lines = [
    `# Agent Gateway performance report`,
    "",
    `- Result: **${report.status.toUpperCase()}**`,
    `- Suite: \`${report.suite}\``,
    `- Started: ${report.startedAt}`,
    `- Environment: ${report.environment.platform}/${report.environment.arch}, ${report.environment.logicalCpus} logical CPUs, ${report.environment.node}`,
    "",
    "## Load results",
    "",
    "| Profile | Target | Stage | Requests | RPS | Error rate | p50 | p95 | p99 | TTFT p95 | Added p95 | Added TTFT p95 | Token gap p50 | SSE order errors |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const run of report.runs) {
    const summary = run.summary;
    lines.push(`| ${run.profile} | ${run.target} | ${run.stage} | ${summary.requests} | ${valueText(summary.throughputRps)} | ${valueText(summary.errorRate)} | ${valueText(summary.latency.p50Ms)} | ${valueText(summary.latency.p95Ms)} | ${valueText(summary.latency.p99Ms)} | ${valueText(summary.timeToFirstToken.p95Ms)} | ${valueText(summary.addedLatency.p95Ms)} | ${valueText(summary.addedTimeToFirstToken.p95Ms)} | ${valueText(summary.sseTokenInterval.p50Ms)} | ${summary.sseOrderErrors} |`);
  }
  lines.push("", "## Thresholds", "", "| Status | Rule | Run | Actual | Requirement |", "|---|---|---|---:|---:|");
  for (const check of report.thresholdChecks) {
    const requirement = check.operator === "within"
      ? `${check.expected} ± ${check.tolerance}`
      : `${check.operator} ${check.expected}`;
    lines.push(`| ${check.status} | ${check.id} | ${check.profile}/${check.target}/${check.stage} | ${valueText(check.actual)} | ${requirement} |`);
  }
  lines.push("", "## Baseline regression", "", "| Status | Run | Metric | Baseline | Current | Relative change | Absolute change |", "|---|---|---|---:|---:|---:|---:|");
  for (const check of report.regressionChecks) {
    lines.push(check.metric
      ? `| ${check.status} | ${check.profile}/${check.target}/${check.stage} | ${check.metric} | ${valueText(check.baseline)} | ${valueText(check.actual)} | ${valueText(check.changeRatio)} | ${valueText(check.absoluteChangeMs)} ms |`
      : `| ${check.status} | — | — | — | — | ${check.reason ?? "n/a"} | — |`);
  }
  if (report.skipped.length) {
    lines.push("", "## Skipped targets", "");
    for (const skipped of report.skipped) lines.push(`- \`${skipped.target}\`: ${skipped.reason}`);
  }
  if (report.capacityAnalysis?.length) {
    lines.push("", "## Capacity analysis", "", "| Target | Highest stable concurrency | Peak RPS | Saturation stage |", "|---|---:|---:|---|");
    for (const capacity of report.capacityAnalysis) {
      lines.push(`| ${capacity.target} | ${valueText(capacity.highestStableConcurrency)} | ${valueText(capacity.peakThroughputRps)} | ${capacity.saturationStage ?? "not reached"} |`);
    }
  }
  if (report.bottleneckAnalysis?.length) {
    lines.push("", "## Latency attribution", "", "| Run | Primary component | Provider p95 | Gateway/Relay added p95 | Provider share |", "|---|---|---:|---:|---:|");
    for (const item of report.bottleneckAnalysis) {
      lines.push(`| ${item.profile}/${item.target}/${item.stage} | ${item.primary} | ${valueText(item.providerP95Ms)} | ${valueText(item.gatewayRelayAddedP95Ms)} | ${valueText(item.providerShare)} |`);
    }
  }
  if (report.browserProbe && !report.browserProbe.skipped) {
    lines.push("", "## Browser probe", "", `- Wall load: ${valueText(report.browserProbe.wallLoadMs)} ms`, `- DOM content loaded: ${valueText(report.browserProbe.navigation?.domContentLoadedMs)} ms`, `- Registration dialog interaction: ${valueText(report.browserProbe.registrationDialogMs)} ms`, `- Page errors: ${report.browserProbe.pageErrors?.length ?? 0}`);
  }
  lines.push("", "## Scope notes", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  return lines.join("\n");
}

export function htmlReport(report) {
  const rows = report.runs.map((run) => `<tr><td>${escapeHtml(run.profile)}</td><td>${escapeHtml(run.target)}</td><td>${escapeHtml(run.stage)}</td><td>${run.summary.requests}</td><td>${valueText(run.summary.throughputRps)}</td><td>${valueText(run.summary.errorRate)}</td><td>${valueText(run.summary.latency.p95Ms)}</td><td>${valueText(run.summary.latency.p99Ms)}</td><td>${valueText(run.summary.timeToFirstToken.p95Ms)}</td><td>${valueText(run.summary.addedLatency.p95Ms)}</td><td>${valueText(run.summary.addedTimeToFirstToken.p95Ms)}</td><td>${valueText(run.summary.sseTokenInterval.p50Ms)}</td><td>${run.summary.sseOrderErrors}</td></tr>`).join("");
  const checks = report.thresholdChecks.map((check) => {
    const requirement = check.operator === "within" ? `${check.expected} ± ${check.tolerance}` : `${check.operator} ${check.expected}`;
    return `<tr class="${escapeHtml(check.status)}"><td>${escapeHtml(check.status)}</td><td>${escapeHtml(check.id)}</td><td>${escapeHtml(`${check.profile}/${check.target}/${check.stage}`)}</td><td>${escapeHtml(valueText(check.actual))}</td><td>${escapeHtml(requirement)}</td></tr>`;
  }).join("");
  const skipped = report.skipped.map((entry) => `<li><code>${escapeHtml(entry.target)}</code>: ${escapeHtml(entry.reason)}</li>`).join("");
  const attribution = (report.bottleneckAnalysis ?? []).map((item) => `<tr><td>${escapeHtml(`${item.profile}/${item.target}/${item.stage}`)}</td><td>${escapeHtml(item.primary)}</td><td>${valueText(item.providerP95Ms)}</td><td>${valueText(item.gatewayRelayAddedP95Ms)}</td><td>${valueText(item.providerShare)}</td></tr>`).join("");
  const browser = report.browserProbe && !report.browserProbe.skipped
    ? `<h2>Browser probe</h2><ul><li>Wall load: ${valueText(report.browserProbe.wallLoadMs)} ms</li><li>DOM content loaded: ${valueText(report.browserProbe.navigation?.domContentLoadedMs)} ms</li><li>Registration dialog: ${valueText(report.browserProbe.registrationDialogMs)} ms</li><li>Page errors: ${report.browserProbe.pageErrors?.length ?? 0}</li></ul>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Gateway performance report</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:32px;background:#0b0d12;color:#e8edf5}h1,h2{letter-spacing:.02em}code{color:#d7ff5f}table{width:100%;border-collapse:collapse;margin:16px 0 32px}th,td{padding:8px 10px;border:1px solid #303746;text-align:right}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2),th:nth-child(3),td:nth-child(3){text-align:left}.passed td:first-child{color:#8ce99a}.failed td:first-child{color:#ff8787}.not-evaluated td:first-child{color:#ffd43b}.status{display:inline-block;padding:4px 10px;border-radius:999px;background:${report.status === "passed" ? "#235c36" : "#7b2631"}}</style></head><body><h1>Agent Gateway performance report</h1><p class="status">${escapeHtml(report.status.toUpperCase())}</p><p>Suite <code>${escapeHtml(report.suite)}</code> · ${escapeHtml(report.startedAt)} · ${escapeHtml(report.environment.comparisonKey)}</p><h2>Load results</h2><table><thead><tr><th>Profile</th><th>Target</th><th>Stage</th><th>Requests</th><th>RPS</th><th>Error rate</th><th>p95</th><th>p99</th><th>TTFT p95</th><th>Added p95</th><th>Added TTFT p95</th><th>Token gap p50</th><th>SSE errors</th></tr></thead><tbody>${rows}</tbody></table><h2>Thresholds</h2><table><thead><tr><th>Status</th><th>Rule</th><th>Run</th><th>Actual</th><th>Requirement</th></tr></thead><tbody>${checks}</tbody></table>${attribution ? `<h2>Latency attribution</h2><table><thead><tr><th>Run</th><th>Primary</th><th>Provider p95</th><th>Added p95</th><th>Provider share</th></tr></thead><tbody>${attribution}</tbody></table>` : ""}${browser}<h2>Skipped targets</h2><ul>${skipped || "<li>None</li>"}</ul><h2>Scope notes</h2><ul>${report.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></body></html>`;
}

export async function writeReports(report, outputDirectory) {
  const resolved = path.resolve(outputDirectory);
  await mkdir(resolved, { recursive: true });
  const timestamp = report.startedAt.replaceAll(":", "-").replace(/\.\d{3}Z$/u, "Z");
  const stem = `${timestamp}-${report.suite}`.replace(/[^a-zA-Z0-9_.-]/gu, "-");
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = `${markdownReport(report)}\n`;
  const html = htmlReport(report);
  const paths = {
    json: path.join(resolved, `${stem}.json`),
    markdown: path.join(resolved, `${stem}.md`),
    html: path.join(resolved, `${stem}.html`),
    latestJson: path.join(resolved, "latest.json"),
    latestMarkdown: path.join(resolved, "latest.md"),
    latestHtml: path.join(resolved, "latest.html"),
  };
  await Promise.all([
    writeFile(paths.json, json, "utf8"),
    writeFile(paths.markdown, markdown, "utf8"),
    writeFile(paths.html, html, "utf8"),
    writeFile(paths.latestJson, json, "utf8"),
    writeFile(paths.latestMarkdown, markdown, "utf8"),
    writeFile(paths.latestHtml, html, "utf8"),
  ]);
  return paths;
}
