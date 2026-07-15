const PERMISSION_ALIASES = new Map([
  ["read-only", "read-only"],
  ["readonly", "read-only"],
  ["read_only", "read-only"],
  ["workspace-write", "workspace-write"],
  ["workspacewrite", "workspace-write"],
  ["workspace_write", "workspace-write"],
  ["danger-full-access", "danger-full-access"],
  ["dangerfullaccess", "danger-full-access"],
  ["full-access", "danger-full-access"],
]);

const APPROVAL_POLICIES = new Set(["never", "on-request", "on-failure", "untrusted"]);

const EFFORT_ALIASES = new Map([
  ["minimal", "minimal"],
  ["low", "low"],
  ["medium", "medium"],
  ["standard", "medium"],
  ["high", "high"],
  ["ultra", "xhigh"],
  ["xhigh", "xhigh"],
  ["extra-high", "xhigh"],
]);

export const PERMISSION_PROFILES = Object.freeze({
  "read-only": Object.freeze({ sandboxMode: "read-only", defaultApprovalPolicy: "never" }),
  "workspace-write": Object.freeze({ sandboxMode: "workspace-write", defaultApprovalPolicy: "untrusted" }),
  "danger-full-access": Object.freeze({ sandboxMode: "danger-full-access", defaultApprovalPolicy: "untrusted" }),
});

export function normalizePermission(value = "workspace-write") {
  if (typeof value !== "string") throw new TypeError("permission must be a string");
  const normalized = PERMISSION_ALIASES.get(value.trim().toLowerCase());
  if (!normalized) throw new RangeError("Unsupported permission mode");
  return normalized;
}

export function normalizeApprovalPolicy(value, permission = "workspace-write") {
  if (value === undefined || value === null || value === "") {
    return PERMISSION_PROFILES[normalizePermission(permission)].defaultApprovalPolicy;
  }
  if (typeof value !== "string") throw new TypeError("approvalPolicy must be a string");
  const normalized = value.trim().toLowerCase();
  if (!APPROVAL_POLICIES.has(normalized)) throw new RangeError("Unsupported approval policy");
  return normalized;
}

export function normalizeEffort(value = "high") {
  if (typeof value !== "string") throw new TypeError("effort must be a string");
  const normalized = EFFORT_ALIASES.get(value.trim().toLowerCase());
  if (!normalized) throw new RangeError("Unsupported reasoning effort");
  return normalized;
}

export function normalizeSpeed(value = "standard") {
  if (typeof value !== "string") throw new TypeError("speed must be a string");
  const normalized = value.trim().toLowerCase();
  if (normalized !== "standard" && normalized !== "fast") throw new RangeError("Unsupported speed");
  return normalized;
}

export function buildThreadOptions(task) {
  const permission = normalizePermission(task.permission ?? task.sandboxMode);
  const options = {
    workingDirectory: task.projectPath,
    sandboxMode: PERMISSION_PROFILES[permission].sandboxMode,
    modelReasoningEffort: normalizeEffort(task.effort),
    approvalPolicy: normalizeApprovalPolicy(task.approvalPolicy, permission),
    skipGitRepoCheck: task.skipGitRepoCheck === true,
  };
  if (task.model) options.model = task.model;
  if (typeof task.networkAccessEnabled === "boolean") options.networkAccessEnabled = task.networkAccessEnabled;
  return options;
}

export function redactSecrets(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\bccc_live_[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]")
    .replace(/\b(?:sk|sess|pat)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

export function sanitizeIpcValue(value, depth = 0) {
  if (depth > 10) return "[TRUNCATED]";
  if (typeof value === "string") {
    const redacted = redactSecrets(value);
    return redacted.length > 131_072 ? `${redacted.slice(0, 131_072)}…` : redacted;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 1_000).map((item) => sanitizeIpcValue(item, depth + 1));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (/api.?key|authorization|password|secret|token/i.test(key)
        && !/^(?:input|output|cached_input|reasoning_output)_tokens$/.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitizeIpcValue(child, depth + 1);
      }
    }
    return result;
  }
  return undefined;
}

export function publicWorkerError(error) {
  const raw = redactSecrets(error instanceof Error ? error.message : String(error ?? ""));
  if (/cannot find package|ERR_MODULE_NOT_FOUND/i.test(raw)) {
    return { code: "CODEX_SDK_UNAVAILABLE", message: "Codex SDK is not installed or could not be loaded." };
  }
  if (/unable to locate codex cli|binary/i.test(raw)) {
    return { code: "CODEX_BINARY_UNAVAILABLE", message: "The Codex CLI binary is unavailable for this platform." };
  }
  if (/\bENOENT\b|spawn(?:Sync)? .* not found|failed to spawn/i.test(raw)) {
    return { code: "CODEX_BINARY_START_FAILED", message: "The bundled Codex CLI could not be started." };
  }
  if (/401|unauthori[sz]ed|authentication/i.test(raw)) {
    return { code: "CODEX_AUTH_FAILED", message: "Codex authentication failed. Sign in again or check the API key." };
  }
  if (/429|rate.?limit|usage.?limit/i.test(raw)) {
    return { code: "CODEX_RATE_LIMITED", message: "Codex usage is temporarily limited. Try again later." };
  }
  if (/model.*(?:not found|unsupported|unavailable)|invalid.*model/i.test(raw)) {
    return { code: "CODEX_MODEL_UNAVAILABLE", message: "The selected Codex model is not available for this account." };
  }
  if (/network|timed? out|ECONN|ENET|dns|certificate|tls/i.test(raw)) {
    return { code: "CODEX_NETWORK_FAILED", message: "Codex could not reach the model service. Check the network or proxy settings." };
  }
  if (/turn failed/i.test(raw)) {
    return { code: "CODEX_TURN_FAILED", message: "Codex could not complete this task." };
  }
  return { code: "CODEX_RUN_FAILED", message: "Codex could not complete this task." };
}
