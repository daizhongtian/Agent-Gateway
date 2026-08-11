import { spawn } from "node:child_process";
import process from "node:process";

const transientPatterns = [
  /\bEAI_AGAIN\b/iu,
  /\bECONNRESET\b/iu,
  /\bETIMEDOUT\b/iu,
  /\bERR_SOCKET_CONNECTION_TIMEOUT\b/iu,
  /socket hang up/iu,
  /network timeout/iu,
  /request timed out/iu,
  /unable to get local issuer certificate/iu,
  /could not transfer artifact/iu,
  /could not resolve host/iu,
  /failed to connect.+timed out/iu,
  /temporary failure in name resolution/iu,
  /remote end hung up unexpectedly/iu,
  /TLS connection was non-properly terminated/iu,
  /HTTP(?:\/\S+)?\s+(?:429|502|503|504)\b/iu,
  /status(?: code)?[=: ]+(?:429|502|503|504)\b/iu,
  /rate limit exceeded/iu,
];

export function isTransientNetworkFailure(output) {
  return transientPatterns.some((pattern) => pattern.test(String(output ?? "")));
}

export function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function normalizeSpawnCommand(command, args, platform = process.platform, commandShell = process.env.ComSpec) {
  if (platform !== "win32" || !/\.(?:cmd|bat)$/iu.test(command)) return { command, args };
  return {
    command: commandShell || "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", command, ...args],
  };
}

function spawnCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const normalized = normalizeSpawnCommand(command, args);
    const child = spawn(normalized.command, normalized.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let output = "";
    const capture = (chunk, stream) => {
      const text = chunk.toString();
      output = `${output}${text}`.slice(-200_000);
      stream.write(chunk);
    };
    child.stdout.on("data", (chunk) => capture(chunk, process.stdout));
    child.stderr.on("data", (chunk) => capture(chunk, process.stderr));
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code: code ?? 1, signal, output }));
  });
}

export async function runCommand(command, args, {
  cwd = process.cwd(),
  env = process.env,
  label = `${command} ${args.join(" ")}`,
  networkRetries = 0,
  retryDelaysMs = [2_000, 5_000],
} = {}) {
  for (let attempt = 0; ; attempt += 1) {
    console.log(`\n[command] ${label}${attempt > 0 ? ` (retry ${attempt}/${networkRetries})` : ""}`);
    const result = await spawnCommand(command, args, { cwd, env });
    if (result.code === 0) return result;

    const canRetry = attempt < networkRetries && isTransientNetworkFailure(result.output);
    if (!canRetry) {
      const signal = result.signal ? `, signal ${result.signal}` : "";
      throw new Error(`${label} failed with exit code ${result.code}${signal}`);
    }
    const delay = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)] ?? 5_000;
    console.warn(`[command] Transient network failure detected; retrying in ${delay / 1_000}s.`);
    await wait(delay);
  }
}
