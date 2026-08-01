"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "codexDesktop",
  Object.freeze({
    pickProject: () => ipcRenderer.invoke("desktop:pick-project"),
    getPlatform: () => ipcRenderer.invoke("desktop:get-platform"),
    getPlatformAccount: () => ipcRenderer.invoke("desktop:get-platform-account"),
    platformBrowserLogin: () => ipcRenderer.invoke("desktop:platform-browser-login"),
    platformLogout: () => ipcRenderer.invoke("desktop:platform-logout"),
    setPlatformHostEnabled: (enabled) => ipcRenderer.invoke("desktop:set-platform-host-enabled", enabled),
    getPreferences: () => ipcRenderer.invoke("desktop:get-preferences"),
    setMinimizeToTray: (enabled) => ipcRenderer.invoke("desktop:set-minimize-to-tray", enabled),
    setDesktopPort: (port) => ipcRenderer.invoke("desktop:set-port", port),
    openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
    checkCodexReadiness: () => ipcRenderer.invoke("desktop:check-codex-readiness"),
    connectCodingAgent: (providerId) => ipcRenderer.invoke("desktop:connect-coding-agent", providerId),
    exportUserData: (preferences) => ipcRenderer.invoke("desktop:export-user-data", preferences),
    importUserData: () => ipcRenderer.invoke("desktop:import-user-data"),
    exportDiagnostics: () => ipcRenderer.invoke("desktop:export-diagnostics"),
    getUpdateState: () => ipcRenderer.invoke("desktop:get-update-state"),
    checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
    downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
    installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
    onUpdateState: (callback) => {
      if (typeof callback !== "function") throw new TypeError("An update state callback is required.");
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("desktop:update-state", listener);
      return () => ipcRenderer.removeListener("desktop:update-state", listener);
    },
    getTailscaleFunnelStatus: () => ipcRenderer.invoke("desktop:get-tailscale-funnel-status"),
    setTailscaleFunnelEnabled: (enabled) => ipcRenderer.invoke("desktop:set-tailscale-funnel-enabled", enabled),
    checkOnlineHost: (providerId) => ipcRenderer.invoke("desktop:check-online-host", providerId),
  }),
);
