import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  normalizeApprovalPolicy,
  normalizeEffort,
  normalizePermission,
  normalizeSpeed,
  sanitizeIpcValue,
} from "../runner/protocol.js";
import { RunnerCancelledError, RunnerTimeoutError } from "../runner/codex-runner.js";
import { badRequest, conflict, notFound, tooManyRequests } from "./errors.js";
import { resolveModel } from "./models.js";
import { ScratchWorkspaceManager } from "./scratch-workspaces.js";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function now() {
  return new Date().toISOString();
}

function normalizeInput(input, projects, context = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw badRequest("INVALID_TASK", "The request body must be an object.");
  }
  if (typeof input.prompt !== "string" || !input.prompt.trim()) {
    throw badRequest("PROMPT_REQUIRED", "prompt must be a non-empty string.");
  }
  if (input.prompt.length > 200_000) {
    throw badRequest("PROMPT_TOO_LARGE", "prompt exceeds the 200,000 character limit.");
  }
  if (input.imageIds !== undefined && !Array.isArray(input.imageIds)) {
    throw badRequest("INVALID_IMAGE_IDS", "imageIds must be an array of uploaded image IDs.");
  }
  if (input.fileIds !== undefined && !Array.isArray(input.fileIds)) {
    throw badRequest("INVALID_FILE_IDS", "fileIds must be an array of uploaded file IDs.");
  }
  if (input.projectless !== undefined && typeof input.projectless !== "boolean") {
    throw badRequest("INVALID_PROJECT_MODE", "projectless must be a boolean.");
  }
  const projectless = input.projectless === true;
  if (projectless && (input.projectId || input.projectPath)) {
    throw badRequest("PROJECT_MODE_CONFLICT", "Do not send a project when projectless is true.");
  }
  if (context.requireExplicitProject && !projectless && !input.projectId && !input.projectPath) {
    throw badRequest("PROJECT_REQUIRED", "Token-authenticated requests must specify projectId or projectPath.");
  }

  try {
    const model = resolveModel(input.model);
    const permission = normalizePermission(input.permission ?? input.sandboxMode ?? "workspace-write");
    const approvalPolicy = normalizeApprovalPolicy(input.approvalPolicy, permission);
    if (approvalPolicy === "on-request" || approvalPolicy === "on-failure") {
      throw badRequest(
        "INTERACTIVE_APPROVAL_UNSUPPORTED",
        "Interactive approvals are unavailable in SDK tasks. Use untrusted to reject approval-requiring operations or never to run within the selected sandbox.",
      );
    }
    return {
      prompt: input.prompt,
      model: model.id,
      modelLabel: model.label,
      effort: normalizeEffort(input.effort ?? "high"),
      speed: normalizeSpeed(input.speed ?? "standard"),
      permission,
      approvalPolicy,
      project: projectless
        ? null
        : projects.resolve(input, {
          ownerId: context.projectOwnerId ?? context.ownerId,
          allowAll: context.allowAllProjects,
        }),
      projectless,
      skipGitRepoCheck: input.skipGitRepoCheck !== false,
      networkAccessEnabled: input.networkAccessEnabled === true,
      fileIds: [...(input.fileIds ?? []), ...(input.imageIds ?? [])],
    };
  } catch (error) {
    if (error?.status) throw error;
    throw badRequest("INVALID_TASK_OPTIONS", error instanceof Error ? error.message : "Task options are invalid.");
  }
}

function itemMessage(event) {
  const item = event.item ?? {};
  const phase = event.type === "item.started" ? "Started" : event.type === "item.completed" ? "Completed" : "Updated";
  const labels = {
    agent_message: "Agent response",
    command_execution: "Command",
    file_change: "File change",
    mcp_tool_call: "Tool call",
    web_search: "Web search",
    reasoning: "Reasoning",
    error: "Error",
  };
  return `${phase}: ${labels[item.type] ?? String(item.type ?? "work item").replaceAll("_", " ")}`;
}

export class TaskManager {
  constructor(options) {
    this.runner = options.runner;
    this.projects = options.projects;
    this.maxConcurrent = options.maxConcurrent ?? 2;
    this.maxQueued = options.maxQueued ?? 50;
    this.timeoutMs = options.timeoutMs;
    this.historyLimit = options.historyLimit ?? 200;
    this.eventHistoryLimit = options.eventHistoryLimit ?? 2_000;
    this.eventHistoryBytes = options.eventHistoryBytes ?? 2 * 1024 * 1024;
    this.requireExplicitProject = options.requireExplicitProject === true;
    this.scratchWorkspaces = options.scratchWorkspaces ?? new ScratchWorkspaceManager({ root: options.scratchRoot });
    this.attachmentStore = options.attachmentStore ?? options.imageStore ?? null;
    this.usageStore = options.usageStore ?? null;
    this.onTaskFinished = typeof options.onTaskFinished === "function" ? options.onTaskFinished : null;
    this.logger = options.logger ?? console;
    this.tasks = new Map();
    this.queue = [];
    this.active = new Map();
    this.runPromises = new Set();
    this.events = new EventEmitter();
    this.events.setMaxListeners(0);
    this.nextTerminalSequence = 1;
    this.closing = false;
  }

  create(input, context = {}) {
    if (this.closing) throw conflict("SERVER_SHUTTING_DOWN", "The server is shutting down.");
    const ownerId = context.ownerId ?? "local-desktop";
    const outstanding = [...this.tasks.values()].filter((task) => !TERMINAL.has(task.status));
    if (outstanding.length >= this.maxQueued
      || outstanding.filter((task) => task.ownerId === ownerId).length >= this.maxQueued) {
      throw tooManyRequests("TASK_QUEUE_FULL", "The task queue is full. Try again after a running task finishes.");
    }
    const normalized = normalizeInput(input, this.projects, {
      ownerId,
      projectOwnerId: context.projectOwnerId ?? ownerId,
      allowAllProjects: context.allowAllProjects === true,
      requireExplicitProject: context.requireExplicitProject ?? this.requireExplicitProject,
    });
    const workspace = normalized.projectless
      ? this.scratchWorkspaces.create(ownerId)
      : normalized.project;
    let attachments = [];
    try {
      if (normalized.fileIds.length && !this.attachmentStore) {
        throw badRequest("FILE_UPLOADS_UNAVAILABLE", "File uploads are not enabled for this service.");
      }
      attachments = this.attachmentStore?.claim(normalized.fileIds, ownerId) ?? [];
    } catch (error) {
      if (normalized.projectless) this.scratchWorkspaces.release(workspace);
      throw error;
    }
    const createdAt = now();
    const task = {
      id: randomUUID(),
      ownerId,
      credentialId: typeof context.credentialId === "string" ? context.credentialId : null,
      status: "queued",
      prompt: normalized.prompt,
      model: normalized.model,
      modelLabel: normalized.modelLabel,
      effort: normalized.effort,
      speed: normalized.speed,
      permission: normalized.permission,
      sandboxMode: normalized.permission,
      approvalPolicy: normalized.approvalPolicy,
      skipGitRepoCheck: normalized.skipGitRepoCheck,
      networkAccessEnabled: normalized.networkAccessEnabled,
      attachments,
      project: normalized.projectless
        ? workspace
        : this.projects.public(workspace, { ownerId, allowAll: context.allowAllProjects === true }),
      projectless: normalized.projectless,
      createdAt,
      startedAt: null,
      completedAt: null,
      updatedAt: createdAt,
      threadId: null,
      usage: null,
      result: null,
      error: null,
      events: [],
      eventBytes: 0,
      nextEventId: 1,
    };
    task.usageGeneration = this.#recordUsageCreated(task);
    this.tasks.set(task.id, task);
    this.queue.push(task.id);
    this.#emit(task, "status", { status: "queued", message: "Task queued." });
    this.#drain();
    return this.public(task, { includeEvents: false });
  }

  get(id) {
    const task = this.tasks.get(id);
    if (!task) throw notFound("Task not found.");
    return task;
  }

  list(options = {}) {
    const status = options.status;
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
    return [...this.tasks.values()]
      .filter((task) => !options.ownerId || task.ownerId === options.ownerId)
      .filter((task) => !status || task.status === status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((task) => this.public(task, { includeEvents: false, includePrompt: false }));
  }

  cancel(id) {
    const task = this.get(id);
    if (TERMINAL.has(task.status)) throw conflict("TASK_ALREADY_FINISHED", "The task has already finished.");
    if (task.status === "queued") {
      this.#finalizeCancelled(task, "Task cancelled before it started.");
      this.#drain();
      return this.public(task);
    }
    if (task.status === "cancelling") return this.public(task);

    const execution = this.active.get(task.id);
    if (!execution?.cancel("user")) throw conflict("TASK_ALREADY_FINISHING", "The task is already finishing.");
    task.status = "cancelling";
    task.updatedAt = now();
    this.#emit(task, "status", { status: "cancelling", message: "Cancellation requested." });
    return this.public(task);
  }

  cancelByCredential(credentialId) {
    if (typeof credentialId !== "string" || !credentialId) return 0;
    let cancelled = 0;
    for (const task of this.tasks.values()) {
      if (task.credentialId !== credentialId || TERMINAL.has(task.status)) continue;
      try {
        this.cancel(task.id);
        cancelled += 1;
      } catch {
        // A task may finish between the status check and cancellation.
      }
    }
    return cancelled;
  }

  activeCredentialIds() {
    const credentialIds = new Set();
    for (const task of this.tasks.values()) {
      if (task.credentialId && !TERMINAL.has(task.status)) credentialIds.add(task.credentialId);
    }
    return credentialIds;
  }

  activeCountForUsageGeneration(generation) {
    if (!generation) return 0;
    return [...this.tasks.values()]
      .filter((task) => task.usageGeneration === generation && !TERMINAL.has(task.status))
      .length;
  }

  eventsAfter(id, lastEventId = 0) {
    const task = this.get(id);
    return task.events.filter((event) => event.id > lastEventId).map((event) => structuredClone(event));
  }

  subscribe(id, listener) {
    this.get(id);
    const eventName = `task:${id}`;
    this.events.on(eventName, listener);
    return () => this.events.off(eventName, listener);
  }

  onClose(listener) {
    this.events.once("close", listener);
    return () => this.events.off("close", listener);
  }

  public(task, options = {}) {
    const includeEvents = options.includeEvents !== false;
    const includePrompt = options.includePrompt !== false;
    const publicProject = task.projectless
      ? this.scratchWorkspaces.public(task.project)
      : { ...task.project };
    const result = {
      id: task.id,
      status: task.status,
      model: task.model,
      modelLabel: task.modelLabel,
      effort: task.effort,
      speed: task.speed,
      permission: task.permission,
      sandboxMode: task.sandboxMode,
      approvalPolicy: task.approvalPolicy,
      credentialId: task.credentialId,
      project: publicProject,
      projectId: task.projectless ? null : task.project.id,
      projectPath: task.projectless ? null : task.project.path,
      projectless: task.projectless,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      updatedAt: task.updatedAt,
      threadId: task.threadId,
      usage: task.usage ? structuredClone(task.usage) : null,
      result: task.result ? structuredClone(task.result) : null,
      error: task.error ? { ...task.error } : null,
      files: task.attachments.map(({ id, name, mimeType, size, kind, extraction }) => ({
        id,
        name,
        mimeType,
        size,
        kind,
        textExtracted: Boolean(extraction?.available),
        extraction: extraction ? { ...extraction } : { available: false },
      })),
      images: task.attachments
        .filter((attachment) => attachment.kind === "image")
        .map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size })),
    };
    if (includePrompt) result.prompt = task.prompt;
    else result.promptPreview = task.prompt.slice(0, 300);
    if (includeEvents) result.events = task.events.map((event) => structuredClone(event));
    return result;
  }

  #emit(task, type, data) {
    const event = {
      id: task.nextEventId++,
      type,
      taskId: task.id,
      timestamp: now(),
      data: sanitizeIpcValue(data),
    };
    task.events.push(event);
    task.eventBytes += Buffer.byteLength(JSON.stringify(event), "utf8");
    while (task.events.length > this.eventHistoryLimit || task.eventBytes > this.eventHistoryBytes) {
      const removed = task.events.shift();
      if (!removed) break;
      task.eventBytes -= Buffer.byteLength(JSON.stringify(removed), "utf8");
    }
    this.events.emit(`task:${task.id}`, structuredClone(event));
    return event;
  }

  #recordUsageCreated(task) {
    if (!this.usageStore) return null;
    try {
      return this.usageStore.recordCreated(task);
    } catch (error) {
      this.logger.error?.(`[task ${task.id}] usage creation could not be recorded`, error);
      return null;
    }
  }

  #recordUsageFinished(task) {
    if (this.usageStore) {
      try {
        this.usageStore.recordFinished(task, task.usageGeneration);
      } catch (error) {
        this.logger.error?.(`[task ${task.id}] usage completion could not be recorded`, error);
      }
    }
    if (this.onTaskFinished) {
      try {
        this.onTaskFinished(task);
      } catch (error) {
        this.logger.error?.(`[task ${task.id}] credential usage could not be recorded`, error);
      }
    }
  }

  #drain() {
    if (this.closing) return;
    while (this.active.size < this.maxConcurrent && this.queue.length) {
      const id = this.queue.shift();
      const task = this.tasks.get(id);
      if (!task || task.status !== "queued") continue;
      this.#start(task);
    }
  }

  #start(task) {
    try {
      // Access was authorized when the task was created. Revalidation here is
      // strictly a path-integrity check and must also work for admin-created
      // tasks that target another owner's registered project.
      if (task.projectless) this.scratchWorkspaces.revalidate(task.project);
      else this.projects.revalidate(task.project.id, { allowAll: true });
    } catch (error) {
      this.#finalizeFailed(task, {
        code: error?.code ?? "PROJECT_PATH_INVALID",
        message: error?.message ?? "The project path is no longer safe to use.",
      });
      queueMicrotask(() => this.#drain());
      return;
    }
    task.status = "running";
    task.startedAt = now();
    task.updatedAt = task.startedAt;
    this.#emit(task, "status", { status: "running", message: "Codex worker started." });

    let execution;
    try {
      execution = this.runner.run({
        prompt: task.prompt,
        model: task.model,
        effort: task.effort,
        speed: task.speed,
        permission: task.permission,
        sandboxMode: task.sandboxMode,
        approvalPolicy: task.approvalPolicy,
        projectPath: task.project.path,
        skipGitRepoCheck: task.skipGitRepoCheck,
        networkAccessEnabled: task.networkAccessEnabled,
        attachments: task.attachments.map((attachment) => ({
          name: attachment.name,
          kind: attachment.kind,
          path: attachment.path,
          extractedTextPath: attachment.extractedTextPath,
        })),
        imagePaths: task.attachments
          .filter((attachment) => attachment.kind === "image")
          .map((attachment) => attachment.path),
        additionalDirectories: [...new Set(task.attachments
          .filter((attachment) => attachment.kind !== "image")
          .map((attachment) => attachment.directoryPath))],
      }, {
        timeoutMs: this.timeoutMs,
        onEvent: (payload) => this.#runnerEvent(task, payload),
      });
    } catch {
      this.#finalizeFailed(task, { code: "WORKER_START_FAILED", message: "Codex task worker could not start." });
      queueMicrotask(() => this.#drain());
      return;
    }

    this.active.set(task.id, execution);
    const pending = execution.promise.then(
      (result) => this.#finalizeCompleted(task, result),
      (error) => {
        if (error instanceof RunnerCancelledError || task.status === "cancelling") {
          this.#finalizeCancelled(task, "Task cancelled.");
        } else if (error instanceof RunnerTimeoutError) {
          this.#finalizeFailed(task, { code: "TASK_TIMEOUT", message: "Task exceeded its time limit." });
        } else {
          this.#finalizeFailed(task, {
            code: typeof error?.code === "string" ? error.code : "CODEX_RUN_FAILED",
            message: typeof error?.message === "string" ? error.message : "Codex could not complete this task.",
          });
        }
      },
    ).finally(() => {
      this.active.delete(task.id);
      this.runPromises.delete(pending);
      this.#drain();
    });
    this.runPromises.add(pending);
  }

  #runnerEvent(task, payload) {
    if (TERMINAL.has(task.status)) return;
    if (payload?.kind === "diagnostic") {
      this.logger.debug?.(`[task ${task.id}] worker ${payload.stream}: ${payload.message}`);
      return;
    }
    if (payload?.kind !== "sdk" || !payload.event) return;
    const event = payload.event;
    if (event.type === "thread.started") {
      task.threadId = event.thread_id ?? null;
      this.#emit(task, "status", { status: task.status, message: "Codex thread started.", threadId: task.threadId });
    } else if (event.type === "turn.started") {
      this.#emit(task, "step", { message: "Codex is working.", sdkEventType: event.type });
    } else if (event.type?.startsWith("item.")) {
      this.#emit(task, event.type === "item.started" ? "step" : "log", {
        message: itemMessage(event),
        sdkEventType: event.type,
        item: event.item,
      });
    } else if (event.type === "turn.completed") {
      task.usage = event.usage ?? null;
      this.#emit(task, "log", { message: "Codex turn completed.", usage: task.usage });
    }
  }

  #finalizeCompleted(task, result) {
    if (TERMINAL.has(task.status)) return;
    task.status = "completed";
    task.completedAt = now();
    task.updatedAt = task.completedAt;
    task.threadId = result.threadId ?? task.threadId;
    task.usage = result.usage ?? task.usage;
    task.result = { content: String(result.content ?? ""), usage: task.usage, threadId: task.threadId };
    task.error = null;
    task.terminalSequence = this.nextTerminalSequence++;
    this.#recordUsageFinished(task);
    this.#emit(task, "result", task.result);
    this.#emit(task, "status", { status: "completed", message: "Task completed." });
    this.#emit(task, "done", { status: "completed" });
    this.#releaseResources(task);
    this.#prune();
  }

  #finalizeFailed(task, error) {
    if (TERMINAL.has(task.status)) return;
    task.status = "failed";
    task.completedAt = now();
    task.updatedAt = task.completedAt;
    task.error = sanitizeIpcValue(error);
    task.terminalSequence = this.nextTerminalSequence++;
    this.#recordUsageFinished(task);
    this.#emit(task, "error", task.error);
    this.#emit(task, "status", { status: "failed", message: "Task failed." });
    this.#emit(task, "done", { status: "failed" });
    this.#releaseResources(task);
    this.#prune();
  }

  #finalizeCancelled(task, message) {
    if (TERMINAL.has(task.status)) return;
    task.status = "cancelled";
    task.completedAt = now();
    task.updatedAt = task.completedAt;
    task.error = null;
    task.terminalSequence = this.nextTerminalSequence++;
    this.#recordUsageFinished(task);
    this.#emit(task, "status", { status: "cancelled", message });
    this.#emit(task, "done", { status: "cancelled" });
    this.#releaseResources(task);
    this.#prune();
  }

  #releaseResources(task) {
    if (task.projectless) this.scratchWorkspaces.release(task.project);
    this.attachmentStore?.release(task.attachments);
  }

  #prune() {
    const terminal = [...this.tasks.values()]
      .filter((task) => TERMINAL.has(task.status))
      .sort((left, right) => right.terminalSequence - left.terminalSequence);
    for (const task of terminal.slice(this.historyLimit)) this.tasks.delete(task.id);
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    for (const task of this.tasks.values()) {
      if (task.status === "queued") this.#finalizeCancelled(task, "Server shut down before the task started.");
      else if (task.status === "running") {
        task.status = "cancelling";
        this.#emit(task, "status", { status: "cancelling", message: "Server is shutting down." });
      }
    }
    await this.runner.close();
    await Promise.allSettled([...this.runPromises]);
    await this.scratchWorkspaces.close?.();
    this.events.emit("close");
  }
}
