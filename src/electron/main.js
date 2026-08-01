import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, Tray } from "electron";
import electronUpdater from "electron-updater";
import { randomBytes } from "node:crypto";
import { existsSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectCodexReadiness } from "./codex-readiness.js";
import { connectCodingAgent } from "./coding-agent-connectors.js";
import {
  checkLoopbackPort,
  desktopPortManagedByEnvironment,
  parseDesktopPort,
  resolveDesktopPort,
} from "./desktop-port.js";
import { createDiagnosticsReport } from "./diagnostics.js";
import { DesktopUpdater, detectUpdateMode } from "./desktop-updater.js";
import { checkOnlineHost, checkOnlineHostWithRepair } from "./online-host-checker.js";
import { downloadPortableUpdate } from "./portable-update.js";
import { checkForUpdates } from "./update-checker.js";
import { PlatformClient } from "./platform-client.js";
import { runPlatformBrowserAuthorization } from "./platform-browser-auth.js";
import { protectProcessLoggingStreams } from "./process-stream-errors.js";
import { waitForShutdown } from "./shutdown.js";
import {
  serializeTailscaleError,
  TailscaleFunnelController,
} from "./tailscale-funnel.js";
import {
  DEFAULT_DESKTOP_PREFERENCES,
  loadDesktopPreferences,
  saveDesktopPreferences,
  shouldMinimizeWindowToTray,
} from "./desktop-preferences.js";
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
const APPLICATION_PROTOCOL = "agent-gateway";
const DESKTOP_SESSION_COOKIE = "codex_desktop_session";
const DEFAULT_WINDOW_SIZE = Object.freeze({ width: 1360, height: 880 });
const SAFE_EXTERNAL_PROTOCOLS = new Set(["https:", "http:"]);
const SDK_SMOKE_TEST = process.env.CODEX_DESKTOP_SDK_SMOKE_TEST === "1";
const SMOKE_TEST = process.env.CODEX_DESKTOP_SMOKE_TEST === "1" || SDK_SMOKE_TEST;
const TEST_USER_DATA = process.env.CODEX_DESKTOP_TEST_USER_DATA;
const LEGACY_USER_DATA_DIRECTORY = "codex-control-center";
const TAILSCALE_PROVIDER = Object.freeze({
  id: "tailscale-funnel",
  label: "Tailscale Funnel",
  forcePublicDns: true,
});
const PLATFORM_PROVIDER = Object.freeze({
  id: "coding-agent-platform",
  label: "Agent Gateway Platform",
  forcePublicDns: true,
  allowLoopbackHttp: true,
  requirePublicOrigin: true,
});
const { autoUpdater } = electronUpdater;

protectProcessLoggingStreams();

app.setName("Agent Gateway");
if (SMOKE_TEST && TEST_USER_DATA) {
  app.setPath("userData", path.resolve(TEST_USER_DATA));
} else {
  // Keep the established data location so existing installations retain keys,
  // usage history, preferences, and online Host settings after the product rename.
  app.setPath("userData", path.join(app.getPath("appData"), LEGACY_USER_DATA_DIRECTORY));
}

let mainWindow = null;
let serverHandle = null;
let trustedRendererOrigin = null;
let pendingSecondInstance = false;
let shutdownStarted = false;
let readinessInFlight = null;
let latestReadiness = null;
let codingAgentConnection = null;
let platformClient = null;
let platformBrowserLoginAction = null;
let tailscaleFunnelAction = null;
const tailscaleFunnel = new TailscaleFunnelController();
const tailscalePublicHostnames = new Set();
let tray = null;
let trayNoticeShown = false;
let isQuitting = false;
let desktopPreferences = DEFAULT_DESKTOP_PREFERENCES;
let desktopUpdater = null;
let automaticUpdateCheckTimer = null;

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function activeDesktopPort() {
  try {
    const port = Number(new URL(serverHandle?.url).port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function rememberTailscaleHostname(status) {
  const hostname = String(status?.dnsName ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (hostname.endsWith(".ts.net") && hostname.length <= 253) {
    tailscalePublicHostnames.add(hostname);
  }
  return Object.freeze({
    ...status,
    providerId: TAILSCALE_PROVIDER.id,
    providerLabel: TAILSCALE_PROVIDER.label,
  });
}

function platformCorsOrigins(baseUrl) {
  const platformUrl = new URL(baseUrl);
  const origins = new Set([platformUrl.origin]);
  if (platformUrl.hostname === "localhost" || platformUrl.hostname === "127.0.0.1") {
    const alias = new URL(platformUrl.origin);
    alias.hostname = platformUrl.hostname === "localhost" ? "127.0.0.1" : "localhost";
    origins.add(alias.origin);
  }
  return [...origins];
}

function platformProviderFromStatus(status) {
  const baseUrl = status?.online && status?.host?.openAiBaseUrl;
  if (!baseUrl) return null;
  const healthUrl = new URL(baseUrl);
  healthUrl.pathname = `${healthUrl.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")}/health`;
  return Object.freeze({
    ...PLATFORM_PROVIDER,
    baseUrl,
    healthUrl: healthUrl.href,
    modelsUrl: `${baseUrl.replace(/\/+$/, "")}/models`,
  });
}

async function checkPlatformOnlineHost(status) {
  const provider = platformProviderFromStatus(status);
  if (!provider) {
    return Object.freeze({
      ok: false,
      online: false,
      apiReady: false,
      checkedAt: new Date().toISOString(),
      providerId: PLATFORM_PROVIDER.id,
      providerLabel: PLATFORM_PROVIDER.label,
      baseUrl: status?.host?.openAiBaseUrl ?? null,
      latencyMs: 0,
      requestId: null,
      checks: Object.freeze([]),
      error: Object.freeze({ code: "ONLINE_HOST_INACTIVE", message: "Online Host is not enabled." }),
    });
  }
  if (!activeDesktopPort()) {
    return Object.freeze({
      ok: false,
      online: false,
      apiReady: false,
      checkedAt: new Date().toISOString(),
      providerId: PLATFORM_PROVIDER.id,
      providerLabel: PLATFORM_PROVIDER.label,
      baseUrl: provider.baseUrl,
      latencyMs: 0,
      requestId: null,
      checks: Object.freeze([]),
      error: Object.freeze({ code: "DESKTOP_SERVER_OFFLINE", message: "The local API is not running." }),
    });
  }
  return checkOnlineHost(provider);
}

async function verifiedPlatformAccountStatus({ disableOnFailure = true } = {}) {
  const status = platformClient
    ? await platformClient.getStatus()
    : { signedIn: false, online: false, user: null, host: null };
  if (!status.online) return Object.freeze({ ...status, verification: null });
  const verification = await checkPlatformOnlineHost(status);
  if (verification.ok) return Object.freeze({ ...status, verification });

  let rolledBack = status;
  if (disableOnFailure && platformClient) {
    try {
      rolledBack = await platformClient.setOnline(false);
    } catch {
      // The UI must still fail closed even if the platform cannot persist the rollback.
    }
  }
  return Object.freeze({
    ...rolledBack,
    online: false,
    verification,
    error: verification.error,
  });
}

async function resolveOnlineHostProvider(providerId, port) {
  const resolvers = new Map([
    [PLATFORM_PROVIDER.id, async () => {
      const status = platformClient ? await platformClient.getStatus() : null;
      const provider = platformProviderFromStatus(status);
      return {
        status: {
          providerId: PLATFORM_PROVIDER.id,
          providerLabel: PLATFORM_PROVIDER.label,
          active: Boolean(status?.online && status?.host?.openAiBaseUrl),
          baseUrl: status?.host?.openAiBaseUrl ?? null,
          message: status?.error?.message || (status?.signedIn ? "Online Host is not enabled." : "Sign in to enable Online Host."),
        },
        provider,
      };
    }],
    [TAILSCALE_PROVIDER.id, async () => {
      const status = rememberTailscaleHostname(await tailscaleFunnel.status(port));
      return {
        status,
        provider: status.active && status.baseUrl
          ? { ...TAILSCALE_PROVIDER, baseUrl: status.baseUrl }
          : null,
      };
    }],
  ]);
  const resolver = resolvers.get(String(providerId ?? "").trim().toLowerCase());
  if (!resolver) return null;
  return resolver();
}

function desktopPreferencesForRenderer(extra = {}) {
  return Object.freeze({
    ...desktopPreferences,
    activePort: activeDesktopPort(),
    portManagedByEnvironment: desktopPortManagedByEnvironment(),
    ...extra,
  });
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

function trayIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.resolve(__dirname, "../../build/icon.ico");
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
  trayNoticeShown = false;
}

function quitFromTray() {
  isQuitting = true;
  app.quit();
}

function ensureTray() {
  if (tray) return true;
  try {
    tray = new Tray(trayIconPath());
    tray.setToolTip("Agent Gateway");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "打开控制台 / Open", click: focusMainWindow },
      { type: "separator" },
      { label: "退出程序 / Quit", click: quitFromTray },
    ]));
    tray.on("click", focusMainWindow);
    tray.on("double-click", focusMainWindow);
    return true;
  } catch (error) {
    console.error("[electron] 无法创建系统托盘图标", error);
    destroyTray();
    return false;
  }
}

function showTrayNotice() {
  if (!tray || trayNoticeShown || typeof tray.displayBalloon !== "function") return;
  trayNoticeShown = true;
  tray.displayBalloon({
    title: "Agent Gateway 仍在运行",
    content: "Host 与本地 API 保持在线；从托盘打开控制台或退出程序。",
  });
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

function registerApplicationProtocol() {
  if (process.platform !== "win32") return;
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(APPLICATION_PROTOCOL);
    return;
  }
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : app.getAppPath();
  app.setAsDefaultProtocolClient(APPLICATION_PROTOCOL, process.execPath, [entry]);
}

function connectCodingAgentProvider(providerId) {
  if (codingAgentConnection) return codingAgentConnection;
  codingAgentConnection = connectCodingAgent(providerId, {
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform,
    arch: process.arch,
    environment: process.env,
  }).finally(() => {
    codingAgentConnection = null;
  });
  return codingAgentConnection;
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

function publishDesktopUpdateState(state) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:update-state", state);
}

function activeAgentTasks() {
  const taskManager = serverHandle?.taskManager;
  if (!taskManager || typeof taskManager.list !== "function") return [];
  return taskManager.list({ limit: 200 }).filter((task) => ["queued", "running", "cancelling"].includes(task.status));
}

async function prepareForUpdateInstall() {
  if (activeAgentTasks().length > 0) {
    throw Object.assign(new Error("Active Agent tasks must finish before installing an update."), {
      code: "UPDATE_TASKS_ACTIVE",
    });
  }

  const handle = serverHandle;
  isQuitting = true;
  shutdownStarted = true;
  serverHandle = null;
  try {
    await stopEmbeddedServerWithTimeout(handle, { timeoutMs: 15_000, rejectOnTimeout: true });
    destroyTray();
  } catch (error) {
    serverHandle = handle;
    shutdownStarted = false;
    isQuitting = false;
    throw error;
  }
}

function createDesktopUpdater() {
  const mode = detectUpdateMode({
    isPackaged: app.isPackaged,
    platform: process.platform,
    environment: process.env,
  });
  return new DesktopUpdater({
    mode,
    currentVersion: app.getVersion(),
    updater: mode === "setup" ? autoUpdater : null,
    checkRelease: () => checkForUpdates({ currentVersion: app.getVersion() }),
    downloadPortable: (release, onProgress) => downloadPortableUpdate(release, {
      destinationDirectory: app.getPath("downloads"),
      onProgress,
    }),
    prepareInstall: prepareForUpdateInstall,
    launchPortable: async (filePath) => {
      app.relaunch({ execPath: filePath, args: [] });
      app.quit();
    },
    onStateChange: publishDesktopUpdateState,
    logger: console,
  });
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
      updateMode: desktopUpdater?.getState().mode ?? "development",
    });
  });

  ipcMain.handle("desktop:open-external", (event, value) => {
    assertTrustedRenderer(event);
    return openExternal(value);
  });

  ipcMain.handle("desktop:get-preferences", (event) => {
    assertTrustedRenderer(event);
    return desktopPreferencesForRenderer();
  });

  ipcMain.handle("desktop:set-minimize-to-tray", (event, enabled) => {
    assertTrustedRenderer(event);
    if (typeof enabled !== "boolean") throw new Error("minimizeToTray 必须是布尔值。");
    if (enabled && !ensureTray()) throw new Error("无法启动系统托盘，请检查应用安装是否完整。");
    desktopPreferences = saveDesktopPreferences(app.getPath("userData"), { ...desktopPreferences, minimizeToTray: enabled });
    if (!enabled) destroyTray();
    return desktopPreferencesForRenderer();
  });

  ipcMain.handle("desktop:set-port", async (event, value) => {
    assertTrustedRenderer(event);
    const port = parseDesktopPort(value, { label: "固定 API 端口" });
    const activePort = activeDesktopPort();
    if (activePort !== port) {
      const availability = await checkLoopbackPort(port, { host: LOOPBACK_HOST });
      if (!availability.available) {
        throw new Error(`端口 ${port} 已被其他程序占用，请选择其他端口。`);
      }
    }
    desktopPreferences = saveDesktopPreferences(app.getPath("userData"), { ...desktopPreferences, port });
    return desktopPreferencesForRenderer({ restartRequired: activePort !== port });
  });

  ipcMain.handle("desktop:check-codex-readiness", (event) => {
    assertTrustedRenderer(event);
    return checkCodexReadiness();
  });

  ipcMain.handle("desktop:get-platform-account", async (event) => {
    assertTrustedRenderer(event);
    return verifiedPlatformAccountStatus();
  });

  ipcMain.handle("desktop:platform-browser-login", (event) => {
    assertTrustedRenderer(event);
    if (!platformBrowserLoginAction) {
      platformBrowserLoginAction = runPlatformBrowserAuthorization({
        platformBaseUrl: platformClient.baseUrl,
        openExternal: (url) => shell.openExternal(url, { activate: true }),
        exchangeAuthorization: (code, verifier) => platformClient.exchangeDesktopAuthorization(code, verifier),
      }).then((status) => {
        focusMainWindow();
        return status;
      }).finally(() => {
        platformBrowserLoginAction = null;
      });
    }
    return platformBrowserLoginAction;
  });

  ipcMain.handle("desktop:platform-logout", (event) => {
    assertTrustedRenderer(event);
    return platformClient.logout();
  });

  ipcMain.handle("desktop:set-platform-host-enabled", async (event, enabled) => {
    assertTrustedRenderer(event);
    if (typeof enabled !== "boolean") throw new Error("Online Host state must be a boolean.");
    if (!enabled) return platformClient.setOnline(false);

    await platformClient.setOnline(true);
    const verified = await verifiedPlatformAccountStatus();
    return verified;
  });

  ipcMain.handle("desktop:connect-coding-agent", async (event, providerId) => {
    assertTrustedRenderer(event);
    const result = await connectCodingAgentProvider(providerId);
    const readiness = await checkCodexReadiness();
    return Object.freeze({ ...result, readiness });
  });

  ipcMain.handle("desktop:export-user-data", async (event, preferences) => {
    assertTrustedRenderer(event);
    const date = new Date().toISOString().slice(0, 10);
    const result = await showSaveDialog({
      title: "导出 Agent Gateway 备份 / Export backup",
      defaultPath: path.join(app.getPath("documents"), `Agent-Gateway-backup-${date}.json`),
      filters: [{ name: "Agent Gateway backup", extensions: ["json"] }],
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
      title: "恢复 Agent Gateway 备份 / Restore backup",
      filters: [{ name: "Agent Gateway backup", extensions: ["json"] }],
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
      defaultPath: path.join(app.getPath("documents"), `Agent-Gateway-diagnostics-${date}.json`),
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

  ipcMain.handle("desktop:get-update-state", (event) => {
    assertTrustedRenderer(event);
    return desktopUpdater.getState();
  });

  ipcMain.handle("desktop:check-for-updates", (event) => {
    assertTrustedRenderer(event);
    return desktopUpdater.check();
  });

  ipcMain.handle("desktop:download-update", (event) => {
    assertTrustedRenderer(event);
    return desktopUpdater.download();
  });

  ipcMain.handle("desktop:install-update", (event) => {
    assertTrustedRenderer(event);
    return desktopUpdater.install();
  });

  ipcMain.handle("desktop:get-tailscale-funnel-status", async (event) => {
    assertTrustedRenderer(event);
    const port = activeDesktopPort();
    if (!port) {
      return {
        installed: false,
        connected: false,
        active: false,
        online: false,
        message: "本地 API 尚未启动，无法检查公网 Host。",
        error: { code: "DESKTOP_SERVER_OFFLINE", message: "本地 API 尚未启动。", actionUrl: null },
      };
    }
    return rememberTailscaleHostname(await tailscaleFunnel.status(port));
  });

  ipcMain.handle("desktop:check-online-host", async (event, providerId) => {
    assertTrustedRenderer(event);
    const port = activeDesktopPort();
    if (!port) {
      return {
        ok: false,
        online: false,
        apiReady: false,
        checkedAt: new Date().toISOString(),
        providerId: String(providerId ?? ""),
        providerLabel: null,
        baseUrl: null,
        latencyMs: 0,
        requestId: null,
        checks: [],
        error: { code: "DESKTOP_SERVER_OFFLINE", message: "本地 API 尚未启动，无法检查公网 Host。" },
      };
    }
    const resolved = await resolveOnlineHostProvider(providerId, port);
    if (!resolved) {
      return {
        ok: false,
        online: false,
        apiReady: false,
        checkedAt: new Date().toISOString(),
        providerId: String(providerId ?? ""),
        providerLabel: null,
        baseUrl: null,
        latencyMs: 0,
        requestId: null,
        checks: [],
        error: { code: "ONLINE_HOST_PROVIDER_UNKNOWN", message: "无法识别指定的公网 Host 渠道。" },
      };
    }
    if (!resolved.provider) {
      return {
        ok: false,
        online: false,
        apiReady: false,
        checkedAt: new Date().toISOString(),
        providerId: resolved.status.providerId,
        providerLabel: resolved.status.providerLabel,
        baseUrl: resolved.status.baseUrl,
        latencyMs: 0,
        requestId: null,
        checks: [],
        error: { code: "ONLINE_HOST_INACTIVE", message: resolved.status.message || "公网 Host 尚未开启。" },
      };
    }
    if (resolved.provider.id !== TAILSCALE_PROVIDER.id) {
      const result = await checkOnlineHost(resolved.provider);
      if (!result.ok && resolved.provider.id === PLATFORM_PROVIDER.id && platformClient) {
        try {
          await platformClient.setOnline(false);
        } catch {
          // A failed check is reported as offline even when persistence is temporarily unavailable.
        }
      }
      return result;
    }
    return checkOnlineHostWithRepair(resolved.provider, {
      repair: async () => {
        if (tailscaleFunnelAction) {
          throw new Error("另一个公网 Host 操作正在进行，请稍后重试。");
        }
        const action = tailscaleFunnel.repair(port);
        tailscaleFunnelAction = action;
        try {
          return rememberTailscaleHostname(await action);
        } finally {
          tailscaleFunnelAction = null;
        }
      },
    });
  });

  ipcMain.handle("desktop:set-tailscale-funnel-enabled", async (event, enabled) => {
    assertTrustedRenderer(event);
    if (typeof enabled !== "boolean") {
      return { ok: false, error: { code: "INVALID_FUNNEL_STATE", message: "公网 Host 状态无效。", actionUrl: null } };
    }
    if (tailscaleFunnelAction) {
      return { ok: false, error: { code: "FUNNEL_ACTION_PENDING", message: "另一个公网 Host 操作正在进行。", actionUrl: null } };
    }
    const port = activeDesktopPort();
    if (!port) {
      return { ok: false, error: { code: "DESKTOP_SERVER_OFFLINE", message: "本地 API 尚未启动。", actionUrl: null } };
    }
    const action = enabled
      ? tailscaleFunnel.enable(port)
      : tailscaleFunnel.disable(port);
    tailscaleFunnelAction = action;
    try {
      return { ok: true, status: rememberTailscaleHostname(await action) };
    } catch (error) {
      return { ok: false, error: serializeTailscaleError(error) };
    } finally {
      tailscaleFunnelAction = null;
    }
  });
}

async function startEmbeddedServer() {
  const serverModule = await import("../server/app.js");
  if (typeof serverModule.startServer !== "function") {
    throw new Error("src/server/app.js 必须导出 startServer(options) 函数。");
  }

  const port = resolveDesktopPort({ environment: process.env, preferences: desktopPreferences });
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
  let handle;
  try {
    handle = await serverModule.startServer({
      host: LOOPBACK_HOST,
      port,
      mode: "desktop",
      apiKeyStorePath: path.join(app.getPath("userData"), "gateway-api-keys.json"),
      usageStorePath: path.join(app.getPath("userData"), "usage-stats.json"),
      apiKeySecretProtector,
      desktopSessionToken,
      corsOrigins: platformCorsOrigins(platformClient.baseUrl),
      isAllowedHost: (hostname) => tailscalePublicHostnames.has(hostname),
      onDesktopOpen: focusMainWindow,
      onDesktopStatus: async () => {
        const readiness = latestReadiness ?? await checkCodexReadiness();
        return Object.freeze({
          codingAgent: Object.freeze({
            id: "chatgpt-codex",
            label: "ChatGPT / Codex",
            status: readiness.overall,
            ready: readiness.ready === true,
            checkedAt: readiness.checkedAt,
          }),
        });
      },
    });
  } catch (error) {
    if (port !== 0 && ["EADDRINUSE", "EACCES"].includes(error?.code)) {
      throw new Error(`固定 API 端口 ${port} 无法使用。请关闭占用该端口的程序，或通过 CODEX_DESKTOP_PORT 临时指定其他端口。`, { cause: error });
    }
    throw error;
  }

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
    title: "Agent Gateway",
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

  const minimizeToTray = (event) => {
    if (!shouldMinimizeWindowToTray({ preferences: desktopPreferences, isQuitting, smokeTest: SMOKE_TEST })) return;
    event.preventDefault();
    window.hide();
    if (ensureTray()) showTrayNotice();
  };
  window.on("close", minimizeToTray);
  window.on("minimize", minimizeToTray);

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
    const requestedDelay = Number(process.env.CODEX_DESKTOP_SMOKE_DURATION_MS ?? 250);
    const closeDelay = Number.isFinite(requestedDelay)
      ? Math.min(Math.max(Math.trunc(requestedDelay), 250), 24 * 60 * 60 * 1_000)
      : 250;
    setTimeout(() => {
      if (!window.isDestroyed()) window.close();
    }, closeDelay).unref?.();
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
  registerApplicationProtocol();
  desktopPreferences = loadDesktopPreferences(app.getPath("userData"));
  if (desktopPreferences.minimizeToTray && !ensureTray()) {
    desktopPreferences = saveDesktopPreferences(app.getPath("userData"), { ...desktopPreferences, minimizeToTray: false });
  }
  if (SDK_SMOKE_TEST) {
    if (!ensureTray()) throw new Error("Packaged Windows tray icon check failed.");
    destroyTray();
    console.info("[electron-smoke] packaged Windows tray icon created successfully");
  }
  prepareUserDataSchema({
    userDataPath: app.getPath("userData"),
    appVersion: app.getVersion(),
  });
  const platformSecretProtector = Object.freeze({
    encrypt(secret) {
      return safeStorage.encryptString(secret).toString("base64");
    },
    decrypt(payload) {
      return safeStorage.decryptString(Buffer.from(payload, "base64"));
    },
  });
  platformClient = new PlatformClient({
    userDataPath: app.getPath("userData"),
    secretProtector: platformSecretProtector,
    appVersion: app.getVersion(),
    localPortProvider: activeDesktopPort,
  });
  desktopUpdater = createDesktopUpdater();
  registerIpcHandlers();
  serverHandle = await startEmbeddedServer();
  console.info(`[electron] 本地服务已启动：${serverHandle.url}`);
  void platformClient.resumeOnlineHost()
    .then((status) => {
      if (status?.host?.desiredOnline && status?.error) {
        console.warn("[electron] Online Host Relay 暂未恢复", status.error.code);
      }
    })
    .catch((error) => console.warn("[electron] 无法恢复 Online Host Relay", error?.code || error?.name));
  void tailscaleFunnel.status(activeDesktopPort())
    .then(rememberTailscaleHostname)
    .catch((error) => console.warn("[electron] 无法预加载 Tailscale 公网 Host 名称", error));
  if (SDK_SMOKE_TEST) {
    const readiness = await checkCodexReadiness();
    if (readiness.runtime?.status !== "available") {
      throw new Error(`Packaged Codex runtime check failed (${readiness.runtime?.status ?? "unknown"}).`);
    }
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
    writeFileSync(
      path.join(app.getPath("userData"), "packaged-runtime-smoke.json"),
      JSON.stringify({
        status: readiness.runtime.status,
        version: readiness.runtime.version ?? null,
        serverUrl: serverHandle.url,
        port: activeDesktopPort(),
      }),
      { encoding: "utf8", mode: 0o600 },
    );
    console.info(`[electron-smoke] packaged Codex runtime available: ${readiness.runtime.version ?? "unknown"}`);
    console.info("[electron-smoke] packaged Codex SDK resolved successfully");
  }
  await createMainWindow(serverHandle.url, serverHandle.desktopSessionToken);
  if (!SMOKE_TEST && app.isPackaged) {
    automaticUpdateCheckTimer = setTimeout(() => {
      void desktopUpdater.check().catch((error) => console.warn("[updater] automatic update check failed", error));
    }, 10_000);
    automaticUpdateCheckTimer.unref?.();
  }
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
    "Agent Gateway 启动失败",
    `${error.message}\n\n请确认依赖已安装、Codex 已登录，并检查终端日志。`,
  );
  app.exit(1);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  // Installer-registered agent-gateway:// links start a second process when
  // the app is already running. The existing single-instance guard turns that
  // launch into a safe focus request for the primary window.
  app.on("second-instance", focusMainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
      void createMainWindow(serverHandle.url, serverHandle.desktopSessionToken).catch(reportStartupFailure);
    } else {
      focusMainWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (desktopPreferences.minimizeToTray && !isQuitting) {
      ensureTray();
      return;
    }
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    isQuitting = true;
    if (shutdownStarted || !serverHandle) return;

    event.preventDefault();
    shutdownStarted = true;
    platformClient?.disconnectRelay();
    const handle = serverHandle;
    serverHandle = null;
    void stopEmbeddedServerWithTimeout(handle)
      .catch((error) => console.error("[electron] 关闭本地服务失败", error))
      .finally(() => app.quit());
  });

  app.on("will-quit", () => {
    if (automaticUpdateCheckTimer) clearTimeout(automaticUpdateCheckTimer);
    automaticUpdateCheckTimer = null;
    destroyTray();
  });

  void app.whenReady().then(bootstrap).catch(reportStartupFailure);
}
