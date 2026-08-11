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

test("Platform account dialog displays the clickable platform homepage separately from Online Host", () => {
  assert.match(html, /class="platform-home-summary"/);
  assert.match(html, /id="platformLocalHomepageUrl"/);
  assert.match(html, /id="platformPublicHomepageUrl"/);
  assert.match(html, /aria-label="打开公网首页"/);
  assert.match(html, />http:\/\/127\.0\.0\.1:8088\/<\/code>/);
  assert.match(html, />https:\/\/platform\.agentgatewayplatform\.cc\/<\/code>/);
  assert.match(app, /const DEFAULT_PLATFORM_PUBLIC_HOMEPAGE_URL = "https:\/\/platform\.agentgatewayplatform\.cc\/";/);
  assert.match(app, /elements\.platformPublicHomepageUrl\.querySelector\("code"\)\.textContent = publicHomepageUrl/);
  assert.match(app, /window\.codexDesktop\.openExternal\(targetUrl\)/);
  assert.match(app, /elements\.platformPublicHomepageUrl\.addEventListener\("click"/);
});

test("Platform portal prefers the active platform URL and uses the safe desktop bridge", () => {
  assert.match(app, /const DEFAULT_PLATFORM_URL = "https:\/\/platform\.agentgatewayplatform\.cc";/);
  assert.match(app, /state\.platformAccount\?\.platformUrl \|\| DEFAULT_PLATFORM_URL/);
  assert.match(app, /window\.codexDesktop\?\.openExternal/);
  assert.match(app, /elements\.openPlatformPortal\.addEventListener\("click"/);
});
