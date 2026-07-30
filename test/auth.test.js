import assert from "node:assert/strict";
import test from "node:test";
import { canAccessOwner, createAuth, hasScope } from "../src/server/auth.js";

function request(authorization, cookie) {
  return {
    headers: { cookie },
    get(name) {
      return name.toLowerCase() === "authorization" ? authorization : undefined;
    },
  };
}

function responseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test("authentication accepts Map, array, and object token registries with normalized principals", async () => {
  const registries = [
    new Map([["map-token", { sub: "map-user", role: "viewer", credentialId: "cred-1" }]]),
    [{ token: "array-token", sub: "array-user", role: "operator", projectOwnerId: "owner-1" }, null, {}],
    { "object-token": { sub: "object-user", role: "custom", scopes: ["tasks:write", 42] } },
  ];

  const expected = [
    ["map-token", "map-user", "viewer"],
    ["array-token", "array-user", "operator"],
    ["object-token", "object-user", "custom"],
  ];
  for (let index = 0; index < registries.length; index += 1) {
    const auth = createAuth({ mode: "token", tokens: registries[index] });
    const [token, subject, role] = expected[index];
    const principal = await auth.resolveBearer(`Bearer ${token}`);
    assert.equal(principal.sub, subject);
    assert.equal(principal.role, role);
  }
});

test("principal metadata is copied safely and invalid optional shapes are ignored", async () => {
  const auth = createAuth({
    mode: "token",
    tokens: {
      metadata: {
        sub: "",
        role: 123,
        scopes: "not-an-array",
        credentialId: "credential-1",
        projectOwnerId: "owner-1",
        taskPreset: { model: "codex" },
        apiKeySettings: { tokenLimit: 10 },
      },
      invalid: {
        taskPreset: [],
        apiKeySettings: [],
      },
    },
  });

  const principal = await auth.resolveBearer("Bearer metadata");
  assert.equal(principal.sub, "token-1");
  assert.equal(principal.role, "operator");
  assert.equal(principal.credentialId, "credential-1");
  assert.equal(principal.projectOwnerId, "owner-1");
  assert.deepEqual(principal.taskPreset, { model: "codex" });
  assert.deepEqual(principal.apiKeySettings, { tokenLimit: 10 });
  assert.equal((await auth.resolveBearer("Bearer invalid")).taskPreset, undefined);
});

test("Bearer parsing rejects malformed or oversized headers before token resolution", async () => {
  let resolverCalls = 0;
  const auth = createAuth({
    mode: "token",
    resolveToken: async () => { resolverCalls += 1; return { sub: "resolved" }; },
  });

  for (const header of [undefined, "", "Basic abc", "Bearer", "Bearer two tokens", "x".repeat(8193)]) {
    assert.equal(await auth.resolveBearer(header), null);
  }
  assert.equal(resolverCalls, 0);
  assert.equal((await auth.resolveBearer("Bearer dynamic-token")).sub, "resolved");
  assert.equal(resolverCalls, 1);
});

test("desktop session cookies are decoded, validated, and never replace an explicit bad header", async () => {
  const auth = createAuth({
    mode: "token",
    sessionToken: "desktop secret",
    sessionCookieName: "desktop_session",
  });

  assert.equal(auth.hasDesktopSession(request(undefined, "other=x; desktop_session=desktop%20secret")), true);
  assert.equal((await auth.resolveAuthorization(undefined, request(undefined, "desktop_session=desktop%20secret"))).role, "admin");
  assert.equal(await auth.resolveAuthorization("Bearer wrong", request("Bearer wrong", "desktop_session=desktop%20secret")), null);
  assert.equal(auth.hasDesktopSession(request(undefined, "desktop_session=%E0%A4%A")), false);
  assert.equal(auth.hasDesktopSession(request(undefined, "desktop_session=wrong")), false);
  assert.equal(auth.hasDesktopSession(request(undefined, "not-a-cookie-part")), false);
  assert.equal(auth.hasDesktopSession(request(undefined, "x".repeat(16_385))), false);
});

test("no-auth mode permits local access only when no desktop session secret is configured", async () => {
  assert.equal((await createAuth().resolveAuthorization(undefined, request())).role, "admin");
  const open = createAuth({ mode: "none" });
  assert.equal((await open.resolveAuthorization(undefined, request())).role, "admin");

  const sessionOnly = createAuth({ mode: "none", sessionToken: "required" });
  assert.equal(await sessionOnly.resolveAuthorization(undefined, request()), null);
});

test("authentication middleware returns stable 401 and 403 responses or calls next", async () => {
  const auth = createAuth({ mode: "token", apiToken: "admin-token" });
  const unauthorized = responseRecorder();
  await auth.authenticateToken(request("Bearer wrong"), unauthorized, () => assert.fail("must not call next"));
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.headers["WWW-Authenticate"], 'Bearer realm="codex-local-api"');
  assert.equal(unauthorized.body.error.code, "UNAUTHORIZED");

  const authorizedRequest = request("Bearer admin-token");
  let nextCalls = 0;
  await auth.authenticate(authorizedRequest, responseRecorder(), () => { nextCalls += 1; });
  assert.equal(authorizedRequest.auth.role, "admin");
  auth.requireScope("tasks:write")(authorizedRequest, responseRecorder(), () => { nextCalls += 1; });
  assert.equal(nextCalls, 2);

  const forbidden = responseRecorder();
  auth.requireScope("admin:only")({ auth: { scopes: new Set() } }, forbidden, () => assert.fail("must not call next"));
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.body.error.code, "FORBIDDEN");
});

test("scope and owner checks distinguish administrator, wildcard, subject, and missing principals", () => {
  assert.equal(hasScope({ scopes: new Set(["tasks:read"]) }, "tasks:read"), true);
  assert.equal(hasScope({ scopes: new Set(["*"]) }, "anything"), true);
  assert.equal(hasScope(null, "tasks:read"), undefined);
  assert.equal(canAccessOwner({ role: "admin", scopes: new Set(), sub: "other" }, "owner"), true);
  assert.equal(canAccessOwner({ role: "operator", scopes: new Set(["*"]), sub: "other" }, "owner"), true);
  assert.equal(canAccessOwner({ role: "operator", scopes: new Set(), sub: "owner" }, "owner"), true);
  assert.equal(canAccessOwner({ role: "operator", scopes: new Set(), sub: "other" }, "owner"), false);
});
