import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { normalizeStoredApiKeyStore } from "../server/api-key-store.js";
import { normalizeStoredUsageState } from "../server/usage-store.js";

export const BACKUP_FORMAT = "coding-agent-gateway-backup";
export const LEGACY_BACKUP_FORMAT = "codex-control-center-backup";
export const BACKUP_VERSION = 1;
export const DATA_SCHEMA_VERSION = 1;

export const MAX_DATA_FILE_BYTES = 32 * 1024 * 1024;
// A backup contains both independently bounded data files plus a small metadata
// envelope. Backups are written compactly so every snapshot produced from two
// valid 32 MiB stores remains importable.
export const MAX_BACKUP_BYTES = (2 * MAX_DATA_FILE_BYTES) + (1024 * 1024);
const DATA_FILE_NAMES = Object.freeze([
  "gateway-api-keys.json",
  "usage-stats.json",
]);
const SCHEMA_FILE_NAME = "data-schema.json";

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function asPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function validateGatewayStore(value) {
  try {
    return normalizeStoredApiKeyStore(value);
  } catch (error) {
    throw new Error(`Gateway API key data is invalid: ${error instanceof Error ? error.message : "invalid data"}`);
  }
}

function validateUsageStore(value) {
  try {
    return normalizeStoredUsageState(value);
  } catch (error) {
    throw new Error(`Usage statistics are invalid: ${error instanceof Error ? error.message : "invalid data"}`);
  }
}

function ensureDataFileSize(name, value) {
  if (value === null) return value;
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_DATA_FILE_BYTES) {
    throw new Error(`${name} is too large.`);
  }
  return value;
}

function validateDataFile(name, value) {
  if (value === null) return null;
  if (name === "gateway-api-keys.json") {
    return ensureDataFileSize(name, validateGatewayStore(value));
  }
  if (name === "usage-stats.json") {
    return ensureDataFileSize(name, validateUsageStore(value));
  }
  throw new Error(`Unsupported backup data file: ${name}`);
}

function cleanString(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\0\r\n]/.test(normalized)) return null;
  return normalized;
}

export function sanitizePreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  if (["zh", "en", "ja", "ko", "es", "fr", "de", "pt", "tr"].includes(value.language)) result.language = value.language;
  const projectPath = cleanString(value.projectPath, 32_767);
  if (projectPath) result.projectPath = projectPath;
  if (typeof value.projectless === "boolean") result.projectless = value.projectless;
  if (value.runConfig && typeof value.runConfig === "object" && !Array.isArray(value.runConfig)) {
    const model = cleanString(value.runConfig.model, 128);
    const effort = cleanString(value.runConfig.effort, 32);
    const speed = cleanString(value.runConfig.speed, 32);
    const runConfig = {};
    if (model) runConfig.model = model;
    if (effort) runConfig.effort = effort;
    if (speed) runConfig.speed = speed;
    if (Object.keys(runConfig).length) result.runConfig = runConfig;
  }
  return result;
}

function readOptionalDataFile(userDataPath, name) {
  const filePath = path.join(userDataPath, name);
  if (!existsSync(filePath)) return null;
  const stats = statSync(filePath);
  if (!stats.isFile() || stats.size > MAX_DATA_FILE_BYTES) {
    throw new Error(`${name} cannot be backed up because it is not a valid data file.`);
  }
  return validateDataFile(name, parseJson(readFileSync(filePath, "utf8"), name));
}

export function createBackupSnapshot(options = {}) {
  const userDataPath = path.resolve(String(options.userDataPath || ""));
  if (!options.userDataPath) throw new Error("A user data directory is required.");
  const data = {};
  for (const name of DATA_FILE_NAMES) data[name] = readOptionalDataFile(userDataPath, name);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: cleanString(options.appVersion, 64) ?? "unknown",
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    data,
    preferences: sanitizePreferences(options.preferences),
    notice: "Encrypted Gateway keys can only be decrypted by the compatible Windows user profile that created them.",
  };
}

export function validateBackupSnapshot(value) {
  const snapshot = asPlainObject(value, "Backup");
  if (![BACKUP_FORMAT, LEGACY_BACKUP_FORMAT].includes(snapshot.format) || snapshot.version !== BACKUP_VERSION) {
    throw new Error("This is not a supported Agent Gateway backup.");
  }
  if (snapshot.dataSchemaVersion !== DATA_SCHEMA_VERSION) {
    throw new Error("The backup data schema is not supported by this application version.");
  }
  if (Number.isNaN(Date.parse(snapshot.createdAt))) throw new Error("The backup timestamp is invalid.");
  const source = asPlainObject(snapshot.data, "Backup data");
  const data = {};
  for (const name of DATA_FILE_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) {
      throw new Error(`Backup data is missing ${name}.`);
    }
    data[name] = validateDataFile(name, source[name]);
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: snapshot.createdAt,
    appVersion: cleanString(snapshot.appVersion, 64) ?? "unknown",
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    data,
    preferences: sanitizePreferences(snapshot.preferences),
    notice: typeof snapshot.notice === "string" ? snapshot.notice.slice(0, 1_000) : undefined,
  };
}

export function writeBackupFile(filePath, snapshot) {
  const validated = validateBackupSnapshot(snapshot);
  const body = `${JSON.stringify(validated)}\n`;
  if (Buffer.byteLength(body, "utf8") > MAX_BACKUP_BYTES) {
    throw new Error("The backup is too large to export.");
  }
  mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  writeFileSync(filePath, body, {
    encoding: "utf8",
    mode: 0o600,
  });
  return filePath;
}

export function readBackupFile(filePath) {
  const stats = statSync(filePath);
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_BACKUP_BYTES) {
    throw new Error("The selected backup file is empty or too large.");
  }
  return validateBackupSnapshot(parseJson(readFileSync(filePath, "utf8"), "Backup"));
}

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    rmSync(filePath, { force: true });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function copyCurrentData(userDataPath, backupDirectory) {
  const copied = [];
  for (const name of DATA_FILE_NAMES) {
    const source = path.join(userDataPath, name);
    if (!existsSync(source)) continue;
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    copyFileSync(source, path.join(backupDirectory, name));
    copied.push(name);
  }
  return copied;
}

export function restoreBackupSnapshot(options = {}) {
  if (!options.userDataPath) throw new Error("A user data directory is required.");
  const userDataPath = path.resolve(options.userDataPath);
  const snapshot = validateBackupSnapshot(options.snapshot);
  mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
  const rollbackDirectory = path.join(
    userDataPath,
    "backups",
    `before-restore-${timestampForPath()}`,
  );
  const copied = copyCurrentData(userDataPath, rollbackDirectory);
  const originallyPresent = new Set(copied);
  if (copied.length) {
    atomicWriteJson(path.join(rollbackDirectory, "manifest.json"), {
      reason: "manual-restore",
      createdAt: new Date().toISOString(),
      appVersion: cleanString(options.appVersion, 64) ?? "unknown",
      files: copied,
    });
  }

  try {
    for (const name of DATA_FILE_NAMES) {
      const target = path.join(userDataPath, name);
      const value = snapshot.data[name];
      if (value === null) rmSync(target, { force: true });
      else atomicWriteJson(target, value);
    }
  } catch (error) {
    for (const name of DATA_FILE_NAMES) {
      const target = path.join(userDataPath, name);
      if (originallyPresent.has(name)) {
        copyFileSync(path.join(rollbackDirectory, name), target);
      } else {
        rmSync(target, { force: true });
      }
    }
    throw error;
  }

  return {
    restored: true,
    sourceVersion: snapshot.appVersion,
    preferences: snapshot.preferences,
    rollbackDirectory: copied.length ? rollbackDirectory : null,
  };
}

export function prepareUserDataSchema(options = {}) {
  if (!options.userDataPath) throw new Error("A user data directory is required.");
  const userDataPath = path.resolve(options.userDataPath);
  const appVersion = cleanString(options.appVersion, 64) ?? "unknown";
  const schemaPath = path.join(userDataPath, SCHEMA_FILE_NAME);
  mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
  let previous = null;
  if (existsSync(schemaPath)) {
    previous = asPlainObject(parseJson(readFileSync(schemaPath, "utf8"), SCHEMA_FILE_NAME), "Data schema");
    if (!Number.isInteger(previous.version) || previous.version < 1) {
      throw new Error("The application data schema is invalid.");
    }
    if (previous.version > DATA_SCHEMA_VERSION) {
      throw new Error("Application data was created by a newer, incompatible version.");
    }
  }

  let backupDirectory = null;
  const legacyDataExists = !previous && DATA_FILE_NAMES.some((name) => existsSync(path.join(userDataPath, name)));
  if ((previous && previous.appVersion !== appVersion) || legacyDataExists) {
    const fromVersion = previous?.appVersion || "legacy";
    backupDirectory = path.join(
      userDataPath,
      "backups",
      `pre-upgrade-${fromVersion}-to-${appVersion}-${timestampForPath()}`,
    );
    const files = copyCurrentData(userDataPath, backupDirectory);
    if (files.length) {
      atomicWriteJson(path.join(backupDirectory, "manifest.json"), {
        reason: "version-change",
        createdAt: new Date().toISOString(),
        fromVersion,
        toVersion: appVersion,
        files,
      });
    } else {
      backupDirectory = null;
    }
  }

  const next = {
    version: DATA_SCHEMA_VERSION,
    appVersion,
    updatedAt: new Date().toISOString(),
  };
  atomicWriteJson(schemaPath, next);
  return { previous, current: next, backupDirectory };
}
