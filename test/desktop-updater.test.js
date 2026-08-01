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

test("desktop updater rejects incomplete construction and actions in the wrong state", async () => {
  assert.throws(() => new DesktopUpdater({ mode: "unknown", currentVersion: "3.0.9" }), /valid desktop update mode/);
  assert.throws(() => new DesktopUpdater({ mode: "development", currentVersion: "next", checkRelease() {} }), /stable current version/);
  assert.throws(() => new DesktopUpdater({ mode: "setup", currentVersion: "3.0.9" }), /NSIS updater/);
  assert.throws(() => new DesktopUpdater({ mode: "portable", currentVersion: "3.0.9" }), /release checker/);

  const instance = new DesktopUpdater({
    mode: "development",
    currentVersion: "3.0.9",
    checkRelease: async () => ({ available: false, latestVersion: "3.0.9" }),
    logger: { info() {}, warn() {}, error() {} },
  });
  await assert.rejects(() => instance.download(), (error) => error.code === "UPDATE_NOT_AVAILABLE");
  await assert.rejects(() => instance.install(), (error) => error.code === "UPDATE_NOT_DOWNLOADED");
  assert.equal(instance.isBusy(), false);
});

test("Setup update fallbacks handle no-update results and eventless downloads", async () => {
  class EventlessUpdater extends EventEmitter {
    async checkForUpdates() {
      return { isUpdateAvailable: false, updateInfo: { version: "3.0.9" } };
    }
  }
  const noUpdate = new DesktopUpdater({
    mode: "setup",
    currentVersion: "3.0.9",
    updater: new EventlessUpdater(),
    logger: { info() {}, warn() {}, error() {} },
  });
  assert.equal((await noUpdate.check()).status, "not-available");

  class EventlessDownloadUpdater extends EventEmitter {
    async checkForUpdates() {
      return { isUpdateAvailable: true, updateInfo: { version: "3.0.10" } };
    }
    async downloadUpdate() { return ["C:\\updates\\eventless.exe"]; }
    quitAndInstall() { return false; }
  }
  const updater = new EventlessDownloadUpdater();
  const available = new DesktopUpdater({
    mode: "setup",
    currentVersion: "3.0.9",
    updater,
    logger: { info() {}, warn() {}, error() {} },
  });
  assert.equal((await available.check()).canDownload, true);
  assert.equal((await available.download()).downloadedFileName, "eventless.exe");
  await assert.rejects(() => available.install(), /could not be completed/);
  assert.equal(available.getState().status, "downloaded");
});

test("update failures expose stable network and integrity errors without private details", async () => {
  class NetworkUpdater extends EventEmitter {
    async checkForUpdates() { throw new Error("ECONNRESET secret.internal.example"); }
  }
  const network = new DesktopUpdater({
    mode: "setup",
    currentVersion: "3.0.9",
    updater: new NetworkUpdater(),
    logger: { info() {}, warn() {}, error() {} },
  });
  await assert.rejects(() => network.check(), (error) => {
    assert.equal(error.code, "UPDATE_NETWORK_FAILED");
    assert.doesNotMatch(error.message, /secret\.internal/);
    return true;
  });

  class IntegrityUpdater extends EventEmitter {
    async checkForUpdates() {
      const updateInfo = { version: "3.0.10" };
      this.emit("update-available", updateInfo);
      return { isUpdateAvailable: true, updateInfo };
    }
    async downloadUpdate() { throw new Error("sha512 checksum mismatch at C:\\private"); }
  }
  const integrity = new DesktopUpdater({
    mode: "setup",
    currentVersion: "3.0.9",
    updater: new IntegrityUpdater(),
    onStateChange() { throw new Error("renderer gone"); },
    logger: { info() {}, warn() {}, error() {} },
  });
  await integrity.check();
  await assert.rejects(() => integrity.download(), (error) => error.code === "UPDATE_INTEGRITY_FAILED");
  assert.equal(integrity.getState().status, "available");
  assert.equal(integrity.getState().canDownload, true);
});

test("Portable checks remain safe when a release has no downloadable asset", async () => {
  const updater = new DesktopUpdater({
    mode: "portable",
    currentVersion: "3.0.9",
    checkRelease: async () => ({ available: true, latestVersion: "3.0.10", releaseUrl: null }),
    logger: { info() {}, warn() {}, error() {} },
  });
  const state = await updater.check();
  assert.equal(state.status, "available");
  assert.equal(state.canDownload, false);
  assert.equal(state.releaseUrl, null);
});
