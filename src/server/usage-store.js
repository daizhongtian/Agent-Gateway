import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";

const STORE_VERSION = 1;
const DEFAULT_LOCK_STALE_MS = 30_000;
const FINISHED_STATUSES = new Set(["completed", "failed", "cancelled"]);

function now() {
  return new Date().toISOString();
}

function counter(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function usageFrom(task) {
  const source = task?.usage && typeof task.usage === "object" ? task.usage : {};
  const inputTokens = counter(source.input_tokens ?? source.inputTokens ?? source.input);
  const cachedInputTokens = counter(source.cached_input_tokens ?? source.cachedInputTokens ?? source.cached);
  const outputTokens = counter(source.output_tokens ?? source.outputTokens ?? source.output);
  const reasoningOutputTokens = counter(source.reasoning_output_tokens ?? source.reasoningOutputTokens ?? source.reasoning);
  const reported = [
    "input_tokens", "inputTokens", "input",
    "cached_input_tokens", "cachedInputTokens", "cached",
    "output_tokens", "outputTokens", "output",
    "reasoning_output_tokens", "reasoningOutputTokens", "reasoning",
  ].some((key) => Object.prototype.hasOwnProperty.call(source, key));
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens: inputTokens + outputTokens,
    reported,
  };
}

function emptyState(timestamp = now()) {
  return {
    version: STORE_VERSION,
    generation: randomUUID(),
    resetAt: timestamp,
    updatedAt: timestamp,
    taskCount: 0,
    completedCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    tasksWithUsage: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    models: {},
    credentials: {},
  };
}

function aggregateRecord(value = {}) {
  return {
    tasks: counter(value.tasks),
    inputTokens: counter(value.inputTokens),
    cachedInputTokens: counter(value.cachedInputTokens),
    outputTokens: counter(value.outputTokens),
    reasoningOutputTokens: counter(value.reasoningOutputTokens),
    totalTokens: counter(value.totalTokens),
  };
}

function aggregateMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, record]) => [key, aggregateRecord(record)]));
}

function storedState(value) {
  if (!value || typeof value !== "object" || value.version !== STORE_VERSION) {
    throw new Error("The usage store has an unsupported format.");
  }
  if (typeof value.generation !== "string" || !value.generation) throw new Error("The usage store generation is invalid.");
  if (Number.isNaN(Date.parse(value.resetAt)) || Number.isNaN(Date.parse(value.updatedAt))) {
    throw new Error("The usage store timestamp is invalid.");
  }
  return {
    version: STORE_VERSION,
    generation: value.generation,
    resetAt: value.resetAt,
    updatedAt: value.updatedAt,
    taskCount: counter(value.taskCount),
    completedCount: counter(value.completedCount),
    failedCount: counter(value.failedCount),
    cancelledCount: counter(value.cancelledCount),
    tasksWithUsage: counter(value.tasksWithUsage),
    inputTokens: counter(value.inputTokens),
    cachedInputTokens: counter(value.cachedInputTokens),
    outputTokens: counter(value.outputTokens),
    reasoningOutputTokens: counter(value.reasoningOutputTokens),
    totalTokens: counter(value.totalTokens),
    models: aggregateMap(value.models),
    credentials: aggregateMap(value.credentials),
  };
}

export function normalizeStoredUsageState(value) {
  return storedState(value);
}

function modelKeyFrom(task) {
  return String(task?.modelLabel || task?.model || "").trim();
}

function addModelTask(record) {
  const target = aggregateRecord(record);
  target.tasks += 1;
  return target;
}

function addUsage(record, usage, { incrementTasks = true } = {}) {
  const target = aggregateRecord(record);
  if (incrementTasks) target.tasks += 1;
  target.inputTokens += usage.inputTokens;
  target.cachedInputTokens += usage.cachedInputTokens;
  target.outputTokens += usage.outputTokens;
  target.reasoningOutputTokens += usage.reasoningOutputTokens;
  target.totalTokens += usage.totalTokens;
  return target;
}

export class UsageStore {
  constructor(options = {}) {
    this.filePath = options.filePath ? path.resolve(options.filePath) : null;
    this.lockStaleMs = Number.isFinite(options.lockStaleMs)
      ? Math.max(5_000, Number(options.lockStaleMs))
      : DEFAULT_LOCK_STALE_MS;
    this.state = emptyState();
    this.#load();
  }

  #load() {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      this.state = normalizeStoredUsageState(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch (error) {
      throw new Error(`Usage statistics could not be read: ${error instanceof Error ? error.message : "invalid JSON"}`);
    }
  }

  #persist(state) {
    if (!this.filePath) return;
    mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      renameSync(temporaryPath, this.filePath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }

  #withWriteLock(callback) {
    if (!this.filePath) return callback();
    mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    let release;
    try {
      release = lockfile.lockSync(this.filePath, {
        realpath: false,
        stale: this.lockStaleMs,
        update: Math.max(1_000, Math.floor(this.lockStaleMs / 3)),
        retries: 0,
      });
    } catch (error) {
      if (error?.code === "ELOCKED") throw new Error("The usage store is busy; try again.");
      throw error;
    }
    try {
      this.#load();
      return callback();
    } finally {
      release();
    }
  }

  get generation() {
    this.#load();
    return this.state.generation;
  }

  recordCreated(task) {
    return this.#withWriteLock(() => {
      const timestamp = now();
      const modelKey = modelKeyFrom(task);
      const next = {
        ...this.state,
        taskCount: this.state.taskCount + 1,
        updatedAt: timestamp,
        models: { ...this.state.models },
      };
      if (modelKey) next.models[modelKey] = addModelTask(next.models[modelKey]);
      this.#persist(next);
      this.state = next;
      if (task && typeof task === "object" && modelKey) task.usageModelRecorded = true;
      return next.generation;
    });
  }

  recordFinished(task, generation) {
    if (!FINISHED_STATUSES.has(task?.status)) return false;
    return this.#withWriteLock(() => {
      if (!generation || generation !== this.state.generation) return false;
      const usage = usageFrom(task);
      const next = {
        ...this.state,
        updatedAt: now(),
        models: { ...this.state.models },
        credentials: { ...this.state.credentials },
      };
      if (task.status === "completed") next.completedCount += 1;
      else if (task.status === "failed") next.failedCount += 1;
      else next.cancelledCount += 1;
      const modelKey = modelKeyFrom(task) || "Unknown";
      next.models[modelKey] = addUsage(next.models[modelKey], usage, {
        incrementTasks: task.usageModelRecorded !== true,
      });
      if (task.credentialId) next.credentials[task.credentialId] = addUsage(next.credentials[task.credentialId], usage);
      if (usage.reported) {
        next.tasksWithUsage += 1;
        next.inputTokens += usage.inputTokens;
        next.cachedInputTokens += usage.cachedInputTokens;
        next.outputTokens += usage.outputTokens;
        next.reasoningOutputTokens += usage.reasoningOutputTokens;
        next.totalTokens += usage.totalTokens;
      }
      this.#persist(next);
      this.state = next;
      return true;
    });
  }

  snapshot(options = {}) {
    this.#load();
    const finishedCount = this.state.completedCount + this.state.failedCount + this.state.cancelledCount;
    return {
      resetAt: this.state.resetAt,
      updatedAt: this.state.updatedAt,
      taskCount: this.state.taskCount,
      activeCount: counter(options.activeCount),
      finishedCount,
      completedCount: this.state.completedCount,
      failedCount: this.state.failedCount,
      cancelledCount: this.state.cancelledCount,
      tasksWithUsage: this.state.tasksWithUsage,
      inputTokens: this.state.inputTokens,
      cachedInputTokens: this.state.cachedInputTokens,
      outputTokens: this.state.outputTokens,
      reasoningOutputTokens: this.state.reasoningOutputTokens,
      totalTokens: this.state.totalTokens,
      models: Object.entries(this.state.models).map(([model, record]) => ({ model, ...aggregateRecord(record) })),
      credentials: Object.entries(this.state.credentials).map(([credentialId, record]) => ({ credentialId, ...aggregateRecord(record) })),
    };
  }

  deleteCredential(credentialId) {
    if (typeof credentialId !== "string" || !credentialId) return false;
    return this.#withWriteLock(() => {
      if (!Object.prototype.hasOwnProperty.call(this.state.credentials, credentialId)) return false;
      const credentials = { ...this.state.credentials };
      delete credentials[credentialId];
      const next = {
        ...this.state,
        credentials,
        updatedAt: now(),
      };
      this.#persist(next);
      this.state = next;
      return true;
    });
  }

  reset() {
    return this.#withWriteLock(() => {
      const next = emptyState();
      this.#persist(next);
      this.state = next;
      return this.snapshot();
    });
  }
}
