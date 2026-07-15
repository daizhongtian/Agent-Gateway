import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { startServer } from "../src/server/app.js";

const chromePath = process.env.CHROME_PATH
  || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const projectRoot = path.resolve(".");
const outputDirectory = path.join(projectRoot, "artifacts");
const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-control-chrome-"));

class VisualRunner {
  run() {
    let rejectExecution;
    let finished = false;
    const execution = {
      promise: new Promise((_resolve, reject) => {
        rejectExecution = reject;
        setTimeout(() => {
          if (finished) return;
          finished = true;
          const error = new Error("视觉回归模拟失败");
          error.code = "VISUAL_TEST_FAILURE";
          reject(error);
        }, 80);
      }),
      cancel: () => {
        if (finished) return false;
        finished = true;
        rejectExecution(Object.assign(new Error("cancelled"), { code: "TASK_CANCELLED" }));
        return true;
      },
    };
    return execution;
  }

  async close() {}
}

const handle = await startServer({ mode: "desktop", port: 0, runner: new VisualRunner() });
let chrome;
let cdp;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function devToolsEndpoint(processHandle) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`Chrome DevTools did not start. ${stderr}`)), 15_000);
    processHandle.stderr.setEncoding("utf8");
    processHandle.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    processHandle.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    processHandle.once("exit", (code) => {
      if (code !== null && !/DevTools listening/.test(stderr)) {
        clearTimeout(timer);
        reject(new Error(`Chrome exited before DevTools was ready (${code}). ${stderr}`));
      }
    });
  });
}

function createCdpClient(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  socket.on("message", (buffer) => {
    const message = JSON.parse(buffer.toString("utf8"));
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    socket,
    ready: new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    }),
    send(method, params = {}) {
      const requestId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
  };
}

async function evaluate(expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function screenshot(filename) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(path.join(outputDirectory, filename), Buffer.from(result.data, "base64"));
}

try {
  await mkdir(outputDirectory, { recursive: true });
  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDirectory}`,
    handle.url,
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

  const browserEndpoint = await devToolsEndpoint(chrome);
  const endpointUrl = new URL(browserEndpoint);
  const targets = await fetch(`http://${endpointUrl.host}/json/list`).then((response) => response.json());
  const page = targets.find((target) => target.type === "page" && target.url.startsWith(handle.url));
  assert.ok(page?.webSocketDebuggerUrl, "The Codex page target was not found");

  cdp = createCdpClient(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#modelTrigger'))")) break;
    await wait(100);
  }
  await wait(1_000);

  const report = await evaluate(`(() => ({
    title: document.title,
    heading: document.querySelector('#composerTitle')?.textContent,
    connection: document.querySelector('#connectionText')?.textContent,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    background: getComputedStyle(document.body).backgroundColor,
  }))()`);
  assert.equal(report.title, "Codex Control Center");
  assert.equal(report.bodyWidth, report.viewportWidth, "The page has horizontal overflow");
  await screenshot("ui-home.png");

  await evaluate("document.querySelector('#modelTrigger').click()");
  await wait(250);
  await screenshot("ui-model-config.png");
  await evaluate("document.querySelector('.setting-row[data-setting=\"model\"]').click()");
  await wait(250);
  const modelState = await evaluate(`(() => ({
    popoverHidden: document.querySelector('#modelPopover').hidden,
    submenuHidden: document.querySelector('#settingSubmenu').hidden,
    models: [...document.querySelectorAll('#submenuOptions button')].map((button) => button.textContent.trim()),
  }))()`);
  assert.equal(modelState.popoverHidden, false);
  assert.equal(modelState.submenuHidden, false);
  assert.deepEqual(modelState.models, [
    "5.6 Sol", "5.6 Terra", "5.6 Luna", "5.5", "5.4", "5.4 Mini", "5.3 Codex Spark",
  ]);
  await screenshot("ui-model-list.png");

  await evaluate("document.querySelector('#modelTrigger').click()");
  await evaluate("document.querySelector('#apiDocsButton').click()");
  await wait(250);
  const apiKeyBefore = await evaluate(`(() => ({
    open: document.querySelector('#apiDialog').open,
    modelCount: document.querySelector('#apiKeyModel').options.length,
    endpoint: document.querySelector('#externalTaskEndpoint').textContent,
  }))()`);
  assert.equal(apiKeyBefore.open, true);
  assert.equal(apiKeyBefore.modelCount, 7);
  assert.match(apiKeyBefore.endpoint, /\/api\/v1\/external\/tasks$/);
  await evaluate(`(() => {
    document.querySelector('#apiKeyName').value = '视觉测试 Key';
    document.querySelector('#apiKeyEffort').value = 'Ultra';
    document.querySelector('#apiKeySpeed').value = 'Fast';
    document.querySelector('#apiKeyPermission').value = 'read-only';
    document.querySelector('#apiKeyForm').requestSubmit();
  })()`);
  let apiKeyState;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    apiKeyState = await evaluate(`(() => ({
      revealHidden: document.querySelector('#apiKeyReveal').hidden,
      secret: document.querySelector('#apiKeySecret').value,
      list: document.querySelector('#apiKeyList').textContent,
      stored: Object.values(localStorage).join(' '),
    }))()`);
    if (!apiKeyState.revealHidden && apiKeyState.list.includes("视觉测试 Key")) break;
    await wait(100);
  }
  assert.equal(apiKeyState.revealHidden, false);
  assert.match(apiKeyState.secret, /^ccc_live_[A-Za-z0-9_-]{40,64}$/);
  assert.match(apiKeyState.list, /视觉测试 Key/);
  assert.doesNotMatch(apiKeyState.stored, /ccc_live_/);
  await screenshot("ui-api-key-created.png");
  await evaluate("document.querySelector('#closeApiDialog').click(); document.querySelector('#apiDocsButton').click()");
  await wait(200);
  const apiKeyReopened = await evaluate(`(() => ({
    revealHidden: document.querySelector('#apiKeyReveal').hidden,
    secret: document.querySelector('#apiKeySecret').value,
    listed: document.querySelector('#apiKeyList').textContent,
  }))()`);
  assert.equal(apiKeyReopened.revealHidden, true);
  assert.equal(apiKeyReopened.secret, "");
  assert.match(apiKeyReopened.listed, /视觉测试 Key/);
  await evaluate("document.querySelector('#closeApiDialog').click()");

  await evaluate("document.querySelector('#projectModeNone').click()");
  const projectlessSelection = await evaluate(`(() => ({
    active: document.querySelector('#projectModeNone').classList.contains('active'),
    inputDisabled: document.querySelector('#projectPath').disabled,
    note: document.querySelector('#projectNote').textContent,
  }))()`);
  assert.equal(projectlessSelection.active, true);
  assert.equal(projectlessSelection.inputDisabled, true);
  assert.match(projectlessSelection.note, /临时目录/);
  await screenshot("ui-projectless-mode.png");

  await evaluate(`(() => {
    const prompt = document.querySelector('#taskPrompt');
    prompt.value = '视觉失败状态测试';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#runButton').click();
  })()`);
  let failureState;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    failureState = await evaluate(`(() => ({
      status: document.querySelector('#statusPill b').textContent,
      timeline: document.querySelector('#timeline').textContent,
      toasts: [...document.querySelectorAll('.toast')].map((toast) => toast.textContent),
    }))()`);
    if (failureState.status === "执行失败") break;
    await wait(100);
  }
  assert.equal(failureState.status, "执行失败");
  assert.doesNotMatch(failureState.timeline, /undefined/);
  assert.equal(failureState.toasts.some((message) => message.includes("任务已完成")), false);
  await evaluate("document.querySelector('.status-panel').scrollIntoView({ block: 'start' })");
  await wait(200);
  await screenshot("ui-projectless-failure.png");

  await writeFile(path.join(outputDirectory, "visual-report.json"), `${JSON.stringify({ report, modelState, apiKeyBefore, apiKeyReopened, projectlessSelection, failureState }, null, 2)}\n`);
  console.log(JSON.stringify({ outputDirectory, report, modelState, apiKeyBefore, apiKeyReopened, projectlessSelection, failureState }));
} finally {
  cdp?.socket.close();
  chrome?.kill();
  await handle.close();
  await rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
}
