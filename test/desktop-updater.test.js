import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { DesktopUpdater, detectUpdateMode } from "../src/electron/desktop-updater.js";

class FakeNsisUpdater extends EventEmitter {
  async checkForUpdates() {
    this.emit("checking-for-update");
    const updateInfo = { version: "3.0.7" };
    this.emit("update-available", updateInfo);
    return { isUpdateAvailable: true, updateInfo };
  }

  async downloadUpdate() {
    this.emit("download-progress", { percent: 42, transferred: 42, total: 100, bytesPerSecond: 21 });
    this.emit("update-downloaded", { version: "3.0.7", downloadedFile: "C:\\updates\\setup.exe", files: [{ size: 100 }] });
    return ["C:\\updates\\setup.exe"];
  }

  quitAndInstall(isSilent, isForceRunAfter) {
    this.installArguments = [isSilent, isForceRunAfter];
    return true;
  }
}

test("desktop update mode distinguishes Setup, Portable, and development builds", () => {
  assert.equal(detectUpdateMode({ isPackaged: false, platform: "win32", environment: {} }), "development");
  assert.equal(detectUpdateMode({ isPackaged: true, platform: "linux", environment: {} }), "development");
  assert.equal(detectUpdateMode({ isPackaged: true, platform: "win32", environment: {} }), "setup");
  assert.equal(detectUpdateMode({
    isPackaged: true,
    platform: "win32",
    environment: { PORTABLE_EXECUTABLE_FILE: "C:\\Agent-Gateway.exe" },
  }), "portable");
});

test("Setup updates check, download with progress, and install only after preparation", async () => {
  const updater = new FakeNsisUpdater();
  const states = [];
  let prepared = 0;
  const desktopUpdater = new DesktopUpdater({
    mode: "setup",
    currentVersion: "3.0.6",
    updater,
    prepareInstall: async () => { prepared += 1; },
    onStateChange: (state) => states.push(state),
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);

  const available = await desktopUpdater.check();
  assert.equal(available.status, "available");
  assert.equal(available.latestVersion, "3.0.7");
  assert.equal(available.canDownload, true);

  const downloaded = await desktopUpdater.download();
  assert.equal(downloaded.status, "downloaded");
  assert.equal(downloaded.progress.percent, 100);
  assert.equal(downloaded.downloadedFileName, "setup.exe");
  assert.ok(states.some((state) => state.status === "downloading" && state.progress.percent === 42));

  await desktopUpdater.install();
  assert.equal(prepared, 1);
  assert.deepEqual(updater.installArguments, [true, true]);
});

test("active Agent tasks block installation without losing the downloaded update", async () => {
  const updater = new FakeNsisUpdater();
  const desktopUpdater = new DesktopUpdater({
    mode: "setup",
    currentVersion: "3.0.6",
    updater,
    prepareInstall: async () => {
      throw Object.assign(new Error("private task detail"), { code: "UPDATE_TASKS_ACTIVE" });
    },
    logger: { info() {}, warn() {}, error() {} },
  });
  await desktopUpdater.check();
  await desktopUpdater.download();

  await assert.rejects(() => desktopUpdater.install(), (error) => {
    assert.equal(error.code, "UPDATE_TASKS_ACTIVE");
    assert.doesNotMatch(error.message, /private task detail/);
    return true;
  });
  assert.equal(desktopUpdater.getState().status, "downloaded");
  assert.equal(desktopUpdater.getState().canInstall, true);
});

test("Portable updates use the verified downloader and relaunch path", async () => {
  const release = {
    available: true,
    latestVersion: "3.0.7",
    releaseUrl: "https://github.com/daizhongtian/Agent-Gateway/releases/tag/v3.0.7",
    portableAsset: { name: "Agent-Gateway-Portable-3.0.7-x64.exe", size: 123 },
  };
  let launched = null;
  const desktopUpdater = new DesktopUpdater({
    mode: "portable",
    currentVersion: "3.0.6",
    checkRelease: async () => release,
    downloadPortable: async (_release, onProgress) => {
      onProgress({ percent: 50, transferred: 50, total: 100 });
      return { filePath: "C:\\Downloads\\Agent-Gateway-Portable-3.0.7-x64.exe", fileName: "Agent-Gateway-Portable-3.0.7-x64.exe" };
    },
    launchPortable: async (filePath) => { launched = filePath; },
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.equal((await desktopUpdater.check()).canDownload, true);
  assert.equal((await desktopUpdater.download()).status, "downloaded");
  await desktopUpdater.install();
  assert.equal(launched, "C:\\Downloads\\Agent-Gateway-Portable-3.0.7-x64.exe");
});

test("development builds can check releases but never present an in-app download action", async () => {
  const desktopUpdater = new DesktopUpdater({
    mode: "development",
    currentVersion: "3.0.6",
    checkRelease: async () => ({
      available: true,
      latestVersion: "3.0.7",
      releaseUrl: "https://github.com/daizhongtian/Agent-Gateway/releases/tag/v3.0.7",
      portableAsset: { name: "Agent-Gateway-Portable-3.0.7-x64.exe", size: 123 },
    }),
    logger: { info() {}, warn() {}, error() {} },
  });
  const state = await desktopUpdater.check();
  assert.equal(state.supported, false);
  assert.equal(state.available, true);
  assert.equal(state.canDownload, false);
});
