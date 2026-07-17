import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BACKUP_FORMAT,
  MAX_BACKUP_BYTES,
  MAX_DATA_FILE_BYTES,
  createBackupSnapshot,
  prepareUserDataSchema,
  readBackupFile,
  restoreBackupSnapshot,
  sanitizePreferences,
  validateBackupSnapshot,
  writeBackupFile,
} from "../src/electron/user-data-manager.js";
import { ApiKeyStore } from "../src/server/api-key-store.js";
import { UsageStore } from "../src/server/usage-store.js";

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

async function temporaryRoot(t, prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function gatewayStore(id = "key_test", overrides = {}) {
  const record = {
    id,
    ownerId: "local-desktop",
    name: "Backup test",
    maskedKey: "ccc_live_example…test",
    keyHash: "a".repeat(64),
    encryptedKey: "encrypted-test-value",
    preset: {
      model: "gpt-5.6-sol",
      modelLabel: "5.6 Sol",
      effort: "high",
      speed: "standard",
      permission: "workspace-write",
      approvalPolicy: "never",
    },
    createdAt: TIMESTAMP,
    revokedAt: null,
    ...overrides,
  };
  return {
    version: 1,
    gateway: { enabled: true, updatedAt: null },
    keys: [record],
  };
}

function usageStore(totalTokens = 5, overrides = {}) {
  return {
    version: 1,
    generation: "generation-test",
    resetAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    taskCount: 1,
    completedCount: 1,
    failedCount: 0,
    cancelledCount: 0,
    tasksWithUsage: 1,
    inputTokens: totalTokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens,
    models: { "5.6 Sol": { tasks: 1, inputTokens: totalTokens, totalTokens } },
    credentials: {},
    ...overrides,
  };
}

function rawSnapshot(data) {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: "2026-01-02T00:00:00.000Z",
    appVersion: "1.0.0",
    dataSchemaVersion: 1,
    data,
    preferences: { language: "zh" },
  };
}

test("backup snapshots include only runtime-compatible data and safe preferences", async (t) => {
  const root = await temporaryRoot(t, "ccc-backup-");
  await writeFile(path.join(root, "gateway-api-keys.json"), JSON.stringify(gatewayStore()));
  await writeFile(path.join(root, "usage-stats.json"), JSON.stringify(usageStore()));
  const snapshot = createBackupSnapshot({
    userDataPath: root,
    appVersion: "1.0.0",
    preferences: {
      language: "en",
      projectPath: "C:\\work",
      projectless: false,
      runConfig: { model: "5.6 Sol", effort: "Xhigh", speed: "Standard", injected: "no" },
      secret: "must-not-be-exported",
    },
  });
  assert.equal(snapshot.format, BACKUP_FORMAT);
  assert.equal(snapshot.data["usage-stats.json"].totalTokens, 5);
  assert.deepEqual(snapshot.preferences, {
    language: "en",
    projectPath: "C:\\work",
    projectless: false,
    runConfig: { model: "5.6 Sol", effort: "Xhigh", speed: "Standard" },
  });
  assert.equal("secret" in snapshot.preferences, false);

  const backupPath = path.join(root, "export.ccc-backup.json");
  writeBackupFile(backupPath, snapshot);
  assert.deepEqual(readBackupFile(backupPath), validateBackupSnapshot(snapshot));
});

test("restored data loads through the real API key and usage stores", async (t) => {
  const root = await temporaryRoot(t, "ccc-restore-");
  await writeFile(path.join(root, "gateway-api-keys.json"), JSON.stringify(gatewayStore("key_old")));
  await writeFile(path.join(root, "usage-stats.json"), JSON.stringify(usageStore(10)));
  const snapshot = validateBackupSnapshot(rawSnapshot({
    "gateway-api-keys.json": gatewayStore("key_new"),
    "usage-stats.json": usageStore(99),
  }));
  const result = restoreBackupSnapshot({ userDataPath: root, appVersion: "1.0.0", snapshot });
  const restoredKeys = new ApiKeyStore({ filePath: path.join(root, "gateway-api-keys.json") });
  const restoredUsage = new UsageStore({ filePath: path.join(root, "usage-stats.json") });
  const rollbackKeys = JSON.parse(await readFile(path.join(result.rollbackDirectory, "gateway-api-keys.json"), "utf8"));
  assert.equal(restoredKeys.list({ allowAll: true })[0].id, "key_new");
  assert.equal(restoredUsage.snapshot().totalTokens, 99);
  assert.equal(rollbackKeys.keys[0].id, "key_old");
  assert.deepEqual(result.preferences, { language: "zh" });
});

test("missing backup fields cannot be confused with explicit deletion", async (t) => {
  const root = await temporaryRoot(t, "ccc-missing-");
  const keyPath = path.join(root, "gateway-api-keys.json");
  const usagePath = path.join(root, "usage-stats.json");
  await writeFile(keyPath, JSON.stringify(gatewayStore("key_existing")));
  await writeFile(usagePath, JSON.stringify(usageStore(42)));
  const beforeKeys = await readFile(keyPath, "utf8");
  const beforeUsage = await readFile(usagePath, "utf8");
  const missing = rawSnapshot({ "gateway-api-keys.json": gatewayStore("key_new") });
  assert.throws(() => validateBackupSnapshot(missing), /missing usage-stats\.json/i);
  assert.throws(() => restoreBackupSnapshot({ userDataPath: root, appVersion: "1.0.0", snapshot: missing }), /missing usage-stats\.json/i);
  assert.equal(await readFile(keyPath, "utf8"), beforeKeys);
  assert.equal(await readFile(usagePath, "utf8"), beforeUsage);

  const explicitDeletion = rawSnapshot({
    "gateway-api-keys.json": gatewayStore("key_new"),
    "usage-stats.json": null,
  });
  restoreBackupSnapshot({ userDataPath: root, appVersion: "1.0.0", snapshot: explicitDeletion });
  assert.equal(new ApiKeyStore({ filePath: keyPath }).list({ allowAll: true })[0].id, "key_new");
  assert.equal(existsSync(usagePath), false);
});

test("malformed runtime stores are rejected before restoration", () => {
  const invalidGateways = [
    gatewayStore("key_bad", { ownerId: "" }),
    gatewayStore("key_bad", { keyHash: "not-a-hash" }),
    gatewayStore("key_bad", { preset: null }),
    gatewayStore("key_bad", { preset: { model: "5.6 Sol", permission: "danger-full-access" } }),
  ];
  for (const gateway of invalidGateways) {
    assert.throws(() => validateBackupSnapshot(rawSnapshot({
      "gateway-api-keys.json": gateway,
      "usage-stats.json": usageStore(),
    })), /Gateway API key data is invalid/i);
  }

  const invalidUsage = [
    usageStore(1, { resetAt: "not-a-date" }),
    usageStore(1, { updatedAt: undefined }),
    usageStore(1, { models: { broken: null } }),
  ];
  for (const usage of invalidUsage) {
    assert.throws(() => validateBackupSnapshot(rawSnapshot({
      "gateway-api-keys.json": gatewayStore(),
      "usage-stats.json": usage,
    })), /Usage statistics are invalid/i);
  }
});

test("a backup larger than the old 32 MiB limit can be exported and re-imported", async (t) => {
  const root = await temporaryRoot(t, "ccc-large-backup-");
  const paddingSize = (16 * 1024 * 1024) + (512 * 1024);
  const gateway = gatewayStore("key_large", { encryptedKey: "e".repeat(paddingSize) });
  const usage = usageStore(1, { generation: "g".repeat(paddingSize) });
  await writeFile(path.join(root, "gateway-api-keys.json"), JSON.stringify(gateway));
  await writeFile(path.join(root, "usage-stats.json"), JSON.stringify(usage));
  const backupPath = path.join(root, "large-backup.json");
  writeBackupFile(backupPath, createBackupSnapshot({ userDataPath: root, appVersion: "1.0.0" }));
  const size = statSync(backupPath).size;
  assert.ok(size > 32 * 1024 * 1024);
  assert.ok(size <= MAX_BACKUP_BYTES);
  const restored = readBackupFile(backupPath);
  assert.equal(restored.data["gateway-api-keys.json"].keys[0].encryptedKey.length, paddingSize);
  assert.equal(restored.data["usage-stats.json"].generation.length, paddingSize);
});

test("oversized source files and backup envelopes are rejected before parsing", async (t) => {
  const root = await temporaryRoot(t, "ccc-size-limit-");
  const gatewayPath = path.join(root, "gateway-api-keys.json");
  await writeFile(gatewayPath, "{}");
  await truncate(gatewayPath, MAX_DATA_FILE_BYTES + 1);
  assert.throws(() => createBackupSnapshot({ userDataPath: root, appVersion: "1.0.0" }), /cannot be backed up/i);

  const backupPath = path.join(root, "oversized-backup.json");
  await writeFile(backupPath, "{}");
  await truncate(backupPath, MAX_BACKUP_BYTES + 1);
  assert.throws(() => readBackupFile(backupPath), /empty or too large/i);
});

test("version changes create a one-time pre-upgrade backup", async (t) => {
  const root = await temporaryRoot(t, "ccc-schema-");
  await writeFile(path.join(root, "usage-stats.json"), JSON.stringify(usageStore(42)));
  const first = prepareUserDataSchema({ userDataPath: root, appVersion: "0.5.2" });
  assert.ok(first.backupDirectory);
  assert.match(first.backupDirectory, /pre-upgrade-legacy-to-0\.5\.2/);
  const upgraded = prepareUserDataSchema({ userDataPath: root, appVersion: "1.0.0" });
  assert.ok(upgraded.backupDirectory);
  const unchanged = prepareUserDataSchema({ userDataPath: root, appVersion: "1.0.0" });
  assert.equal(unchanged.backupDirectory, null);
});

test("invalid and oversized preference fields are discarded", () => {
  assert.deepEqual(sanitizePreferences({
    language: "xx",
    projectPath: "bad\npath",
    projectless: "false",
    runConfig: { model: "", effort: "High" },
  }), { runConfig: { effort: "High" } });
});
