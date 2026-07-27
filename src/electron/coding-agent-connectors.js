import { spawn } from "node:child_process";
import path from "node:path";

import { findBundledCodexRuntime, sanitizeDiagnosticText } from "./codex-readiness.js";

const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_ERROR_OUTPUT = 4_096;

export const CODING_AGENT_CONNECTORS = Object.freeze({
  "chatgpt-codex": Object.freeze({
    id: "chatgpt-codex",
    label: "ChatGPT",
    commandArgs: Object.freeze(["login"]),
  }),
});

function connectorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function runtimeEnvironment(runtime, sourceEnvironment) {
  const environment = { ...sourceEnvironment };
  if (!runtime?.pathDirectory) return environment;
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "PATH";
  environment[pathKey] = [runtime.pathDirectory, environment[pathKey]].filter(Boolean).join(path.delimiter);
  return environment;
}

export function connectCodingAgent(providerId, {
  resourcesPath = process.resourcesPath,
  appPath = process.cwd(),
  platform = process.platform,
  arch = process.arch,
  environment = process.env,
  findRuntime = findBundledCodexRuntime,
  spawnProcess = spawn,
  timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
} = {}) {
  const connector = CODING_AGENT_CONNECTORS[String(providerId ?? "").trim().toLowerCase()];
  if (!connector) {
    return Promise.reject(connectorError("UNSUPPORTED_CODING_AGENT", "This coding agent connector is not supported."));
  }
  if (platform !== "win32") {
    return Promise.reject(connectorError("UNSUPPORTED_PLATFORM", "Coding agent connection is supported on Windows only."));
  }

  const runtime = findRuntime({ resourcesPath, appPath, platform, arch });
  if (!runtime?.executablePath) {
    return Promise.reject(connectorError("CODEX_RUNTIME_MISSING", "The bundled Codex runtime is unavailable."));
  }

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let errorOutput = "";
    let timeout;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
    };

    try {
      child = spawnProcess(runtime.executablePath, [...connector.commandArgs], {
        env: runtimeEnvironment(runtime, environment),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (error) {
      reject(connectorError("LOGIN_START_FAILED", sanitizeDiagnosticText(error?.message) || "Unable to start ChatGPT login."));
      return;
    }

    timeout = setTimeout(() => {
      try { child.kill(); } catch { /* The login process may already have ended. */ }
      finish(connectorError("LOGIN_TIMEOUT", "ChatGPT login timed out."));
    }, Math.max(30_000, Number(timeoutMs) || DEFAULT_LOGIN_TIMEOUT_MS));
    timeout.unref?.();

    child.stderr?.on("data", (chunk) => {
      if (errorOutput.length >= MAX_ERROR_OUTPUT) return;
      errorOutput += String(chunk ?? "").slice(0, MAX_ERROR_OUTPUT - errorOutput.length);
    });
    child.once("error", (error) => {
      finish(connectorError("LOGIN_START_FAILED", sanitizeDiagnosticText(error?.message) || "Unable to start ChatGPT login."));
    });
    child.once("close", (code) => {
      if (code === 0) {
        finish(null, Object.freeze({ ok: true, providerId: connector.id, providerLabel: connector.label }));
        return;
      }
      const detail = sanitizeDiagnosticText(errorOutput, 240);
      finish(connectorError("LOGIN_FAILED", detail || "ChatGPT login was not completed."));
    });
  });
}
