import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildThreadOptions,
  normalizeApprovalPolicy,
  normalizeEffort,
  normalizePermission,
  normalizeSpeed,
  publicWorkerError,
  redactSecrets,
  sanitizeIpcValue,
} from "../src/runner/protocol.js";
import { ImageUploadStore } from "../src/server/image-upload-store.js";
import {
  createAesSecretProtector,
  secretProtectorFromEnvironment,
} from "../src/server/secret-protector.js";

test("runtime option normalization accepts aliases and rejects unsafe values", () => {
  for (const [value, expected] of [
    [undefined, "workspace-write"],
    [" READONLY ", "read-only"],
    ["read_only", "read-only"],
    ["workspacewrite", "workspace-write"],
    ["workspace_write", "workspace-write"],
    ["dangerfullaccess", "danger-full-access"],
    ["full-access", "danger-full-access"],
  ]) assert.equal(normalizePermission(value), expected);
  assert.throws(() => normalizePermission(7), TypeError);
  assert.throws(() => normalizePermission("owner"), RangeError);

  assert.equal(normalizeApprovalPolicy(undefined, "read-only"), "never");
  assert.equal(normalizeApprovalPolicy(null, "workspace-write"), "untrusted");
  assert.equal(normalizeApprovalPolicy("", "danger-full-access"), "untrusted");
  for (const policy of ["never", "on-request", "on-failure", "untrusted"]) {
    assert.equal(normalizeApprovalPolicy(` ${policy.toUpperCase()} `), policy);
  }
  assert.throws(() => normalizeApprovalPolicy(false), TypeError);
  assert.throws(() => normalizeApprovalPolicy("always"), RangeError);

  for (const [value, expected] of [
    [undefined, "high"],
    ["minimal", "minimal"],
    ["standard", "medium"],
    ["ultra", "xhigh"],
    ["extra-high", "xhigh"],
  ]) assert.equal(normalizeEffort(value), expected);
  assert.throws(() => normalizeEffort({}), TypeError);
  assert.throws(() => normalizeEffort("maximum"), RangeError);

  assert.equal(normalizeSpeed(), "standard");
  assert.equal(normalizeSpeed(" FAST "), "fast");
  assert.throws(() => normalizeSpeed(1), TypeError);
  assert.throws(() => normalizeSpeed("turbo"), RangeError);
});

test("thread options include only normalized optional runtime fields", () => {
  assert.deepEqual(buildThreadOptions({
    projectPath: "C:\\workspace",
    sandboxMode: "readonly",
    effort: "standard",
    approvalPolicy: "on-request",
    skipGitRepoCheck: true,
    model: "gpt-test",
    networkAccessEnabled: false,
    additionalDirectories: [" C:\\shared ", "", 42, "   "],
  }), {
    workingDirectory: "C:\\workspace",
    sandboxMode: "read-only",
    modelReasoningEffort: "medium",
    approvalPolicy: "on-request",
    skipGitRepoCheck: true,
    model: "gpt-test",
    networkAccessEnabled: false,
    additionalDirectories: ["C:\\shared"],
  });

  assert.deepEqual(buildThreadOptions({
    projectPath: "C:\\workspace",
    permission: "workspace-write",
    effort: "low",
    additionalDirectories: [],
  }), {
    workingDirectory: "C:\\workspace",
    sandboxMode: "workspace-write",
    modelReasoningEffort: "low",
    approvalPolicy: "untrusted",
    skipGitRepoCheck: false,
  });
});

test("IPC sanitization redacts credentials, bounds collections, and truncates recursion", () => {
  assert.equal(redactSecrets(17), 17);
  const redacted = redactSecrets([
    "Bearer abc.DEF-123=",
    `ccc_live_${"a".repeat(32)}`,
    `sk-${"b".repeat(16)}`,
    "password=hunter2",
  ].join(" "));
  assert.doesNotMatch(redacted, /abc\.DEF|ccc_live|sk-|hunter2/);
  assert.match(redacted, /Bearer \[REDACTED\]/);

  const sanitized = sanitizeIpcValue({
    authorization: "Bearer secret",
    apiKey: "secret",
    refresh_token: "secret",
    input_tokens: 12,
    nested: { value: "token=secret" },
    list: Array.from({ length: 1_005 }, (_, index) => index),
    unsupported: Symbol("ignored"),
  });
  assert.equal(sanitized.authorization, "[REDACTED]");
  assert.equal(sanitized.apiKey, "[REDACTED]");
  assert.equal(sanitized.refresh_token, "[REDACTED]");
  assert.equal(sanitized.input_tokens, 12);
  assert.equal(sanitized.nested.value, "token=[REDACTED]");
  assert.equal(sanitized.list.length, 1_000);
  assert.equal(sanitized.unsupported, undefined);
  assert.equal(sanitizeIpcValue("x".repeat(131_073)).endsWith("…"), true);
  assert.equal(sanitizeIpcValue(null), null);
  assert.equal(sanitizeIpcValue(true), true);

  let deep = "value";
  for (let index = 0; index < 12; index += 1) deep = { deep };
  assert.equal(sanitizeIpcValue(deep).deep.deep.deep.deep.deep.deep.deep.deep.deep.deep.deep, "[TRUNCATED]");
});

test("worker errors map every public failure class without exposing secrets", () => {
  const cases = [
    [new Error("Cannot find package @openai/codex-sdk"), "CODEX_SDK_UNAVAILABLE"],
    [new Error("unable to locate codex CLI binary"), "CODEX_BINARY_UNAVAILABLE"],
    [new Error("spawnSync codex not found"), "CODEX_BINARY_START_FAILED"],
    [new Error("401 unauthorized"), "CODEX_AUTH_FAILED"],
    [new Error("429 rate limit"), "CODEX_RATE_LIMITED"],
    [new Error("model unavailable"), "CODEX_MODEL_UNAVAILABLE"],
    [new Error("network certificate failure"), "CODEX_NETWORK_FAILED"],
    [new Error("turn failed"), "CODEX_TURN_FAILED"],
    [`unexpected ccc_live_${"z".repeat(32)}`, "CODEX_RUN_FAILED"],
    [null, "CODEX_RUN_FAILED"],
  ];
  for (const [error, code] of cases) {
    const result = publicWorkerError(error);
    assert.equal(result.code, code);
    assert.doesNotMatch(result.message, /ccc_live_|unauthorized|certificate/i);
  }
});

test("AES secret protection validates, authenticates, and restores stored values", () => {
  assert.throws(() => createAesSecretProtector(), /at least 32/);
  assert.throws(() => createAesSecretProtector("short"), /at least 32/);
  const protector = createAesSecretProtector("k".repeat(32));
  assert.equal(protector.name, "aes-256-gcm-v1");
  assert.throws(() => protector.encrypt(""), /non-empty/);
  assert.throws(() => protector.encrypt(42), /non-empty/);

  const payload = protector.encrypt("ccc_live_private-value");
  assert.equal(payload.includes("ccc_live_private-value"), false);
  assert.equal(protector.decrypt(payload), "ccc_live_private-value");
  for (const invalid of [null, "", "wrong.a.b.c", "aes-256-gcm-v1.a.b", `${payload}.extra`]) {
    assert.throws(() => protector.decrypt(invalid), /invalid/);
  }
  const parts = payload.split(".");
  const tamperedTag = Buffer.from(parts[2], "base64url");
  tamperedTag[0] ^= 0xff;
  parts[2] = tamperedTag.toString("base64url");
  assert.throws(() => protector.decrypt(parts.join(".")));

  assert.equal(secretProtectorFromEnvironment({}), null);
  assert.equal(secretProtectorFromEnvironment({ API_KEY_ENCRYPTION_KEY: "" }), null);
  assert.equal(secretProtectorFromEnvironment({ API_KEY_ENCRYPTION_KEY: "x".repeat(32) }).name, "aes-256-gcm-v1");
});

test("legacy image upload adapter enforces image-only storage through the current store", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "agent-gateway-image-adapter-"));
  const store = new ImageUploadStore({ root, ttlMs: 60_000 });
  t.after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  assert.deepEqual(store.limits(), store.imageLimits());
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const uploaded = await store.create({ ownerId: "owner-1", body: png, mimeType: "image/png" });
  assert.equal(uploaded.kind, "image");
  assert.match(uploaded.name, /\.png$/);
  const [claimed] = store.claim([uploaded.id], "owner-1");
  assert.equal(claimed.id, uploaded.id);
  store.release([claimed]);

  await assert.rejects(
    store.create({ ownerId: "owner-1", body: Buffer.from("plain text"), fileName: "note.txt", mimeType: "text/plain" }),
    (error) => error?.status === 415,
  );
});
