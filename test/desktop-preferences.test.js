import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_DESKTOP_PREFERENCES,
  DESKTOP_PREFERENCES_FILE,
  loadDesktopPreferences,
  normalizeDesktopPreferences,
  saveDesktopPreferences,
  shouldMinimizeWindowToTray,
} from "../src/electron/desktop-preferences.js";

function temporaryUserData(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "ccc-desktop-preferences-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("desktop preferences default to normal window closing", () => {
  assert.deepEqual(normalizeDesktopPreferences(null), DEFAULT_DESKTOP_PREFERENCES);
  assert.deepEqual(normalizeDesktopPreferences({ minimizeToTray: "true" }), DEFAULT_DESKTOP_PREFERENCES);
});

test("minimize-to-tray preferences persist and malformed files fail closed", (t) => {
  const root = temporaryUserData(t);
  assert.deepEqual(loadDesktopPreferences(root), DEFAULT_DESKTOP_PREFERENCES);
  assert.deepEqual(saveDesktopPreferences(root, { minimizeToTray: true }), { minimizeToTray: true });
  assert.deepEqual(loadDesktopPreferences(root), { minimizeToTray: true });
  assert.equal(JSON.parse(readFileSync(path.join(root, DESKTOP_PREFERENCES_FILE), "utf8")).minimizeToTray, true);

  writeFileSync(path.join(root, DESKTOP_PREFERENCES_FILE), "not json", "utf8");
  assert.deepEqual(loadDesktopPreferences(root), DEFAULT_DESKTOP_PREFERENCES);
});

test("window closing minimizes only for an enabled normal user close", () => {
  const enabled = { minimizeToTray: true };
  assert.equal(shouldMinimizeWindowToTray({ preferences: enabled }), true);
  assert.equal(shouldMinimizeWindowToTray({ preferences: enabled, isQuitting: true }), false);
  assert.equal(shouldMinimizeWindowToTray({ preferences: enabled, smokeTest: true }), false);
  assert.equal(shouldMinimizeWindowToTray({ preferences: DEFAULT_DESKTOP_PREFERENCES }), false);
});
