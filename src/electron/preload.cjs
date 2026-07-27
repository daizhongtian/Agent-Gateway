"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "codexDesktop",
  Object.freeze({
    pickProject: () => ipcRenderer.invoke("desktop:pick-project"),
    getPlatform: () => ipcRenderer.invoke("desktop:get-platform"),
    getPreferences: () => ipcRenderer.invoke("desktop:get-preferences"),
    setMinimizeToTray: (enabled) => ipcRenderer.invoke("desktop:set-minimize-to-tray", enabled),
    setDesktopPort: (port) => ipcRenderer.invoke("desktop:set-port", port),
    openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
    checkCodexReadiness: () => ipcRenderer.invoke("desktop:check-codex-readiness"),
    connectCodingAgent: (providerId) => ipcRenderer.invoke("desktop:connect-coding-agent", providerId),
    exportUserData: (preferences) => ipcRenderer.invoke("desktop:export-user-data", preferences),
    importUserData: () => ipcRenderer.invoke("desktop:import-user-data"),
    exportDiagnostics: () => ipcRenderer.invoke("desktop:export-diagnostics"),
    checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
    getTailscaleFunnelStatus: () => ipcRenderer.invoke("desktop:get-tailscale-funnel-status"),
    setTailscaleFunnelEnabled: (enabled) => ipcRenderer.invoke("desktop:set-tailscale-funnel-enabled", enabled),
    checkOnlineHost: (providerId) => ipcRenderer.invoke("desktop:check-online-host", providerId),
  }),
);
