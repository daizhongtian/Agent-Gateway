import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 4_000;
const BUNDLED_RUNTIME_TIMEOUT_MS = 8_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const SAFE_VERSION_LENGTH = 96;

const WINDOWS_RUNTIMES = Object.freeze({
  x64: Object.freeze({
    packageName: "@openai/codex-win32-x64",
    targetTriple: "x86_64-pc-windows-msvc",
  }),
  arm64: Object.freeze({
    packageName: "@openai/codex-win32-arm64",
    targetTriple: "aarch64-pc-windows-msvc",
  }),
});

function isFile(filePath, fileExists = existsSync, fileStat = statSync) {
  try {
    return fileExists(filePath) && fileStat(filePath).isFile();
  } catch {
    return false;
  }
}

function normalizeOutput(value) {
  return String(value ?? "").replaceAll("\0", "").trim();
}

export function sanitizeDiagnosticText(value, maxLength = 240) {
  let text = normalizeOutput(value)
    .replace(/\b(?:sk|sess|ccc_live)_[A-Za-z0-9._~+\/-]{8,}\b/gi, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\b(OPENAI_API_KEY|CODEX_API_KEY|API_TOKEN)\s*[=:]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[ACCOUNT]")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, "%USERPROFILE%")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (text.length > maxLength) text = `${text.slice(0, Math.max(0, maxLength - 1))}…`;
  return text;
}

export function parseCodexVersion(value) {
  const text = sanitizeDiagnosticText(value, 500);
  if (!text) return null;
  const semantic = text.match(/(?:codex(?:-cli)?\s*)?v?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/i);
  if (semantic) return semantic[1].slice(0, SAFE_VERSION_LENGTH);
  return text.split(" ").slice(0, 6).join(" ").slice(0, SAFE_VERSION_LENGTH) || null;
}

export function classifyLoginStatus(result) {
  const output = sanitizeDiagnosticText(`${result?.stdout ?? ""} ${result?.stderr ?? ""}`, 300);
  const normalized = output.toLowerCase();
  if (/not logged in|not authenticated|login required|please log in|please login/.test(normalized)) {
    return { status: "logged-out", method: null, detail: "Codex login is required." };
  }
  if (result?.ok && /logged in|authenticated|chatgpt|api key/.test(normalized)) {
    const method = normalized.includes("chatgpt")
      ? "chatgpt"
      : normalized.includes("api key")
        ? "api-key"
        : "codex";
    return { status: "logged-in", method, detail: "Codex authentication is available." };
  }
  if (result?.timedOut) return { status: "unknown", method: null, detail: "Login status check timed out." };
  return {
    status: "unknown",
    method: null,
    detail: output || "Login status could not be determined.",
  };
}

export function findBundledCodexRuntime({
  resourcesPath = process.resourcesPath,
  appPath = process.cwd(),
  platform = process.platform,
  arch = process.arch,
  fileExists = existsSync,
  fileStat = statSync,
} = {}) {
  if (platform !== "win32" || !WINDOWS_RUNTIMES[arch]) return null;
  const { packageName, targetTriple } = WINDOWS_RUNTIMES[arch];
  const unpackagedAppPath = appPath && !/\.asar$/iu.test(appPath)
    ? path.join(appPath, "node_modules")
    : null;
  const roots = [
    resourcesPath && path.join(resourcesPath, "app.asar.unpacked", "node_modules"),
    unpackagedAppPath,
    appPath && path.join(path.dirname(appPath), "app.asar.unpacked", "node_modules"),
  ].filter(Boolean);
  const uniqueRoots = [...new Set(roots.map((root) => path.resolve(root)))];
  for (const modulesRoot of uniqueRoots) {
    const targetRoot = path.join(modulesRoot, packageName, "vendor", targetTriple);
    const candidates = [
      path.join(targetRoot, "bin", "codex.exe"),
      path.join(targetRoot, "codex", "codex.exe"),
    ];
    const executablePath = candidates.find((candidate) => isFile(candidate, fileExists, fileStat));
    if (!executablePath) continue;
    const pathDirectory = path.join(targetRoot, "codex-path");
    return {
      executablePath,
      pathDirectory: fileExists(pathDirectory) ? pathDirectory : null,
      packageName,
      arch,
    };
  }
  return null;
}

export function executeFile(file, args = [], options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(250, options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    const finish = (error, stdout = "", stderr = "") => {
      resolve({
        ok: !error,
        code: Number.isInteger(error?.code) ? error.code : (!error ? 0 : null),
        timedOut: Boolean(error?.killed || error?.code === "ETIMEDOUT"),
        stdout: normalizeOutput(stdout),
        stderr: normalizeOutput(stderr),
        error: error ? sanitizeDiagnosticText(error.message) : null,
      });
    };
    try {
      execFile(file, args, {
        windowsHide: true,
        shell: false,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
        env: options.env,
      }, finish);
    } catch (error) {
      finish(error);
    }
  });
}

function runtimeEnvironment(runtime, sourceEnvironment) {
  const env = { ...sourceEnvironment };
  if (!runtime?.pathDirectory) return env;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = [runtime.pathDirectory, env[pathKey]].filter(Boolean).join(path.delimiter);
  return env;
}

function firstExecutableFromWhere(output, bundledPath) {
  const bundled = bundledPath ? path.resolve(bundledPath).toLowerCase() : null;
  for (const line of normalizeOutput(output).split(/\r?\n/)) {
    const candidate = line.trim().replace(/^"|"$/g, "");
    if (!candidate || !/\.(?:exe|cmd)$/i.test(candidate)) continue;
    if (bundled && path.resolve(candidate).toLowerCase() === bundled) continue;
    return candidate;
  }
  return null;
}

function commandForExecutable(executablePath, args, environment) {
  if (!/\.cmd$/i.test(executablePath)) return { file: executablePath, args };
  const comSpec = environment.ComSpec || environment.COMSPEC || "cmd.exe";
  const quotedPath = `"${executablePath.replaceAll('"', '""')}"`;
  const safeArgs = args.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(" ");
  return { file: comSpec, args: ["/d", "/s", "/c", `${quotedPath} ${safeArgs}`] };
}

async function runExecutable(execute, executablePath, args, options) {
  const command = commandForExecutable(executablePath, args, options.env || {});
  return execute(command.file, command.args, options);
}

function safeAppPackage(value) {
  try {
    const parsed = JSON.parse(normalizeOutput(value));
    if (!parsed || typeof parsed !== "object") return null;
    return {
      name: sanitizeDiagnosticText(parsed.name || parsed.Name || "Codex", 80),
      version: sanitizeDiagnosticText(parsed.version || parsed.Version || "", SAFE_VERSION_LENGTH) || null,
    };
  } catch {
    return null;
  }
}

export async function detectCodexReadiness({
  resourcesPath = process.resourcesPath,
  appPath = process.cwd(),
  platform = process.platform,
  arch = process.arch,
  environment = process.env,
  execute = executeFile,
  fileExists = existsSync,
  fileStat = statSync,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const checkedAt = new Date().toISOString();
  if (platform !== "win32") {
    return {
      checkedAt,
      overall: "unsupported",
      ready: false,
      runtime: { status: "unsupported", version: null, arch },
      cli: { status: "unsupported", version: null },
      app: { status: "unsupported", version: null },
      auth: { status: "unknown", method: null },
      consumesTokens: false,
    };
  }

  const runtime = findBundledCodexRuntime({
    resourcesPath,
    appPath,
    platform,
    arch,
    fileExists,
    fileStat,
  });
  const internalVersionResult = runtime
    ? await runExecutable(execute, runtime.executablePath, ["--version"], {
        timeoutMs: Math.max(timeoutMs, BUNDLED_RUNTIME_TIMEOUT_MS),
        env: runtimeEnvironment(runtime, environment),
      })
    : null;
  const runtimeStatus = !runtime
    ? { status: "missing", version: null, arch }
    : internalVersionResult.ok
      ? { status: "available", version: parseCodexVersion(internalVersionResult.stdout || internalVersionResult.stderr), arch }
      : {
          status: "broken",
          version: null,
          arch,
          detail: internalVersionResult.timedOut ? "Bundled runtime check timed out." : "Bundled runtime could not start.",
        };

  const whereResult = await execute("where.exe", ["codex"], { timeoutMs: Math.min(timeoutMs, 3_000), env: environment });
  const externalPath = whereResult.ok ? firstExecutableFromWhere(whereResult.stdout, runtime?.executablePath) : null;
  const externalVersionResult = externalPath
    ? await runExecutable(execute, externalPath, ["--version"], { timeoutMs, env: environment })
    : null;
  const cliStatus = !externalPath
    ? { status: "missing", version: null }
    : externalVersionResult.ok
      ? { status: "available", version: parseCodexVersion(externalVersionResult.stdout || externalVersionResult.stderr) }
      : {
          status: "broken",
          version: null,
          detail: externalVersionResult.timedOut ? "External CLI check timed out." : "External CLI could not start.",
        };

  const powershell = path.join(environment.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const appScript = [
    "$pkg = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if (-not $pkg) { $pkg = Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'OpenAI.*Codex|(^|\\.)Codex$' -or $_.PackageFamilyName -match 'OpenAI\\.Codex' } | Select-Object -First 1 }",
    "if ($pkg) { @{ name = [string]$pkg.Name; version = [string]$pkg.Version } | ConvertTo-Json -Compress }",
  ].join("; ");
  const appResult = await execute(powershell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    appScript,
  ], { timeoutMs: Math.min(timeoutMs, 3_500), env: environment });
  const appPackage = appResult.ok ? safeAppPackage(appResult.stdout) : null;
  const appStatus = appPackage
    ? { status: "available", ...appPackage }
    : appResult.ok
      ? { status: "missing", version: null }
      : {
          status: "unknown",
          version: null,
          detail: appResult.timedOut ? "Windows app check timed out." : "Windows app status could not be checked.",
        };

  const authExecutable = runtimeStatus.status === "available"
    ? runtime?.executablePath
    : cliStatus.status === "available"
      ? externalPath
      : null;
  const authEnvironment = authExecutable === runtime?.executablePath
    ? runtimeEnvironment(runtime, environment)
    : environment;
  const loginResult = authExecutable
    ? await runExecutable(execute, authExecutable, ["login", "status"], {
        timeoutMs: Math.max(timeoutMs, 5_000),
        env: authEnvironment,
      })
    : null;
  const authStatus = loginResult
    ? classifyLoginStatus(loginResult)
    : { status: "unknown", method: null, detail: "No usable Codex runtime was found for the login check." };

  const runtimeReady = runtimeStatus.status === "available";
  const ready = runtimeReady && authStatus.status === "logged-in";
  const overall = ready
    ? "ready"
    : !runtimeReady
      ? "unavailable"
      : authStatus.status === "logged-out"
        ? "login-required"
        : "attention";

  return {
    checkedAt,
    overall,
    ready,
    runtime: runtimeStatus,
    cli: cliStatus,
    app: appStatus,
    auth: authStatus,
    consumesTokens: false,
  };
}
