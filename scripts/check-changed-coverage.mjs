import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const THRESHOLDS = Object.freeze({ lines: 90, branches: 85, functions: 90 });
const ROOT = process.cwd();
const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function slash(value) {
  return String(value).replaceAll("\\", "/");
}

function git(...gitArgs) {
  return execFileSync("git", gitArgs, { cwd: ROOT, encoding: "utf8" });
}

function usableBase(value) {
  if (!value || /^0+$/.test(value)) return "HEAD^";
  try {
    git("rev-parse", "--verify", `${value}^{commit}`);
    return value;
  } catch {
    return "HEAD^";
  }
}

function changedLinesFromDiff(diff) {
  const files = new Map();
  let current = null;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      const value = line.slice(4).trim();
      current = value === "/dev/null" ? null : value.replace(/^b\//, "");
      if (current && !files.has(current)) files.set(current, new Set());
      continue;
    }
    if (!current || !line.startsWith("@@")) continue;
    const match = /\+(\d+)(?:,(\d+))?/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let number = start; number < start + count; number += 1) files.get(current).add(number);
  }
  return files;
}

function collectChanges(base) {
  const range = base === "HEAD" ? ["diff", "--unified=0", "HEAD"] : ["diff", "--unified=0", `${base}...HEAD`];
  const changes = changedLinesFromDiff(git(...range));
  if (base === "HEAD") {
    const untracked = git("ls-files", "--others", "--exclude-standard").split(/\r?\n/).filter(Boolean);
    for (const file of untracked) {
      const normalized = slash(file);
      if (!statSync(path.resolve(ROOT, file)).isFile()) continue;
      if (!changes.has(normalized)) {
        const lineCount = readFileSync(path.resolve(ROOT, file), "utf8").split(/\r?\n/).length;
        changes.set(normalized, new Set(Array.from({ length: lineCount }, (_, index) => index + 1)));
      }
    }
  }
  return changes;
}

function intersects(location, lines) {
  const start = Number(location?.start?.line ?? location?.line ?? 0);
  const end = Number(location?.end?.line ?? start);
  if (!start) return false;
  for (const line of lines) if (line >= start && line <= end) return true;
  return false;
}

function emptyMetrics() {
  return {
    lines: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
  };
}

function addMetric(target, metric, covered, total = 1) {
  target[metric].covered += covered;
  target[metric].total += total;
}

function mergeMetrics(target, source) {
  for (const metric of Object.keys(THRESHOLDS)) {
    target[metric].covered += source[metric].covered;
    target[metric].total += source[metric].total;
  }
}

async function javascriptMetrics(reportPath, changes, accepts) {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const result = emptyMetrics();
  const entries = Object.entries(report).map(([file, coverage]) => [slash(path.relative(ROOT, file)), coverage]);
  for (const [file, lines] of changes) {
    if (!accepts(file)) continue;
    const entry = entries.find(([name]) => name.toLowerCase() === file.toLowerCase());
    if (!entry) throw new Error(`Changed production file is missing from coverage: ${file}`);
    const coverage = entry[1];
    const lineState = new Map();
    for (const [id, location] of Object.entries(coverage.statementMap ?? {})) {
      if (!intersects(location, lines)) continue;
      const start = Number(location.start.line);
      const end = Number(location.end.line);
      for (const line of lines) {
        if (line < start || line > end) continue;
        lineState.set(line, (lineState.get(line) ?? false) || Number(coverage.s?.[id] ?? 0) > 0);
      }
    }
    for (const covered of lineState.values()) addMetric(result, "lines", covered ? 1 : 0);

    for (const [id, branch] of Object.entries(coverage.branchMap ?? {})) {
      const counts = coverage.b?.[id] ?? [];
      (branch.locations ?? []).forEach((location, index) => {
        if (intersects(location, lines)) addMetric(result, "branches", Number(counts[index] ?? 0) > 0 ? 1 : 0);
      });
    }
    for (const [id, fn] of Object.entries(coverage.fnMap ?? {})) {
      if (intersects(fn.decl, lines) || intersects(fn.loc, lines)) {
        addMetric(result, "functions", Number(coverage.f?.[id] ?? 0) > 0 ? 1 : 0);
      }
    }
  }
  return result;
}

function attributes(value) {
  return Object.fromEntries([...value.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

async function javaMetrics(reportPath, changes) {
  const xml = await readFile(reportPath, "utf8");
  const result = emptyMetrics();
  const sources = new Map();
  for (const packageMatch of xml.matchAll(/<package name="([^"]+)">([\s\S]*?)<\/package>/g)) {
    const packageName = packageMatch[1];
    const body = packageMatch[2];
    for (const sourceMatch of body.matchAll(/<sourcefile name="([^"]+)">([\s\S]*?)<\/sourcefile>/g)) {
      const file = `platform/backend/src/main/java/${packageName}/${sourceMatch[1]}`;
      sources.set(file, { body: sourceMatch[2], methods: [] });
    }
    for (const classMatch of body.matchAll(/<class name="[^"]+" sourcefilename="([^"]+)">([\s\S]*?)<\/class>/g)) {
      const file = `platform/backend/src/main/java/${packageName}/${classMatch[1]}`;
      const source = sources.get(file);
      if (!source) continue;
      for (const methodMatch of classMatch[2].matchAll(/<method ([^>]+)>([\s\S]*?)<\/method>/g)) {
        const method = attributes(methodMatch[1]);
        const counterMatch = /<counter type="METHOD" missed="(\d+)" covered="(\d+)"\/>/.exec(methodMatch[2]);
        if (method.line && counterMatch) source.methods.push({
          line: Number(method.line),
          missed: Number(counterMatch[1]),
          covered: Number(counterMatch[2]),
        });
      }
    }
  }

  for (const [file, lines] of changes) {
    if (!/^platform\/backend\/src\/main\/java\/.+\.java$/i.test(file)
      || /(?:PlatformApplication|Dtos|Repository)\.java$/i.test(file)) continue;
    const source = sources.get(file);
    if (!source) throw new Error(`Changed Java production file is missing from JaCoCo coverage: ${file}`);
    for (const lineMatch of source.body.matchAll(/<line ([^>]+)\/>/g)) {
      const line = attributes(lineMatch[1]);
      if (!lines.has(Number(line.nr))) continue;
      addMetric(result, "lines", Number(line.ci) > 0 ? 1 : 0);
      const totalBranches = Number(line.mb) + Number(line.cb);
      if (totalBranches > 0) addMetric(result, "branches", Number(line.cb), totalBranches);
    }
    source.methods.sort((left, right) => left.line - right.line);
    source.methods.forEach((method, index) => {
      const end = source.methods[index + 1]?.line ? source.methods[index + 1].line - 1 : Number.MAX_SAFE_INTEGER;
      if ([...lines].some((line) => line >= method.line && line <= end)) {
        addMetric(result, "functions", method.covered, method.covered + method.missed);
      }
    });
  }
  return result;
}

function acceptsDesktop(file) {
  return /^src\/.+\.js$/i.test(file)
    && !/^src\/electron\/main\.js$/i.test(file)
    && !/^src\/server\/standalone\.js$/i.test(file);
}

function acceptsFrontend(file) {
  return /^platform\/frontend\/src\/.+\.(?:ts|tsx)$/i.test(file)
    && !/\.test\.(?:ts|tsx)$/i.test(file)
    && !/^platform\/frontend\/src\/test\//i.test(file)
    && !/^platform\/frontend\/src\/(?:main\.tsx|types\.ts)$/i.test(file);
}

const scope = option("--scope", "all");
if (!["all", "desktop", "backend", "frontend"].includes(scope)) throw new Error(`Unknown coverage scope: ${scope}`);
const base = usableBase(option("--base", process.env.COVERAGE_BASE_REF || "HEAD"));
const changes = collectChanges(base);
const metrics = emptyMetrics();

if (scope === "all" || scope === "desktop") {
  mergeMetrics(metrics, await javascriptMetrics(path.resolve("coverage", "desktop", "coverage-final.json"), changes, acceptsDesktop));
}
if (scope === "all" || scope === "frontend") {
  mergeMetrics(metrics, await javascriptMetrics(path.resolve("platform", "frontend", "coverage", "coverage-final.json"), changes, acceptsFrontend));
}
if (scope === "all" || scope === "backend") {
  mergeMetrics(metrics, await javaMetrics(path.resolve("platform", "backend", "target", "site", "jacoco", "jacoco.xml"), changes));
}

let failed = false;
for (const [metric, minimum] of Object.entries(THRESHOLDS)) {
  const value = metrics[metric];
  if (value.total === 0) {
    console.log(`Changed ${metric}: no executable ${metric} changed in ${scope} scope.`);
    continue;
  }
  const actual = (value.covered / value.total) * 100;
  const message = `Changed ${metric}: ${actual.toFixed(2)}% (${value.covered}/${value.total}); required ${minimum}%.`;
  if (actual + Number.EPSILON < minimum) {
    failed = true;
    console.error(message);
  } else {
    console.log(message);
  }
}
if (failed) process.exitCode = 1;
