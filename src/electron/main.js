import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = path.join(__dirname, "preload.cjs");
const LOOPBACK_HOST = "127.0.0.1";
const DESKTOP_SESSION_COOKIE = "codex_desktop_session";
const DEFAULT_WINDOW_SIZE = Object.freeze({ width: 1360, height: 880 });
const SAFE_EXTERNAL_PROTOCOLS = new Set(["https:", "http:"]);
const SDK_SMOKE_TEST = process.env.CODEX_DESKTOP_SDK_SMOKE_TEST === "1";
const SMOKE_TEST = process.env.CODEX_DESKTOP_SMOKE_TEST === "1" || SDK_SMOKE_TEST;

let mainWindow = null;
let serverHandle = null;
let trustedRendererOrigin = null;
let pendingSecondInstance = false;
let shutdownStarted = false;

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
  const senderOrigin = (() => {
    try {
      return new URL(event.senderFrame?.url ?? "").origin;
    } catch {
      return null;
    }
  })();

  if (!activeContents || event.sender !== activeContents || senderOrigin !== trustedRendererOrigin) {
    throw new Error("拒绝来自非受信页面的桌面接口调用。");
  }
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
}

async function startEmbeddedServer() {
  const serverModule = await import("../server/app.js");
  if (typeof serverModule.startServer !== "function") {
    throw new Error("src/server/app.js 必须导出 startServer(options) 函数。");
  }

  const port = parseDesktopPort(process.env.CODEX_DESKTOP_PORT);
  const desktopSessionToken = randomBytes(32).toString("base64url");
  const handle = await serverModule.startServer({
    host: LOOPBACK_HOST,
    port,
    mode: "desktop",
    apiKeyStorePath: path.join(app.getPath("userData"), "gateway-api-keys.json"),
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

function stopEmbeddedServerWithTimeout(handle, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[electron] 服务关闭超过 ${timeoutMs}ms，继续退出。`);
      resolve();
    }, timeoutMs);
    timer.unref?.();

    stopEmbeddedServer(handle).then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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
