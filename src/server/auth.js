import { timingSafeEqual } from "node:crypto";

const ROLE_SCOPES = Object.freeze({
  admin: ["*"],
  operator: [
    "models:read", "projects:read", "tasks:read", "tasks:write", "tasks:cancel",
  ],
  viewer: ["models:read", "projects:read", "tasks:read"],
});

function normalizedPrincipal(value = {}, fallbackSubject = "api-user") {
  const role = typeof value.role === "string" ? value.role : "operator";
  const roleScopes = ROLE_SCOPES[role] ?? [];
  const scopes = new Set([
    ...roleScopes,
    ...(Array.isArray(value.scopes) ? value.scopes.filter((scope) => typeof scope === "string") : []),
  ]);
  const principal = {
    sub: typeof value.sub === "string" && value.sub ? value.sub : fallbackSubject,
    role,
    scopes,
  };
  if (typeof value.credentialId === "string" && value.credentialId) principal.credentialId = value.credentialId;
  if (typeof value.projectOwnerId === "string" && value.projectOwnerId) {
    principal.projectOwnerId = value.projectOwnerId;
  }
  if (value.taskPreset && typeof value.taskPreset === "object" && !Array.isArray(value.taskPreset)) {
    principal.taskPreset = { ...value.taskPreset };
  }
  if (value.apiKeySettings && typeof value.apiKeySettings === "object" && !Array.isArray(value.apiKeySettings)) {
    principal.apiKeySettings = { ...value.apiKeySettings };
  }
  return principal;
}

function tokenEntries(apiToken, registry) {
  const entries = [];
  if (apiToken) entries.push([apiToken, normalizedPrincipal({ role: "admin" }, "local-api-token")]);
  if (registry instanceof Map) {
    for (const [token, principal] of registry) {
      entries.push([String(token), normalizedPrincipal(principal, `token-${entries.length + 1}`)]);
    }
  } else if (Array.isArray(registry)) {
    for (const entry of registry) {
      if (entry?.token) entries.push([String(entry.token), normalizedPrincipal(entry, `token-${entries.length + 1}`)]);
    }
  } else if (registry && typeof registry === "object") {
    for (const [token, principal] of Object.entries(registry)) {
      entries.push([token, normalizedPrincipal(principal, `token-${entries.length + 1}`)]);
    }
  }
  return entries;
}

function matchesToken(candidate, expected) {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearerToken(header) {
  if (typeof header !== "string" || header.length > 8_192) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function cookieToken(header, name) {
  if (typeof header !== "string" || header.length > 16_384) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function hasScope(principal, scope) {
  return principal?.scopes?.has("*") || principal?.scopes?.has(scope);
}

export function canAccessOwner(principal, ownerId) {
  return principal?.role === "admin" || hasScope(principal, "*") || principal?.sub === ownerId;
}

export function createAuth(options = {}) {
  const mode = options.mode ?? "none";
  const entries = tokenEntries(options.apiToken, options.tokens);
  const localPrincipal = normalizedPrincipal({ role: "admin" }, "local-desktop");
  const resolveToken = options.resolveToken;
  const sessionToken = typeof options.sessionToken === "string" ? options.sessionToken : "";
  const sessionCookieName = options.sessionCookieName ?? "codex_desktop_session";

  function hasDesktopSession(request) {
    if (!sessionToken) return false;
    const candidate = cookieToken(request?.headers?.cookie, sessionCookieName);
    return candidate ? matchesToken(candidate, sessionToken) : false;
  }

  async function resolveBearer(header, request) {
    const token = bearerToken(header);
    if (!token) return null;
    let principal = null;
    const match = entries.find(([expected]) => matchesToken(token, expected));
    if (match) principal = match[1];
    if (!principal && resolveToken) {
      const resolved = await resolveToken(token, request);
      if (resolved) principal = normalizedPrincipal(resolved);
    }
    return principal;
  }

  async function resolveAuthorization(header, request) {
    const principal = await resolveBearer(header, request);
    if (principal) return principal;
    if (typeof header === "string" && header.trim()) return null;
    if (hasDesktopSession(request)) return localPrincipal;
    return mode === "none" && !sessionToken ? localPrincipal : null;
  }

  function rejectUnauthorized(response) {
    response.set("WWW-Authenticate", 'Bearer realm="codex-local-api"');
    response.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid Bearer token is required." } });
  }

  async function authenticate(request, response, next) {
    const principal = await resolveAuthorization(request.get("authorization"), request);

    if (!principal) {
      rejectUnauthorized(response);
      return;
    }
    request.auth = principal;
    next();
  }

  async function authenticateToken(request, response, next) {
    const principal = await resolveBearer(request.get("authorization"), request);
    if (!principal) {
      rejectUnauthorized(response);
      return;
    }
    request.auth = principal;
    next();
  }

  function requireScope(scope) {
    return (request, response, next) => {
      if (!hasScope(request.auth, scope)) {
        response.status(403).json({ error: { code: "FORBIDDEN", message: "This token does not grant the required scope." } });
        return;
      }
      next();
    };
  }

  return {
    authenticate,
    authenticateToken,
    requireScope,
    resolveAuthorization,
    resolveBearer,
    hasDesktopSession,
    sessionCookieName,
    mode,
  };
}
