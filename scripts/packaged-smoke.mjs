import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = path.join(projectRoot, "release");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const productName = packageJson.build?.productName ?? "Codex Control Center";
const version = packageJson.version;
const powershell = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const taskkill = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
const timeoutMs = Number(process.env.CODEX_PACKAGED_SMOKE_TIMEOUT_MS ?? 45_000);
const installTimeoutMs = Number(process.env.CODEX_PACKAGED_INSTALL_TIMEOUT_MS ?? 180_000);
const keepTemporaryFiles = process.env.CODEX_PACKAGED_SMOKE_KEEP_TEMP === "1";

if (process.platform !== "win32") {
  throw new Error("Packaged smoke tests are Windows-only.");
}
if (!Number.isFinite(timeoutMs) || timeoutMs < 5_000) {
  throw new Error("CODEX_PACKAGED_SMOKE_TIMEOUT_MS must be at least 5000.");
}
if (!Number.isFinite(installTimeoutMs) || installTimeoutMs < 30_000) {
  throw new Error("CODEX_PACKAGED_INSTALL_TIMEOUT_MS must be at least 30000.");
}

function log(message) {
  const line = `[packaged-smoke] ${message}`;
  console.log(line);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function commandText(command) {
  return Buffer.from(command, "utf16le").toString("base64");
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function createLoggedProcess(label, executable, args, options = {}) {
  const output = [];
  const child = spawn(executable, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  for (const [streamName, stream] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk) => {
      for (const rawLine of chunk.split(/\r?\n/u)) {
        const line = rawLine.trimEnd();
        if (!line) continue;
        output.push(`${streamName}: ${line}`);
      }
    });
  }

  child.once("error", (error) => {
    output.push(`spawn-error: ${error.message}`);
  });
  return { child, label, output };
}

function exitResult(processHandle, milliseconds) {
  const { child, label, output } = processHandle;
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode, output });
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} timed out after ${milliseconds} ms.\n${output.join("\n")}`));
    }, milliseconds);
    const onExit = (code, signal) => {
      cleanup();
      resolve({ code, signal, output });
    };
    const onError = (error) => {
      cleanup();
      reject(new Error(`${label} failed to start: ${error.message}\n${output.join("\n")}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function runPowerShell(command, { allowFailure = false, timeout = 20_000 } = {}) {
  const handle = createLoggedProcess("PowerShell", powershell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    commandText(command),
  ]);
  const result = await exitResult(handle, timeout);
  if (!allowFailure && result.code !== 0) {
    throw new Error(`PowerShell exited with code ${result.code}.\n${result.output.join("\n")}`);
  }
  return {
    ...result,
    stdout: result.output
      .filter((line) => line.startsWith("stdout: "))
      .map((line) => line.slice(8))
      .join("\n")
      .trim(),
  };
}

async function terminateProcessTree(processId) {
  const handle = createLoggedProcess("taskkill", taskkill, ["/PID", String(processId), "/T", "/F"]);
  await exitResult(handle, 15_000).catch(() => {});
}

async function runPackagedApp(label, executable, userDataDirectory, {
  requireRendererLog = true,
  desktopPort = "0",
  expectedPort = null,
} = {}) {
  await mkdir(userDataDirectory, { recursive: true });
  const environment = {
    ...process.env,
    CODEX_DESKTOP_SMOKE_TEST: "1",
    CODEX_DESKTOP_SDK_SMOKE_TEST: "1",
    CODEX_DESKTOP_TEST_USER_DATA: userDataDirectory,
  };
  if (desktopPort === null) delete environment.CODEX_DESKTOP_PORT;
  else environment.CODEX_DESKTOP_PORT = String(desktopPort);
  const processHandle = createLoggedProcess(label, executable, [], {
    cwd: path.dirname(executable),
    env: environment,
  });
  try {
    const result = await exitResult(processHandle, timeoutMs);
    assert.equal(result.signal, null, `${label} was terminated by signal ${result.signal}.`);
    assert.equal(result.code, 0, `${label} exited with code ${result.code}.\n${result.output.join("\n")}`);
    if (requireRendererLog) {
      assert.ok(
        result.output.some((line) => line.includes("[electron-smoke] renderer ready:")),
        `${label} exited without confirming that its renderer loaded.\n${result.output.join("\n")}`,
      );
    }
    const schemaPath = path.join(userDataDirectory, "data-schema.json");
    assert.ok(existsSync(schemaPath), `${label} did not initialize its isolated userData directory.`);
    const runtimeMarkerPath = path.join(userDataDirectory, "packaged-runtime-smoke.json");
    assert.ok(existsSync(runtimeMarkerPath), `${label} did not confirm that its packaged Codex runtime can start.`);
    const runtimeMarker = JSON.parse(await readFile(runtimeMarkerPath, "utf8"));
    assert.equal(runtimeMarker.status, "available", `${label} reported an unavailable packaged Codex runtime.`);
    if (expectedPort !== null) {
      assert.equal(
        runtimeMarker.port,
        expectedPort,
        `${label} did not start on its saved fixed port ${expectedPort}.`,
      );
      assert.equal(
        runtimeMarker.serverUrl,
        `http://127.0.0.1:${expectedPort}`,
        `${label} reported an unexpected server URL.`,
      );
    }
    log(`${label} verified its Codex runtime, loaded its renderer, and shut down cleanly with exit code 0.`);
  } catch (error) {
    await terminateProcessTree(processHandle.child.pid);
    throw error;
  }
}

async function availableLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function runCommand(label, executable, args, milliseconds) {
  const handle = createLoggedProcess(label, executable, args, { cwd: path.dirname(executable) });
  try {
    const result = await exitResult(handle, milliseconds);
    assert.equal(result.signal, null, `${label} was terminated by signal ${result.signal}.`);
    assert.equal(result.code, 0, `${label} exited with code ${result.code}.\n${result.output.join("\n")}`);
    return result;
  } catch (error) {
    await terminateProcessTree(handle.child.pid);
    throw error;
  }
}

async function findExistingInstall() {
  const displayName = quotePowerShell(productName);
  const command = `
$roots = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$match = Get-ItemProperty -Path $roots -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -eq ${displayName} } |
  Select-Object -First 1
if ($null -ne $match) {
  Write-Output ($match.DisplayVersion + '|' + $match.InstallLocation)
  exit 0
}
exit 4
`;
  const result = await runPowerShell(command, { allowFailure: true });
  return result.code === 0 ? result.stdout : null;
}

async function waitForRemoval(target, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (existsSync(target) && Date.now() < deadline) await delay(250);
  return !existsSync(target);
}

async function waitForInstallRegistrationRemoval(milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (!await findExistingInstall()) return true;
    await delay(250);
  }
  return !await findExistingInstall();
}

async function removeTemporaryDirectory(directory) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 });
      return;
    } catch (error) {
      if (attempt === 6) throw error;
      await delay(attempt * 300);
    }
  }
}

const unpackedExecutable = path.join(releaseDirectory, "win-unpacked", `${productName}.exe`);
const portableExecutable = path.join(releaseDirectory, `Codex-Control-Center-Portable-${version}-x64.exe`);
const setupExecutable = path.join(releaseDirectory, `Codex-Control-Center-Setup-${version}-x64.exe`);
for (const artifact of [unpackedExecutable, portableExecutable, setupExecutable]) {
  assert.ok(existsSync(artifact), `Required release artifact is missing: ${artifact}`);
  assert.ok((await stat(artifact)).size > 1_000_000, `Release artifact is unexpectedly small: ${artifact}`);
}

const existingInstall = await findExistingInstall();
if (existingInstall && process.env.CODEX_PACKAGED_SMOKE_ALLOW_EXISTING_INSTALL !== "1") {
  throw new Error(
    `${productName} is already registered as installed (${existingInstall}). `
    + "Refusing to overwrite it during smoke testing. Use a clean Windows runner.",
  );
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codex-control-packaged-smoke-"));
const installDirectory = path.join(temporaryRoot, "Custom Install Location");
const installUserData = path.join(temporaryRoot, "user-data", "installed");
let installed = false;
let uninstallExecutable = null;

try {
  log(`Using isolated temporary root: ${temporaryRoot}`);
  await runPackagedApp("win-unpacked", unpackedExecutable, path.join(temporaryRoot, "user-data", "unpacked"));
  await runPackagedApp(
    "portable",
    portableExecutable,
    path.join(temporaryRoot, "user-data", "portable"),
    { requireRendererLog: false },
  );
  const fixedPort = await availableLoopbackPort();
  const fixedPortUserData = path.join(temporaryRoot, "user-data", "fixed-port");
  await mkdir(fixedPortUserData, { recursive: true });
  await writeFile(
    path.join(fixedPortUserData, "desktop-preferences.json"),
    `${JSON.stringify({ minimizeToTray: false, port: fixedPort }, null, 2)}\n`,
    "utf8",
  );
  await runPackagedApp(
    "portable fixed port",
    portableExecutable,
    fixedPortUserData,
    { requireRendererLog: false, desktopPort: null, expectedPort: fixedPort },
  );
  log(`Portable app reused its saved fixed port ${fixedPort}.`);

  log(`Silently installing to custom directory: ${installDirectory}`);
  await runCommand(
    "setup",
    setupExecutable,
    ["/S", "/currentuser", `/D=${installDirectory}`],
    installTimeoutMs,
  );
  installed = true;

  const installedExecutable = path.join(installDirectory, `${productName}.exe`);
  assert.ok(existsSync(installedExecutable), `Installer ignored or failed to create the custom installation directory: ${installDirectory}`);
  assert.equal(path.dirname(installedExecutable), installDirectory, "Installed executable is not in the requested custom directory.");
  log("Installer honored the custom installation directory.");

  const installedFiles = await readdir(installDirectory);
  const uninstallName = installedFiles.find((name) => /^Uninstall.*\.exe$/iu.test(name));
  assert.ok(uninstallName, "The installed application does not contain an uninstaller.");
  uninstallExecutable = path.join(installDirectory, uninstallName);

  await runPackagedApp("installed app", installedExecutable, installUserData);
  await writeFile(path.join(installUserData, "packaged-smoke-marker.txt"), "isolated smoke-test data\n", "utf8");

  log("Silently uninstalling the temporary installation.");
  await runCommand("uninstaller", uninstallExecutable, ["/S", "/currentuser"], installTimeoutMs);
  const removed = await waitForRemoval(installDirectory, 30_000);
  assert.ok(removed, `Uninstaller did not remove the custom installation directory: ${installDirectory}`);
  installed = false;
  assert.ok(
    existsSync(path.join(installUserData, "packaged-smoke-marker.txt")),
    "Uninstaller unexpectedly removed the isolated application data.",
  );
  assert.ok(
    await waitForInstallRegistrationRemoval(30_000),
    "Uninstaller left an application registration behind.",
  );
  log("Uninstaller removed the custom installation and preserved application data.");
  log("All packaged smoke tests passed.");
} finally {
  if (installed && uninstallExecutable && existsSync(uninstallExecutable)) {
    await runCommand("cleanup uninstaller", uninstallExecutable, ["/S", "/currentuser"], installTimeoutMs).catch((error) => {
      console.error(`[packaged-smoke] Cleanup uninstaller failed: ${error.message}`);
    });
  }
  if (keepTemporaryFiles) {
    log(`Temporary files kept by request: ${temporaryRoot}`);
  } else {
    await removeTemporaryDirectory(temporaryRoot).catch((error) => {
      console.error(`[packaged-smoke] Failed to remove temporary files: ${error.message}`);
    });
  }
}
