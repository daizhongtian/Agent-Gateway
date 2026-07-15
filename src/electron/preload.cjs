"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "codexDesktop",
  Object.freeze({
    pickProject: () => ipcRenderer.invoke("desktop:pick-project"),
    getPlatform: () => ipcRenderer.invoke("desktop:get-platform"),
    openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  }),
);
