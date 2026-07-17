const SENSITIVE_FIELD = /(?:authorization|cookie|credential|encrypted|hash|secret|token|api.?key)/i;
const SECRET_PATTERN = /\b(?:ccc_live_|sk-)[A-Za-z0-9_-]{8,}\b/g;

function redactText(value, homeDirectory) {
  let text = String(value).replace(SECRET_PATTERN, "[REDACTED]");
  if (homeDirectory) {
    const home = String(homeDirectory).replace(/[\\/]+$/, "");
    if (home) text = text.split(home).join("%USERPROFILE%");
  }
  return text.slice(0, 8_192);
}

export function sanitizeDiagnostics(value, options = {}, depth = 0) {
  if (depth > 8) return "[TRUNCATED]";
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactText(value, options.homeDirectory);
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeDiagnostics(entry, options, depth + 1));
  }
  if (typeof value !== "object") return String(value);
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 200)) {
    if (SENSITIVE_FIELD.test(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    result[key] = sanitizeDiagnostics(entry, options, depth + 1);
  }
  return result;
}

export function createDiagnosticsReport(options = {}) {
  return {
    format: "codex-control-center-diagnostics",
    version: 1,
    generatedAt: new Date().toISOString(),
    application: {
      version: String(options.appVersion ?? "unknown"),
      packaged: options.isPackaged === true,
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron ?? null,
    },
    server: sanitizeDiagnostics(options.server ?? {}, options),
    readiness: sanitizeDiagnostics(options.readiness ?? {}, options),
    data: sanitizeDiagnostics(options.data ?? {}, options),
    note: "This report excludes prompts, file contents, API keys, authentication tokens, and encrypted key material.",
  };
}
