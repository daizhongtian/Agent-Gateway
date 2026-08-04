import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("desktop update checks provide visible card feedback for every result", () => {
  for (const id of ["checkDesktopUpdatesTitle", "checkDesktopUpdatesDescription", "checkDesktopUpdatesIcon"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`, "u"));
  }
  assert.match(app, /function renderUpdateCheckCard\(update\)/u);
  for (const status of ["checking", "not-available", "available", "error"]) {
    assert.match(app, new RegExp(`status === ["']${status}["']`, "u"));
    assert.match(styles, new RegExp(`data-update-status=["']${status}["']`, "u"));
  }
  assert.match(app, /showToast\("当前已是最新版本。", "success"/u);
  assert.match(app, /latestState = await window\.codexDesktop\.getUpdateState\(\)/u);
  assert.match(styles, /animation: spin 800ms linear infinite/u);
});
