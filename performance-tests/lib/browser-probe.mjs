import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

function browserCandidates() {
  return [
    process.env.PERFORMANCE_BROWSER_EXECUTABLE,
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
}

export async function runBrowserProbe(projectRoot, baseUrl) {
  const executablePath = browserCandidates().find(existsSync);
  if (!executablePath) return { skipped: true, reason: "No supported Chrome/Edge executable was found." };
  let resolved;
  try {
    const requireFromFrontend = createRequire(path.join(projectRoot, "platform", "frontend", "package.json"));
    resolved = requireFromFrontend.resolve("playwright-core");
  } catch {
    return { skipped: true, reason: "platform/frontend dependencies are not installed (playwright-core missing)." };
  }
  const playwright = await import(pathToFileURL(resolved).href);
  const chromium = playwright.chromium ?? playwright.default?.chromium;
  if (!chromium) return { skipped: true, reason: "The installed playwright-core package does not expose Chromium." };
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ baseURL: baseUrl, locale: "zh-CN" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    const wallStarted = performance.now();
    await page.goto("/", { waitUntil: "load", timeout: 30000 });
    const wallLoadMs = performance.now() - wallStarted;
    const navigation = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0];
      return entry ? {
        responseStartMs: entry.responseStart,
        domContentLoadedMs: entry.domContentLoadedEventEnd,
        loadMs: entry.loadEventEnd,
        transferBytes: entry.transferSize,
        encodedBodyBytes: entry.encodedBodySize,
      } : null;
    });
    const registerButton = page.getByRole("button", { name: /注册|register/iu }).first();
    const interactionStarted = performance.now();
    await registerButton.click({ timeout: 10000 });
    await page.getByRole("dialog", { name: /注册|register/iu }).waitFor({ state: "visible", timeout: 10000 });
    const registrationDialogMs = performance.now() - interactionStarted;
    const memory = await page.evaluate(() => {
      const value = performance.memory;
      return value ? {
        usedJsHeapBytes: value.usedJSHeapSize,
        totalJsHeapBytes: value.totalJSHeapSize,
      } : null;
    });
    return {
      skipped: false,
      executablePath,
      wallLoadMs,
      navigation,
      registrationDialogMs,
      memory,
      pageErrors,
      ok: pageErrors.length === 0,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
