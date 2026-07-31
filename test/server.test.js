import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { WebSocket } from "ws";
import { startServer } from "../src/server/app.js";
import { ApiKeyStore } from "../src/server/api-key-store.js";
import { createAuth } from "../src/server/auth.js";
import { loadServerConfig } from "../src/server/config.js";
import { ProjectRegistry } from "../src/server/projects.js";
import { MODELS } from "../src/server/models.js";
import { createAesSecretProtector } from "../src/server/secret-protector.js";
import { TaskManager } from "../src/server/task-manager.js";
import { UsageStore } from "../src/server/usage-store.js";
import { CodexRunner, RunnerCancelledError, RunnerTimeoutError } from "../src/runner/codex-runner.js";
import { executeCodexTask, resolvePackagedCodexRuntime } from "../src/runner/worker.js";
import { normalizeApprovalPolicy, redactSecrets } from "../src/runner/protocol.js";

const PROJECT_ROOT = path.resolve(".");
const PACKAGE_VERSION = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;

class FakeRunner {
  constructor({ complete = true } = {}) {
    this.complete = complete;
    this.executions = new Set();
  }

  run(task, options = {}) {
    this.lastTask = task;
    let finished = false;
    let rejectPromise;
    const execution = {
      promise: new Promise((resolve, reject) => {
        rejectPromise = reject;
        if (this.complete) {
          setImmediate(() => {
            if (finished) return;
            options.onEvent?.({ kind: "sdk", event: { type: "thread.started", thread_id: "thread_test" } });
            options.onEvent?.({ kind: "sdk", event: { type: "turn.started" } });
            options.onEvent?.({
              kind: "sdk",
              event: { type: "item.completed", item: { id: "message_1", type: "agent_message", text: "测试完成" } },
            });
            options.onEvent?.({
              kind: "sdk",
              event: {
                type: "turn.completed",
                usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 1 },
              },
            });
            finished = true;
            resolve({
              content: "测试完成",
              threadId: "thread_test",
              usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 1 },
            });
          });
        }
      }),
      cancel: () => {
        if (finished) return false;
        finished = true;
        rejectPromise(new RunnerCancelledError());
        return true;
      },
    };
    this.executions.add(execution);
    execution.promise.finally(() => this.executions.delete(execution)).catch(() => {});
    return execution;
  }

  async close() {
    for (const execution of [...this.executions]) execution.cancel();
    await Promise.allSettled([...this.executions].map((execution) => execution.promise));
  }
}

class ModelRecordingRunner {
  constructor() {
    this.calls = [];
  }

  run(task) {
    const callIndex = this.calls.length;
    this.calls.push(structuredClone(task));
    const usage = {
      input_tokens: 100 + callIndex,
      cached_input_tokens: 10 + callIndex,
      output_tokens: 20 + callIndex,
      reasoning_output_tokens: 5 + callIndex,
    };
    return {
      promise: Promise.resolve({
        content: `completed with ${task.model}`,
        threadId: `thread_model_${callIndex}`,
        usage,
      }),
      cancel: () => false,
    };
  }

  async close() {}
}

async function jsonRequest(baseUrl, pathname, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body && typeof options.body !== "string") {
    headers.set("content-type", "application/json");
    options = { ...options, body: JSON.stringify(options.body) };
  }
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function waitForTask(baseUrl, id, headers = {}) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { payload } = await jsonRequest(baseUrl, `/api/v1/tasks/${id}`, { headers });
    if (["completed", "failed", "cancelled"].includes(payload.status)) return payload;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Task did not reach a terminal state");
}

async function waitForExternalTask(baseUrl, id, headers = {}) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { response, payload } = await jsonRequest(baseUrl, `/api/v1/external/tasks/${id}`, { headers });
    assert.equal(response.status, 200);
    if (["completed", "failed", "cancelled"].includes(payload.status)) return payload;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("External task did not reach a terminal state");
}

function createTextPdf(text = "Hello PDF attachment") {
  const escaped = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source, "ascii"));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(source, "ascii");
  source += `xref\n0 ${objects.length + 1}\n`;
  source += "0000000000 65535 f \n";
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, "ascii");
}

function createDocx(text = "Hello DOCX attachment") {
  return Buffer.from(zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" '
      + 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + "</Types>",
    ),
    "word/document.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    ),
  }));
}

function rawHttpStatus(baseUrl, pathname, headers) {
  const target = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "GET",
      headers,
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
    request.end();
  });
}

test("server exposes the UI, model catalog, task API, and completed SSE history", async () => {
  let desktopOpenRequests = 0;
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    allowedProjectRoots: [PROJECT_ROOT],
    corsOrigins: ["http://127.0.0.1:8088"],
    runner: new FakeRunner(),
    onDesktopOpen: () => { desktopOpenRequests += 1; },
    onDesktopStatus: async () => ({
      codingAgent: {
        id: "chatgpt-codex",
        label: "ChatGPT / Codex",
        status: "ready",
        ready: true,
        checkedAt: "2026-07-29T12:00:00.000Z",
      },
    }),
  });
  try {
    const index = await fetch(`${handle.url}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /Agent Gateway/);
    assert.match(index.headers.get("content-security-policy"), /object-src 'none'/);
    const health = await fetch(`${handle.url}/api/v1/health`, {
      headers: { origin: "http://127.0.0.1:8088" },
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), "http://127.0.0.1:8088");
    const healthPayload = await health.json();
    assert.equal(healthPayload.ok, true);
    assert.equal(healthPayload.product, "agent-gateway");
    assert.equal(healthPayload.status, "ok");
    assert.equal(healthPayload.version, "3.0.1");
    const desktopOpen = await fetch(`${handle.url}/api/v1/desktop/open`, {
      method: "POST",
      headers: { origin: "http://127.0.0.1:8088" },
    });
    assert.equal(desktopOpen.status, 200);
    assert.deepEqual(await desktopOpen.json(), {
      ok: true,
      product: "agent-gateway",
      action: "desktop-open",
    });
    assert.equal(desktopOpenRequests, 1);
    const desktopStatus = await fetch(`${handle.url}/api/v1/desktop/status`, {
      headers: { origin: "http://127.0.0.1:8088" },
    });
    assert.equal(desktopStatus.status, 200);
    assert.deepEqual(await desktopStatus.json(), {
      ok: true,
      product: "agent-gateway",
      status: "ok",
      version: "3.0.1",
      codingAgent: {
        id: "chatgpt-codex",
        label: "ChatGPT / Codex",
        status: "ready",
        ready: true,
        checkedAt: "2026-07-29T12:00:00.000Z",
      },
    });
    assert.equal(await rawHttpStatus(handle.url, "/health", {
      host: "evil.example",
      origin: "http://evil.example",
    }), 421);
    assert.equal(await rawHttpStatus(handle.url, "/health", {
      host: "codex-host.example.ts.net",
    }), 421);

    const { response: modelsResponse, payload: models } = await jsonRequest(handle.url, "/api/v1/models");
    assert.equal(modelsResponse.status, 200);
    assert.deepEqual(models.models.map((model) => model.label), [
      "5.6 Sol", "5.6 Terra", "5.6 Luna", "5.5", "5.4", "5.4 Mini", "5.3 Codex Spark",
    ]);

    const { response: projectResponse, payload: project } = await jsonRequest(handle.url, "/api/v1/projects", {
      method: "POST",
      body: { name: "SDK test", path: PROJECT_ROOT },
    });
    assert.equal(projectResponse.status, 201);
    assert.equal(project.path, PROJECT_ROOT);

    const { response: taskResponse, payload: task } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: {
        prompt: "只返回测试完成",
        projectId: project.id,
        model: "gpt-5.6-sol",
        effort: "ultra",
        speed: "standard",
        sandboxMode: "workspace-write",
        approvalPolicy: "untrusted",
      },
    });
    assert.equal(taskResponse.status, 202);
    const completed = await waitForTask(handle.url, task.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.result.content, "测试完成");
    assert.equal(completed.approvalPolicy, "untrusted");

    const events = await fetch(`${handle.url}/api/v1/tasks/${task.id}/events`);
    const eventText = await events.text();
    assert.match(eventText, /event: result/);
    assert.match(eventText, /event: done/);

    const { payload: history } = await jsonRequest(handle.url, "/api/v1/tasks");
    assert.equal(history.tasks[0].promptPreview, "只返回测试完成");
  } finally {
    await handle.close();
  }
});

test("loopback services accept only explicitly allowed public Host names", async () => {
  const dynamicHosts = new Set(["dynamic.example.ts.net"]);
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    allowedProjectRoots: [PROJECT_ROOT],
    allowedHosts: ["static.example.ts.net"],
    isAllowedHost: (hostname) => dynamicHosts.has(hostname),
    runner: new FakeRunner(),
  });
  try {
    assert.equal(await rawHttpStatus(handle.url, "/health", {
      host: "static.example.ts.net",
    }), 200);
    assert.equal(await rawHttpStatus(handle.url, "/health", {
      host: "dynamic.example.ts.net:443",
    }), 200);
    assert.equal(await rawHttpStatus(handle.url, "/health", {
      host: "attacker.example.ts.net",
    }), 421);
  } finally {
    await handle.close();
  }
});

test("projectless tasks use an isolated temporary workspace and clean it after completion", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codex-control-projectless-test-"));
  const scratchRoot = path.join(temporaryRoot, "scratch");
  const runner = new FakeRunner();
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    scratchRoot,
    runner,
  });
  try {
    const { response, payload: created } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: {
        prompt: "无项目任务",
        projectless: true,
        model: "gpt-5.6-sol",
        approvalPolicy: "untrusted",
      },
    });
    assert.equal(response.status, 202);
    assert.equal(created.projectless, true);
    assert.equal(created.projectId, null);
    assert.equal(created.projectPath, null);
    assert.equal(created.project.projectless, true);
    const completed = await waitForTask(handle.url, created.id);
    assert.equal(completed.status, "completed");
    const relativeWorkspacePath = path.relative(await realpath(scratchRoot), runner.lastTask.projectPath);
    assert.ok(
      relativeWorkspacePath
      && !relativeWorkspacePath.startsWith(`..${path.sep}`)
      && relativeWorkspacePath !== ".."
      && !path.isAbsolute(relativeWorkspacePath),
    );
    assert.deepEqual(await readdir(scratchRoot), []);
  } finally {
    await handle.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("image uploads are validated, attached as local_image inputs, owner-isolated, and cleaned", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codex-control-images-test-"));
  const uploadRoot = path.join(temporaryRoot, "uploads");
  const runner = new FakeRunner();
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    imageUploadRoot: uploadRoot,
    runner,
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zlq8AAAAASUVORK5CYII=",
    "base64",
  );
  try {
    const uploadResponse = await fetch(`${handle.url}/api/v1/uploads/images`, {
      method: "POST",
      headers: { "content-type": "image/png", "x-file-name": encodeURIComponent("screen shot.png") },
      body: png,
    });
    assert.equal(uploadResponse.status, 201);
    const uploaded = await uploadResponse.json();
    assert.equal(uploaded.image.name, "screen shot.png");
    assert.equal(uploaded.image.mimeType, "image/png");
    assert.equal(uploaded.image.size, png.length);
    assert.equal(uploaded.limits.maxImages, 4);

    const { response: taskResponse, payload: task } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: {
        prompt: "Describe the attached image",
        projectless: true,
        imageIds: [uploaded.image.id],
        approvalPolicy: "untrusted",
      },
    });
    assert.equal(taskResponse.status, 202);
    assert.deepEqual(task.images, [{
      id: uploaded.image.id,
      name: "screen shot.png",
      mimeType: "image/png",
      size: png.length,
    }]);
    assert.doesNotMatch(JSON.stringify(task), /codex-control-images-test/);
    const completed = await waitForTask(handle.url, task.id);
    assert.equal(completed.status, "completed");
    assert.equal(runner.lastTask.imagePaths.length, 1);
    assert.ok(path.isAbsolute(runner.lastTask.imagePaths[0]));
    await assert.rejects(readFile(runner.lastTask.imagePaths[0]), (error) => error?.code === "ENOENT");

    const { response: reused, payload: reusedPayload } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: {
        prompt: "Try to reuse a consumed image",
        projectless: true,
        imageIds: [uploaded.image.id],
      },
    });
    assert.equal(reused.status, 404);
    assert.equal(reusedPayload.error.code, "NOT_FOUND");

    const invalid = await fetch(`${handle.url}/api/v1/uploads/images`, {
      method: "POST",
      headers: { "content-type": "image/png", "x-file-name": "not-an-image.png" },
      body: Buffer.from("not an image"),
    });
    assert.equal(invalid.status, 415);
    assert.equal((await invalid.json()).error.code, "INVALID_IMAGE_CONTENT");

    const disposableResponse = await fetch(`${handle.url}/api/v1/uploads/images`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: png,
    });
    const disposable = await disposableResponse.json();
    const deleted = await fetch(`${handle.url}/api/v1/uploads/images/${disposable.image.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { id: disposable.image.id, deleted: true });
  } finally {
    await handle.close();
    assert.deepEqual(await readdir(uploadRoot), []);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("gateway image and generic file uploads are owner-isolated and task-bound", async () => {
  const runner = new FakeRunner();
  const handle = await startServer({ mode: "desktop", port: 0, runner });
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  try {
    const createKey = (name) => jsonRequest(handle.url, "/api/v1/api-keys", {
      method: "POST",
      body: { name, model: "gpt-5.6-sol", effort: "high", speed: "standard", permission: "read-only" },
    });
    const first = (await createKey("Image client one")).payload;
    const second = (await createKey("Image client two")).payload;
    const firstHeaders = { authorization: `Bearer ${first.key}` };
    const secondHeaders = { authorization: `Bearer ${second.key}` };
    const uploadedResponse = await fetch(`${handle.url}/api/v1/external/uploads/images`, {
      method: "POST",
      headers: { ...firstHeaders, "content-type": "image/png" },
      body: png,
    });
    assert.equal(uploadedResponse.status, 201);
    const uploaded = await uploadedResponse.json();

    const { response: stolen, payload: stolenPayload } = await jsonRequest(handle.url, "/api/v1/external/tasks", {
      method: "POST",
      headers: secondHeaders,
      body: { prompt: "Use another key's image", projectless: true, imageIds: [uploaded.image.id] },
    });
    assert.equal(stolen.status, 404);
    assert.equal(stolenPayload.error.code, "NOT_FOUND");

    const { response: accepted, payload: task } = await jsonRequest(handle.url, "/api/v1/external/tasks", {
      method: "POST",
      headers: firstHeaders,
      body: { prompt: "Describe my image", projectless: true, imageIds: [uploaded.image.id] },
    });
    assert.equal(accepted.status, 202);
    assert.equal((await waitForExternalTask(handle.url, task.id, firstHeaders)).status, "completed");

    const profile = await jsonRequest(handle.url, "/api/v1/external/profile", { headers: firstHeaders });
    assert.equal(profile.response.status, 200);
    assert.equal(profile.payload.fileLimits.maxFiles, 12);
    assert.equal(profile.payload.endpoints.uploadFile, "/api/v1/external/uploads/files");

    const textUploadResponse = await fetch(`${handle.url}/api/v1/external/uploads/files`, {
      method: "POST",
      headers: {
        ...firstHeaders,
        "content-type": "text/markdown",
        "x-file-name": "agent-notes.md",
      },
      body: Buffer.from("# Agent notes\nUse the external file API.\n"),
    });
    assert.equal(textUploadResponse.status, 201);
    const textUpload = await textUploadResponse.json();
    assert.equal(textUpload.file.kind, "text");
    assert.equal(textUpload.file.textExtracted, true);

    const { response: stolenFile, payload: stolenFilePayload } = await jsonRequest(
      handle.url,
      "/api/v1/external/tasks",
      {
        method: "POST",
        headers: secondHeaders,
        body: { prompt: "Use another key's file", projectless: true, fileIds: [textUpload.file.id] },
      },
    );
    assert.equal(stolenFile.status, 404);
    assert.equal(stolenFilePayload.error.code, "NOT_FOUND");

    const { response: acceptedFile, payload: fileTask } = await jsonRequest(
      handle.url,
      "/api/v1/external/tasks",
      {
        method: "POST",
        headers: firstHeaders,
        body: { prompt: "Read my file", projectless: true, fileIds: [textUpload.file.id] },
      },
    );
    assert.equal(acceptedFile.status, 202);
    assert.equal(fileTask.files[0].name, "agent-notes.md");
    assert.equal((await waitForExternalTask(handle.url, fileTask.id, firstHeaders)).status, "completed");
  } finally {
    await handle.close();
  }
});

test("generic file uploads support mixed PDF, Office, text, and native image inputs", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codex-control-files-test-"));
  const uploadRoot = path.join(temporaryRoot, "uploads");
  const runner = new FakeRunner({ complete: false });
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    attachmentUploadRoot: uploadRoot,
    runner,
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zlq8AAAAASUVORK5CYII=",
    "base64",
  );
  const uploads = [
    { name: "requirements.pdf", type: "application/pdf", body: createTextPdf("PDF acceptance criteria") },
    {
      name: "specification.docx",
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      body: createDocx("DOCX implementation notes"),
    },
    { name: "notes.md", type: "text/markdown", body: Buffer.from("# Text attachment\nUse strict validation.\n") },
    { name: "diagram.png", type: "image/png", body: png },
  ];
  try {
    const uploadedFiles = [];
    for (const upload of uploads) {
      const response = await fetch(`${handle.url}/api/v1/uploads/files`, {
        method: "POST",
        headers: {
          "content-type": upload.type,
          "x-file-name": encodeURIComponent(upload.name),
        },
        body: upload.body,
      });
      assert.equal(response.status, 201);
      const payload = await response.json();
      uploadedFiles.push(payload.file);
      assert.equal(payload.limits.maxFiles, 12);
      assert.equal(payload.limits.maxImages, 4);
    }
    assert.deepEqual(uploadedFiles.map((file) => file.kind), ["pdf", "office", "text", "image"]);
    assert.equal(uploadedFiles[0].textExtracted, true);
    assert.equal(uploadedFiles[1].textExtracted, true);
    assert.equal(uploadedFiles[2].textExtracted, true);
    assert.equal(uploadedFiles[3].textExtracted, false);

    const { response, payload: task } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: {
        prompt: "Review all attachments",
        projectless: true,
        fileIds: uploadedFiles.map((file) => file.id),
        approvalPolicy: "untrusted",
      },
    });
    assert.equal(response.status, 202);
    assert.deepEqual(task.files.map((file) => file.kind), ["pdf", "office", "text", "image"]);
    assert.equal(task.images.length, 1);
    assert.doesNotMatch(JSON.stringify(task), /codex-control-files-test/);
    assert.equal(runner.lastTask.imagePaths.length, 1);
    assert.equal(runner.lastTask.additionalDirectories.length, 3);
    assert.equal(runner.lastTask.attachments.length, 4);

    const pdfAttachment = runner.lastTask.attachments.find((file) => file.kind === "pdf");
    const officeAttachment = runner.lastTask.attachments.find((file) => file.kind === "office");
    const textAttachment = runner.lastTask.attachments.find((file) => file.kind === "text");
    assert.match(await readFile(pdfAttachment.extractedTextPath, "utf8"), /PDF acceptance criteria/);
    assert.match(await readFile(officeAttachment.extractedTextPath, "utf8"), /DOCX implementation notes/);
    assert.match(await readFile(textAttachment.extractedTextPath, "utf8"), /Use strict validation/);
    assert.deepEqual(
      runner.lastTask.additionalDirectories.every((directory) => path.isAbsolute(directory)),
      true,
    );

    const blocked = await fetch(`${handle.url}/api/v1/uploads/files`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "malware.exe",
      },
      body: Buffer.from("MZ blocked"),
    });
    assert.equal(blocked.status, 415);
    assert.equal((await blocked.json()).error.code, "EXECUTABLE_FILE_FORBIDDEN");

    const cancelled = await jsonRequest(handle.url, `/api/v1/tasks/${task.id}/cancel`, { method: "POST" });
    assert.equal(cancelled.response.status, 202);
    assert.equal((await waitForTask(handle.url, task.id)).status, "cancelled");
    for (const attachment of runner.lastTask.attachments) {
      await assert.rejects(readFile(attachment.path), (error) => error?.code === "ENOENT");
    }
  } finally {
    await handle.close();
    assert.deepEqual(await readdir(uploadRoot), []);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("queued and running projectless cancellations clean every scratch workspace", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codex-control-projectless-cancel-"));
  const scratchRoot = path.join(temporaryRoot, "scratch");
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    scratchRoot,
    maxConcurrentTasks: 1,
    maxQueuedTasks: 3,
    runner: new FakeRunner({ complete: false }),
  });
  try {
    const { payload: running } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: { prompt: "running scratch", projectless: true, approvalPolicy: "untrusted" },
    });
    const { payload: queued } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: { prompt: "queued scratch", projectless: true, approvalPolicy: "untrusted" },
    });
    assert.equal(handle.taskManager.get(running.id).status, "running");
    assert.equal(handle.taskManager.get(queued.id).status, "queued");
    assert.equal((await readdir(scratchRoot)).length, 2);

    const { payload: queuedCancelled } = await jsonRequest(
      handle.url,
      `/api/v1/tasks/${queued.id}/cancel`,
      { method: "POST" },
    );
    assert.equal(queuedCancelled.status, "cancelled");
    assert.equal((await readdir(scratchRoot)).length, 1);

    await jsonRequest(handle.url, `/api/v1/tasks/${running.id}/cancel`, { method: "POST" });
    assert.equal((await waitForTask(handle.url, running.id)).status, "cancelled");
    assert.deepEqual(await readdir(scratchRoot), []);
  } finally {
    await handle.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("timed-out projectless tasks fail safely and release their scratch workspace", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codex-control-projectless-timeout-"));
  const scratchRoot = path.join(temporaryRoot, "scratch");
  const timeoutRunner = {
    run() {
      return {
        promise: Promise.reject(new RunnerTimeoutError()),
        cancel: () => false,
      };
    },
    async close() {},
  };
  const handle = await startServer({ mode: "desktop", port: 0, scratchRoot, runner: timeoutRunner });
  try {
    const { payload: task } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: { prompt: "timeout scratch", projectless: true, approvalPolicy: "untrusted" },
    });
    const failed = await waitForTask(handle.url, task.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.error.code, "TASK_TIMEOUT");
    assert.deepEqual(await readdir(scratchRoot), []);
  } finally {
    await handle.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("non-loopback deployments require strong authentication and allowed roots", () => {
  assert.throws(
    () => loadServerConfig({ host: "0.0.0.0", authMode: "none" }),
    /Bearer token is required/,
  );
  assert.throws(
    () => loadServerConfig({
      host: "0.0.0.0",
      authMode: "token",
      apiToken: "short-token",
      allowedProjectRoots: [PROJECT_ROOT],
    }),
    /at least 32 characters/,
  );
  const config = loadServerConfig({
    env: {
      HOST: "0.0.0.0",
      AUTH_MODE: "token",
      API_TOKEN: "a".repeat(32),
      ALLOWED_PROJECT_ROOTS: `${PROJECT_ROOT},${os.tmpdir()}`,
    },
  });
  assert.equal(config.allowedProjectRoots.length, 2);
  assert.doesNotThrow(() => loadServerConfig({
    host: "0.0.0.0",
    authMode: "token",
    resolveToken: async () => null,
    allowedProjectRoots: [PROJECT_ROOT],
  }));
});

test("token auth and WebSocket origin checks are enforced", async () => {
  const token = "t".repeat(40);
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    authMode: "token",
    apiToken: token,
    allowedProjectRoots: [PROJECT_ROOT],
    runner: new FakeRunner(),
  });
  try {
    assert.equal((await fetch(`${handle.url}/api/v1/models`)).status, 401);
    assert.equal((await fetch(`${handle.url}/api/v1/models`, {
      headers: { authorization: `Bearer ${token}` },
    })).status, 200);
    assert.equal((await fetch(`${handle.url}/api/v1/models`, {
      headers: { authorization: `Bearer ${token}`, origin: "http://evil.example" },
    })).status, 403);

    const wsUrl = handle.url.replace(/^http/, "ws") + "/ws";
    const socket = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${token}` }, origin: handle.url });
    const messagePromise = once(socket, "message");
    await once(socket, "open");
    const [welcome] = await messagePromise;
    assert.equal(JSON.parse(welcome.toString()).type, "welcome");
    socket.close();
    await once(socket, "close");

    const rejectedStatus = await new Promise((resolve, reject) => {
      const rejected = new WebSocket(wsUrl, {
        headers: { authorization: `Bearer ${token}` },
        origin: "http://evil.example",
      });
      rejected.once("unexpected-response", (_request, response) => {
        const status = response.statusCode;
        response.resume();
        resolve(status);
      });
      rejected.once("open", () => reject(new Error("Forbidden WebSocket origin was accepted")));
      rejected.once("error", () => {});
    });
    assert.equal(rejectedStatus, 403);
  } finally {
    await handle.close();
  }
});

test("WebSocket ping, validation, subscription, and live task events work", async () => {
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    runner: new FakeRunner({ complete: false }),
  });
  let socket;
  const nextMessage = (predicate) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket?.off("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 2_000);
    const onMessage = (buffer) => {
      const message = JSON.parse(buffer.toString("utf8"));
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
  try {
    const { payload: task } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: { prompt: "websocket task", projectless: true, approvalPolicy: "untrusted" },
    });
    socket = new WebSocket(handle.url.replace(/^http/, "ws") + "/ws");
    const welcome = nextMessage((message) => message.type === "welcome");
    await once(socket, "open");
    assert.equal((await welcome).version, PACKAGE_VERSION);

    const invalid = nextMessage((message) => message.type === "error");
    socket.send(JSON.stringify({ type: "unknown" }));
    assert.equal((await invalid).error.code, "INVALID_MESSAGE");

    const pong = nextMessage((message) => message.type === "pong");
    socket.send(JSON.stringify({ type: "ping" }));
    assert.ok((await pong).timestamp);

    const subscribed = nextMessage((message) => message.type === "subscribed");
    socket.send(JSON.stringify({ type: "subscribe", taskId: task.id, after: 0 }));
    assert.equal((await subscribed).taskId, task.id);

    const done = nextMessage((message) => message.type === "done" && message.taskId === task.id);
    await jsonRequest(handle.url, `/api/v1/tasks/${task.id}/cancel`, { method: "POST" });
    assert.equal((await done).data.status, "cancelled");
  } finally {
    socket?.close();
    await handle.close();
  }
});

test("CORS preflight and JSON body limits are enforced", async () => {
  const trustedOrigin = "https://trusted.example";
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    corsOrigins: [trustedOrigin],
    bodyLimit: "128b",
    runner: new FakeRunner(),
  });
  try {
    const preflight = await fetch(`${handle.url}/api/v1/models`, {
      method: "OPTIONS",
      headers: {
        origin: trustedOrigin,
        "access-control-request-method": "GET",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), trustedOrigin);
    assert.equal((await fetch(`${handle.url}/api/v1/models`, {
      headers: { origin: "https://evil.example" },
    })).status, 403);

    const oversized = await fetch(`${handle.url}/api/v1/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "x".repeat(1_000), projectless: true }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, "REQUEST_TOO_LARGE");
  } finally {
    await handle.close();
  }
});

test("nested external token resolvers authenticate scoped API users", async () => {
  const token = "external-token-for-test";
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    auth: {
      mode: "token",
      resolveToken: async (candidate) => candidate === token
        ? { sub: "external-viewer", role: "viewer" }
        : null,
    },
    allowedProjectRoots: [PROJECT_ROOT],
    runner: new FakeRunner(),
  });
  try {
    const headers = { authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${handle.url}/api/v1/models`, { headers })).status, 200);
    assert.equal((await fetch(`${handle.url}/api/v1/projects`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ path: PROJECT_ROOT }),
    })).status, 403);
  } finally {
    await handle.close();
  }
});

test("token registries assign distinct fallback owners", async () => {
  const auth = createAuth({
    mode: "token",
    tokens: new Map([
      ["first-token", { role: "operator" }],
      ["second-token", { role: "operator" }],
    ]),
  });
  const first = await auth.resolveAuthorization("Bearer first-token", {});
  const second = await auth.resolveAuthorization("Bearer second-token", {});
  assert.notEqual(first.sub, second.sub);
});

test("projects are owner-isolated and revalidated after a junction or symlink replacement", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-projects-"));
  const original = path.join(root, "original");
  const replacement = path.join(root, "replacement");
  await mkdir(original);
  await mkdir(replacement);
  try {
    const registry = new ProjectRegistry({ allowedRoots: [root] });
    const project = registry.register({ path: original }, { ownerId: "owner-a" });
    assert.throws(() => registry.get(project.id, { ownerId: "owner-b" }), /Project not found/);
    assert.equal(registry.list({ ownerId: "owner-b" }).length, 0);

    await rm(original, { recursive: true });
    try {
      await symlink(replacement, original, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (error?.code === "EPERM") {
        t.skip("Creating a junction/symlink is not permitted in this environment");
        return;
      }
      throw error;
    }
    assert.throws(
      () => registry.revalidate(project.id, { ownerId: "owner-a" }),
      /different location/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("task queue and SSE connections have hard limits", async () => {
  const runner = new FakeRunner({ complete: false });
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    allowedProjectRoots: [PROJECT_ROOT],
    maxQueuedTasks: 1,
    maxSseConnections: 1,
    runner,
  });
  const streamAbort = new AbortController();
  try {
    const { payload: project } = await jsonRequest(handle.url, "/api/v1/projects", {
      method: "POST",
      body: { path: PROJECT_ROOT },
    });
    const { payload: task } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: { prompt: "等待取消", projectId: project.id, approvalPolicy: "untrusted" },
    });
    const { response: rejected } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      body: { prompt: "队列应拒绝", projectId: project.id, approvalPolicy: "untrusted" },
    });
    assert.equal(rejected.status, 429);

    const firstStream = await fetch(`${handle.url}/api/v1/tasks/${task.id}/events`, { signal: streamAbort.signal });
    assert.equal(firstStream.status, 200);
    const secondStream = await fetch(`${handle.url}/api/v1/tasks/${task.id}/events`);
    assert.equal(secondStream.status, 429);
    streamAbort.abort();

    const { response: cancelled } = await jsonRequest(handle.url, `/api/v1/tasks/${task.id}/cancel`, { method: "POST" });
    assert.equal(cancelled.status, 202);
  } finally {
    streamAbort.abort();
    await handle.close();
  }
});

test("SDK worker maps API key, speed, environment policy, and approval defaults", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-secret";
  let codexOptions;
  let threadOptions;
  let runInput;
  class MockCodex {
    constructor(options) {
      codexOptions = options;
    }
    startThread(options) {
      threadOptions = options;
      return {
        id: "thread_mock",
        async runStreamed(input) {
          runInput = input;
          return {
            events: (async function* events() {
              yield { type: "thread.started", thread_id: "thread_mock" };
              yield { type: "item.completed", item: { id: "m", type: "agent_message", text: "ok" } };
              yield {
                type: "turn.completed",
                usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
              };
            })(),
          };
        },
      };
    }
  }
  try {
    const result = await executeCodexTask({
      prompt: "test",
      projectPath: PROJECT_ROOT,
      model: "gpt-5.6-sol",
      effort: "ultra",
      speed: "fast",
      permission: "workspace-write",
      approvalPolicy: "untrusted",
      skipGitRepoCheck: true,
      imagePaths: [path.join(PROJECT_ROOT, "attached.png")],
    }, {
      loadSdk: async () => ({ Codex: MockCodex }),
      packagedRuntime: { executablePath: "C:\\packaged\\codex.exe", pathDirectory: null },
    });
    assert.equal(result.content, "ok");
    assert.equal(codexOptions.apiKey, "sk-test-not-a-real-secret");
    assert.equal(codexOptions.config.service_tier, "fast");
    assert.equal(codexOptions.codexPathOverride, "C:\\packaged\\codex.exe");
    assert.ok(codexOptions.config.shell_environment_policy.exclude.includes("OPENAI_API_KEY"));
    assert.equal(threadOptions.model, "gpt-5.6-sol");
    assert.equal(threadOptions.modelReasoningEffort, "xhigh");
    assert.equal(threadOptions.approvalPolicy, "untrusted");
    assert.deepEqual(runInput, [
      { type: "text", text: "test" },
      { type: "local_image", path: path.join(PROJECT_ROOT, "attached.png") },
    ]);
    assert.equal(normalizeApprovalPolicy(undefined, "workspace-write"), "untrusted");
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("SDK worker forwards every catalog model ID unchanged to startThread", async () => {
  const seen = [];
  class ModelCaptureCodex {
    startThread(options) {
      seen.push(options);
      return {
        id: `thread_${seen.length}`,
        async runStreamed() {
          return {
            events: (async function* events() {
              yield { type: "thread.started", thread_id: `thread_${seen.length}` };
              yield { type: "item.completed", item: { id: "m", type: "agent_message", text: "ok" } };
              yield {
                type: "turn.completed",
                usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
              };
            })(),
          };
        },
      };
    }
  }

  for (const model of MODELS) {
    await executeCodexTask({
      prompt: `verify ${model.id}`,
      projectPath: PROJECT_ROOT,
      model: model.id,
      effort: "medium",
      speed: "standard",
      permission: "read-only",
      approvalPolicy: "never",
      skipGitRepoCheck: true,
    }, {
      loadSdk: async () => ({ Codex: ModelCaptureCodex }),
      packagedRuntime: { executablePath: "C:\\packaged\\codex.exe", pathDirectory: null },
    });
  }

  assert.deepEqual(seen.map((options) => options.model), MODELS.map((model) => model.id));
});

test("packaged Codex runtime resolves from app.asar.unpacked", async () => {
  const resources = await mkdtemp(path.join(os.tmpdir(), "codex-control-resources-"));
  const runtimeRoot = path.join(
    resources,
    "app.asar.unpacked",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
  );
  try {
    await mkdir(path.join(runtimeRoot, "bin"), { recursive: true });
    await mkdir(path.join(runtimeRoot, "codex-path"));
    await writeFile(path.join(runtimeRoot, "bin", "codex.exe"), "test executable placeholder");
    const runtime = resolvePackagedCodexRuntime(resources, "win32", "x64");
    assert.equal(runtime.executablePath, path.join(runtimeRoot, "bin", "codex.exe"));
    assert.equal(runtime.pathDirectory, path.join(runtimeRoot, "codex-path"));
  } finally {
    await rm(resources, { recursive: true, force: true });
  }
});

test("cancelling a runner before worker readiness never starts the task", async () => {
  class DeferredChild extends EventEmitter {
    constructor() {
      super();
      this.connected = true;
      this.stdout = new PassThrough();
      this.stderr = new PassThrough();
      this.sent = [];
    }

    send(message, callback) {
      this.sent.push(message);
      callback?.();
    }
  }

  const child = new DeferredChild();
  const runner = new CodexRunner({
    workerPath: "fake-worker.js",
    forkImpl: () => child,
    timeoutMs: 0,
    killGraceMs: 25,
    env: {},
  });
  const execution = runner.run({ projectPath: PROJECT_ROOT });
  const rejected = assert.rejects(execution.promise, (error) => error.code === "TASK_CANCELLED");
  assert.equal(execution.cancel("user"), true);
  child.emit("message", { type: "ready" });
  assert.equal(child.sent.some((message) => message.type === "start"), false);
  child.emit("close", null, "SIGKILL");
  await rejected;
  await runner.close();
});

test("runner timeout sends cancellation to the worker and rejects with TASK_TIMEOUT", async () => {
  class TimeoutChild extends EventEmitter {
    constructor() {
      super();
      this.connected = true;
      this.stdout = new PassThrough();
      this.stderr = new PassThrough();
      this.sent = [];
    }

    send(message, callback) {
      this.sent.push(message);
      callback?.();
    }
  }

  const child = new TimeoutChild();
  const runner = new CodexRunner({
    workerPath: "fake-worker.js",
    forkImpl: () => child,
    timeoutMs: 20,
    killGraceMs: 1_000,
    env: {},
  });
  const execution = runner.run({ projectPath: PROJECT_ROOT });
  const rejected = assert.rejects(execution.promise, (error) => error.code === "TASK_TIMEOUT");
  child.emit("message", { type: "ready" });
  for (let attempt = 0; attempt < 40 && !child.sent.some((message) => message.type === "cancel"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(child.sent.some((message) => message.type === "start"), true);
  assert.equal(child.sent.some((message) => message.type === "cancel" && message.reason === "timeout"), true);
  child.emit("message", { type: "cancelled" });
  child.connected = false;
  child.emit("close", 0, null);
  await rejected;
  await runner.close();
});

test("TaskManager rejects interactive approval policies", async () => {
  const registry = new ProjectRegistry({ allowedRoots: [PROJECT_ROOT] });
  const project = registry.register({ path: PROJECT_ROOT }, { ownerId: "owner-a" });
  const runner = new FakeRunner({ complete: false });
  const manager = new TaskManager({ runner, projects: registry, maxQueued: 2, requireExplicitProject: true });
  try {
    assert.throws(() => manager.create({
      prompt: "test",
      projectId: project.id,
      approvalPolicy: "on-request",
    }, { ownerId: "owner-a" }), (error) => error.code === "INTERACTIVE_APPROVAL_UNSUPPORTED");
  } finally {
    await manager.close();
  }
});

test("an authorized admin task revalidates another owner's project before execution", async () => {
  const registry = new ProjectRegistry({ allowedRoots: [PROJECT_ROOT] });
  const project = registry.register({ path: PROJECT_ROOT }, { ownerId: "project-owner" });
  const runner = new FakeRunner();
  const manager = new TaskManager({ runner, projects: registry, maxQueued: 2, requireExplicitProject: true });
  try {
    const created = manager.create({
      prompt: "admin task",
      projectId: project.id,
      approvalPolicy: "untrusted",
    }, { ownerId: "admin-user", allowAllProjects: true });
    for (let attempt = 0; attempt < 40 && manager.get(created.id).status !== "completed"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(manager.get(created.id).status, "completed");
  } finally {
    await manager.close();
  }
});

test("preflight failures obey the task history limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-prune-"));
  const projectPath = path.join(root, "project");
  await mkdir(projectPath);
  const registry = new ProjectRegistry({ allowedRoots: [root] });
  const project = registry.register({ path: projectPath }, { ownerId: "owner-a" });
  const manager = new TaskManager({
    runner: new FakeRunner(),
    projects: registry,
    maxConcurrent: 1,
    maxQueued: 100,
    historyLimit: 10,
    requireExplicitProject: true,
  });
  try {
    await rm(projectPath, { recursive: true, force: true });
    for (let index = 0; index < 25; index += 1) {
      manager.create({
        prompt: `preflight failure ${index}`,
        projectId: project.id,
        approvalPolicy: "untrusted",
      }, { ownerId: "owner-a" });
    }
    assert.equal(manager.tasks.size, 10);
    assert.equal([...manager.tasks.values()].every((task) => task.status === "failed"), true);
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid JSON is reported as a client error", async () => {
  const handle = await startServer({ mode: "desktop", port: 0, runner: new FakeRunner() });
  try {
    const response = await fetch(`${handle.url}/api/v1/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_JSON");
  } finally {
    await handle.close();
  }
});

test("Electron desktop sessions protect the internal API while generated keys use the external API", async () => {
  const desktopSessionToken = "desktop-session-" + "s".repeat(32);
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    desktopSessionToken,
    runner: new FakeRunner(),
  });
  try {
    assert.equal((await fetch(`${handle.url}/health`)).status, 200);
    assert.equal((await fetch(`${handle.url}/api/v1/models`)).status, 401);
    assert.equal((await fetch(`${handle.url}/api/v1/models`, {
      headers: { cookie: "codex_desktop_session=wrong" },
    })).status, 401);

    const sessionHeaders = { cookie: `codex_desktop_session=${desktopSessionToken}` };
    assert.equal((await fetch(`${handle.url}/api/v1/models`, { headers: sessionHeaders })).status, 200);
    const { response: createResponse, payload: createdKey } = await jsonRequest(handle.url, "/api/v1/api-keys", {
      method: "POST",
      headers: sessionHeaders,
      body: { model: "gpt-5.6-sol", effort: "high", speed: "standard", permission: "read-only" },
    });
    assert.equal(createResponse.status, 201);
    assert.equal((await fetch(`${handle.url}/api/v1/external/profile`, {
      headers: { authorization: `Bearer ${createdKey.key}` },
    })).status, 200);
  } finally {
    await handle.close();
  }
});

test("gateway Host can be disabled, disconnects API clients, and persists without revoking keys", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-gateway-host-"));
  const storePath = path.join(root, "gateway-api-keys.json");
  const runner = new FakeRunner({ complete: false });
  let handle = await startServer({
    mode: "desktop",
    port: 0,
    apiKeyStorePath: storePath,
    runner,
  });
  let createdKey;
  try {
    const initial = await jsonRequest(handle.url, "/api/v1/gateway");
    assert.equal(initial.response.status, 200);
    assert.equal(initial.payload.enabled, true);

    ({ payload: createdKey } = await jsonRequest(handle.url, "/api/v1/api-keys", {
      method: "POST",
      body: {
        model: "gpt-5.6-sol",
        effort: "high",
        speed: "standard",
        permission: "read-only",
      },
    }));
    const headers = { authorization: `Bearer ${createdKey.key}` };
    const { payload: task } = await jsonRequest(handle.url, "/api/v1/external/tasks", {
      method: "POST",
      headers,
      body: { prompt: "Stay active until the Host is closed", projectless: true },
    });
    assert.equal(handle.taskManager.get(task.id).status, "running");

    const socket = new WebSocket(handle.url.replace(/^http/, "ws") + "/ws", { headers });
    await once(socket, "open");
    const closed = once(socket, "close");
    const disabled = await jsonRequest(handle.url, "/api/v1/gateway", {
      method: "POST",
      body: { enabled: false },
    });
    assert.equal(disabled.response.status, 200);
    assert.equal(disabled.payload.enabled, false);
    assert.equal(disabled.payload.cancelledTasks, 1);
    assert.equal(disabled.payload.closedConnections, 1);
    const [closeCode] = await closed;
    assert.equal(closeCode, 4004);

    for (let attempt = 0; attempt < 40 && handle.taskManager.get(task.id).status !== "cancelled"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(handle.taskManager.get(task.id).status, "cancelled");
    const rejected = await jsonRequest(handle.url, "/api/v1/external/profile", { headers });
    assert.equal(rejected.response.status, 503);
    assert.equal(rejected.payload.error.code, "GATEWAY_DISABLED");
    const keysWhileDisabled = await jsonRequest(handle.url, "/api/v1/api-keys");
    assert.equal(keysWhileDisabled.payload.apiKeys[0].active, true);
    assert.doesNotMatch(await readFile(storePath, "utf8"), new RegExp(createdKey.key));
    assert.match(await readFile(storePath, "utf8"), /"enabled": false/);
  } finally {
    await handle.close();
  }

  handle = await startServer({
    mode: "desktop",
    port: 0,
    apiKeyStorePath: storePath,
    runner: new FakeRunner(),
  });
  try {
    const persisted = await jsonRequest(handle.url, "/api/v1/gateway");
    assert.equal(persisted.payload.enabled, false);
    const enabled = await jsonRequest(handle.url, "/api/v1/gateway", {
      method: "POST",
      body: { enabled: true },
    });
    assert.equal(enabled.response.status, 200);
    assert.equal(enabled.payload.enabled, true);
    assert.equal((await fetch(`${handle.url}/api/v1/external/profile`, {
      headers: { authorization: `Bearer ${createdKey.key}` },
    })).status, 200);
  } finally {
    await handle.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("gateway API keys persist as hashes plus encrypted secrets, lock presets, and delete permanently", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-api-keys-"));
  const storePath = path.join(root, "gateway-api-keys.json");
  const secretProtector = createAesSecretProtector("test-only-api-key-encryption-key-with-at-least-32-characters");
  const runner = new FakeRunner();
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    apiKeyStorePath: storePath,
    apiKeySecretProtector: secretProtector,
    allowedProjectRoots: [PROJECT_ROOT],
    runner,
  });
  try {
    const { response: projectResponse, payload: project } = await jsonRequest(handle.url, "/api/v1/projects", {
      method: "POST",
      body: { name: "Gateway project", path: PROJECT_ROOT },
    });
    assert.equal(projectResponse.status, 201);

    const { response: keyResponse, payload: createdKey } = await jsonRequest(handle.url, "/api/v1/api-keys", {
      method: "POST",
      body: {
        name: "Read-only automation",
        model: "gpt-5.6-sol",
        effort: "ultra",
        speed: "fast",
        permission: "read-only",
      },
    });
    assert.equal(keyResponse.status, 201);
    assert.match(createdKey.key, /^ccc_live_[A-Za-z0-9_-]{40,64}$/);
    assert.equal(redactSecrets(`token=${createdKey.key}`), "token=[REDACTED]");
    assert.equal(createdKey.preset.effort, "xhigh");
    assert.equal(createdKey.preset.permission, "read-only");
    const firstHeaders = { authorization: `Bearer ${createdKey.key}` };

    const { response: secondResponse, payload: secondKey } = await jsonRequest(handle.url, "/api/v1/api-keys", {
      method: "POST",
      body: {
        name: "Second automation",
        model: "gpt-5.4",
        effort: "medium",
        speed: "standard",
        permission: "workspace-write",
      },
    });
    assert.equal(secondResponse.status, 201);
    const secondHeaders = { authorization: `Bearer ${secondKey.key}` };

    const stored = await readFile(storePath, "utf8");
    assert.doesNotMatch(stored, new RegExp(createdKey.key));
    assert.doesNotMatch(stored, new RegExp(secondKey.key));
    assert.match(stored, /"keyHash": "[a-f0-9]{64}"/);
    assert.match(stored, /"encryptedKey": "aes-256-gcm-v1\./);

    const { response: listResponse, payload: listed } = await jsonRequest(handle.url, "/api/v1/api-keys");
    assert.equal(listResponse.status, 200);
    assert.equal(listed.apiKeys.length, 2);
    assert.equal("key" in listed.apiKeys[0], false);
    assert.equal(listed.apiKeys.every((key) => key.revealable), true);
    assert.doesNotMatch(JSON.stringify(listed), /keyHash/);
    assert.doesNotMatch(JSON.stringify(listed), /encryptedKey/);

    const { response: revealResponse, payload: revealed } = await jsonRequest(
      handle.url,
      `/api/v1/api-keys/${encodeURIComponent(createdKey.id)}/secret`,
    );
    assert.equal(revealResponse.status, 200);
    assert.equal(revealed.key, createdKey.key);
    assert.equal((await fetch(`${handle.url}/api/v1/api-keys/${encodeURIComponent(createdKey.id)}/secret`, {
      headers: firstHeaders,
    })).status, 403);

    assert.equal((await fetch(`${handle.url}/api/v1/external/profile`)).status, 401);
    assert.equal((await fetch(`${handle.url}/api/v1/models`, {
      headers: { authorization: `Bearer ccc_live_${"invalid_".repeat(5)}invalid` },
    })).status, 401);

    const { response: profileResponse, payload: profile } = await jsonRequest(
      handle.url,
      "/api/v1/external/profile",
      { headers: firstHeaders },
    );
    assert.equal(profileResponse.status, 200);
    assert.equal(profile.preset.model, "gpt-5.6-sol");
    assert.equal(profile.preset.effort, "xhigh");
    assert.ok(profile.projects.some((candidate) => candidate.id === project.id));

    const { response: taskResponse, payload: task } = await jsonRequest(handle.url, "/api/v1/external/tasks", {
      method: "POST",
      headers: firstHeaders,
      body: {
        prompt: "Run with the key preset",
        projectId: project.id,
      },
    });
    assert.equal(taskResponse.status, 202);
    assert.equal(task.model, "gpt-5.6-sol");
    assert.equal(task.effort, "xhigh");
    assert.equal(task.speed, "fast");
    assert.equal(task.permission, "read-only");
    assert.equal(task.credentialId, createdKey.id);
    const completed = await waitForExternalTask(handle.url, task.id, firstHeaders);
    assert.equal(completed.status, "completed");
    assert.equal(runner.lastTask.model, "gpt-5.6-sol");
    assert.equal(runner.lastTask.effort, "xhigh");
    assert.equal(runner.lastTask.permission, "read-only");
    const usageBeforeDelete = await jsonRequest(handle.url, "/api/v1/usage");
    assert.equal(
      usageBeforeDelete.payload.credentials.some((entry) => entry.credentialId === createdKey.id),
      true,
    );

    const { response: conflictResponse, payload: conflictPayload } = await jsonRequest(
      handle.url,
      "/api/v1/external/tasks",
      {
        method: "POST",
        headers: firstHeaders,
        body: { prompt: "Try another model", projectless: true, model: "gpt-5.4" },
      },
    );
    assert.equal(conflictResponse.status, 409);
    assert.equal(conflictPayload.error.code, "API_KEY_PRESET_CONFLICT");

    const { response: approvalConflict, payload: approvalPayload } = await jsonRequest(
      handle.url,
      "/api/v1/external/tasks",
      {
        method: "POST",
        headers: firstHeaders,
        body: { prompt: "Try another approval policy", projectless: true, approvalPolicy: "untrusted" },
      },
    );
    assert.equal(approvalConflict.status, 409);
    assert.deepEqual(approvalPayload.error.details.fields, ["approvalPolicy"]);

    const { response: networkResponse } = await jsonRequest(handle.url, "/api/v1/external/tasks", {
      method: "POST",
      headers: firstHeaders,
      body: { prompt: "Try network", projectless: true, networkAccessEnabled: true },
    });
    assert.equal(networkResponse.status, 403);
    assert.equal((await fetch(`${handle.url}/api/v1/external/tasks/${task.id}`, {
      headers: secondHeaders,
    })).status, 404);
    assert.equal((await fetch(`${handle.url}/api/v1/api-keys`, { headers: firstHeaders })).status, 403);
    assert.equal((await fetch(`${handle.url}/api/v1/projects`, {
      method: "POST",
      headers: { ...firstHeaders, "content-type": "application/json" },
      body: JSON.stringify({ path: PROJECT_ROOT }),
    })).status, 403);
    assert.equal((await fetch(`${handle.url}/api/v1/projects/select`, {
      method: "POST",
      headers: { ...firstHeaders, "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id }),
    })).status, 403);

    const restartedBeforeDelete = new ApiKeyStore({ filePath: storePath, secretProtector });
    assert.equal(restartedBeforeDelete.resolve(createdKey.key)?.credentialId, createdKey.id);
    assert.equal(restartedBeforeDelete.reveal(createdKey.id).key, createdKey.key);

    const { response: deleteResponse, payload: deleted } = await jsonRequest(
      handle.url,
      `/api/v1/api-keys/${encodeURIComponent(createdKey.id)}`,
      { method: "DELETE" },
    );
    assert.equal(deleteResponse.status, 200);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.active, false);
    assert.equal((await fetch(`${handle.url}/api/v1/external/profile`, { headers: firstHeaders })).status, 401);
    assert.equal(restartedBeforeDelete.resolve(createdKey.key), null);
    assert.throws(() => restartedBeforeDelete.reveal(createdKey.id), (error) => error?.status === 404);

    const listedAfterDelete = await jsonRequest(handle.url, "/api/v1/api-keys");
    assert.deepEqual(listedAfterDelete.payload.apiKeys.map((key) => key.id), [secondKey.id]);
    const storedAfterDelete = JSON.parse(await readFile(storePath, "utf8"));
    assert.deepEqual(storedAfterDelete.keys.map((key) => key.id), [secondKey.id]);
    const usageAfterDelete = await jsonRequest(handle.url, "/api/v1/usage");
    assert.equal(
      usageAfterDelete.payload.credentials.some((entry) => entry.credentialId === createdKey.id),
      false,
    );
    assert.equal(usageAfterDelete.payload.totalTokens, usageBeforeDelete.payload.totalTokens);

    const restartedAfterDelete = new ApiKeyStore({ filePath: storePath, secretProtector });
    assert.equal(restartedAfterDelete.resolve(createdKey.key), null);
    assert.equal(restartedAfterDelete.resolve(secondKey.key)?.credentialId, secondKey.id);
  } finally {
    await handle.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy revoked key records are purged when the server starts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-key-migration-"));
  const storePath = path.join(root, "gateway-api-keys.json");
  try {
    const store = new ApiKeyStore({ filePath: storePath });
    const legacy = store.create({
      name: "legacy revoked",
      model: "gpt-5.6-sol",
      effort: "low",
      speed: "standard",
      permission: "read-only",
    });
    const active = store.create({
      name: "still active",
      model: "gpt-5.6-terra",
      effort: "medium",
      speed: "standard",
      permission: "read-only",
    });
    const document = JSON.parse(await readFile(storePath, "utf8"));
    document.keys.find((record) => record.id === legacy.id).revokedAt = new Date().toISOString();
    await writeFile(storePath, `${JSON.stringify(document, null, 2)}\n`);

    const handle = await startServer({ mode: "desktop", port: 0, apiKeyStorePath: storePath });
    try {
      const listed = await jsonRequest(handle.url, "/api/v1/api-keys");
      assert.deepEqual(listed.payload.apiKeys.map((key) => key.id), [active.id]);
      const persisted = JSON.parse(await readFile(storePath, "utf8"));
      assert.deepEqual(persisted.keys.map((record) => record.id), [active.id]);
    } finally {
      await handle.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("different model API keys remain distinct through Gateway execution and usage statistics", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-multi-model-keys-"));
  const runner = new ModelRecordingRunner();
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    apiKeyStorePath: path.join(root, "gateway-api-keys.json"),
    usageStorePath: path.join(root, "usage-stats.json"),
    runner,
  });
  const efforts = ["low", "medium", "high", "xhigh"];
  const speeds = ["standard", "fast"];
  const created = [];

  try {
    for (const [index, model] of MODELS.entries()) {
      const effort = efforts[index % efforts.length];
      const speed = speeds[index % speeds.length];
      const { response: keyResponse, payload: key } = await jsonRequest(handle.url, "/api/v1/api-keys", {
        method: "POST",
        body: {
          name: `${model.label} integration key`,
          model: model.id,
          effort,
          speed,
          permission: "read-only",
        },
      });
      assert.equal(keyResponse.status, 201);
      assert.equal(key.preset.model, model.id);
      assert.equal(key.preset.modelLabel, model.label);
      assert.equal(key.preset.effort, effort);
      assert.equal(key.preset.speed, speed);
      created.push({ key, model, effort, speed });
    }

    for (const [index, entry] of created.entries()) {
      const headers = { authorization: `Bearer ${entry.key.key}` };
      const { response: profileResponse, payload: profile } = await jsonRequest(
        handle.url,
        "/api/v1/external/profile",
        { headers },
      );
      assert.equal(profileResponse.status, 200);
      assert.equal(profile.preset.model, entry.model.id);
      assert.equal(profile.preset.modelLabel, entry.model.label);

      const { response: taskResponse, payload: task } = await jsonRequest(
        handle.url,
        "/api/v1/external/tasks",
        {
          method: "POST",
          headers,
          body: { prompt: `Run ${entry.model.label}`, projectless: true },
        },
      );
      assert.equal(taskResponse.status, 202);
      assert.equal(task.model, entry.model.id);
      assert.equal(task.modelLabel, entry.model.label);
      assert.equal(task.effort, entry.effort);
      assert.equal(task.speed, entry.speed);
      assert.equal(task.credentialId, entry.key.id);

      const completed = await waitForExternalTask(handle.url, task.id, headers);
      assert.equal(completed.status, "completed");
      assert.equal(completed.model, entry.model.id);
      assert.equal(completed.modelLabel, entry.model.label);
      assert.equal(completed.result.content, `completed with ${entry.model.id}`);

      const runnerCall = runner.calls[index];
      assert.equal(runnerCall.model, entry.model.id);
      assert.equal(runnerCall.effort, entry.effort);
      assert.equal(runnerCall.speed, entry.speed);
    }

    assert.deepEqual(runner.calls.map((task) => task.model), MODELS.map((model) => model.id));

    const { response: usageResponse, payload: usage } = await jsonRequest(handle.url, "/api/v1/usage");
    assert.equal(usageResponse.status, 200);
    assert.equal(usage.taskCount, MODELS.length);
    assert.equal(usage.completedCount, MODELS.length);
    assert.equal(usage.tasksWithUsage, MODELS.length);
    assert.equal(usage.models.length, MODELS.length);
    assert.equal(usage.credentials.length, MODELS.length);

    const modelsByName = new Map(usage.models.map((record) => [record.model, record]));
    const credentialsById = new Map(usage.credentials.map((record) => [record.credentialId, record]));
    for (const [index, entry] of created.entries()) {
      const expectedTokens = (100 + index) + (20 + index);
      assert.equal(modelsByName.get(entry.model.label)?.tasks, 1);
      assert.equal(modelsByName.get(entry.model.label)?.totalTokens, expectedTokens);
      assert.equal(credentialsById.get(entry.key.id)?.tasks, 1);
      assert.equal(credentialsById.get(entry.key.id)?.totalTokens, expectedTokens);
    }

    const storedKeys = JSON.parse(await readFile(path.join(root, "gateway-api-keys.json"), "utf8"));
    assert.deepEqual(
      storedKeys.keys.map((record) => record.preset.model),
      MODELS.map((model) => model.id),
    );
    for (const entry of created) {
      assert.doesNotMatch(JSON.stringify(storedKeys), new RegExp(entry.key.key));
    }
  } finally {
    await handle.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("gateway API key deletion frees capacity and does not leave a history record", () => {
  const store = new ApiKeyStore();
  const input = {
    model: "gpt-5.6-sol",
    effort: "low",
    speed: "standard",
    permission: "read-only",
  };
  const keys = Array.from({ length: 100 }, (_, index) => store.create({
    ...input,
    name: `limit test ${index}`,
  }));
  assert.equal(store.list().length, 100);
  assert.throws(
    () => store.create({ ...input, name: "one too many" }),
    (error) => error?.code === "API_KEY_LIMIT_REACHED",
  );
  const deleted = store.remove(keys[0].id);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.active, false);
  assert.equal(store.list().some((key) => key.id === keys[0].id), false);
  assert.throws(() => store.remove(keys[0].id), (error) => error?.status === 404);
  assert.doesNotThrow(() => store.create({ ...input, name: "replacement" }));
});

test("deleting a gateway key cancels its active tasks and closes authenticated WebSockets", async () => {
  const runner = new FakeRunner({ complete: false });
  const handle = await startServer({ mode: "desktop", port: 0, runner });
  try {
    const { payload: createdKey } = await jsonRequest(handle.url, "/api/v1/api-keys", {
      method: "POST",
      body: {
        model: "gpt-5.6-sol",
        effort: "high",
        speed: "standard",
        permission: "read-only",
      },
    });
    const headers = { authorization: `Bearer ${createdKey.key}` };
    const { response: taskResponse, payload: task } = await jsonRequest(handle.url, "/api/v1/external/tasks", {
      method: "POST",
      headers,
      body: { prompt: "Stay active until deleted", projectless: true },
    });
    assert.equal(taskResponse.status, 202);
    assert.equal(handle.taskManager.get(task.id).status, "running");

    const socket = new WebSocket(handle.url.replace(/^http/, "ws") + "/ws", { headers });
    await once(socket, "open");
    const closed = once(socket, "close");
    const { response: deleteResponse, payload: deleted } = await jsonRequest(
      handle.url,
      `/api/v1/api-keys/${encodeURIComponent(createdKey.id)}`,
      { method: "DELETE" },
    );
    assert.equal(deleteResponse.status, 200);
    assert.equal(deleted.cancelledTasks, 1);
    assert.equal(deleted.closedConnections, 1);
    const [closeCode] = await closed;
    assert.equal(closeCode, 4003);

    for (let attempt = 0; attempt < 40 && handle.taskManager.get(task.id).status !== "cancelled"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(handle.taskManager.get(task.id).status, "cancelled");
  } finally {
    await handle.close();
  }
});

test("token-limited gateway keys serialize admission and account each reservation once", () => {
  const store = new ApiKeyStore();
  const key = store.create({
    model: "gpt-5.6-sol",
    effort: "low",
    speed: "standard",
    permission: "read-only",
    tokenLimit: 100,
  });

  const reservation = store.reserveTask(key.id);
  assert.match(reservation, /^reservation_/);
  assert.throws(
    () => store.reserveTask(key.id),
    (error) => error?.code === "API_KEY_TOKEN_LIMIT_BUSY",
  );
  store.recordTokens(key.id, { usage: { input_tokens: 7, output_tokens: 5 } }, reservation);
  store.recordTokens(key.id, { usage: { input_tokens: 7, output_tokens: 5 } }, reservation);
  assert.equal(store.list()[0].tokensUsed, 12, "reservation retry must not double-charge usage");

  const next = store.reserveTask(key.id);
  store.releaseTaskReservation(key.id, next);
  assert.equal(store.list()[0].tokensUsed, 12);
});

test("gateway accounting fails closed and retries pending usage before admitting another task", async () => {
  const store = new ApiKeyStore();
  const key = store.create({
    model: "gpt-5.6-sol",
    effort: "low",
    speed: "standard",
    permission: "read-only",
  });
  const recordTokens = store.recordTokens.bind(store);
  let syntheticFailures = 2;
  store.recordTokens = (...args) => {
    if (syntheticFailures > 0) {
      syntheticFailures -= 1;
      throw new Error("synthetic durable store outage");
    }
    return recordTokens(...args);
  };
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    apiKeyStore: store,
    runner: new FakeRunner(),
    logger: { error() {}, warn() {}, info() {}, debug() {} },
  });
  const headers = { authorization: `Bearer ${key.key}` };
  try {
    const first = await jsonRequest(handle.url, "/api/v1/external/tasks", {
      method: "POST",
      headers,
      body: { prompt: "record this usage", projectless: true },
    });
    assert.equal(first.response.status, 202);
    await waitForExternalTask(handle.url, first.payload.id, headers);

    const unavailable = await jsonRequest(handle.url, "/api/v1/external/tasks", {
      method: "POST",
      headers,
      body: { prompt: "must wait for accounting", projectless: true },
    });
    assert.equal(unavailable.response.status, 503);
    assert.equal(unavailable.payload.error.code, "API_KEY_ACCOUNTING_UNAVAILABLE");

    const recovered = await jsonRequest(handle.url, "/api/v1/external/tasks", {
      method: "POST",
      headers,
      body: { prompt: "accounting recovered", projectless: true },
    });
    assert.equal(recovered.response.status, 202);
    await waitForExternalTask(handle.url, recovered.payload.id, headers);
    assert.equal(store.list()[0].tokensUsed, 24);
  } finally {
    await handle.close();
  }
});

test("one gateway credential cannot monopolize SSE or WebSocket connection capacity", async () => {
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    maxSseConnections: 4,
    runner: new FakeRunner({ complete: false }),
  });
  const sockets = [];
  const readers = [];
  try {
    const createKey = async (name) => (await jsonRequest(handle.url, "/api/v1/api-keys", {
      method: "POST",
      body: { name, model: "gpt-5.6-sol", effort: "low", speed: "standard", permission: "read-only" },
    })).payload;
    const firstKey = await createKey("fairness-a");
    const secondKey = await createKey("fairness-b");
    const firstHeaders = { authorization: `Bearer ${firstKey.key}` };
    const secondHeaders = { authorization: `Bearer ${secondKey.key}` };
    const createTask = async (headers, prompt) => (await jsonRequest(handle.url, "/api/v1/external/tasks", {
      method: "POST",
      headers,
      body: { prompt, projectless: true },
    })).payload;
    const firstTask = await createTask(firstHeaders, "fair stream a");
    const secondTask = await createTask(secondHeaders, "fair stream b");

    const firstStream = await fetch(`${handle.url}/api/v1/external/tasks/${firstTask.id}/events`, { headers: firstHeaders });
    assert.equal(firstStream.status, 200);
    readers.push(firstStream.body.getReader());
    const monopolizedStream = await fetch(`${handle.url}/api/v1/external/tasks/${firstTask.id}/events`, { headers: firstHeaders });
    assert.equal(monopolizedStream.status, 429);
    assert.equal((await monopolizedStream.json()).error.code, "CREDENTIAL_STREAM_LIMIT_REACHED");
    const fairStream = await fetch(`${handle.url}/api/v1/external/tasks/${secondTask.id}/events`, { headers: secondHeaders });
    assert.equal(fairStream.status, 200);
    readers.push(fairStream.body.getReader());

    const firstSocket = new WebSocket(handle.url.replace(/^http/, "ws") + "/ws", { headers: firstHeaders });
    sockets.push(firstSocket);
    await once(firstSocket, "open");
    const rejectedStatus = await new Promise((resolve, reject) => {
      const rejected = new WebSocket(handle.url.replace(/^http/, "ws") + "/ws", { headers: firstHeaders });
      rejected.on("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode);
      });
      rejected.on("open", () => reject(new Error("credential exceeded its WebSocket share")));
      rejected.on("error", () => {});
    });
    assert.equal(rejectedStatus, 429);
    const fairSocket = new WebSocket(handle.url.replace(/^http/, "ws") + "/ws", { headers: secondHeaders });
    sockets.push(fairSocket);
    await once(fairSocket, "open");
  } finally {
    for (const reader of readers) await reader.cancel().catch(() => {});
    for (const socket of sockets) socket.close();
    await handle.close();
  }
});

test("expiring a gateway key permanently deletes it and cancels its active resources", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coding-agent-gateway-key-expiration-"));
  const storePath = path.join(root, "gateway-api-keys.json");
  const runner = new FakeRunner({ complete: false });
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    apiKeyStorePath: storePath,
    apiKeyRevocationPollMs: 10,
    runner,
  });
  let socket;
  try {
    const { payload: createdKey } = await jsonRequest(handle.url, "/api/v1/api-keys", {
      method: "POST",
      body: {
        name: "Short-lived key",
        model: "gpt-5.6-sol",
        effort: "high",
        speed: "standard",
        permission: "read-only",
      },
    });
    const headers = { authorization: `Bearer ${createdKey.key}` };
    const { response: taskResponse, payload: task } = await jsonRequest(handle.url, "/api/v1/external/tasks", {
      method: "POST",
      headers,
      body: { prompt: "Stay active until the key expires", projectless: true },
    });
    assert.equal(taskResponse.status, 202);
    assert.equal(handle.taskManager.get(task.id).status, "running");

    socket = new WebSocket(handle.url.replace(/^http/, "ws") + "/ws", { headers });
    await once(socket, "open");
    const closed = once(socket, "close");
    const expiresAt = new Date(Date.now() + 250).toISOString();
    const updated = await jsonRequest(
      handle.url,
      `/api/v1/api-keys/${encodeURIComponent(createdKey.id)}`,
      { method: "PATCH", body: { expiresAt } },
    );
    assert.equal(updated.response.status, 200);
    assert.equal(updated.payload.expiresAt, expiresAt);

    const [closeCode] = await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Expired key socket stayed open")), 2_000)),
    ]);
    assert.equal(closeCode, 4003);
    for (let attempt = 0; attempt < 80 && handle.taskManager.get(task.id).status !== "cancelled"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(handle.taskManager.get(task.id).status, "cancelled");
    assert.equal((await fetch(`${handle.url}/api/v1/external/profile`, { headers })).status, 401);

    const listed = await jsonRequest(handle.url, "/api/v1/api-keys");
    assert.equal(listed.payload.apiKeys.some((key) => key.id === createdKey.id), false);
    const persisted = JSON.parse(await readFile(storePath, "utf8"));
    assert.equal(persisted.keys.some((key) => key.id === createdKey.id), false);
  } finally {
    socket?.close();
    await handle.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("API key store recovers a crashed stale writer lock without stealing a live lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-api-key-lock-"));
  const storePath = path.join(root, "gateway-api-keys.json");
  const lockPath = `${storePath}.lock`;
  try {
    await mkdir(lockPath);
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleAt, staleAt);
    const store = new ApiKeyStore({ filePath: storePath, lockStaleMs: 5_000 });
    const created = store.create({
      model: "gpt-5.6-sol",
      effort: "high",
      speed: "standard",
      permission: "read-only",
    });
    assert.match(created.key, /^ccc_live_/);
    await assert.rejects(readFile(lockPath), (error) => error?.code === "ENOENT");

    await mkdir(lockPath);
    assert.throws(
      () => store.remove(created.id),
      (error) => error?.code === "API_KEY_STORE_BUSY",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("gateway key deletion propagates to tasks, SSE, and WebSockets in another server instance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-api-key-cluster-"));
  const storePath = path.join(root, "gateway-api-keys.json");
  const first = await startServer({
    mode: "desktop",
    port: 0,
    apiKeyStorePath: storePath,
    apiKeyRevocationPollMs: 20,
    runner: new FakeRunner({ complete: false }),
  });
  const second = await startServer({
    mode: "desktop",
    port: 0,
    apiKeyStorePath: storePath,
    apiKeyRevocationPollMs: 20,
    runner: new FakeRunner({ complete: false }),
  });
  const timeout = (promise, message) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 2_000)),
  ]);
  try {
    const { payload: createdKey } = await jsonRequest(first.url, "/api/v1/api-keys", {
      method: "POST",
      body: {
        model: "gpt-5.6-sol",
        effort: "high",
        speed: "standard",
        permission: "read-only",
      },
    });
    const headers = { authorization: `Bearer ${createdKey.key}` };
    const { payload: task } = await jsonRequest(second.url, "/api/v1/external/tasks", {
      method: "POST",
      headers,
      body: { prompt: "Wait for cross-instance deletion", projectless: true },
    });
    assert.equal(second.taskManager.get(task.id).status, "running");

    const socket = new WebSocket(second.url.replace(/^http/, "ws") + "/ws", { headers });
    await once(socket, "open");
    const socketClosed = once(socket, "close");

    const stream = await fetch(`${second.url}/api/v1/external/tasks/${task.id}/events`, { headers });
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    const streamEnded = (async () => {
      while (!(await reader.read()).done) {
        // Drain the stream until deletion closes it.
      }
    })();

    const { response: deleteResponse } = await jsonRequest(
      first.url,
      `/api/v1/api-keys/${encodeURIComponent(createdKey.id)}`,
      { method: "DELETE" },
    );
    assert.equal(deleteResponse.status, 200);
    const [closeCode] = await timeout(socketClosed, "Remote WebSocket was not closed after deletion");
    assert.equal(closeCode, 4003);
    await timeout(streamEnded, "Remote SSE stream was not closed after deletion");

    for (let attempt = 0; attempt < 100 && second.taskManager.get(task.id).status !== "cancelled"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(second.taskManager.get(task.id).status, "cancelled");
  } finally {
    await Promise.allSettled([first.close(), second.close()]);
    await rm(root, { recursive: true, force: true });
  }
});

test("usage statistics persist beyond 200 tasks and reset generations cleanly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-usage-store-"));
  const storePath = path.join(root, "usage-stats.json");
  try {
    const store = new UsageStore({ filePath: storePath });
    for (let index = 0; index < 205; index += 1) {
      const task = {
        status: "completed",
        modelLabel: index % 2 ? "5.6 Sol" : "5.4",
        credentialId: index % 3 ? "key_automation" : null,
        usage: {
          input_tokens: 10,
          cached_input_tokens: 2,
          output_tokens: 4,
          reasoning_output_tokens: 1,
        },
      };
      const generation = store.recordCreated(task);
      assert.equal(store.recordFinished(task, generation), true);
    }

    const persisted = new UsageStore({ filePath: storePath }).snapshot();
    assert.equal(persisted.taskCount, 205);
    assert.equal(persisted.completedCount, 205);
    assert.equal(persisted.tasksWithUsage, 205);
    assert.equal(persisted.inputTokens, 2_050);
    assert.equal(persisted.outputTokens, 820);
    assert.equal(persisted.totalTokens, 2_870);
    assert.equal(persisted.models.reduce((sum, model) => sum + model.tasks, 0), 205);
    assert.deepEqual(
      Object.fromEntries(persisted.models.map((model) => [model.model, model.tasks])),
      { "5.4": 103, "5.6 Sol": 102 },
    );

    const activeTerra = { model: "gpt-5.6-terra", modelLabel: "5.6 Terra" };
    const activeGeneration = store.recordCreated(activeTerra);
    const withActiveTerra = store.snapshot({ activeCount: 1 });
    const terraUsage = withActiveTerra.models.find((model) => model.model === "5.6 Terra");
    assert.equal(withActiveTerra.taskCount, 206);
    assert.equal(withActiveTerra.activeCount, 1);
    assert.equal(terraUsage.tasks, 1);
    assert.equal(terraUsage.totalTokens, 0);
    assert.equal(store.recordFinished({
      ...activeTerra,
      status: "completed",
      usageModelRecorded: activeTerra.usageModelRecorded,
      usage: { input_tokens: 20, output_tokens: 5 },
    }, activeGeneration), true);
    const completedTerra = store.snapshot().models.find((model) => model.model === "5.6 Terra");
    assert.equal(completedTerra.tasks, 1);
    assert.equal(completedTerra.totalTokens, 25);

    const reopened = new UsageStore({ filePath: storePath });
    const staleTask = { modelLabel: "5.6 Luna" };
    const staleGeneration = reopened.recordCreated(staleTask);
    const reset = reopened.reset();
    assert.equal(reset.taskCount, 0);
    assert.equal(reset.totalTokens, 0);
    assert.equal(reopened.recordFinished({
      status: "completed",
      modelLabel: "5.6 Sol",
      usage: { input_tokens: 999, output_tokens: 999 },
    }, staleGeneration), false);
    assert.equal(reopened.snapshot().totalTokens, 0);

    const currentTask = { status: "failed", modelLabel: "5.6 Sol", usage: null };
    const currentGeneration = reopened.recordCreated(currentTask);
    reopened.recordFinished(currentTask, currentGeneration);
    const afterReset = new UsageStore({ filePath: storePath }).snapshot();
    assert.equal(afterReset.taskCount, 1);
    assert.equal(afterReset.failedCount, 1);
    assert.equal(afterReset.tasksWithUsage, 0);
    assert.equal(afterReset.totalTokens, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("usage API is admin-only, returns cumulative totals, and resets them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-control-usage-api-"));
  const desktopSessionToken = "desktop-usage-session-token";
  const handle = await startServer({
    mode: "desktop",
    port: 0,
    desktopSessionToken,
    usageStorePath: path.join(root, "usage-stats.json"),
    runner: new FakeRunner(),
  });
  const sessionHeaders = { cookie: `codex_desktop_session=${desktopSessionToken}` };
  try {
    const { payload: task } = await jsonRequest(handle.url, "/api/v1/tasks", {
      method: "POST",
      headers: sessionHeaders,
      body: { prompt: "count cumulative usage", projectless: true },
    });
    await waitForTask(handle.url, task.id, sessionHeaders);

    const { response: usageResponse, payload: usage } = await jsonRequest(handle.url, "/api/v1/usage", {
      headers: sessionHeaders,
    });
    assert.equal(usageResponse.status, 200);
    assert.equal(usage.taskCount, 1);
    assert.equal(usage.completedCount, 1);
    assert.equal(usage.inputTokens, 10);
    assert.equal(usage.outputTokens, 2);
    assert.equal(usage.totalTokens, 12);

    const { payload: gatewayKey } = await jsonRequest(handle.url, "/api/v1/api-keys", {
      method: "POST",
      headers: sessionHeaders,
      body: { model: "gpt-5.6-sol", effort: "high", speed: "standard", permission: "read-only" },
    });
    const gatewayHeaders = { authorization: `Bearer ${gatewayKey.key}` };
    assert.equal((await fetch(`${handle.url}/api/v1/usage`, { headers: gatewayHeaders })).status, 403);
    assert.equal((await fetch(`${handle.url}/api/v1/usage/reset`, { method: "POST", headers: gatewayHeaders })).status, 403);

    const { response: resetResponse, payload: reset } = await jsonRequest(handle.url, "/api/v1/usage/reset", {
      method: "POST",
      headers: sessionHeaders,
      body: {},
    });
    assert.equal(resetResponse.status, 200);
    assert.equal(reset.taskCount, 0);
    assert.equal(reset.totalTokens, 0);
    assert.equal(reset.models.length, 0);
  } finally {
    await handle.close();
    await rm(root, { recursive: true, force: true });
  }
});
