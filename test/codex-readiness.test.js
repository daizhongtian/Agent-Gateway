import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  classifyLoginStatus,
  detectCodexReadiness,
  executeFile,
  findBundledCodexRuntime,
  parseCodexVersion,
  sanitizeDiagnosticText,
} from "../src/electron/codex-readiness.js";

test("readiness diagnostics redact credentials and account data", () => {
  const source = "OPENAI_API_KEY=sk-test_123456789 user@example.com C:\\Users\\alice\\.codex ccc_live_1234567890";
  const sanitized = sanitizeDiagnosticText(source);
  assert.doesNotMatch(sanitized, /sk-test|ccc_live|user@example|\\alice/i);
  assert.match(sanitized, /REDACTED/);
  assert.match(sanitized, /ACCOUNT/);
  assert.match(sanitized, /%USERPROFILE%/);
});

test("version parsing accepts Codex CLI output without returning arbitrary long output", () => {
  assert.equal(parseCodexVersion("codex-cli 0.144.4\r\n"), "0.144.4");
  assert.equal(parseCodexVersion("Codex v5.6.1-beta.2"), "5.6.1-beta.2");
  assert.ok(parseCodexVersion("custom build without semver").length <= 96);
});

test("bundled runtime lookup supports the electron-builder unpacked layout", () => {
  const resourcesPath = path.resolve("C:\\Program Files\\Codex Control Center\\resources");
  const executablePath = path.join(
    resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
    "bin",
    "codex.exe",
  );
  const pathDirectory = path.join(path.dirname(path.dirname(executablePath)), "codex-path");
  const existing = new Set([executablePath, pathDirectory]);
  const runtime = findBundledCodexRuntime({
    resourcesPath,
    appPath: "C:\\unused\\app.asar",
    platform: "win32",
    arch: "x64",
    fileExists: (candidate) => existing.has(candidate),
    fileStat: () => ({ isFile: () => true }),
  });
  assert.equal(runtime.executablePath, executablePath);
  assert.equal(runtime.pathDirectory, pathDirectory);
  assert.equal(runtime.packageName, "@openai/codex-win32-x64");
});

test("readiness check reports a ready machine without model calls", async () => {
  const resourcesPath = path.resolve("C:\\Codex\\resources");
  const executablePath = path.join(
    resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
    "bin",
    "codex.exe",
  );
  const existing = new Set([executablePath]);
  const calls = [];
  const execute = async (file, args, options) => {
    calls.push({ file, args: [...args], timeoutMs: options.timeoutMs });
    if (file === executablePath && args[0] === "--version") {
      return { ok: true, code: 0, stdout: "codex-cli 0.144.4", stderr: "", timedOut: false };
    }
    if (file === "where.exe") {
      return { ok: true, code: 0, stdout: "C:\\Tools\\codex.cmd", stderr: "", timedOut: false };
    }
    if (/cmd\.exe$/i.test(file)) {
      return { ok: true, code: 0, stdout: "codex-cli 0.143.0", stderr: "", timedOut: false };
    }
    if (/powershell\.exe$/i.test(file)) {
      return { ok: true, code: 0, stdout: '{"name":"OpenAI.Codex","version":"26.7.1"}', stderr: "", timedOut: false };
    }
    if (file === executablePath && args.join(" ") === "login status") {
      return { ok: true, code: 0, stdout: "Logged in using ChatGPT", stderr: "", timedOut: false };
    }
    throw new Error(`Unexpected command: ${file} ${args.join(" ")}`);
  };

  const result = await detectCodexReadiness({
    resourcesPath,
    appPath: "C:\\Codex\\resources\\app.asar",
    platform: "win32",
    arch: "x64",
    environment: { SystemRoot: "C:\\Windows", ComSpec: "C:\\Windows\\System32\\cmd.exe", PATH: "C:\\Tools" },
    execute,
    fileExists: (candidate) => existing.has(candidate),
    fileStat: () => ({ isFile: () => true }),
    timeoutMs: 1_000,
  });

  assert.equal(result.overall, "ready");
  assert.equal(result.ready, true);
  assert.equal(result.runtime.status, "available");
  assert.equal(result.runtime.version, "0.144.4");
  assert.equal(result.cli.status, "available");
  assert.equal(result.app.status, "available");
  assert.equal(result.auth.status, "logged-in");
  assert.equal(result.auth.method, "chatgpt");
  assert.equal(result.consumesTokens, false);
  assert.ok(calls.some(({ args }) => args.join(" ") === "login status"));
  assert.ok(calls.every(({ args }) => !args.includes("run") && !args.includes("exec")));
  assert.equal("executablePath" in result.runtime, false);
});

test("missing bundled runtime is unavailable and never performs a login check", async () => {
  const calls = [];
  const execute = async (file, args) => {
    calls.push({ file, args: [...args] });
    if (file === "where.exe") return { ok: false, code: 1, stdout: "", stderr: "", timedOut: false };
    if (/powershell\.exe$/i.test(file)) return { ok: true, code: 0, stdout: "", stderr: "", timedOut: false };
    throw new Error(`Unexpected command: ${file}`);
  };
  const result = await detectCodexReadiness({
    resourcesPath: "C:\\missing",
    appPath: "C:\\missing\\app.asar",
    platform: "win32",
    arch: "x64",
    environment: { SystemRoot: "C:\\Windows" },
    execute,
    fileExists: () => false,
    fileStat: () => ({ isFile: () => false }),
    timeoutMs: 1_000,
  });
  assert.equal(result.overall, "unavailable");
  assert.equal(result.runtime.status, "missing");
  assert.equal(result.cli.status, "missing");
  assert.equal(result.auth.status, "unknown");
  assert.ok(calls.every(({ args }) => args.join(" ") !== "login status"));
});

test("login classification distinguishes signed out and timed out checks", () => {
  assert.deepEqual(
    classifyLoginStatus({ ok: false, stdout: "Not logged in", stderr: "", timedOut: false }),
    { status: "logged-out", method: null, detail: "Codex login is required." },
  );
  assert.deepEqual(
    classifyLoginStatus({ ok: false, stdout: "", stderr: "", timedOut: true }),
    { status: "unknown", method: null, detail: "Login status check timed out." },
  );
});

test("real command execution enforces its timeout", async () => {
  const startedAt = Date.now();
  const result = await executeFile(process.execPath, ["-e", "setTimeout(() => {}, 2000)"], { timeoutMs: 250 });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - startedAt < 1_800);
});
