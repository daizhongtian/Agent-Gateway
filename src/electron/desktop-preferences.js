import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_DESKTOP_PORT, parseDesktopPort } from "./desktop-port.js";

export const DESKTOP_PREFERENCES_FILE = "desktop-preferences.json";
export const DEFAULT_DESKTOP_PREFERENCES = Object.freeze({
  minimizeToTray: false,
  port: DEFAULT_DESKTOP_PORT,
});

function normalizedPort(value) {
  try {
    return parseDesktopPort(value);
  } catch {
    return DEFAULT_DESKTOP_PORT;
  }
}

export function normalizeDesktopPreferences(value) {
  return Object.freeze({
    minimizeToTray: value?.minimizeToTray === true,
    port: normalizedPort(value?.port),
  });
}

export function loadDesktopPreferences(userDataPath) {
  const filePath = path.join(path.resolve(userDataPath), DESKTOP_PREFERENCES_FILE);
  try {
    return normalizeDesktopPreferences(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return DEFAULT_DESKTOP_PREFERENCES;
  }
}

export function saveDesktopPreferences(userDataPath, value) {
  const normalized = normalizeDesktopPreferences(value);
  const directory = path.resolve(userDataPath);
  const filePath = path.join(directory, DESKTOP_PREFERENCES_FILE);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    rmSync(filePath, { force: true });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return normalized;
}

export function shouldMinimizeWindowToTray({ preferences, isQuitting = false, smokeTest = false } = {}) {
  return preferences?.minimizeToTray === true && !isQuitting && !smokeTest;
}
