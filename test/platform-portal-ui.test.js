import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, app] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
]);

test("API Gateway monitor exposes a localized Platform portal action", () => {
  assert.match(html, /id="openPlatformPortal"/);
  assert.match(html, /aria-label="打开 Platform"/);
  assert.match(html, /<span>Platform<\/span>/);
});

test("Platform portal prefers the active platform URL and uses the safe desktop bridge", () => {
  assert.match(app, /const DEFAULT_PLATFORM_URL = "https:\/\/platform\.agentgatewayplatform\.cc";/);
  assert.match(app, /state\.platformAccount\?\.platformUrl \|\| DEFAULT_PLATFORM_URL/);
  assert.match(app, /window\.codexDesktop\?\.openExternal/);
  assert.match(app, /elements\.openPlatformPortal\.addEventListener\("click"/);
});
