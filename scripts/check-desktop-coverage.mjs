import { readFile } from "node:fs/promises";
import path from "node:path";

const REPORT_PATH = path.resolve("coverage", "desktop", "coverage-summary.json");
const SECURITY_FILES = Object.freeze([
  "src/server/auth.js",
  "src/server/api-key-store.js",
  "src/server/secret-protector.js",
  "src/server/config.js",
  "src/electron/platform-client.js",
  "src/runner/protocol.js",
]);
const THRESHOLDS = Object.freeze({ lines: 95, branches: 90, functions: 95 });

function normalized(value) {
  return String(value).replaceAll("\\", "/").toLowerCase();
}

function percentage(covered, total) {
  return total === 0 ? 100 : (covered / total) * 100;
}

const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
const entries = Object.entries(report).filter(([name]) => name !== "total");
const selected = SECURITY_FILES.map((file) => {
  const suffix = normalized(file);
  const match = entries.find(([name]) => normalized(name).endsWith(suffix));
  if (!match) throw new Error(`Security coverage file is missing from the report: ${file}`);
  return match;
});

let failed = false;
for (const [metric, minimum] of Object.entries(THRESHOLDS)) {
  const aggregate = selected.reduce((result, [, value]) => ({
    covered: result.covered + value[metric].covered,
    total: result.total + value[metric].total,
  }), { covered: 0, total: 0 });
  const actual = percentage(aggregate.covered, aggregate.total);
  const label = `${metric}: ${actual.toFixed(2)}% (${aggregate.covered}/${aggregate.total})`;
  if (actual + Number.EPSILON < minimum) {
    failed = true;
    console.error(`Security coverage failed — ${label}; required ${minimum}%.`);
  } else {
    console.log(`Security coverage passed — ${label}; required ${minimum}%.`);
  }
}

if (failed) process.exitCode = 1;
