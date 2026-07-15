import { buildThreadOptions, normalizeSpeed, publicWorkerError, sanitizeIpcValue } from "./protocol.js";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

let abortController = null;
let started = false;
let finishing = false;

function send(message) {
  if (!process.send || !process.connected) return;
  try {
    process.send(sanitizeIpcValue(message));
  } catch {
    // The parent may have closed IPC while cancellation was in flight.
  }
}

function disconnectSoon() {
  finishing = true;
  setImmediate(() => {
    try {
      if (process.connected) process.disconnect();
    } catch {
      // Nothing remains to report.
    }
  });
}

function pathEnvironmentKey(env) {
  const matches = Object.keys(env).filter((key) => key.toLowerCase() === "path");
  return matches.includes("Path") ? "Path" : matches.at(-1) ?? "PATH";
}

export function resolvePackagedCodexRuntime(
  resourcesPath = process.resourcesPath,
  platform = process.platform,
  arch = process.arch,
) {
  if (!resourcesPath) return null;
  const runtimes = {
    "win32:x64": ["@openai/codex-win32-x64", "x86_64-pc-windows-msvc", "codex.exe"],
    "win32:arm64": ["@openai/codex-win32-arm64", "aarch64-pc-windows-msvc", "codex.exe"],
  };
  const runtime = runtimes[`${platform}:${arch}`];
  if (!runtime) return null;
  const [packageName, targetTriple, binaryName] = runtime;
  const packageRoot = path.join(
    resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    packageName,
    "vendor",
    targetTriple,
  );
  const candidates = [
    path.join(packageRoot, "bin", binaryName),
    path.join(packageRoot, "codex", binaryName),
  ];
  const executablePath = candidates.find((candidate) => {
    try { return existsSync(candidate) && statSync(candidate).isFile(); } catch { return false; }
  });
  if (!executablePath) return null;
  const pathDirectory = path.join(packageRoot, "codex-path");
  return {
    executablePath,
    pathDirectory: existsSync(pathDirectory) ? pathDirectory : null,
  };
}

function runtimeEnvironment(runtime) {
  if (!runtime?.pathDirectory) return undefined;
  const env = { ...process.env };
  const key = pathEnvironmentKey(env);
  env[key] = [runtime.pathDirectory, env[key]].filter(Boolean).join(path.delimiter);
  return env;
}

export async function executeCodexTask(task, dependencies = {}) {
  const loadSdk = dependencies.loadSdk ?? (() => import("@openai/codex-sdk"));
  const emit = dependencies.emit ?? (() => {});
  const signal = dependencies.signal;
  const { Codex } = await loadSdk();
  const runtime = dependencies.packagedRuntime
    ?? resolvePackagedCodexRuntime(dependencies.resourcesPath);
  const speed = normalizeSpeed(task.speed);
  const apiKey = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY || undefined;
  const codex = new Codex({
    ...(runtime ? {
      codexPathOverride: runtime.executablePath,
      env: runtimeEnvironment(runtime),
    } : {}),
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL || undefined,
    config: {
      ...(speed === "fast" ? { service_tier: "fast" } : {}),
      shell_environment_policy: {
        exclude: ["OPENAI_API_KEY", "CODEX_API_KEY", "API_TOKEN"],
      },
    },
  });
  if (task.probeSdk === true) {
    // Constructing the client resolves and validates the packaged native Codex
    // executable without starting a model turn or consuming API usage.
    return { content: "SDK_RESOLVED", usage: null, threadId: null };
  }
  const thread = codex.startThread(buildThreadOptions(task));
  const { events } = await thread.runStreamed(task.prompt, { signal });

  let finalResponse = "";
  let usage = null;
  let threadId = null;
  let completed = false;

  for await (const event of events) {
    emit({ kind: "sdk", event });
    if (event.type === "thread.started") {
      threadId = event.thread_id;
    } else if (event.type === "item.completed" && event.item?.type === "agent_message") {
      finalResponse = event.item.text ?? "";
    } else if (event.type === "turn.completed") {
      usage = event.usage ?? null;
      completed = true;
    } else if (event.type === "turn.failed") {
      const failure = new Error("Codex turn failed");
      failure.code = "CODEX_TURN_FAILED";
      throw failure;
    } else if (event.type === "error") {
      const failure = new Error(event.message || "Codex stream failed");
      failure.code = "CODEX_STREAM_FAILED";
      throw failure;
    }
  }

  if (signal?.aborted) {
    const error = new Error("Task cancelled");
    error.name = "AbortError";
    throw error;
  }
  if (!completed) throw new Error("Codex event stream ended before turn completion");
  return { content: finalResponse, usage, threadId: threadId ?? thread.id ?? null };
}

async function runFromMessage(task) {
  abortController = new AbortController();
  try {
    const result = await executeCodexTask(task, {
      signal: abortController.signal,
      emit: (event) => send({ type: "event", payload: event }),
    });
    send({ type: "completed", result });
  } catch (error) {
    if (abortController.signal.aborted || error?.name === "AbortError" || error?.code === "ABORT_ERR") {
      send({ type: "cancelled" });
    } else {
      send({ type: "failed", error: publicWorkerError(error) });
    }
  } finally {
    abortController = null;
    disconnectSoon();
  }
}

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "start" && !started) {
    started = true;
    void runFromMessage(message.task);
  } else if (message.type === "cancel") {
    abortController?.abort(message.reason ?? "cancelled");
  }
});

process.on("SIGTERM", () => {
  abortController?.abort("terminated");
  if (!abortController && !finishing) disconnectSoon();
});

process.on("uncaughtException", (error) => {
  abortController?.abort("worker exception");
  send({ type: "failed", error: publicWorkerError(error) });
  disconnectSoon();
});

process.on("unhandledRejection", (error) => {
  abortController?.abort("worker rejection");
  send({ type: "failed", error: publicWorkerError(error) });
  disconnectSoon();
});

send({ type: "ready" });
