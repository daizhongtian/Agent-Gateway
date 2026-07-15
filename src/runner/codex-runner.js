import { fork, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { redactSecrets } from "./protocol.js";

const DEFAULT_WORKER_PATH = fileURLToPath(new URL("./worker.js", import.meta.url));
const ENV_ALLOWLIST = /^(?:path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|homedrive|homepath|appdata|localappdata|codex_home|openai_api_key|codex_api_key|openai_base_url|http_proxy|https_proxy|no_proxy|all_proxy|ssl_cert_file|node_extra_ca_certs)$/i;

export class RunnerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RunnerError";
    this.code = code;
  }
}

export class RunnerCancelledError extends RunnerError {
  constructor(message = "Task was cancelled") {
    super("TASK_CANCELLED", message);
    this.name = "RunnerCancelledError";
  }
}

export class RunnerTimeoutError extends RunnerError {
  constructor(message = "Task exceeded its time limit") {
    super("TASK_TIMEOUT", message);
    this.name = "RunnerTimeoutError";
  }
}

function workerEnvironment(source = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && ENV_ALLOWLIST.test(key)) env[key] = value;
  }
  env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}

function forceKillTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch { /* Process already exited. */ }
  }
}

class RunnerExecution {
  constructor(child, task, options) {
    this.child = child;
    this.task = task;
    this.onEvent = options.onEvent ?? (() => {});
    this.killGraceMs = options.killGraceMs;
    this.exposeDiagnostics = options.exposeDiagnostics === true;
    this.finished = false;
    this.terminal = null;
    this.cancelReason = null;
    this.forceTimer = null;
    this.timeoutTimer = null;
    this.ready = false;

    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });

    child.on("message", (message) => this.#onMessage(message));
    child.once("error", () => {
      this.#recordTerminal({
        kind: "error",
        error: new RunnerError("WORKER_START_FAILED", "Codex task worker could not start."),
      });
    });
    // `close` is emitted after stdio closes for both normal exits and spawn
    // failures; unlike `exit`, it also reliably covers a failed fork.
    child.once("close", (code, signal) => this.#onClose(code, signal));
    child.stdout?.on("data", (chunk) => this.#diagnostic("stdout", chunk));
    child.stderr?.on("data", (chunk) => this.#diagnostic("stderr", chunk));

    if (options.timeoutMs > 0) {
      this.timeoutTimer = setTimeout(() => this.cancel("timeout"), options.timeoutMs);
      this.timeoutTimer.unref?.();
    }
  }

  #diagnostic(stream, chunk) {
    if (!this.exposeDiagnostics) return;
    const message = redactSecrets(String(chunk)).trim();
    if (!message) return;
    try { this.onEvent({ kind: "diagnostic", stream, message }); } catch { /* Observer errors are isolated. */ }
  }

  #onMessage(message) {
    if (this.finished || !message || typeof message !== "object") return;
    if (message.type === "ready" && !this.ready) {
      this.ready = true;
      if (this.cancelReason || this.terminal) return;
      this.child.send({ type: "start", task: this.task }, (error) => {
        if (error) this.#fail(new RunnerError("WORKER_IPC_FAILED", "Codex task worker became unavailable."));
      });
    } else if (message.type === "event" && !this.terminal) {
      try { this.onEvent(message.payload); } catch { /* Observer errors are isolated. */ }
    } else if (message.type === "completed") {
      this.#recordTerminal({
        kind: "success",
        result: message.result ?? { content: "", usage: null, threadId: null },
      });
    } else if (message.type === "failed") {
      this.#recordTerminal({
        kind: "error",
        error: new RunnerError(message.error?.code ?? "CODEX_RUN_FAILED", message.error?.message ?? "Codex could not complete this task."),
      });
    } else if (message.type === "cancelled") {
      this.#recordTerminal({
        kind: "error",
        error: this.cancelReason === "timeout" ? new RunnerTimeoutError() : new RunnerCancelledError(),
      });
    }
  }

  #onClose(code, signal) {
    if (this.finished) return;
    if (this.terminal) {
      if (this.terminal.kind === "success") this.#succeed(this.terminal.result);
      else this.#fail(this.terminal.error);
      return;
    }
    if (this.cancelReason) {
      this.#fail(this.cancelReason === "timeout" ? new RunnerTimeoutError() : new RunnerCancelledError());
      return;
    }
    this.#fail(new RunnerError(
      "WORKER_EXITED",
      code === 0 && !signal ? "Codex task worker ended before returning a result." : "Codex task worker stopped unexpectedly.",
    ));
  }

  #cleanup() {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    if (this.forceTimer) clearTimeout(this.forceTimer);
    this.timeoutTimer = null;
    this.forceTimer = null;
  }

  #recordTerminal(terminal) {
    if (this.finished || this.terminal) return;
    this.terminal = terminal;
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = null;
    // A terminal IPC message is only an acknowledgement. Keep the worker in
    // the active set until it exits so its Codex subprocess cannot be orphaned.
    if (!this.forceTimer) {
      this.forceTimer = setTimeout(() => forceKillTree(this.child), this.killGraceMs);
      this.forceTimer.unref?.();
    }
  }

  #succeed(result) {
    if (this.finished) return;
    this.finished = true;
    this.#cleanup();
    this.resolve(result);
  }

  #fail(error) {
    if (this.finished) return;
    this.finished = true;
    this.#cleanup();
    this.reject(error);
  }

  cancel(reason = "cancelled") {
    if (this.finished || this.terminal || this.cancelReason) return false;
    this.cancelReason = reason;
    try {
      if (this.child.connected) this.child.send({ type: "cancel", reason });
    } catch {
      // The force-kill timer below handles a broken IPC channel.
    }
    this.forceTimer = setTimeout(() => forceKillTree(this.child), this.killGraceMs);
    this.forceTimer.unref?.();
    return true;
  }
}

export class CodexRunner {
  constructor(options = {}) {
    this.workerPath = options.workerPath ?? DEFAULT_WORKER_PATH;
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 60 * 60 * 1_000;
    this.killGraceMs = Number.isFinite(options.killGraceMs) ? options.killGraceMs : 8_000;
    this.forkImpl = options.forkImpl ?? fork;
    this.env = options.env ?? process.env;
    this.exposeDiagnostics = options.exposeDiagnostics === true;
    this.active = new Set();
  }

  run(task, options = {}) {
    const child = this.forkImpl(this.workerPath, [], {
      cwd: task.projectPath,
      env: workerEnvironment(this.env),
      execArgv: [],
      serialization: "json",
      silent: true,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const execution = new RunnerExecution(child, task, {
      onEvent: options.onEvent,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      killGraceMs: this.killGraceMs,
      exposeDiagnostics: this.exposeDiagnostics,
    });
    this.active.add(execution);
    execution.promise.then(
      () => this.active.delete(execution),
      () => this.active.delete(execution),
    );
    return execution;
  }

  async close() {
    const running = [...this.active];
    for (const execution of running) execution.cancel("shutdown");
    await Promise.allSettled(running.map((execution) => execution.promise));
  }
}

export function createCodexRunner(options) {
  return new CodexRunner(options);
}
