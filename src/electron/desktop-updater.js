const UPDATE_MODES = new Set(["setup", "portable", "development"]);
const ACTIVE_STATUSES = new Set(["checking", "downloading", "installing"]);

function stableVersion(value) {
  const version = String(value ?? "").trim().replace(/^v/i, "");
  return /^\d+\.\d+\.\d+$/.test(version) ? version : null;
}

function releaseUrl(version) {
  const normalized = stableVersion(version);
  return normalized ? `https://github.com/daizhongtian/Agent-Gateway/releases/tag/v${normalized}` : null;
}

function publicError(error) {
  const sourceCode = typeof error?.code === "string" ? error.code : "UPDATE_FAILED";
  if (sourceCode === "UPDATE_TASKS_ACTIVE") {
    return Object.freeze({
      code: sourceCode,
      message: "Finish or cancel active Agent tasks before installing the update.",
    });
  }
  if (/checksum|sha512|sha256|signature|integrity/i.test(String(error?.message ?? ""))) {
    return Object.freeze({
      code: "UPDATE_INTEGRITY_FAILED",
      message: "The downloaded update failed its security verification and was not installed.",
    });
  }
  if (error?.name === "AbortError" || /timed? out|network|ENOTFOUND|ECONN/i.test(String(error?.message ?? ""))) {
    return Object.freeze({
      code: "UPDATE_NETWORK_FAILED",
      message: "The update service could not be reached. Check your connection and try again.",
    });
  }
  return Object.freeze({
    code: sourceCode.startsWith("ERR_UPDATER_") ? sourceCode : "UPDATE_FAILED",
    message: "The update could not be completed. Try again later or use the GitHub Release page.",
  });
}

function normalizeProgress(value) {
  const total = Number(value?.total);
  const transferred = Number(value?.transferred);
  const bytesPerSecond = Number(value?.bytesPerSecond);
  const percent = Number(value?.percent);
  return Object.freeze({
    percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0,
    transferred: Number.isFinite(transferred) && transferred >= 0 ? transferred : 0,
    total: Number.isFinite(total) && total >= 0 ? total : 0,
    bytesPerSecond: Number.isFinite(bytesPerSecond) && bytesPerSecond >= 0 ? bytesPerSecond : 0,
  });
}

function freezeState(value) {
  return Object.freeze({
    ...value,
    progress: value.progress ? normalizeProgress(value.progress) : null,
    lastError: value.lastError ? Object.freeze({ ...value.lastError }) : null,
  });
}

export function detectUpdateMode(options = {}) {
  if (!options.isPackaged || options.platform !== "win32") return "development";
  return options.environment?.PORTABLE_EXECUTABLE_FILE ? "portable" : "setup";
}

export class DesktopUpdater {
  constructor(options = {}) {
    if (!UPDATE_MODES.has(options.mode)) throw new TypeError("A valid desktop update mode is required.");
    const currentVersion = stableVersion(options.currentVersion);
    if (!currentVersion) throw new TypeError("A stable current version is required.");
    if (options.mode === "setup" && !options.updater) throw new TypeError("The NSIS updater is required in Setup mode.");
    if (options.mode !== "setup" && typeof options.checkRelease !== "function") {
      throw new TypeError("A release checker is required outside Setup mode.");
    }

    this.mode = options.mode;
    this.currentVersion = currentVersion;
    this.updater = options.updater ?? null;
    this.checkRelease = options.checkRelease ?? null;
    this.downloadPortable = options.downloadPortable ?? null;
    this.prepareInstall = options.prepareInstall ?? (async () => {});
    this.launchPortable = options.launchPortable ?? null;
    this.onStateChange = options.onStateChange ?? (() => {});
    this.logger = options.logger ?? console;
    this.release = null;
    this.downloadedFile = null;
    this.pendingAction = null;
    this.state = freezeState({
      supported: this.mode !== "development",
      mode: this.mode,
      status: "idle",
      currentVersion,
      latestVersion: null,
      releaseUrl: null,
      available: false,
      canDownload: false,
      canInstall: false,
      progress: null,
      downloadedFileName: null,
      lastError: null,
    });

    if (this.updater) this.#configureNsisUpdater();
  }

  #configureNsisUpdater() {
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = false;
    this.updater.allowDowngrade = false;
    this.updater.logger = this.logger;

    this.updater.on("checking-for-update", () => this.#set({ status: "checking", lastError: null }));
    this.updater.on("update-available", (info) => {
      const latestVersion = stableVersion(info?.version);
      this.#set({
        status: "available",
        latestVersion,
        releaseUrl: releaseUrl(latestVersion),
        available: Boolean(latestVersion),
        canDownload: Boolean(latestVersion),
        canInstall: false,
        progress: null,
        lastError: null,
      });
    });
    this.updater.on("update-not-available", (info) => {
      this.#set({
        status: "not-available",
        latestVersion: stableVersion(info?.version) ?? this.currentVersion,
        releaseUrl: null,
        available: false,
        canDownload: false,
        canInstall: false,
        progress: null,
        lastError: null,
      });
    });
    this.updater.on("download-progress", (progress) => {
      this.#set({ status: "downloading", canDownload: false, progress });
    });
    this.updater.on("update-downloaded", (info) => {
      this.downloadedFile = typeof info?.downloadedFile === "string" ? info.downloadedFile : this.downloadedFile;
      this.#set({
        status: "downloaded",
        canDownload: false,
        canInstall: true,
        progress: { percent: 100, transferred: info?.files?.[0]?.size ?? 0, total: info?.files?.[0]?.size ?? 0 },
        downloadedFileName: this.downloadedFile ? this.downloadedFile.split(/[\\/]/).at(-1) : null,
        lastError: null,
      });
    });
    this.updater.on("update-cancelled", () => {
      this.#set({ status: "available", canDownload: true, canInstall: false, progress: null });
    });
    this.updater.on("error", (error) => this.#handleError(error));
  }

  #set(patch) {
    this.state = freezeState({ ...this.state, ...patch });
    try {
      this.onStateChange(this.state);
    } catch (error) {
      this.logger.warn?.("[updater] unable to publish update state", error);
    }
    return this.state;
  }

  #handleError(error, restoreStatus = null) {
    this.logger.error?.("[updater] update operation failed", error);
    const lastError = publicError(error);
    this.#set({
      status: restoreStatus ?? "error",
      canDownload: restoreStatus === "available",
      canInstall: restoreStatus === "downloaded",
      lastError,
    });
    return Object.assign(new Error(lastError.message), { code: lastError.code });
  }

  getState() {
    return this.state;
  }

  async check() {
    if (this.pendingAction) return this.pendingAction;
    this.pendingAction = (async () => {
      this.#set({ status: "checking", lastError: null, progress: null });
      try {
        if (this.mode === "setup") {
          const result = await this.updater.checkForUpdates();
          if (!result) throw Object.assign(new Error("The packaged updater is unavailable."), { code: "UPDATE_UNAVAILABLE" });
          if (this.state.status === "checking") {
            const latestVersion = stableVersion(result.updateInfo?.version);
            this.#set(result.isUpdateAvailable ? {
              status: "available",
              latestVersion,
              releaseUrl: releaseUrl(latestVersion),
              available: Boolean(latestVersion),
              canDownload: Boolean(latestVersion),
              canInstall: false,
            } : {
              status: "not-available",
              latestVersion: latestVersion ?? this.currentVersion,
              releaseUrl: null,
              available: false,
              canDownload: false,
              canInstall: false,
            });
          }
          return this.state;
        }

        this.release = await this.checkRelease();
        const downloadable = Boolean(this.release?.available && this.release?.portableAsset && this.mode === "portable");
        this.#set({
          status: this.release?.available ? "available" : "not-available",
          latestVersion: stableVersion(this.release?.latestVersion),
          releaseUrl: this.release?.releaseUrl ?? null,
          available: Boolean(this.release?.available),
          canDownload: downloadable,
          canInstall: false,
          lastError: null,
        });
        return this.state;
      } catch (error) {
        throw this.#handleError(error);
      }
    })().finally(() => {
      this.pendingAction = null;
    });
    return this.pendingAction;
  }

  async download() {
    if (this.pendingAction) return this.pendingAction;
    if (this.state.status !== "available" || !this.state.canDownload) {
      throw Object.assign(new Error("Check for an available update before downloading it."), { code: "UPDATE_NOT_AVAILABLE" });
    }
    this.pendingAction = (async () => {
      this.#set({ status: "downloading", canDownload: false, progress: normalizeProgress({}), lastError: null });
      try {
        if (this.mode === "setup") {
          const files = await this.updater.downloadUpdate();
          if (this.state.status !== "downloaded") {
            this.downloadedFile = Array.isArray(files) && typeof files[0] === "string" ? files[0] : null;
            this.#set({
              status: "downloaded",
              canInstall: true,
              progress: { percent: 100 },
              downloadedFileName: this.downloadedFile?.split(/[\\/]/).at(-1) ?? null,
            });
          }
        } else {
          if (typeof this.downloadPortable !== "function") throw new Error("Portable update downloads are unavailable.");
          const result = await this.downloadPortable(this.release, (progress) => {
            this.#set({ status: "downloading", progress });
          });
          this.downloadedFile = result.filePath;
          this.#set({
            status: "downloaded",
            canInstall: true,
            progress: { percent: 100, transferred: this.release.portableAsset.size, total: this.release.portableAsset.size },
            downloadedFileName: result.fileName,
            lastError: null,
          });
        }
        return this.state;
      } catch (error) {
        throw this.#handleError(error, "available");
      }
    })().finally(() => {
      this.pendingAction = null;
    });
    return this.pendingAction;
  }

  async install() {
    if (this.pendingAction) return this.pendingAction;
    if (this.state.status !== "downloaded" || !this.state.canInstall || !this.downloadedFile) {
      throw Object.assign(new Error("Download the update before installing it."), { code: "UPDATE_NOT_DOWNLOADED" });
    }
    this.pendingAction = (async () => {
      this.#set({ status: "installing", canInstall: false, lastError: null });
      try {
        await this.prepareInstall();
        if (this.mode === "setup") {
          const started = this.updater.quitAndInstall(true, true);
          if (started === false) throw new Error("The update installer did not start.");
        } else {
          if (typeof this.launchPortable !== "function") throw new Error("Portable update launch is unavailable.");
          await this.launchPortable(this.downloadedFile);
        }
        return this.state;
      } catch (error) {
        throw this.#handleError(error, "downloaded");
      }
    })().finally(() => {
      this.pendingAction = null;
    });
    return this.pendingAction;
  }

  isBusy() {
    return ACTIVE_STATUSES.has(this.state.status);
  }
}

export const desktopUpdaterInternals = Object.freeze({ publicError, normalizeProgress, stableVersion });
