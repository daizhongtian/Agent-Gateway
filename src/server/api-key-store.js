import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import {
  normalizeApprovalPolicy,
  normalizeEffort,
  normalizePermission,
  normalizeSpeed,
} from "../runner/protocol.js";
import { badRequest, conflict, notFound } from "./errors.js";
import { resolveModel } from "./models.js";

const STORE_VERSION = 1;
const KEY_PREFIX = "ccc_live_";
const KEY_PATTERN = /^ccc_live_[A-Za-z0-9_-]{40,64}$/;
const DEFAULT_LOCK_STALE_MS = 30_000;
const CLIENT_SCOPES = Object.freeze([
  "models:read",
  "projects:read",
  "tasks:read",
  "tasks:write",
  "tasks:cancel",
]);

function now() {
  return new Date().toISOString();
}

function digest(secret) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function safeName(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !value.trim() || value.length > 80 || /[\r\n\0]/.test(value)) {
    throw badRequest("INVALID_API_KEY_NAME", "name must be a single line up to 80 characters.");
  }
  return value.trim();
}

function normalizePreset(input = {}, { catalogOnly = true } = {}) {
  let model;
  let effort;
  let speed;
  let permission;
  try {
    model = resolveModel(input.model);
    effort = normalizeEffort(input.effort ?? "high");
    speed = normalizeSpeed(input.speed ?? "standard");
    permission = normalizePermission(input.permission ?? "workspace-write");
  } catch (error) {
    throw badRequest(
      "INVALID_API_KEY_PRESET",
      error instanceof Error ? error.message : "The API key preset is invalid.",
    );
  }
  if (catalogOnly && model.custom) {
    throw badRequest("MODEL_NOT_AVAILABLE", "Choose a model from the current Codex model catalog.");
  }
  if (permission === "danger-full-access") {
    throw badRequest(
      "API_KEY_PERMISSION_FORBIDDEN",
      "Gateway API keys can use read-only or workspace-write permission only.",
    );
  }
  return {
    model: model.id,
    modelLabel: model.label,
    effort,
    speed,
    permission,
    approvalPolicy: normalizeApprovalPolicy(undefined, permission),
  };
}

function storedRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid API key record.");
  if (typeof value.id !== "string" || !value.id.startsWith("key_")) throw new Error("Invalid API key id.");
  if (typeof value.ownerId !== "string" || !value.ownerId) throw new Error("Invalid API key owner.");
  if (typeof value.keyHash !== "string" || !/^[a-f0-9]{64}$/.test(value.keyHash)) {
    throw new Error("Invalid API key hash.");
  }
  const preset = normalizePreset(value.preset, { catalogOnly: false });
  return {
    id: value.id,
    ownerId: value.ownerId,
    name: safeName(value.name, `${preset.modelLabel} · ${preset.effort}`),
    maskedKey: typeof value.maskedKey === "string" ? value.maskedKey : `${KEY_PREFIX}••••••••`,
    keyHash: value.keyHash,
    encryptedKey: typeof value.encryptedKey === "string" && value.encryptedKey
      ? value.encryptedKey
      : null,
    preset,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now(),
    revokedAt: typeof value.revokedAt === "string" ? value.revokedAt : null,
  };
}

export function normalizeStoredApiKeyStore(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== STORE_VERSION || !Array.isArray(value.keys)) {
    throw new Error("API key store has an unsupported format.");
  }
  if (value.keys.length > 10_000) throw new Error("API key store is too large.");
  return {
    version: STORE_VERSION,
    gateway: {
      enabled: value.gateway?.enabled !== false,
      updatedAt: typeof value.gateway?.updatedAt === "string" ? value.gateway.updatedAt : null,
    },
    keys: value.keys.map(storedRecord),
  };
}

function publicRecord(record) {
  return {
    id: record.id,
    name: record.name,
    maskedKey: record.maskedKey,
    preset: { ...record.preset },
    scopes: [...CLIENT_SCOPES],
    createdAt: record.createdAt,
    revealable: Boolean(record.encryptedKey),
    active: true,
  };
}

export class ApiKeyStore {
  constructor(options = {}) {
    this.filePath = options.filePath ? path.resolve(options.filePath) : null;
    this.lockStaleMs = Number.isFinite(options.lockStaleMs)
      ? Math.max(5_000, Number(options.lockStaleMs))
      : DEFAULT_LOCK_STALE_MS;
    this.secretProtector = options.secretProtector ?? null;
    this.records = [];
    this.gatewayEnabled = true;
    this.gatewayUpdatedAt = null;
    this.#load();
  }

  #load() {
    if (!this.filePath) return;
    if (!existsSync(this.filePath)) {
      this.records = [];
      this.gatewayEnabled = true;
      this.gatewayUpdatedAt = null;
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new Error(`API key store could not be read: ${error instanceof Error ? error.message : "invalid JSON"}`);
    }
    try {
      const normalized = normalizeStoredApiKeyStore(parsed);
      this.records = normalized.keys;
      this.gatewayEnabled = normalized.gateway.enabled;
      this.gatewayUpdatedAt = normalized.gateway.updatedAt;
    } catch (error) {
      throw new Error(`API key store is invalid: ${error instanceof Error ? error.message : "invalid record"}`);
    }
  }

  #persist(records) {
    if (!this.filePath) return;
    mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    const body = `${JSON.stringify({
      version: STORE_VERSION,
      gateway: {
        enabled: this.gatewayEnabled,
        updatedAt: this.gatewayUpdatedAt,
      },
      keys: records,
    }, null, 2)}\n`;
    try {
      writeFileSync(temporaryPath, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
      renameSync(temporaryPath, this.filePath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }

  #withWriteLock(callback) {
    if (!this.filePath) return callback();
    mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    let release;
    try {
      release = lockfile.lockSync(this.filePath, {
        realpath: false,
        stale: this.lockStaleMs,
        update: Math.max(1_000, Math.floor(this.lockStaleMs / 3)),
        retries: 0,
      });
    } catch (error) {
      if (error?.code === "ELOCKED") {
        throw conflict("API_KEY_STORE_BUSY", "The API key store is busy; try again.");
      }
      throw error;
    }
    try {
      this.#load();
      return callback();
    } finally {
      release();
    }
  }

  list(context = {}) {
    this.#load();
    const ownerId = context.ownerId ?? "local-desktop";
    return this.records
      .filter((record) => !record.revokedAt && (context.allowAll || record.ownerId === ownerId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(publicRecord);
  }

  purgeRevoked() {
    return this.#withWriteLock(() => {
      const nextRecords = this.records.filter((record) => !record.revokedAt);
      const removed = this.records.length - nextRecords.length;
      if (!removed) return 0;
      this.#persist(nextRecords);
      this.records = nextRecords;
      return removed;
    });
  }

  gatewayStatus() {
    this.#load();
    return {
      enabled: this.gatewayEnabled,
      updatedAt: this.gatewayUpdatedAt,
    };
  }

  setGatewayEnabled(enabled) {
    if (typeof enabled !== "boolean") {
      throw badRequest("INVALID_GATEWAY_STATE", "enabled must be a boolean.");
    }
    return this.#withWriteLock(() => {
      if (this.gatewayEnabled === enabled) return this.gatewayStatus();
      this.gatewayEnabled = enabled;
      this.gatewayUpdatedAt = now();
      this.#persist(this.records);
      return {
        enabled: this.gatewayEnabled,
        updatedAt: this.gatewayUpdatedAt,
      };
    });
  }

  create(input = {}, context = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw badRequest("INVALID_API_KEY", "The request body must be an object.");
    }
    const ownerId = context.ownerId ?? "local-desktop";
    const preset = normalizePreset(input);
    const secret = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const encryptedKey = this.secretProtector?.encrypt(secret) ?? null;
    return this.#withWriteLock(() => {
      const activeCount = this.records.filter((record) => record.ownerId === ownerId && !record.revokedAt).length;
      if (activeCount >= 100) {
        throw badRequest("API_KEY_LIMIT_REACHED", "Delete an existing API key before creating another one.");
      }
      const record = {
        id: `key_${randomUUID()}`,
        ownerId,
        name: safeName(input.name, `${preset.modelLabel} · ${preset.effort}`),
        maskedKey: `${secret.slice(0, KEY_PREFIX.length + 8)}…${secret.slice(-4)}`,
        keyHash: digest(secret),
        encryptedKey,
        preset,
        createdAt: now(),
        revokedAt: null,
      };
      const nextRecords = [...this.records, record];
      this.#persist(nextRecords);
      this.records = nextRecords;
      return { ...publicRecord(record), key: secret };
    });
  }

  revoke(id, context = {}) {
    return this.remove(id, context);
  }

  remove(id, context = {}) {
    const ownerId = context.ownerId ?? "local-desktop";
    return this.#withWriteLock(() => {
      const index = this.records.findIndex((record) => record.id === id
        && (context.allowAll || record.ownerId === ownerId));
      if (index < 0) throw notFound("API key not found.");
      const current = this.records[index];
      const nextRecords = this.records.filter((_record, recordIndex) => recordIndex !== index);
      this.#persist(nextRecords);
      this.records = nextRecords;
      return { ...publicRecord(current), deleted: true, active: false };
    });
  }

  reveal(id, context = {}) {
    const ownerId = context.ownerId ?? "local-desktop";
    this.#load();
    const record = this.records.find((entry) => entry.id === id
      && !entry.revokedAt
      && (context.allowAll || entry.ownerId === ownerId));
    if (!record) throw notFound("API key not found.");
    if (!record.encryptedKey || !this.secretProtector) {
      throw conflict(
        "API_KEY_SECRET_UNAVAILABLE",
        "This key was created before secure reveal storage was enabled. Delete it and generate a new key.",
      );
    }
    let secret;
    try {
      secret = this.secretProtector.decrypt(record.encryptedKey);
    } catch {
      throw conflict("API_KEY_DECRYPTION_FAILED", "The saved API key could not be decrypted on this device.");
    }
    if (!KEY_PATTERN.test(secret) || digest(secret) !== record.keyHash) {
      throw conflict("API_KEY_DECRYPTION_FAILED", "The saved API key failed its integrity check.");
    }
    return {
      id: record.id,
      key: secret,
      maskedKey: record.maskedKey,
    };
  }

  resolve(secret) {
    if (typeof secret !== "string" || !KEY_PATTERN.test(secret)) return null;
    this.#load();
    const candidate = Buffer.from(digest(secret), "hex");
    const record = this.records.find((entry) => {
      if (entry.revokedAt) return false;
      const expected = Buffer.from(entry.keyHash, "hex");
      return expected.length === candidate.length && timingSafeEqual(candidate, expected);
    });
    if (!record) return null;
    return {
      sub: `api-key:${record.id}`,
      role: "api-client",
      scopes: [...CLIENT_SCOPES],
      credentialId: record.id,
      projectOwnerId: record.ownerId,
      taskPreset: { ...record.preset },
    };
  }

  inactiveCredentialIds(credentialIds) {
    const requested = new Set(
      [...(credentialIds ?? [])].filter((credentialId) => typeof credentialId === "string" && credentialId),
    );
    if (!requested.size) return [];
    this.#load();
    const active = new Set(
      this.records.filter((record) => !record.revokedAt).map((record) => record.id),
    );
    return [...requested].filter((credentialId) => !active.has(credentialId));
  }

  revokedCredentialIds(credentialIds) {
    return this.inactiveCredentialIds(credentialIds);
  }
}

export const API_KEY_PREFIX = KEY_PREFIX;
