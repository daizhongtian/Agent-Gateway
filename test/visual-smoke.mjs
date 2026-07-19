import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { startServer } from "../src/server/app.js";
import { createAesSecretProtector } from "../src/server/secret-protector.js";
import { UsageStore } from "../src/server/usage-store.js";

const chromePath = [
  process.env.CHROME_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find((candidate) => candidate && existsSync(candidate))
  || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const projectRoot = path.resolve(".");
const outputDirectory = path.join(projectRoot, "artifacts");
const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-control-chrome-"));

class VisualRunner {
  constructor() {
    this.runCount = 0;
  }

  run() {
    const shouldSucceed = this.runCount === 0;
    this.runCount += 1;
    let resolveExecution;
    let rejectExecution;
    let finished = false;
    const execution = {
      promise: new Promise((resolve, reject) => {
        resolveExecution = resolve;
        rejectExecution = reject;
        setTimeout(() => {
          if (finished) return;
          finished = true;
          if (shouldSucceed) {
            resolve({
              content: "视觉用量统计任务完成",
              threadId: "thread_visual_usage",
              usage: { input_tokens: 1_200, cached_input_tokens: 300, output_tokens: 400, reasoning_output_tokens: 100 },
            });
            return;
          }
          const error = new Error("视觉回归模拟失败");
          error.code = "VISUAL_TEST_FAILURE";
          reject(error);
        }, 80);
      }),
      cancel: () => {
        if (finished) return false;
        finished = true;
        resolveExecution = null;
        rejectExecution(Object.assign(new Error("cancelled"), { code: "TASK_CANCELLED" }));
        return true;
      },
    };
    return execution;
  }

  async close() {}
}

const visualUsageStore = new UsageStore();
for (const modelLabel of ["5.6 Terra", "5.6 Luna", "5.5", "5.4", "5.4 Mini", "5.3 Codex Spark"]) {
  visualUsageStore.recordCreated({ modelLabel });
}
const handle = await startServer({
  mode: "desktop",
  port: 0,
  runner: new VisualRunner(),
  usageStore: visualUsageStore,
  apiKeySecretProtector: createAesSecretProtector("visual-test-encryption-key-with-at-least-32-characters"),
});
let chrome;
let cdp;

const seededTask = await fetch(`${handle.url}/api/v1/tasks`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt: "视觉用量统计种子任务", projectless: true }),
}).then((response) => response.json());
for (let attempt = 0; attempt < 40; attempt += 1) {
  const task = await fetch(`${handle.url}/api/v1/tasks/${seededTask.id}`).then((response) => response.json());
  if (task.status === "completed") break;
  await new Promise((resolve) => setTimeout(resolve, 50));
}

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
    heading: document.querySelector('#gatewayDashboardTitle')?.textContent,
    testBenchHidden: document.querySelector('#apiTestBench').hidden,
    firstPanel: document.querySelector('.workspace > section')?.id,
    endpointVisible: document.querySelector('#externalTaskEndpoint').getBoundingClientRect().height > 0,
    connection: document.querySelector('#connectionText')?.textContent,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    background: getComputedStyle(document.body).backgroundColor,
  }))()`);
  assert.equal(report.title, "Codex Control Center");
  assert.equal(report.heading, "API Gateway 监控");
  assert.equal(report.testBenchHidden, true);
  assert.equal(report.firstPanel, "gatewayDashboard");
  assert.equal(report.endpointVisible, true);
  assert.equal(report.bodyWidth, report.viewportWidth, "The page has horizontal overflow");
  await screenshot("ui-home.png");

  await evaluate("document.querySelector('#languageSwitch').click()");
  await wait(250);
  const englishState = await evaluate(`(() => ({
    language: document.documentElement.lang,
    switchLabel: document.querySelector('#languageSwitchLabel').textContent,
    title: document.querySelector('.topbar-title h1').textContent,
    monitorTitle: document.querySelector('#gatewayDashboardTitle').textContent,
    testBenchHidden: document.querySelector('#apiTestBench').hidden,
    gatewayTitle: document.querySelector('#apiGatewayTitle').textContent,
    composerTitle: document.querySelector('#composerTitle').textContent,
    usageTitle: document.querySelector('#usageDashboardTitle').textContent,
    settingsLabel: document.querySelector('#settingsButton').textContent.trim(),
    settingsDialogOpen: document.querySelector('#settingsDialog').open,
    releasePanelAbsent: !document.querySelector('#releasePanel'),
    releaseVersion: document.querySelector('#desktopAppVersion').textContent,
    releaseStatus: document.querySelector('#releaseStatusText').textContent,
    settingsDisabled: [...document.querySelectorAll('#settingsDialog .settings-action')].every((button) => button.disabled),
    releaseAvailableHidden: document.querySelector('#openDesktopRelease').hidden
      && getComputedStyle(document.querySelector('#openDesktopRelease')).display === 'none',
    imageAction: document.querySelector('#addImagesButton').textContent.trim(),
    fileAction: document.querySelector('#addFilesButton').textContent.trim(),
    hostAction: document.querySelector('#gatewayHostToggle').textContent,
    stored: localStorage.getItem('codex.language'),
  }))()`);
  assert.equal(englishState.language, "en");
  assert.equal(englishState.switchLabel, "中文");
  assert.equal(englishState.title, "Codex API Console");
  assert.equal(englishState.monitorTitle, "API Gateway Monitor");
  assert.equal(englishState.testBenchHidden, true);
  assert.equal(englishState.gatewayTitle, "Model API Keys");
  assert.equal(englishState.composerTitle, "What should Codex do?");
  assert.equal(englishState.usageTitle, "Codex Usage");
  assert.equal(englishState.settingsLabel, "Settings");
  assert.equal(englishState.settingsDialogOpen, false);
  assert.equal(englishState.releasePanelAbsent, true);
  assert.equal(englishState.releaseVersion, "Web");
  assert.equal(englishState.releaseStatus, "Updates and diagnostics are available in the desktop app only.");
  assert.equal(englishState.settingsDisabled, true);
  assert.equal(englishState.releaseAvailableHidden, true);
  assert.match(englishState.imageAction, /Add images/);
  assert.match(englishState.fileAction, /Add files/);
  assert.equal(englishState.hostAction, "Disable Host");
  assert.equal(englishState.stored, "en");
  await screenshot("ui-home-english.png");
  await evaluate("document.querySelector('#settingsButton').click()");
  await wait(250);
  const settingsState = await evaluate(`(() => ({
    open: document.querySelector('#settingsDialog').open,
    title: document.querySelector('#settingsDialogTitle').textContent,
    description: document.querySelector('#settingsDialog .settings-dialog-heading p').textContent,
    trayTitle: document.querySelector('#settingsDialog .settings-preference-copy strong').textContent,
    trayDescription: document.querySelector('#settingsDialog .settings-preference-copy small').textContent,
    trayChecked: document.querySelector('#minimizeToTrayToggle').checked,
    trayDisabled: document.querySelector('#minimizeToTrayToggle').disabled,
    actions: [...document.querySelectorAll('#settingsDialog .settings-action strong')].map((node) => node.textContent),
    version: document.querySelector('#desktopAppVersion').textContent,
  }))()`);
  assert.equal(settingsState.open, true);
  assert.equal(settingsState.title, "Settings");
  assert.equal(settingsState.description, "Check for updates or export a safe local diagnostics report.");
  assert.equal(settingsState.trayTitle, "Minimize to tray");
  assert.equal(settingsState.trayDescription, "Keep the Host and local API running after closing or minimizing the window");
  assert.equal(settingsState.trayChecked, false);
  assert.equal(settingsState.trayDisabled, true);
  assert.deepEqual(settingsState.actions, ["Check for updates", "Export diagnostics"]);
  assert.equal(settingsState.version, "Web");
  await screenshot("ui-settings-english.png");
  await evaluate("document.querySelector('#closeSettingsDialog').click()");
  await wait(150);
  await evaluate("document.querySelector('#languageSwitch').click()");
  await wait(250);
  assert.deepEqual(await evaluate(`(() => ({
    language: document.documentElement.lang,
    switchLabel: document.querySelector('#languageSwitchLabel').textContent,
    title: document.querySelector('.topbar-title h1').textContent,
    stored: localStorage.getItem('codex.language'),
  }))()`), {
    language: "zh-CN",
    switchLabel: "EN",
    title: "Codex API 控制台",
    stored: "zh",
  });

  await evaluate("document.querySelector('#openApiTestBench').click(); document.querySelector('#modelTrigger').click()");
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

  await evaluate("document.querySelector('#modelTrigger').click(); document.querySelector('#closeApiTestBench').click()");
  assert.equal(await evaluate("document.querySelector('#apiTestBench').hidden"), true);
  await evaluate("document.querySelector('#apiDocsButton').click()");
  await wait(250);
  const apiKeyBefore = await evaluate(`(() => ({
    visible: !document.querySelector('#apiGatewayPanel').hidden,
    beforeComposer: document.querySelector('#apiGatewayPanel').compareDocumentPosition(document.querySelector('.composer-card')) & Node.DOCUMENT_POSITION_FOLLOWING,
    modelCount: document.querySelector('#apiKeyModel').options.length,
    endpoint: document.querySelector('#externalTaskEndpoint').textContent,
    hostStatus: document.querySelector('#gatewayHostStatusText').textContent,
    hostAction: document.querySelector('#gatewayHostToggle').textContent,
    totalTokens: document.querySelector('#usageTotalTokens').textContent,
    tokenCoverage: document.querySelector('#usageCoverage').textContent,
    modelUsage: document.querySelector('#usageModelList').textContent,
    modelRows: document.querySelectorAll('#usageModelList .usage-model-row').length,
    modelBadge: document.querySelector('.usage-model-card .usage-subheading > span').textContent,
  }))()`);
  assert.equal(apiKeyBefore.visible, true);
  assert.ok(apiKeyBefore.beforeComposer);
  assert.equal(apiKeyBefore.modelCount, 7);
  assert.match(apiKeyBefore.endpoint, /\/api\/v1\/external\/tasks$/);
  assert.equal(apiKeyBefore.hostStatus, "Host 已开启");
  assert.equal(apiKeyBefore.hostAction, "关闭 Host");
  assert.equal(apiKeyBefore.totalTokens, "1,600");
  assert.match(apiKeyBefore.tokenCoverage, /1 个任务/);
  assert.match(apiKeyBefore.modelUsage, /5\.6 Sol/);
  assert.match(apiKeyBefore.modelUsage, /5\.6 Terra/);
  assert.match(apiKeyBefore.modelUsage, /5\.3 Codex Spark/);
  assert.equal(apiKeyBefore.modelRows, 7);
  assert.equal(apiKeyBefore.modelBadge, "全部模型");
  await evaluate("document.querySelector('#gatewayHostToggle').click(); document.querySelector('#gatewayHostToggle').click()");
  let gatewayDisabledState;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    gatewayDisabledState = await evaluate(`(() => ({
      status: document.querySelector('#gatewayHostStatusText').textContent,
      action: document.querySelector('#gatewayHostToggle').textContent,
      offline: document.querySelector('#gatewayDashboard').classList.contains('gateway-offline'),
      address: document.querySelector('#apiAddress').textContent,
    }))()`);
    if (gatewayDisabledState.status === "Host 已关闭") break;
    await wait(100);
  }
  assert.equal(gatewayDisabledState.status, "Host 已关闭");
  assert.equal(gatewayDisabledState.action, "开启 Host");
  assert.equal(gatewayDisabledState.offline, true);
  assert.match(gatewayDisabledState.address, /Host 已关闭/);
  await screenshot("ui-gateway-host-disabled.png");
  await evaluate("document.querySelector('#gatewayHostToggle').click()");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await evaluate("document.querySelector('#gatewayHostStatusText').textContent");
    if (status === "Host 已开启") break;
    await wait(100);
  }
  assert.equal(await evaluate("document.querySelector('#gatewayHostStatusText').textContent"), "Host 已开启");
  await evaluate("document.querySelector('#usageDashboard').scrollIntoView({ block: 'start' })");
  await wait(200);
  await screenshot("ui-usage-dashboard.png");
  await evaluate("document.querySelector('#resetUsageDashboard').click(); document.querySelector('#resetUsageDashboard').click()");
  let usageResetState;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    usageResetState = await evaluate(`(() => ({
      totalTokens: document.querySelector('#usageTotalTokens').textContent,
      taskCount: document.querySelector('#usageTaskCount').textContent,
      modelText: document.querySelector('#usageModelList').textContent,
      resetLabel: document.querySelector('#usageUpdatedAt').textContent,
    }))()`);
    if (usageResetState.totalTokens === "0" && usageResetState.taskCount === "0") break;
    await wait(100);
  }
  assert.equal(usageResetState.totalTokens, "0");
  assert.equal(usageResetState.taskCount, "0");
  assert.match(usageResetState.modelText, /运行任务后/);
  assert.match(usageResetState.resetLabel, /累计自/);
  await screenshot("ui-usage-reset.png");
  await evaluate("document.querySelector('#apiGatewayPanel').scrollIntoView({ block: 'start' })");
  await wait(200);
  await evaluate(`(() => {
    document.querySelector('#apiKeyName').value = '视觉测试 Key';
    document.querySelector('#apiKeyModel').value = 'gpt-5.6-terra';
    document.querySelector('#apiKeyEffort').value = 'Xhigh';
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
  assert.match(apiKeyState.list, /5\.6 Terra/);
  assert.doesNotMatch(apiKeyState.stored, /ccc_live_/);
  await screenshot("ui-api-key-created.png");
  await evaluate("document.querySelector('#hideApiKeySecret').click(); document.querySelector('#apiDocsButton').click()");
  await wait(200);
  const apiKeyReopened = await evaluate(`(() => ({
    revealHidden: document.querySelector('#apiKeyReveal').hidden,
    secret: document.querySelector('#apiKeySecret').value,
    listed: document.querySelector('#apiKeyList').textContent,
  }))()`);
  assert.equal(apiKeyReopened.revealHidden, true);
  assert.equal(apiKeyReopened.secret, "");
  assert.match(apiKeyReopened.listed, /视觉测试 Key/);
  assert.match(apiKeyReopened.listed, /5\.6 Terra/);

  await evaluate("document.querySelector('.key-reveal').click()");
  let revealedKeyState;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    revealedKeyState = await evaluate(`(() => ({
      hidden: document.querySelector('.key-secret-inline').hidden,
      secret: document.querySelector('.key-secret-inline input').value,
      copyLabel: document.querySelector('.key-secret-inline .key-copy').textContent,
      deleteLabel: document.querySelector('.key-delete').textContent,
    }))()`);
    if (!revealedKeyState.hidden && revealedKeyState.secret.startsWith("ccc_live_")) break;
    await wait(100);
  }
  assert.equal(revealedKeyState.hidden, false);
  assert.equal(revealedKeyState.secret, apiKeyState.secret);
  assert.equal(revealedKeyState.copyLabel, "复制");
  assert.equal(revealedKeyState.deleteLabel, "删除");
  await screenshot("ui-api-key-revealed.png");

  const externalMonitorTask = await evaluate(`(async () => {
    const created = await fetch('/api/v1/external/tasks', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + ${JSON.stringify(apiKeyState.secret)},
      },
      body: JSON.stringify({ prompt: 'API 监控视觉测试', projectless: true }),
    }).then((response) => response.json());
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const task = await fetch('/api/v1/tasks/' + created.id).then((response) => response.json());
      if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return created;
  })()`);
  assert.ok(externalMonitorTask.id);
  await evaluate("document.querySelector('#refreshGatewayMonitor').click()");
  await wait(350);
  const gatewayMonitorState = await evaluate(`(() => {
    const filter = document.querySelector('#gatewayKeyFilter');
    filter.selectedIndex = 1;
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      callCount: document.querySelector('#gatewayCallCount').textContent,
      rowCount: document.querySelectorAll('#gatewayCallList .gateway-call-row').length,
      rows: document.querySelector('#gatewayCallList').textContent,
      focusModel: document.querySelector('#gatewayFocusModel').textContent,
      selectedKey: document.querySelector('#gatewayFocusTitle').textContent,
    };
  })()`);
  assert.equal(gatewayMonitorState.callCount, "1");
  assert.equal(gatewayMonitorState.rowCount, 1);
  assert.match(gatewayMonitorState.rows, /视觉测试 Key/);
  assert.match(gatewayMonitorState.rows, /5\.6 Terra/);
  assert.equal(gatewayMonitorState.focusModel, "5.6 Terra");
  assert.equal(gatewayMonitorState.selectedKey, "视觉测试 Key");
  await evaluate("document.querySelector('#gatewayDashboard').scrollIntoView({ block: 'start' })");
  await wait(180);
  await screenshot("ui-api-gateway-monitor.png");

  await evaluate("document.querySelector('#openApiTestBench').click(); document.querySelector('#projectModeNone').click()");
  const projectlessSelection = await evaluate(`(() => ({
    active: document.querySelector('#projectModeNone').classList.contains('active'),
    inputDisabled: document.querySelector('#projectPath').disabled,
    note: document.querySelector('#projectNote').textContent,
  }))()`);
  assert.equal(projectlessSelection.active, true);
  assert.equal(projectlessSelection.inputDisabled, true);
  assert.match(projectlessSelection.note, /临时目录/);
  await screenshot("ui-projectless-mode.png");

  const imageInputState = await evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 100;
    const context = canvas.getContext('2d');
    context.fillStyle = '#6f55bd';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.font = 'bold 24px sans-serif';
    context.fillText('IMAGE', 34, 58);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'visual-input.png', { type: 'image/png', lastModified: Date.now() });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector('#imageInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    return {
      count: document.querySelector('#imageCount').textContent,
      cards: document.querySelectorAll('.image-attachment').length,
      fileName: document.querySelector('.image-attachment-info strong')?.textContent,
      preview: document.querySelector('.image-attachment img')?.src,
      overflow: document.body.scrollWidth === window.innerWidth,
    };
  })()`);
  assert.equal(imageInputState.count, "1 / 12");
  assert.equal(imageInputState.cards, 1);
  assert.equal(imageInputState.fileName, "visual-input.png");
  assert.match(imageInputState.preview, /^blob:/);
  assert.equal(imageInputState.overflow, true);
  const fileInputState = await evaluate(`(async () => {
    const file = new File(['# Attachment\\nGeneral file input works.\\n'], 'visual-notes.md', {
      type: 'text/markdown',
      lastModified: Date.now(),
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector('#fileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    return {
      count: document.querySelector('#imageCount').textContent,
      cards: document.querySelectorAll('.image-attachment').length,
      icon: [...document.querySelectorAll('.attachment-file-icon')].map((entry) => entry.textContent),
      names: [...document.querySelectorAll('.image-attachment-info strong')].map((entry) => entry.textContent),
      overflow: document.body.scrollWidth === window.innerWidth,
    };
  })()`);
  assert.equal(fileInputState.count, "2 / 12");
  assert.equal(fileInputState.cards, 2);
  assert.deepEqual(fileInputState.icon, ["TEXT"]);
  assert.deepEqual(fileInputState.names, ["visual-input.png", "visual-notes.md"]);
  assert.equal(fileInputState.overflow, true);
  await evaluate(`(() => {
    document.querySelectorAll('.toast').forEach((toast) => toast.remove());
    document.querySelector('.composer-card').scrollIntoView({ block: 'start' });
  })()`);
  await wait(200);
  await screenshot("ui-image-input.png");

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
      toastCloseTop: (() => {
        const toast = document.querySelector('.toast');
        const close = toast?.querySelector('button');
        if (!toast || !close) return null;
        return Math.round(close.getBoundingClientRect().top - toast.getBoundingClientRect().top);
      })(),
      toastCloseRight: (() => {
        const toast = document.querySelector('.toast');
        const close = toast?.querySelector('button');
        if (!toast || !close) return null;
        return Math.round(toast.getBoundingClientRect().right - close.getBoundingClientRect().right);
      })(),
    }))()`);
    if (failureState.status === "执行失败") break;
    await wait(100);
  }
  assert.equal(failureState.status, "执行失败");
  assert.doesNotMatch(failureState.timeline, /undefined/);
  assert.equal(failureState.toasts.some((message) => message.includes("任务已完成")), false);
  assert.ok(failureState.toastCloseTop >= 0 && failureState.toastCloseTop <= 10, "Toast close button must stay at the top");
  assert.ok(failureState.toastCloseRight >= 0 && failureState.toastCloseRight <= 10, "Toast close button must stay at the right");
  await evaluate("document.querySelector('.status-panel').scrollIntoView({ block: 'start' })");
  await wait(200);
  await screenshot("ui-projectless-failure.png");

  await evaluate("document.querySelector('#languageSwitch').click()");
  await wait(300);
  const dynamicEnglishState = await evaluate(`(() => ({
    status: document.querySelector('#statusPill b').textContent,
    timeline: document.querySelector('#timeline').textContent,
    projectNote: document.querySelector('#projectNote').textContent,
    apiKeys: document.querySelector('#apiKeyList').textContent,
    usageModel: document.querySelector('#usageModelList').textContent,
    example: document.querySelector('#apiExampleCode').textContent,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }))()`);
  assert.equal(dynamicEnglishState.status, "Execution failed");
  assert.match(dynamicEnglishState.timeline, /Task ended/);
  assert.match(dynamicEnglishState.projectNote, /fresh temporary directory/);
  assert.match(dynamicEnglishState.apiKeys, /Read only/);
  assert.match(dynamicEnglishState.apiKeys, /Active/);
  assert.match(dynamicEnglishState.apiKeys, /Delete/);
  assert.match(dynamicEnglishState.usageModel, /5\.6 Sol/);
  assert.match(dynamicEnglishState.usageModel, /1 cumulative tasks/);
  assert.match(dynamicEnglishState.example, /Inspect and fix this project/);
  assert.equal(dynamicEnglishState.bodyWidth, dynamicEnglishState.viewportWidth, "The English page has horizontal overflow");
  await screenshot("ui-runtime-english.png");

  await evaluate("document.querySelector('.key-delete').click(); document.querySelector('.key-delete').click()");
  let deletionState;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    deletionState = await evaluate(`(() => ({
      rows: document.querySelectorAll('.api-key-row').length,
      count: document.querySelector('#apiKeyCount').textContent,
      empty: document.querySelector('#apiKeyList').textContent,
    }))()`);
    if (deletionState.rows === 0) break;
    await wait(100);
  }
  assert.equal(deletionState.rows, 0);
  assert.match(deletionState.count, /No access keys created/);
  assert.match(deletionState.empty, /Create your first Gateway API key/);
  await screenshot("ui-api-key-deleted.png");

  await evaluate(`(() => {
    const bench = document.querySelector('#apiTestBench');
    if (!bench.hidden) document.querySelector('#closeApiTestBench').click();
    document.querySelectorAll('.toast').forEach((toast) => toast.remove());
    window.scrollTo(0, 0);
  })()`);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await wait(250);
  await evaluate(`(() => {
    document.activeElement?.blur();
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    document.scrollingElement.scrollTop = 0;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.querySelector('.main-content').scrollTop = 0;
  })()`);
  await wait(350);
  const mobileState = await evaluate(`(() => ({
    scrollTop: document.scrollingElement.scrollTop,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    dashboardVisible: document.querySelector('#gatewayDashboard').getBoundingClientRect().height > 0,
    testBenchHidden: document.querySelector('#apiTestBench').hidden,
    kpiColumns: getComputedStyle(document.querySelector('.gateway-kpi-grid')).gridTemplateColumns.split(' ').length,
    apiKeysAfterDashboard: document.querySelector('#apiGatewayPanel').getBoundingClientRect().top
      > document.querySelector('#gatewayDashboard').getBoundingClientRect().top,
  }))()`);
  assert.equal(mobileState.bodyWidth, mobileState.viewportWidth, "The mobile page has horizontal overflow");
  assert.equal(mobileState.scrollTop, 0);
  assert.equal(mobileState.dashboardVisible, true);
  assert.equal(mobileState.testBenchHidden, true);
  assert.equal(mobileState.kpiColumns, 2);
  assert.equal(mobileState.apiKeysAfterDashboard, true);
  await screenshot("ui-home-mobile.png");

  await writeFile(path.join(outputDirectory, "visual-report.json"), `${JSON.stringify({ report, englishState, modelState, apiKeyBefore, gatewayDisabledState, usageResetState, apiKeyReopened, revealedKeyState, gatewayMonitorState, projectlessSelection, imageInputState, fileInputState, failureState, dynamicEnglishState, deletionState, mobileState }, null, 2)}\n`);
  console.log(JSON.stringify({ outputDirectory, report, englishState, modelState, apiKeyBefore, gatewayDisabledState, usageResetState, apiKeyReopened, revealedKeyState, gatewayMonitorState, projectlessSelection, imageInputState, fileInputState, failureState, dynamicEnglishState, deletionState, mobileState }));
} finally {
  cdp?.socket.close();
  chrome?.kill();
  await handle.close();
  await rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
}
