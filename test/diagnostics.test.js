import assert from "node:assert/strict";
import test from "node:test";
import { createDiagnosticsReport, sanitizeDiagnostics } from "../src/electron/diagnostics.js";

test("diagnostic reports redact credentials and the user profile path", () => {
  const value = sanitizeDiagnostics({
    status: "failed at C:\\Users\\alice\\project",
    apiKey: "ccc_live_should_never_appear_1234567890",
    nested: { message: "Bearer sk-secret_value_123456" },
  }, { homeDirectory: "C:\\Users\\alice" });
  assert.equal(value.apiKey, "[REDACTED]");
  assert.match(value.status, /%USERPROFILE%/);
  assert.doesNotMatch(JSON.stringify(value), /ccc_live_|sk-secret/);
});

test("diagnostic reports contain only operational metadata", () => {
  const report = createDiagnosticsReport({
    appVersion: "1.0.0",
    isPackaged: true,
    server: { online: true, token: "do-not-export" },
    readiness: { overall: "ready" },
  });
  assert.equal(report.application.version, "1.0.0");
  assert.equal(report.server.token, "[REDACTED]");
  assert.equal(report.readiness.overall, "ready");
});
