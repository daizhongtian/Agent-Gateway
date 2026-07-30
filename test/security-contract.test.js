import assert from "node:assert/strict";
import test from "node:test";
import { validateApiPermissionMatrix } from "../scripts/security/validate-api-permissions.mjs";
import { runStaticSecurityCheck } from "../scripts/security/static-security-check.mjs";

test("every documented API operation has one explicit security policy", async () => {
  const result = await validateApiPermissionMatrix();
  assert.deepEqual(result.failures, []);
  assert.ok(result.operationCount >= 70, "unexpectedly small API surface");
});

test("repository security invariants and secret scan remain clean", async () => {
  const result = await runStaticSecurityCheck();
  assert.deepEqual(result.failures, []);
  assert.ok(result.filesScanned >= 200, "security scan unexpectedly skipped most repository files");
});
