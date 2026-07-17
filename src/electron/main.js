import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectCodexReadiness } from "./codex-readiness.js";
import { createDiagnosticsReport } from "./diagnostics.js";
import { checkForUpdates } from "./update-checker.js";
import { waitForShutdown } from "./shutdown.js";
import {
  createBackupSnapshot,
  prepareUserDataSchema,
  readBackupFile,
  restoreBackupSnapshot,
  writeBackupFile,
} from "./user-data-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = path.join(__dirname, "preload.cjs");
const LOOPBACK_HOST = "127.0.0.1";
const DESKTOP_SESSION_COOKIE = "codex_desktop_session";
const DEFAULT_WINDOW_SIZE = Object.freeze({ width: 1360, height: 880 });
const SAFE_EXTERNAL_PROTOCOLS = new Set(["https:", "http:"]);
const SDK_SMOKE_TEST = process.env.CODEX_DESKTOP_SDK_SMOKE_TEST === "1";
const SMOKE_TEST = process.env.CODEX_DESKTOP_SMOKE_TEST === "1" || SDK_SMOKE_TEST;
const TEST_USER_DATA = process.env.CODEX_DESKTOP_TEST_USER_DATA;

if (SMOKE_TEST && TEST_USER_DATA) {
  app.setPath("userData", path.resolve(TEST_USER_DATA));
}

let mainWindow = null;
let serverHandle = null;
let trustedRendererOrigin = null;
let pendingSecondInstance = false;
let shutdownStarted = false;
let readinessInFlight = null;
let latestReadiness = null;

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function parseDesktopPort(value) {
  if (value === undefined || value === "") return 0;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("CODEX_DESKTOP_PORT 必须是 0 到 65535 之间的整数。");
  }

  return port;
}

function parseWebUrl(value, label = "服务地址") {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}无效：${value}`);
  }

  if (!SAFE_EXTERNAL_PROTOCOLS.has(url.protocol)) {
    throw new Error(`${label}必须使用 HTTP 或 HTTPS。`);
  }

  return url;
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function ensureDesktopServerUrl(value) {
  const url = parseWebUrl(value);
  if (!isLoopbackHostname(url.hostname)) {
    throw new Error(`桌面内置服务拒绝监听非回环地址：${url.hostname}`);
  }
  return url;
}

function isSafeExternalUrl(value) {
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

async function openExternal(value) {
  if (typeof value !== "string" || value.length > 2_048 || !isSafeExternalUrl(value)) {
    throw new Error("只允许打开有效的 HTTP/HTTPS 外部链接。");
  }

  await shell.openExternal(value, { activate: true });
  return true;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingSecondInstance = true;
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function assertTrustedRenderer(event) {
  const activeContents = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  const senderFrame = event.senderFrame ?? null;
  const isMainFrame = Boolean(senderFrame && activeContents && senderFrame === activeContents.mainFrame);
  const senderOrigin = (() => {
    try {
      return new URL(senderFrame?.url ?? "").origin;
    } catch {
      return null;
    }
  })();

  if (!activeContents || event.sender !== activeContents || !isMainFrame || senderOrigin !== trustedRendererOrigin) {
    throw new Error("拒绝来自非受信页面的桌面接口调用。");
  }
}

function checkCodexReadiness() {
  if (readinessInFlight) return readinessInFlight;
  readinessInFlight = detectCodexReadiness({
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform,
    arch: process.arch,
    environment: process.env,
  })
    .then((result) => {
      latestReadiness = result;
      return result;
    })
    .finally(() => {
      readinessInFlight = null;
    });
  return readinessInFlight;
}

function dialogOwner() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
}

async function showSaveDialog(options) {
  const owner = dialogOwner();
  return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options);
}

async function showOpenDialog(options) {
  const owner = dialogOwner();
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options);
}

async function showMessageBox(options) {
  const owner = dialogOwner();
  return owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options);
}

function dataFileSummary() {
  const userDataPath = app.getPath("userData");
  const summary = {};
  for (const name of ["gateway-api-keys.json", "usage-stats.json", "data-schema.json"]) {
    const filePath = path.join(userDataPath, name);
    try {
      const stats = statSync(filePath);
      summary[name] = { present: stats.isFile(), bytes: stats.isFile() ? stats.size : 0 };
    } catch {
      summary[name] = { present: false, bytes: 0 };
    }
  }
  return summary;
}

function registerIpcHandlers() {
  ipcMain.handle("desktop:pick-project", async (event) => {
    assertTrustedRenderer(event);
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const options = {
      title: "选择 Codex 项目文件夹",
      buttonLabel: "选择项目",
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);

    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("desktop:get-platform", (event) => {
    assertTrustedRenderer(event);
    return Object.freeze({
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
    });
  });

  ipcMain.handle("desktop:open-external", (event, value) => {
    assertTrustedRenderer(event);
    return openExternal(value);
  });

  ipcMain.handle("desktop:check-codex-readiness", (event) => {
    assertTrustedRenderer(event);
    return checkCodexReadiness();
  });

  ipcMain.handle("desktop:export-user-data", async (event, preferences) => {
    assertTrustedRenderer(event);
    const date = new Date().toISOString().slice(0, 10);
    const result = await showSaveDialog({
      title: "导出 Codex Control Center 备份 / Export backup",
      defaultPath: path.join(app.getPath("documents"), `Codex-Control-Center-backup-${date}.json`),
      filters: [{ name: "Codex Control Center backup", extensions: ["json"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const snapshot = createBackupSnapshot({
      userDataPath: app.getPath("userData"),
      appVersion: app.getVersion(),
      preferences,
    });
    writeBackupFile(result.filePath, snapshot);
    return { canceled: false, fileName: path.basename(result.filePath), createdAt: snapshot.createdAt };
  });

  ipcMain.handle("desktop:import-user-data", async (event) => {
    assertTrustedRenderer(event);
    const selected = await showOpenDialog({
      title: "恢复 Codex Control Center 备份 / Restore backup",
      filters: [{ name: "Codex Control Center backup", extensions: ["json"] }],
      properties: ["openFile", "dontAddToRecent"],
    });
    const filePath = selected.canceled ? null : selected.filePaths[0];
    if (!filePath) return { canceled: true };
    const snapshot = readBackupFile(filePath);
    const confirmation = await showMessageBox({
      type: "warning",
      title: "恢复备份 / Restore backup",
      message: "恢复后应用将自动重启。当前 API Key 与用量数据会先保存为回滚副本。",
      detail: `Backup version: ${snapshot.appVersion}\nCreated: ${snapshot.createdAt}\n\nEncrypted API keys may only be readable by the compatible Windows user profile that created them.`,
      buttons: ["恢复并重启", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) return { canceled: true };

    const handle = serverHandle;
    await stopEmbeddedServerWithTimeout(handle, { timeoutMs: 15_000, rejectOnTimeout: true });
    serverHandle = null;
    let restored;
    try {
      restored = restoreBackupSnapshot({
        userDataPath: app.getPath("userData"),
        appVersion: app.getVersion(),
        snapshot,
      });
    } catch (error) {
      setTimeout(() => {
        app.relaunch();
        app.exit(1);
      }, 500).unref?.();
      throw error;
    }
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 1_000).unref?.();
    return {
      canceled: false,
      restarting: true,
      sourceVersion: restored.sourceVersion,
      preferences: restored.preferences,
    };
  });

  ipcMain.handle("desktop:export-diagnostics", async (event) => {
    assertTrustedRenderer(event);
    const date = new Date().toISOString().replace(/[:.]/g, "-");
    const result = await showSaveDialog({
      title: "导出诊断报告 / Export diagnostics",
      defaultPath: path.join(app.getPath("documents"), `Codex-Control-Center-diagnostics-${date}.json`),
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const readiness = latestReadiness ?? await checkCodexReadiness();
    const report = createDiagnosticsReport({
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      homeDirectory: os.homedir(),
      readiness,
      server: {
        online: Boolean(serverHandle),
        host: serverHandle?.host ?? LOOPBACK_HOST,
        port: serverHandle?.port ?? null,
        gatewayEnabled: serverHandle?.apiKeyStore?.gatewayStatus?.().enabled ?? null,
      },
      data: dataFileSummary(),
    });
    writeFileSync(result.filePath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return { canceled: false, fileName: path.basename(result.filePath), generatedAt: report.generatedAt };
  });

  ipcMain.handle("desktop:check-for-updates", async (event) => {
    assertTrustedRenderer(event);
    return checkForUpdates({ currentVersion: app.getVersion() });
  });
}

async function startEmbeddedServer() {
  const serverModule = await import("../server/app.js");
  if (typeof serverModule.startServer !== "function") {
    throw new Error("src/server/app.js 必须导出 startServer(options) 函数。");
  }

  const port = parseDesktopPort(process.env.CODEX_DESKTOP_PORT);
  const desktopSessionToken = randomBytes(32).toString("base64url");
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows 安全存储不可用，无法安全保存可查看的 API Key。");
  }
  const apiKeySecretProtector = Object.freeze({
    name: "electron-safe-storage",
    encrypt(secret) {
      return safeStorage.encryptString(secret).toString("base64");
    },
    decrypt(payload) {
      return safeStorage.decryptString(Buffer.from(payload, "base64"));
    },
  });
  const protectorProbe = `ccc_live_${randomBytes(32).toString("base64url")}`;
  if (apiKeySecretProtector.decrypt(apiKeySecretProtector.encrypt(protectorProbe)) !== protectorProbe) {
    throw new Error("Windows 安全存储自检失败，无法安全恢复 API Key。");
  }
  const handle = await serverModule.startServer({
    host: LOOPBACK_HOST,
    port,
    mode: "desktop",
    apiKeyStorePath: path.join(app.getPath("userData"), "gateway-api-keys.json"),
    usageStorePath: path.join(app.getPath("userData"), "usage-stats.json"),
    apiKeySecretProtector,
    desktopSessionToken,
  });

  try {
    if (!handle || typeof handle !== "object" || !handle.server) {
      throw new Error("startServer() 必须返回包含 server 的对象。");
    }

    let url = handle.url;
    if (!url) {
      const address = handle.server.address?.();
      const actualPort = typeof address === "object" && address ? address.port : handle.port;
      if (!Number.isInteger(actualPort)) {
        throw new Error("startServer() 未返回可用的 url 或 port。");
      }
      url = `http://${LOOPBACK_HOST}:${actualPort}`;
    }

    const validatedUrl = ensureDesktopServerUrl(url);
    return { ...handle, url: validatedUrl.href.replace(/\/$/, ""), desktopSessionToken };
  } catch (error) {
    await stopEmbeddedServerWithTimeout(handle).catch((closeError) => {
      console.error("[electron] 无法关闭返回值无效的服务", closeError);
    });
    throw error;
  }
}

async function stopEmbeddedServer(handle) {
  if (!handle) return;

  if (typeof handle.close === "function") {
    await handle.close();
    return;
  }

  if (handle.server && typeof handle.server.close === "function") {
    await new Promise((resolve, reject) => {
      handle.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function stopEmbeddedServerWithTimeout(handle, options = {}) {
  const result = await waitForShutdown(() => stopEmbeddedServer(handle), options);
  if (result.timedOut) {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 5_000;
    console.warn(`[electron] 服务关闭超过 ${timeoutMs}ms，继续退出。`);
  }
}

function isSameOrigin(value, applicationOrigin) {
  try {
    return new URL(value).origin === applicationOrigin;
  } catch {
    return false;
  }
}

async function createMainWindow(applicationUrl, desktopSessionToken) {
  const applicationOrigin = new URL(applicationUrl).origin;
  trustedRendererOrigin = applicationOrigin;
  const window = new BrowserWindow({
    ...DEFAULT_WINDOW_SIZE,
    minWidth: 1_040,
    minHeight: 680,
    title: "Codex Control Center",
    backgroundColor: "#0f1115",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      safeDialogs: true,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  mainWindow = window;
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url) && !isSameOrigin(url, applicationOrigin)) {
      void openExternal(url).catch((error) => console.error("[electron] 无法打开外链", error));
    }
    return { action: "deny" };
  });

  const guardNavigation = (event, url) => {
    if (isSameOrigin(url, applicationOrigin)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void openExternal(url).catch((error) => console.error("[electron] 无法打开外链", error));
    }
  };
  window.webContents.on("will-navigate", guardNavigation);
  window.webContents.on("will-redirect", guardNavigation);

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[electron] 渲染进程异常退出", details);
    if (!shutdownStarted) {
      dialog.showErrorBox("Codex 界面异常", "渲染进程已退出，请重新启动应用。");
    }
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
      trustedRendererOrigin = null;
    }
  });

  window.once("ready-to-show", () => {
    if (!SMOKE_TEST && !window.isDestroyed()) window.show();
  });

  await window.webContents.session.cookies.set({
    url: `${applicationOrigin}/`,
    name: DESKTOP_SESSION_COOKIE,
    value: desktopSessionToken,
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "strict",
  });
  await window.loadURL(applicationUrl);
  if (SMOKE_TEST) {
    console.info(`[electron-smoke] renderer ready: ${applicationUrl}`);
    setTimeout(() => {
      if (!window.isDestroyed()) window.close();
    }, 250).unref?.();
  } else if (!window.isVisible()) {
    window.show();
  }

  if (pendingSecondInstance) {
    pendingSecondInstance = false;
    focusMainWindow();
  }

  return window;
}

async function bootstrap() {
  prepareUserDataSchema({
    userDataPath: app.getPath("userData"),
    appVersion: app.getVersion(),
  });
  registerIpcHandlers();
  serverHandle = await startEmbeddedServer();
  console.info(`[electron] 本地服务已启动：${serverHandle.url}`);
  if (SDK_SMOKE_TEST) {
    const probe = serverHandle.runner.run({
      probeSdk: true,
      projectPath: process.cwd(),
      prompt: "",
      speed: "standard",
      effort: "low",
      permission: "read-only",
      approvalPolicy: "never",
      skipGitRepoCheck: true,
    });
    const result = await probe.promise;
    if (result.content !== "SDK_RESOLVED") throw new Error("Packaged Codex SDK probe failed.");
    console.info("[electron-smoke] packaged Codex SDK resolved successfully");
  }
  await createMainWindow(serverHandle.url, serverHandle.desktopSessionToken);
}

async function reportStartupFailure(cause) {
  const error = asError(cause);
  console.error("[electron] 启动失败", error);

  const handle = serverHandle;
  serverHandle = null;
  try {
    await stopEmbeddedServerWithTimeout(handle);
  } catch (closeError) {
    console.error("[electron] 启动失败后关闭服务时发生错误", closeError);
  }

  dialog.showErrorBox(
    "Codex Control Center 启动失败",
    `${error.message}\n\n请确认依赖已安装、Codex 已登录，并检查终端日志。`,
  );
  app.exit(1);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", focusMainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
      void createMainWindow(serverHandle.url, serverHandle.desktopSessionToken).catch(reportStartupFailure);
    } else {
      focusMainWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (shutdownStarted || !serverHandle) return;

    event.preventDefault();
    shutdownStarted = true;
    const handle = serverHandle;
    serverHandle = null;
    void stopEmbeddedServerWithTimeout(handle)
      .catch((error) => console.error("[electron] 关闭本地服务失败", error))
      .finally(() => app.quit());
  });

  void app.whenReady().then(bootstrap).catch(reportStartupFailure);
}
