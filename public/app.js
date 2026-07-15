"use strict";

(() => {
  const API_BASE = "/api/v1";
  const MODEL_OPTIONS = Object.freeze([
    "5.6 Sol",
    "5.6 Terra",
    "5.6 Luna",
    "5.5",
    "5.4",
    "5.4 Mini",
    "5.3 Codex Spark",
  ]);
  const EFFORT_OPTIONS = Object.freeze(["Low", "Medium", "High", "Ultra"]);
  const SPEED_OPTIONS = Object.freeze(["Standard", "Fast"]);
  const DEFAULT_CONFIG = Object.freeze({ model: "5.6 Sol", effort: "Ultra", speed: "Standard" });
  const ACTIVE_STATUSES = new Set(["queued", "pending", "starting", "running", "cancelling", "canceling"]);
  const FINISHED_STATUSES = new Set(["completed", "succeeded", "success", "failed", "error", "cancelled", "canceled"]);
  const STATUS_LABELS = Object.freeze({
    idle: "等待任务",
    queued: "等待执行",
    pending: "准备中",
    starting: "正在启动",
    running: "运行中",
    cancelling: "正在取消",
    canceling: "正在取消",
    cancelled: "已取消",
    canceled: "已取消",
    completed: "已完成",
    succeeded: "已完成",
    success: "已完成",
    failed: "执行失败",
    error: "发生错误",
  });
  const EVENT_MESSAGE_LABELS = Object.freeze({
    "Task queued.": "任务已进入执行队列。",
    "Codex worker started.": "Codex 运行进程已启动。",
    "Codex thread started.": "Codex 会话已建立。",
    "Codex is working.": "Codex 正在处理任务。",
    "Codex turn completed.": "Codex 本轮执行完成。",
    "Task completed.": "任务已完成。",
    "Task failed.": "任务执行失败。",
  });

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const elements = {
    sidebar: $("#sidebar"),
    sidebarOpen: $("#sidebarOpen"),
    sidebarClose: $("#sidebarClose"),
    sidebarScrim: $("#sidebarScrim"),
    newTaskButton: $("#newTaskButton"),
    refreshHistory: $("#refreshHistory"),
    historyList: $("#historyList"),
    connectionChip: $("#connectionChip"),
    connectionText: $("#connectionText"),
    sidebarConnectionDot: $("#sidebarConnectionDot"),
    apiAddress: $("#apiAddress"),
    taskPrompt: $("#taskPrompt"),
    promptShell: $("#promptShell"),
    charCount: $("#charCount"),
    projectPath: $("#projectPath"),
    pathControl: $("#pathControl"),
    pickProjectButton: $("#pickProjectButton"),
    folderFallback: $("#folderFallback"),
    projectNote: $("#projectNote"),
    projectModeProject: $("#projectModeProject"),
    projectModeNone: $("#projectModeNone"),
    approvalToggle: $("#approvalToggle"),
    modelControl: $("#modelControl"),
    modelTrigger: $("#modelTrigger"),
    modelPopover: $("#modelPopover"),
    currentModel: $("#currentModel"),
    currentEffort: $("#currentEffort"),
    currentSpeed: $("#currentSpeed"),
    triggerModel: $("#triggerModel"),
    triggerEffort: $("#triggerEffort"),
    resetSettings: $("#resetSettings"),
    createKeyFromConfig: $("#createKeyFromConfig"),
    settingSubmenu: $("#settingSubmenu"),
    submenuTitle: $("#submenuTitle"),
    submenuOptions: $("#submenuOptions"),
    runButton: $("#runButton"),
    statusPill: $("#statusPill"),
    elapsedMetric: $("#elapsedMetric"),
    stepsMetric: $("#stepsMetric"),
    stepsCaption: $("#stepsCaption"),
    filesMetric: $("#filesMetric"),
    modelMetric: $("#modelMetric"),
    effortMetric: $("#effortMetric"),
    taskIdLabel: $("#taskIdLabel"),
    timeline: $("#timeline"),
    terminal: $("#terminal"),
    terminalEmpty: $("#terminalEmpty"),
    autoScroll: $("#autoScroll"),
    clearLog: $("#clearLog"),
    logCount: $("#logCount"),
    resultPanel: $("#resultPanel"),
    resultContent: $("#resultContent"),
    copyResult: $("#copyResult"),
    toastRegion: $("#toastRegion"),
    apiDialog: $("#apiDialog"),
    apiDocsButton: $("#apiDocsButton"),
    closeApiDialog: $("#closeApiDialog"),
    confirmApiDialog: $("#confirmApiDialog"),
    restEndpoint: $("#restEndpoint"),
    externalTaskEndpoint: $("#externalTaskEndpoint"),
    apiKeyForm: $("#apiKeyForm"),
    apiKeyName: $("#apiKeyName"),
    apiKeyModel: $("#apiKeyModel"),
    apiKeyEffort: $("#apiKeyEffort"),
    apiKeySpeed: $("#apiKeySpeed"),
    apiKeyPermission: $("#apiKeyPermission"),
    generateApiKey: $("#generateApiKey"),
    apiKeyReveal: $("#apiKeyReveal"),
    apiKeySecret: $("#apiKeySecret"),
    copyApiKey: $("#copyApiKey"),
    apiKeyList: $("#apiKeyList"),
    apiKeyCount: $("#apiKeyCount"),
    refreshApiKeys: $("#refreshApiKeys"),
    apiExampleCode: $("#apiExampleCode"),
    copyApiExample: $("#copyApiExample"),
  };

  const state = {
    config: { ...DEFAULT_CONFIG },
    modelIds: new Map(),
    modelCatalog: MODEL_OPTIONS.map((label) => ({ id: label, label })),
    apiKeys: [],
    revealedApiKey: "",
    projects: [],
    selectedProject: null,
    projectPathDraft: "",
    projectless: false,
    tasks: [],
    currentTask: null,
    logs: [],
    steps: [],
    result: "",
    elapsedTimer: null,
    startedAt: null,
    endedAt: null,
    socket: null,
    socketConnected: false,
    socketRetry: null,
    socketRetries: 0,
    streamFallbackTimer: null,
    eventSource: null,
    subscribedTaskId: null,
    eventSignatures: new Map(),
    activeSubmenu: null,
    runRequestPending: false,
    connectionOkay: false,
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
  }

  function unwrapPayload(payload) {
    if (!payload || typeof payload !== "object") return payload;
    if (payload.data !== undefined && Object.keys(payload).length <= 4) return payload.data;
    return payload;
  }

  function extractList(payload, keys) {
    const source = unwrapPayload(payload);
    if (Array.isArray(source)) return source;
    if (!source || typeof source !== "object") return [];
    for (const key of keys) {
      if (Array.isArray(source[key])) return source[key];
      if (source[key] && Array.isArray(source[key].items)) return source[key].items;
    }
    if (Array.isArray(source.items)) return source.items;
    return [];
  }

  function extractTask(payload) {
    let source = unwrapPayload(payload);
    if (!source || typeof source !== "object") return null;
    if (source.task && typeof source.task === "object") source = source.task;
    return source;
  }

  function messageFromErrorPayload(payload, fallback) {
    if (typeof payload === "string" && payload.trim()) return payload.trim();
    if (!payload || typeof payload !== "object") return fallback;
    const candidate = payload.message || payload.error?.message || payload.error || payload.detail || payload.title;
    return typeof candidate === "string" && candidate.trim() ? candidate.trim() : fallback;
  }

  async function apiFetch(path, options = {}) {
    const { timeout = 15_000, silent = false, root = false, ...fetchOptions } = options;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    const headers = new Headers(fetchOptions.headers || {});
    if (fetchOptions.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");

    try {
      const response = await fetch(root ? path : `${API_BASE}${path}`, {
        cache: "no-store",
        credentials: "same-origin",
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") || "";
      let payload = null;
      if (response.status !== 204) {
        payload = contentType.includes("application/json")
          ? await response.json().catch(() => null)
          : await response.text().catch(() => "");
      }
      if (!response.ok) {
        const error = new Error(messageFromErrorPayload(payload, `请求失败（HTTP ${response.status}）`));
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("本地服务响应超时，请确认服务仍在运行。");
      }
      if (error instanceof TypeError && !silent) {
        throw new Error("无法连接本地 Codex 服务，请检查应用服务状态。");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function showToast(message, type = "info", duration = 4_000) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    const text = document.createElement("span");
    text.textContent = message;
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "关闭通知");
    close.textContent = "×";
    toast.append(document.createElement("span"), text, close);
    elements.toastRegion.append(toast);

    let timeoutId = null;
    const dismiss = () => {
      if (!toast.isConnected) return;
      toast.classList.add("leaving");
      window.setTimeout(() => toast.remove(), 190);
      if (timeoutId) clearTimeout(timeoutId);
    };
    close.addEventListener("click", dismiss);
    if (duration > 0) timeoutId = window.setTimeout(dismiss, duration);
    return dismiss;
  }

  function setConnection(status, label) {
    const normalized = status === "online" ? "online" : status === "offline" ? "offline" : "checking";
    elements.connectionChip.className = `connection-chip ${normalized}`;
    elements.connectionText.textContent = label || (normalized === "online" ? "本地服务在线" : normalized === "offline" ? "服务离线" : "正在连接");
    elements.sidebarConnectionDot.className = `connection-dot ${normalized}`;
    state.connectionOkay = normalized === "online";
  }

  function getStoredValue(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function setStoredValue(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage can be disabled in a hardened webview; the UI remains functional.
    }
  }

  function loadStoredPreferences() {
    const path = getStoredValue("codex.projectPath");
    if (path) {
      elements.projectPath.value = path;
      state.projectPathDraft = path;
      state.selectedProject = { path };
    }
    state.projectless = getStoredValue("codex.projectless") === "true";
    const savedConfig = getStoredValue("codex.runConfig");
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        if (typeof parsed.model === "string" && parsed.model.trim() && parsed.model.length <= 128) {
          state.config.model = parsed.model.trim();
        }
        if (EFFORT_OPTIONS.includes(parsed.effort)) state.config.effort = parsed.effort;
        if (SPEED_OPTIONS.includes(parsed.speed)) state.config.speed = parsed.speed;
      } catch {
        // Ignore malformed preferences.
      }
    }
    updateProjectMode({ persist: false });
    updateConfigLabels();
  }

  function storeConfig() {
    setStoredValue("codex.runConfig", JSON.stringify(state.config));
  }

  function updateConfigLabels() {
    elements.currentModel.textContent = state.config.model;
    elements.currentEffort.textContent = state.config.effort;
    elements.currentSpeed.textContent = state.config.speed;
    elements.triggerModel.textContent = state.config.model;
    elements.triggerEffort.textContent = state.config.effort;
    if (!state.currentTask || !ACTIVE_STATUSES.has(normalizeStatus(state.currentTask.status))) {
      elements.modelMetric.textContent = state.config.model;
      elements.effortMetric.textContent = `${state.config.effort} effort`;
    }
  }

  function toggleModelPopover(force) {
    const shouldOpen = force ?? elements.modelPopover.hidden;
    elements.modelPopover.hidden = !shouldOpen;
    elements.modelTrigger.setAttribute("aria-expanded", String(shouldOpen));
    if (!shouldOpen) closeSubmenu();
    return shouldOpen;
  }

  function closeSubmenu(focusParent = false) {
    const previous = state.activeSubmenu;
    state.activeSubmenu = null;
    elements.settingSubmenu.hidden = true;
    $$(".setting-row", elements.modelPopover).forEach((row) => {
      row.classList.remove("open");
      row.setAttribute("aria-expanded", "false");
    });
    if (focusParent && previous) $(`.setting-row[data-setting="${previous}"]`, elements.modelPopover)?.focus();
  }

  function openSubmenu(setting, focusOption = false) {
    const definitions = {
      model: { title: "Model", options: state.modelCatalog.map((model) => model.label), selected: state.config.model },
      effort: { title: "Effort", options: EFFORT_OPTIONS, selected: state.config.effort },
      speed: { title: "Speed", options: SPEED_OPTIONS, selected: state.config.speed },
    };
    const definition = definitions[setting];
    if (!definition) return;
    state.activeSubmenu = setting;
    elements.submenuTitle.textContent = definition.title;
    elements.submenuOptions.replaceChildren();
    definition.options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `submenu-option${option === definition.selected ? " selected" : ""}`;
      button.setAttribute("role", "menuitemradio");
      button.setAttribute("aria-checked", String(option === definition.selected));
      button.dataset.value = option;
      button.textContent = option;
      button.addEventListener("click", () => selectSetting(setting, option));
      button.addEventListener("keydown", handleSubmenuKeydown);
      elements.submenuOptions.append(button);
    });
    elements.settingSubmenu.hidden = false;
    $$(".setting-row", elements.modelPopover).forEach((row) => {
      const open = row.dataset.setting === setting;
      row.classList.toggle("open", open);
      row.setAttribute("aria-expanded", String(open));
    });
    if (focusOption) {
      requestAnimationFrame(() => ($(".submenu-option.selected", elements.settingSubmenu) || $(".submenu-option", elements.settingSubmenu))?.focus());
    }
  }

  function selectSetting(setting, value) {
    if (setting === "model" && state.modelCatalog.some((model) => model.label === value)) state.config.model = value;
    if (setting === "effort" && EFFORT_OPTIONS.includes(value)) state.config.effort = value;
    if (setting === "speed" && SPEED_OPTIONS.includes(value)) state.config.speed = value;
    updateConfigLabels();
    storeConfig();
    toggleModelPopover(false);
    elements.modelTrigger.focus();
  }

  function resetSettings() {
    state.config = { ...DEFAULT_CONFIG };
    updateConfigLabels();
    storeConfig();
    toggleModelPopover(false);
    showToast("模型设置已恢复默认值。", "success");
    elements.modelTrigger.focus();
  }

  function moveFocusWithin(items, current, direction) {
    if (!items.length) return;
    const currentIndex = Math.max(0, items.indexOf(current));
    const nextIndex = (currentIndex + direction + items.length) % items.length;
    items[nextIndex].focus();
  }

  function handleMainMenuKeydown(event) {
    const items = $$(".setting-row, .reset-setting", elements.modelPopover).filter((node) => !node.hidden);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocusWithin(items, event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "ArrowRight" && event.currentTarget.dataset.setting) {
      event.preventDefault();
      openSubmenu(event.currentTarget.dataset.setting, true);
    } else if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      toggleModelPopover(false);
      elements.modelTrigger.focus();
    }
  }

  function handleSubmenuKeydown(event) {
    const items = $$(".submenu-option", elements.settingSubmenu);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocusWithin(items, event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      closeSubmenu(true);
    }
  }

  function normalizeStatus(status) {
    const value = String(status || "idle").toLowerCase().replaceAll("_", "-");
    if (value === "in-progress" || value === "inprogress" || value === "active") return "running";
    if (value === "done") return "completed";
    if (value === "waiting") return "queued";
    return value;
  }

  function statusLabel(status) {
    const normalized = normalizeStatus(status);
    return STATUS_LABELS[normalized] || status || "等待任务";
  }

  function isTaskActive(task = state.currentTask) {
    return Boolean(task && ACTIVE_STATUSES.has(normalizeStatus(task.status)));
  }

  function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== "");
  }

  function localizeEventMessage(value) {
    const message = String(value ?? "");
    return EVENT_MESSAGE_LABELS[message] || message;
  }

  function normalizeTask(raw) {
    if (!raw || typeof raw !== "object") return null;
    const options = raw.options || raw.config || raw.request || {};
    const project = raw.project || {};
    const resultValue = firstDefined(raw.result, raw.finalResult, raw.final_result, raw.output, raw.answer);
    const result = typeof resultValue === "object" && resultValue
      ? firstDefined(resultValue.markdown, resultValue.content, resultValue.text, resultValue.message, JSON.stringify(resultValue, null, 2))
      : resultValue;
    const fileValue = firstDefined(raw.filesChanged, raw.files_changed, raw.changedFiles, raw.changes);
    const events = asArray(firstDefined(raw.events, raw.timeline, []));
    const storedLogs = asArray(firstDefined(raw.logs, raw.logEntries, raw.log_entries, []));
    const eventLogs = events
      .filter((event) => ["log", "error"].includes(String(event?.type || "").toLowerCase()))
      .map((event) => ({
        ...(event.data && typeof event.data === "object" ? event.data : {}),
        level: event.type,
        timestamp: event.timestamp,
      }));
    return {
      ...raw,
      id: String(firstDefined(raw.id, raw.taskId, raw.task_id, raw.uuid, "")),
      prompt: String(firstDefined(raw.prompt, raw.promptPreview, raw.prompt_preview, raw.instructions, raw.input, raw.title) ?? ""),
      status: normalizeStatus(firstDefined(raw.status, raw.state, "idle")),
      createdAt: firstDefined(raw.createdAt, raw.created_at, raw.timestamp),
      startedAt: firstDefined(raw.startedAt, raw.started_at, raw.createdAt, raw.created_at),
      endedAt: firstDefined(raw.endedAt, raw.ended_at, raw.completedAt, raw.completed_at, raw.updatedAt, raw.updated_at),
      projectPath: String(firstDefined(raw.projectPath, raw.project_path, project.path, options.projectPath) ?? ""),
      projectId: firstDefined(raw.projectId, raw.project_id, project.id, options.projectId),
      projectless: raw.projectless === true || project.projectless === true,
      model: String(firstDefined(raw.modelLabel, raw.model_label, raw.model, options.modelLabel, options.model, DEFAULT_CONFIG.model)),
      effort: String(firstDefined(raw.effortLabel, raw.effort_label, raw.effort, options.effort, DEFAULT_CONFIG.effort)),
      speed: String(firstDefined(raw.speedLabel, raw.speed_label, raw.speed, options.speed, DEFAULT_CONFIG.speed)),
      result: result == null ? "" : String(result),
      logs: storedLogs.length ? storedLogs : eventLogs,
      steps: asArray(firstDefined(raw.steps, events)),
      filesChanged: Array.isArray(fileValue) ? fileValue.length : Number(fileValue || 0),
      error: firstDefined(raw.error?.message, raw.error, raw.failureReason, raw.failure_reason),
    };
  }

  function taskTitle(task) {
    const text = String(task?.prompt || task?.title || "未命名任务").trim().replace(/\s+/g, " ");
    return text.length > 48 ? `${text.slice(0, 48)}…` : text || "未命名任务";
  }

  function formatRelativeTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "刚刚";
    const seconds = Math.round((Date.now() - date.getTime()) / 1_000);
    if (seconds < 45) return "刚刚";
    if (seconds < 3_600) return `${Math.max(1, Math.floor(seconds / 60))} 分钟前`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} 小时前`;
    if (seconds < 604_800) return `${Math.floor(seconds / 86_400)} 天前`;
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
  }

  function formatClock(value = Date.now()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "--:--:--";
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  }

  function formatElapsed(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1_000));
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function updateElapsed() {
    if (!state.startedAt) {
      elements.elapsedMetric.textContent = "00:00";
      return;
    }
    const start = new Date(state.startedAt).getTime();
    const end = state.endedAt ? new Date(state.endedAt).getTime() : Date.now();
    elements.elapsedMetric.textContent = formatElapsed(Math.max(0, end - start));
  }

  function startElapsedTimer() {
    if (state.elapsedTimer) clearInterval(state.elapsedTimer);
    updateElapsed();
    if (isTaskActive()) state.elapsedTimer = window.setInterval(updateElapsed, 1_000);
  }

  function stopElapsedTimer() {
    if (state.elapsedTimer) clearInterval(state.elapsedTimer);
    state.elapsedTimer = null;
    updateElapsed();
  }

  function setStatus(status, taskPatch = {}) {
    const normalized = normalizeStatus(status);
    if (state.currentTask) state.currentTask = { ...state.currentTask, ...taskPatch, status: normalized };
    elements.statusPill.className = `status-pill ${normalized}`;
    $("b", elements.statusPill).textContent = statusLabel(normalized);
    const active = ACTIVE_STATUSES.has(normalized);
    elements.runButton.classList.toggle("running", active);
    elements.runButton.setAttribute("aria-label", active ? "取消当前任务" : "运行任务");
    if (FINISHED_STATUSES.has(normalized)) {
      state.endedAt = firstDefined(taskPatch.endedAt, state.currentTask?.endedAt, new Date().toISOString());
      stopElapsedTimer();
      closeTaskStreams();
    } else if (active && !state.elapsedTimer) {
      startElapsedTimer();
    }
    if (state.currentTask) upsertTask(state.currentTask, false);
  }

  function renderHistory() {
    elements.historyList.replaceChildren();
    if (!state.tasks.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.innerHTML = "<strong>还没有历史任务</strong><span>运行第一个任务后，它会保留在这里。</span>";
      elements.historyList.append(empty);
      return;
    }
    state.tasks.slice(0, 60).forEach((task) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `history-item${state.currentTask?.id === task.id ? " active" : ""}`;
      button.dataset.taskId = task.id;
      button.setAttribute("aria-label", `打开任务：${taskTitle(task)}`);
      const status = normalizeStatus(task.status);
      button.innerHTML = `
        <span class="history-status ${escapeAttribute(status)}" aria-hidden="true"></span>
        <span class="history-content"><strong>${escapeHtml(taskTitle(task))}</strong><small>${escapeHtml(statusLabel(status))} · ${escapeHtml(task.model || DEFAULT_CONFIG.model)}</small></span>
        <span class="history-time">${escapeHtml(formatRelativeTime(task.createdAt || task.startedAt))}</span>`;
      button.addEventListener("click", () => loadTask(task.id));
      elements.historyList.append(button);
    });
  }

  function upsertTask(rawTask, rerender = true) {
    const task = normalizeTask(rawTask);
    if (!task?.id) return;
    const index = state.tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) state.tasks[index] = { ...state.tasks[index], ...task };
    else state.tasks.unshift(task);
    state.tasks.sort((a, b) => new Date(b.createdAt || b.startedAt || 0) - new Date(a.createdAt || a.startedAt || 0));
    if (rerender) renderHistory();
  }

  function normalizeLogEntry(entry) {
    if (typeof entry === "string") return { message: entry, level: "info", timestamp: new Date().toISOString() };
    const source = entry && typeof entry === "object" ? entry : {};
    return {
      message: String(firstDefined(source.message, source.text, source.content, source.output, source.command, source.detail) ?? ""),
      level: String(firstDefined(source.level, source.severity, source.kind, source.type, "info")).toLowerCase(),
      timestamp: firstDefined(source.timestamp, source.time, source.createdAt, source.created_at, new Date().toISOString()),
    };
  }

  function normalizeLogLevel(level) {
    const value = String(level || "info").toLowerCase();
    if (value.includes("err") || value === "stderr") return "error";
    if (value.includes("warn")) return "warn";
    if (value.includes("success") || value.includes("complete") || value === "stdout") return value === "stdout" ? "info" : "success";
    if (value.includes("command") || value.includes("tool") || value.includes("exec")) return "command";
    return "info";
  }

  function appendLog(entry, options = {}) {
    const normalized = normalizeLogEntry(entry);
    if (!normalized.message.trim()) return;
    const level = normalizeLogLevel(normalized.level);
    const key = options.key || `${normalized.timestamp}|${level}|${normalized.message}`;
    if (state.logs.some((item) => item.key === key)) return;
    state.logs.push({ ...normalized, level, key });
    if (state.logs.length > 1_000) state.logs.splice(0, state.logs.length - 1_000);
    renderLogLine(state.logs.at(-1));
    elements.logCount.textContent = `${state.logs.length} 条日志`;
  }

  function logSymbol(level) {
    return { error: "×", warn: "!", success: "✓", command: "$", info: "›" }[level] || "›";
  }

  function renderLogLine(entry) {
    elements.terminalEmpty?.remove();
    const line = document.createElement("div");
    line.className = `log-line ${entry.level}`;
    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = formatClock(entry.timestamp);
    const symbol = document.createElement("span");
    symbol.className = "log-symbol";
    symbol.textContent = logSymbol(entry.level);
    const message = document.createElement("span");
    message.className = "log-message";
    message.textContent = entry.message;
    line.append(time, symbol, message);
    elements.terminal.append(line);
    if (elements.autoScroll.checked) elements.terminal.scrollTop = elements.terminal.scrollHeight;
  }

  function renderAllLogs() {
    elements.terminal.replaceChildren();
    if (!state.logs.length) {
      const empty = document.createElement("div");
      empty.className = "terminal-empty";
      empty.id = "terminalEmpty";
      empty.innerHTML = '<span class="terminal-logo">›_</span><strong>日志流已就绪</strong><p>运行任务后，命令、工具调用和执行反馈将在这里实时出现。</p>';
      elements.terminal.append(empty);
      elements.terminalEmpty = empty;
    } else {
      state.logs.forEach(renderLogLine);
    }
    elements.logCount.textContent = `${state.logs.length} 条日志`;
  }

  function clearLogs() {
    state.logs = [];
    renderAllLogs();
  }

  function normalizeStep(step, index = 0) {
    if (typeof step === "string") {
      return { id: `step-${index}-${step}`, title: step, description: "", status: "completed", timestamp: null };
    }
    const source = step && typeof step === "object" ? step : {};
    const data = source.data && typeof source.data === "object" ? source.data : {};
    const type = String(firstDefined(source.type, source.kind, "step")).toLowerCase();
    const eventStatus = normalizeStatus(firstDefined(
      data.status,
      source.status,
      type === "error" ? "failed" : type === "done" ? "completed" : "completed",
    ));
    const fallbackTitle = type === "status"
      ? statusLabel(eventStatus)
      : type === "error" ? "执行失败"
        : type === "done" ? "任务结束"
          : type === "log" ? "运行日志" : type === "step" ? "执行步骤" : type;
    return {
      id: String(firstDefined(source.id, source.stepId, source.step_id, `${index}-${source.timestamp || Date.now()}`)),
      title: String(firstDefined(source.title, source.name, source.label, fallbackTitle, `步骤 ${index + 1}`)),
      description: localizeEventMessage(firstDefined(source.description, data.message, data.text, source.detail, source.text, source.content)),
      status: eventStatus,
      timestamp: firstDefined(source.timestamp, data.timestamp, source.time, source.startedAt, source.started_at),
    };
  }

  function addStep(rawStep) {
    const step = normalizeStep(rawStep, state.steps.length);
    const existing = state.steps.findIndex((item) => item.id === step.id);
    if (existing >= 0) state.steps[existing] = { ...state.steps[existing], ...step };
    else state.steps.push(step);
    if (state.steps.length > 120) state.steps.splice(0, state.steps.length - 120);
    renderTimeline();
  }

  function renderTimeline() {
    elements.timeline.replaceChildren();
    if (!state.steps.length) {
      const item = document.createElement("li");
      item.className = "timeline-empty";
      item.innerHTML = '<span class="timeline-node"></span><div><strong>等待开始</strong><p>提交任务后，Codex 的执行步骤会显示在这里。</p></div>';
      elements.timeline.append(item);
    } else {
      state.steps.forEach((step) => {
        const item = document.createElement("li");
        item.className = step.status;
        item.innerHTML = `<span class="timeline-node" aria-hidden="true"></span><div><strong>${escapeHtml(step.title)}</strong>${step.description ? `<p>${escapeHtml(step.description)}</p>` : ""}</div>${step.timestamp ? `<time>${escapeHtml(formatClock(step.timestamp))}</time>` : ""}`;
        elements.timeline.append(item);
      });
      elements.timeline.scrollTop = elements.timeline.scrollHeight;
    }
    elements.stepsMetric.textContent = String(state.steps.length);
    elements.stepsCaption.textContent = state.steps.length ? `${state.steps.filter((item) => ["completed", "success", "succeeded"].includes(item.status)).length} 个已完成` : "尚未开始";
  }

  function inlineMarkdown(text) {
    let escaped = escapeHtml(text);
    const codeSlots = [];
    escaped = escaped.replace(/`([^`\n]+)`/g, (_, code) => {
      const token = `@@INLINECODE${codeSlots.length}@@`;
      codeSlots.push(`<code>${code}</code>`);
      return token;
    });
    escaped = escaped
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
    codeSlots.forEach((html, index) => {
      escaped = escaped.replace(`@@INLINECODE${index}@@`, html);
    });
    return escaped;
  }

  function markdownToHtml(markdown) {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const html = [];
    let inCode = false;
    let codeLanguage = "";
    let codeLines = [];
    let listType = null;
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!listType) return;
      html.push(`</${listType}>`);
      listType = null;
    };
    const openList = (type) => {
      if (listType === type) return;
      closeList();
      flushParagraph();
      listType = type;
      html.push(`<${type}>`);
    };
    const flushCode = () => {
      html.push(`<pre${codeLanguage ? ` data-language="${escapeAttribute(codeLanguage)}"` : ""}><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      codeLines = [];
      codeLanguage = "";
    };

    lines.forEach((line) => {
      const fence = line.match(/^\s*```\s*([^\s`]*)/);
      if (fence) {
        if (inCode) {
          inCode = false;
          flushCode();
        } else {
          flushParagraph();
          closeList();
          inCode = true;
          codeLanguage = fence[1] || "";
        }
        return;
      }
      if (inCode) {
        codeLines.push(line);
        return;
      }
      if (!line.trim()) {
        flushParagraph();
        closeList();
        return;
      }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        closeList();
        const level = heading[1].length;
        html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        return;
      }
      if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
        flushParagraph();
        closeList();
        html.push("<hr>");
        return;
      }
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        flushParagraph();
        closeList();
        html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
        return;
      }
      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      if (unordered) {
        openList("ul");
        let item = unordered[1];
        item = item.replace(/^\[x\]\s*/i, '<span class="md-check">✓</span> ').replace(/^\[ \]\s*/, "○ ");
        html.push(`<li>${inlineMarkdown(item).replaceAll("&lt;span class=&quot;md-check&quot;&gt;✓&lt;/span&gt;", '<span class="md-check">✓</span>')}</li>`);
        return;
      }
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (ordered) {
        openList("ol");
        html.push(`<li>${inlineMarkdown(ordered[1])}</li>`);
        return;
      }
      if (listType) closeList();
      paragraph.push(line.trim());
    });

    if (inCode) flushCode();
    flushParagraph();
    closeList();
    return html.join("\n");
  }

  function setResult(markdown, append = false) {
    const next = String(markdown ?? "");
    state.result = append ? `${state.result}${next}` : next;
    if (!state.result.trim()) {
      elements.resultContent.className = "result-content empty";
      elements.resultContent.innerHTML = '<div class="result-placeholder"><span aria-hidden="true"><svg viewBox="0 0 28 28"><path d="M6 3.5h11l5 5v16H6v-21Z"></path><path d="M17 3.5v5h5M10 13h8M10 17h8M10 21h5"></path></svg></span><strong>结果将在任务完成后呈现</strong><p>支持 Markdown 标题、列表、引用和代码块。</p></div>';
      elements.copyResult.disabled = true;
      return;
    }
    elements.resultContent.className = "result-content";
    elements.resultContent.innerHTML = `<article class="markdown-body">${markdownToHtml(state.result)}</article>`;
    elements.copyResult.disabled = false;
  }

  function resetTaskView() {
    closeTaskStreams();
    state.currentTask = null;
    state.logs = [];
    state.steps = [];
    state.result = "";
    state.startedAt = null;
    state.endedAt = null;
    stopElapsedTimer();
    elements.taskIdLabel.textContent = "尚无任务";
    elements.filesMetric.textContent = "0";
    elements.stepsMetric.textContent = "0";
    elements.stepsCaption.textContent = "尚未开始";
    setStatus("idle");
    renderAllLogs();
    renderTimeline();
    setResult("");
    updateConfigLabels();
    renderHistory();
  }

  function populateTaskView(rawTask) {
    const task = normalizeTask(rawTask);
    if (!task?.id) return;
    state.currentTask = task;
    state.logs = task.logs.map((entry, index) => ({ ...normalizeLogEntry(entry), key: `stored-${index}` }));
    state.logs = state.logs.map((entry) => ({ ...entry, level: normalizeLogLevel(entry.level) }));
    state.steps = task.steps.map(normalizeStep);
    state.result = task.result;
    state.startedAt = task.startedAt || task.createdAt || new Date().toISOString();
    state.endedAt = FINISHED_STATUSES.has(task.status) ? task.endedAt : null;
    elements.taskIdLabel.textContent = task.id ? `#${task.id.slice(0, 12)}` : "尚无任务";
    elements.filesMetric.textContent = String(task.filesChanged || 0);
    elements.modelMetric.textContent = displayModelName(task.model);
    elements.effortMetric.textContent = `${capitalize(task.effort)} effort`;
    setStatus(task.status, task);
    renderAllLogs();
    renderTimeline();
    setResult(task.result);
    upsertTask(task);
    startElapsedTimer();
    if (isTaskActive(task)) subscribeToTask(task.id);
  }

  function displayModelName(model) {
    const value = String(model || "");
    for (const [label, id] of state.modelIds.entries()) {
      if (id === value) return label;
    }
    return value || DEFAULT_CONFIG.model;
  }

  function capitalize(value) {
    const text = String(value || "");
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  async function loadHistory({ quiet = false } = {}) {
    elements.refreshHistory.disabled = true;
    try {
      const payload = await apiFetch("/tasks?limit=60", { silent: quiet });
      const tasks = extractList(payload, ["tasks", "history", "results"])
        .map(normalizeTask)
        .filter((task) => task?.id);
      state.tasks = tasks.sort((a, b) => new Date(b.createdAt || b.startedAt || 0) - new Date(a.createdAt || a.startedAt || 0));
      renderHistory();
    } catch (error) {
      if (!quiet) showToast(error.message || "无法加载任务历史。", "error");
      if (!state.tasks.length) renderHistory();
    } finally {
      elements.refreshHistory.disabled = false;
    }
  }

  async function loadTask(taskId) {
    if (!taskId) return;
    closeSidebar();
    const cached = state.tasks.find((task) => task.id === taskId);
    if (cached) populateTaskView(cached);
    try {
      const payload = await apiFetch(`/tasks/${encodeURIComponent(taskId)}`);
      const task = extractTask(payload);
      if (!task) throw new Error("任务数据格式无效。");
      populateTaskView(task);
    } catch (error) {
      showToast(error.message || "无法读取任务详情。", "error");
    }
  }

  function normalizeProject(value) {
    if (typeof value === "string") return { path: value, name: value.split(/[\\/]/).filter(Boolean).at(-1) || value };
    if (!value || typeof value !== "object") return null;
    const source = unwrapPayload(value);
    const project = source?.project || source;
    const path = firstDefined(project?.path, project?.projectPath, project?.project_path, project?.directory);
    if (!path) return null;
    return {
      ...project,
      id: firstDefined(project.id, project.projectId, project.project_id),
      path: String(path),
      name: String(firstDefined(project.name, String(path).split(/[\\/]/).filter(Boolean).at(-1), path)),
    };
  }

  function selectProject(project, source = "desktop") {
    const normalized = normalizeProject(project);
    if (!normalized) return false;
    state.selectedProject = normalized;
    state.projectPathDraft = normalized.path;
    if (!state.projectless) elements.projectPath.value = normalized.path;
    setStoredValue("codex.projectPath", normalized.path);
    elements.projectNote.textContent = source === "browser"
      ? "浏览器仅能提供目录名称；桌面应用可获取完整 Windows 路径"
      : `已选择：${normalized.name}`;
    return true;
  }

  function updateProjectMode({ persist = true } = {}) {
    const projectless = state.projectless === true;
    elements.projectModeProject.classList.toggle("active", !projectless);
    elements.projectModeNone.classList.toggle("active", projectless);
    elements.projectModeProject.setAttribute("aria-pressed", String(!projectless));
    elements.projectModeNone.setAttribute("aria-pressed", String(projectless));
    elements.pathControl.classList.toggle("projectless", projectless);
    elements.projectPath.disabled = projectless;
    elements.pickProjectButton.disabled = projectless;
    elements.projectPath.value = projectless
      ? "无项目 · 隔离临时工作区"
      : state.projectPathDraft;
    elements.projectNote.textContent = projectless
      ? "每次任务使用全新的临时目录，任务结束后自动清理"
      : state.selectedProject?.name
        ? `已选择：${state.selectedProject.name}`
        : "可粘贴 Windows 完整路径，或使用原生目录选择器";
    if (persist) setStoredValue("codex.projectless", String(projectless));
  }

  function setProjectlessMode(projectless) {
    if (state.projectless === Boolean(projectless)) return;
    if (!state.projectless) state.projectPathDraft = elements.projectPath.value.trim();
    state.projectless = Boolean(projectless);
    updateProjectMode();
  }

  async function registerProject(project, { required = false } = {}) {
    if (!project?.path) {
      if (required) throw new Error("请选择有效的项目目录。");
      return null;
    }
    try {
      const payload = await apiFetch("/projects", {
        method: "POST",
        body: JSON.stringify({ path: project.path, name: project.name }),
        timeout: 8_000,
        silent: true,
      });
      const registered = normalizeProject(payload);
      if (!registered) throw new Error("服务未返回有效的项目信息。");
      selectProject(registered, "desktop");
      return registered;
    } catch (error) {
      if (required) {
        throw new Error(error?.message || "无法注册项目目录，请确认路径存在且有权访问。");
      }
      return null;
    }
  }

  async function pickProject() {
    elements.pickProjectButton.disabled = true;
    try {
      if (window.codexDesktop?.pickProject) {
        const result = await window.codexDesktop.pickProject();
        if (result && selectProject(result, "desktop")) {
          await registerProject(state.selectedProject);
          showToast("项目目录已更新。", "success");
        }
        return;
      }

      try {
        const payload = await apiFetch("/projects/select", {
          method: "POST",
          body: "{}",
          timeout: 30_000,
          silent: true,
        });
        if (selectProject(payload, "desktop")) {
          showToast("项目目录已更新。", "success");
          return;
        }
      } catch {
        // A regular browser cannot open the native desktop dialog; use directory input below.
      }
      elements.folderFallback.click();
    } catch (error) {
      showToast(error.message || "无法打开目录选择器。", "error");
    } finally {
      elements.pickProjectButton.disabled = false;
    }
  }

  function handleBrowserFolder(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rootName = file.webkitRelativePath?.split("/")[0] || file.name;
    selectProject({ path: rootName, name: rootName }, "browser");
    showToast("浏览器无法读取完整路径；建议在桌面应用中选择项目。", "warning", 6_000);
    event.target.value = "";
  }

  function readPermission() {
    return $("input[name='permission']:checked")?.value || "workspace-write";
  }

  function resolveModelId(label) {
    return state.modelIds.get(label) || label;
  }

  function validateTaskInput() {
    const prompt = elements.taskPrompt.value.trim();
    const projectPath = state.projectless ? "" : elements.projectPath.value.trim();
    if (!prompt) {
      elements.promptShell.classList.remove("invalid");
      requestAnimationFrame(() => elements.promptShell.classList.add("invalid"));
      elements.taskPrompt.focus();
      showToast("请先填写任务描述。", "warning");
      return null;
    }
    if (!state.projectless && !projectPath) {
      elements.projectPath.focus();
      showToast("请选择或填写项目目录。", "warning");
      return null;
    }
    elements.promptShell.classList.remove("invalid");
    return { prompt, projectPath, projectless: state.projectless };
  }

  function buildTaskRequest(input) {
    const permission = readPermission();
    return {
      prompt: input.prompt,
      projectless: input.projectless === true,
      ...(input.projectless ? {} : {
        projectPath: input.projectPath,
        projectId: state.selectedProject?.id || undefined,
      }),
      model: resolveModelId(state.config.model),
      modelLabel: state.config.model,
      effort: state.config.effort.toLowerCase(),
      effortLabel: state.config.effort,
      speed: state.config.speed.toLowerCase(),
      speedLabel: state.config.speed,
      sandboxMode: permission,
      permission,
      approvalPolicy: elements.approvalToggle.checked ? "untrusted" : "never",
    };
  }

  async function startTask() {
    if (state.runRequestPending) return;
    if (isTaskActive()) {
      await cancelTask();
      return;
    }
    const input = validateTaskInput();
    if (!input) return;
    state.runRequestPending = true;
    elements.runButton.disabled = true;
    clearLogs();
    state.steps = [];
    renderTimeline();
    setResult("");
    elements.filesMetric.textContent = "0";
    addStep({ id: "submitting", title: "提交任务", description: "正在将任务发送到本地 Codex 服务", status: "running", timestamp: new Date().toISOString() });
    appendLog({ message: `正在提交任务 · ${state.config.model} · ${state.config.effort}`, level: "info" });

    try {
      let request;
      if (input.projectless) {
        request = buildTaskRequest(input);
      } else {
        const registeredProject = await registerProject({
          path: input.projectPath,
          name: input.projectPath.split(/[\\/]/).filter(Boolean).at(-1),
        }, { required: true });
        request = buildTaskRequest({ ...input, projectPath: registeredProject.path });
      }
      const payload = await apiFetch("/tasks", {
        method: "POST",
        body: JSON.stringify(request),
        timeout: 35_000,
      });
      let task = normalizeTask(extractTask(payload));
      if (!task?.id) throw new Error("服务未返回有效的任务 ID。");
      task = {
        ...task,
        prompt: task.prompt || request.prompt,
        projectPath: task.projectPath || request.projectPath || "",
        projectless: request.projectless,
        model: state.config.model,
        effort: state.config.effort,
        speed: state.config.speed,
        status: ACTIVE_STATUSES.has(task.status) ? task.status : "queued",
      };
      state.currentTask = task;
      state.startedAt = task.startedAt || task.createdAt || new Date().toISOString();
      state.endedAt = null;
      state.steps = [];
      state.logs = [];
      state.result = "";
      elements.taskIdLabel.textContent = `#${task.id.slice(0, 12)}`;
      elements.modelMetric.textContent = state.config.model;
      elements.effortMetric.textContent = `${state.config.effort} effort`;
      addStep({ id: "submitted", title: "任务已提交", description: "等待 Codex 开始处理", status: "completed", timestamp: new Date().toISOString() });
      appendLog({ message: `任务 ${task.id} 已创建 · ${request.projectless ? "无项目临时工作区" : "项目工作区"}`, level: "success" });
      setStatus(task.status, task);
      upsertTask(task);
      subscribeToTask(task.id);
      showToast("任务已开始运行。", "success");
    } catch (error) {
      addStep({ id: "submit-error", title: "提交失败", description: error.message, status: "error", timestamp: new Date().toISOString() });
      appendLog({ message: error.message || "任务提交失败", level: "error" });
      setStatus("error");
      showToast(error.message || "任务提交失败。", "error", 6_000);
    } finally {
      state.runRequestPending = false;
      elements.runButton.disabled = false;
    }
  }

  async function cancelTask() {
    const taskId = state.currentTask?.id;
    if (!taskId || !isTaskActive()) return;
    if (state.runRequestPending) return;
    state.runRequestPending = true;
    elements.runButton.disabled = true;
    setStatus("cancelling");
    appendLog({ message: "正在请求取消任务…", level: "warn" });
    try {
      const payload = await apiFetch(`/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: "POST",
        body: "{}",
        timeout: 15_000,
      });
      const task = normalizeTask(extractTask(payload));
      if (task?.id) populateTaskView({ ...state.currentTask, ...task });
      else setStatus("cancelled", { endedAt: new Date().toISOString() });
      addStep({ id: `cancel-${Date.now()}`, title: "任务已取消", description: "已停止后续执行", status: "error", timestamp: new Date().toISOString() });
      appendLog({ message: "任务已取消", level: "warn" });
      showToast("已取消当前任务。", "success");
      void loadHistory({ quiet: true });
    } catch (error) {
      setStatus("running");
      appendLog({ message: error.message || "取消任务失败", level: "error" });
      showToast(error.message || "取消任务失败。", "error");
    } finally {
      state.runRequestPending = false;
      elements.runButton.disabled = false;
    }
  }

  function eventSignature(event) {
    const data = event?.data || event?.payload || event;
    const nested = event?.event && typeof event.event === "object"
      ? event.event
      : data?.event && typeof data.event === "object" ? data.event : null;
    const type = firstDefined(
      typeof event?.type === "string" ? event.type : undefined,
      typeof event?.event === "string" ? event.event : undefined,
      event?.kind,
      nested?.type,
      "message",
    );
    const explicitId = firstDefined(event?.id, event?.eventId, event?.event_id, data?.id);
    const nestedId = firstDefined(nested?.id, nested?.item?.id, nested?.thread_id, nested?.turn_id);
    const timestamp = firstDefined(event?.timestamp, data?.timestamp, nested?.timestamp, "");
    const message = firstDefined(data?.message, data?.text, data?.status, nested?.message, nested?.item?.text, "");
    let fingerprint = "";
    if (!explicitId && !nestedId && !timestamp && !message) {
      try { fingerprint = JSON.stringify(nested || data).slice(0, 600); } catch { fingerprint = String(nested || data); }
    }
    return `${type}|${explicitId || ""}|${nestedId || ""}|${timestamp}|${message}|${fingerprint}`;
  }

  function rememberEvent(event) {
    const signature = eventSignature(event);
    if (state.eventSignatures.has(signature)) return false;
    state.eventSignatures.set(signature, Date.now());
    if (state.eventSignatures.size > 400) {
      const oldest = [...state.eventSignatures.entries()].sort((a, b) => a[1] - b[1]).slice(0, 100);
      oldest.forEach(([key]) => state.eventSignatures.delete(key));
    }
    return true;
  }

  function extractEventTaskId(event) {
    const data = event?.data || event?.payload || {};
    return String(firstDefined(event?.taskId, event?.task_id, data?.taskId, data?.task_id, data?.task?.id, event?.task?.id, ""));
  }

  function eventData(event) {
    const data = firstDefined(event?.data, event?.payload, event?.detail, event);
    return data && typeof data === "object" ? data : { message: String(data ?? "") };
  }

  function eventMessage(data) {
    const value = firstDefined(data.message, data.text, data.content, data.output, data.delta, data.detail, data.error?.message, data.error);
    if (typeof value === "string") return localizeEventMessage(value);
    if (value && typeof value === "object") return localizeEventMessage(firstDefined(value.text, value.content, value.message, JSON.stringify(value)));
    return "";
  }

  function taskFromEvent(event, data) {
    return normalizeTask(firstDefined(data.task, event.task, data.result?.task, null));
  }

  function inferSdkEventDescription(data) {
    const item = data.item || data.event?.item || data;
    const itemType = String(firstDefined(item.type, data.event?.type, data.type, "")).replaceAll("_", " ");
    const command = firstDefined(item.command, item.tool, item.name);
    const text = firstDefined(item.text, item.message, item.content);
    if (command) return `${itemType || "工具调用"} · ${command}`;
    if (typeof text === "string") return text.length > 140 ? `${text.slice(0, 140)}…` : text;
    return itemType || "Codex 事件";
  }

  function handleRealtimeEvent(rawEvent, source = "stream") {
    if (Array.isArray(rawEvent)) {
      rawEvent.forEach((entry) => handleRealtimeEvent(entry, source));
      return;
    }
    if (!rawEvent || typeof rawEvent !== "object") return;
    if (!rememberEvent(rawEvent)) return;

    const type = String(firstDefined(
      typeof rawEvent.type === "string" ? rawEvent.type : undefined,
      typeof rawEvent.event === "string" ? rawEvent.event : undefined,
      rawEvent.kind,
      "message",
    )).toLowerCase();
    if (["welcome", "connected", "ping", "pong", "subscribed"].includes(type)) return;
    const data = eventData(rawEvent);
    const taskId = extractEventTaskId(rawEvent);
    const activeTaskId = state.currentTask?.id;

    const eventTask = taskFromEvent(rawEvent, data);
    if (eventTask?.id) upsertTask(eventTask);
    if (taskId && activeTaskId && taskId !== activeTaskId) return;
    if (!activeTaskId && taskId) return;

    const nestedEvent = data.event && typeof data.event === "object" ? data.event : null;
    if (nestedEvent && nestedEvent !== rawEvent) {
      handleRealtimeEvent({
        ...nestedEvent,
        taskId: taskId || activeTaskId,
        id: firstDefined(nestedEvent.id, rawEvent.id ? `${rawEvent.id}:${nestedEvent.type || "nested"}` : undefined),
      }, source);
    }

    const flatStatus = firstDefined(data.status, rawEvent.status, eventTask?.status);
    if (flatStatus) setStatus(flatStatus, eventTask || {});
    if (type === "status" && flatStatus) {
      addStep({
        id: rawEvent.id,
        title: statusLabel(flatStatus),
        description: eventMessage(data),
        status: flatStatus,
        timestamp: firstDefined(rawEvent.timestamp, data.timestamp, new Date().toISOString()),
      });
    }

    if (type.includes("created") || type.includes("queued")) {
      setStatus("queued");
    }
    const isLifecycleStart = type === "started"
      || type === "running"
      || type === "task.started"
      || type === "thread.started"
      || type === "turn.started"
      || type.endsWith(".task.started");
    if (isLifecycleStart) {
      setStatus("running", { startedAt: firstDefined(data.startedAt, data.timestamp, rawEvent.timestamp, state.startedAt) });
      addStep({
        id: firstDefined(data.id, rawEvent.id, "codex-started"),
        title: "Codex 开始执行",
        description: "正在分析任务与项目上下文",
        status: "running",
        timestamp: firstDefined(data.timestamp, rawEvent.timestamp, new Date().toISOString()),
      });
    }

    if (type.includes("log") || type.includes("stdout") || type.includes("stderr") || type === "message") {
      const message = eventMessage(data);
      if (message) appendLog({ message, level: firstDefined(data.level, type), timestamp: firstDefined(data.timestamp, rawEvent.timestamp) }, { key: eventSignature(rawEvent) });
    }

    if (type.includes("step") || type.includes("plan")) {
      const step = data.step || data;
      addStep({
        ...step,
        id: firstDefined(step.id, rawEvent.id, `${type}-${Date.now()}`),
        title: firstDefined(step.title, step.name, step.message, type.includes("plan") ? "更新执行计划" : "执行步骤"),
        description: firstDefined(step.description, step.detail, step.text, ""),
        status: firstDefined(step.status, data.status, type.includes("completed") ? "completed" : "running"),
        timestamp: firstDefined(step.timestamp, rawEvent.timestamp, new Date().toISOString()),
      });
    }

    if (type.includes("item.") || type.includes("tool") || type.includes("command")) {
      const isComplete = type.includes("completed") || type.includes("finished");
      const description = inferSdkEventDescription(data);
      addStep({
        id: firstDefined(data.item?.id, data.id, rawEvent.id, `${type}-${Date.now()}`),
        title: isComplete ? "完成工具调用" : "执行工具调用",
        description,
        status: isComplete ? "completed" : "running",
        timestamp: firstDefined(data.timestamp, rawEvent.timestamp, new Date().toISOString()),
      });
      appendLog({ message: description, level: "command", timestamp: firstDefined(data.timestamp, rawEvent.timestamp) }, { key: `${eventSignature(rawEvent)}-sdk` });
      const item = data.item || data.event?.item;
      if (isComplete && item?.type === "agent_message" && typeof item.text === "string") setResult(item.text);
    }

    const fileCount = firstDefined(data.filesChanged, data.files_changed, data.changedFiles?.length, eventTask?.filesChanged);
    if (fileCount !== undefined) elements.filesMetric.textContent = String(Array.isArray(fileCount) ? fileCount.length : Number(fileCount) || 0);

    const isResultDelta = type.includes("result.delta") || type.includes("output.delta") || type.includes("text.delta");
    if (isResultDelta) {
      const delta = eventMessage(data);
      if (delta) setResult(delta, true);
    } else if (type.includes("result") || type.includes("output")) {
      const content = firstDefined(data.markdown, data.result?.markdown, data.result?.content, data.result?.text, data.result, data.output, data.content, data.text);
      if (typeof content === "string" && content) setResult(content);
    }

    const doneStatus = normalizeStatus(firstDefined(data.status, eventTask?.status, ""));
    const isTaskCompletion = type === "completed"
      || type === "succeeded"
      || type === "success"
      || (type === "done" && ["completed", "succeeded", "success"].includes(doneStatus))
      || type === "task.completed"
      || type === "task.succeeded"
      || type === "turn.completed"
      || type.endsWith(".task.completed");
    if (isTaskCompletion) {
      const content = firstDefined(eventTask?.result, data.markdown, data.result?.markdown, data.result?.content, data.result?.text, typeof data.result === "string" ? data.result : undefined, data.output, data.finalResult, data.final_result);
      if (typeof content === "string" && content) setResult(content);
      setStatus(eventTask?.status || "completed", { ...eventTask, endedAt: firstDefined(data.endedAt, data.timestamp, rawEvent.timestamp, new Date().toISOString()) });
      addStep({ id: firstDefined(rawEvent.id, "task-completed"), title: "任务完成", description: "最终结果已生成", status: "completed", timestamp: firstDefined(data.timestamp, rawEvent.timestamp, new Date().toISOString()) });
      appendLog({ message: "任务已完成", level: "success", timestamp: firstDefined(data.timestamp, rawEvent.timestamp) }, { key: `${eventSignature(rawEvent)}-done` });
      showToast("任务已完成，最终结果已生成。", "success");
      void refreshCurrentTask();
    }

    const isTaskCancellation = type === "cancelled"
      || type === "canceled"
      || (type === "done" && ["cancelled", "canceled"].includes(doneStatus))
      || type === "task.cancelled"
      || type === "task.canceled"
      || type.endsWith(".task.cancelled");
    if (isTaskCancellation) {
      setStatus("cancelled", { endedAt: firstDefined(data.timestamp, rawEvent.timestamp, new Date().toISOString()) });
      addStep({ id: firstDefined(rawEvent.id, "task-cancelled"), title: "任务已取消", description: "执行已由用户停止", status: "error", timestamp: firstDefined(data.timestamp, rawEvent.timestamp, new Date().toISOString()) });
    }

    const isTaskFailure = type === "failed"
      || type === "error"
      || type === "task.failed"
      || type === "turn.failed"
      || type === "task.error"
      || type.endsWith(".task.failed");
    if (isTaskFailure) {
      const message = eventMessage(data) || "任务执行失败";
      setStatus("failed", { error: message, endedAt: firstDefined(data.timestamp, rawEvent.timestamp, new Date().toISOString()) });
      addStep({ id: firstDefined(rawEvent.id, "task-failed"), title: "执行失败", description: message, status: "error", timestamp: firstDefined(data.timestamp, rawEvent.timestamp, new Date().toISOString()) });
      appendLog({ message, level: "error", timestamp: firstDefined(data.timestamp, rawEvent.timestamp) }, { key: `${eventSignature(rawEvent)}-error` });
      showToast(message, "error", 6_000);
      void refreshCurrentTask();
    }

    if (state.currentTask) upsertTask(state.currentTask);
  }

  async function refreshCurrentTask() {
    const taskId = state.currentTask?.id;
    if (!taskId) return;
    try {
      const payload = await apiFetch(`/tasks/${encodeURIComponent(taskId)}`, { silent: true });
      const task = extractTask(payload);
      if (task) populateTaskView(task);
    } catch {
      void loadHistory({ quiet: true });
    }
  }

  function parseEventPayload(value) {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return { type: "log", data: { message: trimmed } };
    }
  }

  function socketUrl() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}/ws`;
  }

  function connectWebSocket() {
    if (!("WebSocket" in window) || state.socket?.readyState === WebSocket.OPEN || state.socket?.readyState === WebSocket.CONNECTING) return;
    if (state.socketRetry) clearTimeout(state.socketRetry);
    try {
      const socket = new WebSocket(socketUrl());
      state.socket = socket;
      socket.addEventListener("open", () => {
        if (state.socket !== socket) return;
        state.socketConnected = true;
        state.socketRetries = 0;
        setConnection("online", "事件流已连接");
        if (state.currentTask?.id && isTaskActive()) {
          sendSocketSubscription(state.currentTask.id);
          closeEventSource();
        }
      });
      socket.addEventListener("message", (event) => {
        const payload = parseEventPayload(event.data);
        if (payload) handleRealtimeEvent(payload, "websocket");
      });
      socket.addEventListener("error", () => {
        if (state.socket !== socket) return;
        state.socketConnected = false;
      });
      socket.addEventListener("close", () => {
        if (state.socket !== socket) return;
        state.socketConnected = false;
        state.socket = null;
        if (state.currentTask?.id && isTaskActive()) openEventSource(state.currentTask.id);
        scheduleSocketReconnect();
      });
    } catch {
      state.socketConnected = false;
      scheduleSocketReconnect();
    }
  }

  function scheduleSocketReconnect() {
    if (state.socketRetry || document.hidden) return;
    state.socketRetries += 1;
    const delay = Math.min(30_000, 1_200 * (2 ** Math.min(state.socketRetries, 4)));
    state.socketRetry = window.setTimeout(() => {
      state.socketRetry = null;
      connectWebSocket();
    }, delay);
  }

  function sendSocketSubscription(taskId) {
    if (state.socket?.readyState !== WebSocket.OPEN || !taskId) return false;
    try {
      state.socket.send(JSON.stringify({ type: "subscribe", taskId }));
      state.subscribedTaskId = taskId;
      return true;
    } catch {
      return false;
    }
  }

  function closeEventSource() {
    if (state.eventSource) state.eventSource.close();
    state.eventSource = null;
  }

  function openEventSource(taskId) {
    if (!("EventSource" in window) || !taskId || state.eventSource) return;
    const stream = new EventSource(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/events`);
    state.eventSource = stream;
    const receive = (event) => {
      const payload = parseEventPayload(event.data);
      if (!payload) return;
      if (event.type && event.type !== "message" && payload.type == null) payload.type = event.type;
      handleRealtimeEvent(payload, "sse");
    };
    stream.onopen = () => setConnection("online", "事件流已连接");
    stream.onmessage = receive;
    ["status", "step", "log", "result", "done", "error", "task.created", "task.started", "task.completed", "task.failed", "task.cancelled", "task.event", "task.sdk", "task.log", "task.status", "task.result"].forEach((eventName) => {
      stream.addEventListener(eventName, receive);
    });
    stream.onerror = () => {
      if (FINISHED_STATUSES.has(normalizeStatus(state.currentTask?.status))) {
        closeEventSource();
        return;
      }
      if (stream.readyState === EventSource.CLOSED && !state.socketConnected) {
        setConnection("offline", "事件流重连中");
      }
    };
  }

  function subscribeToTask(taskId) {
    if (!taskId) return;
    state.subscribedTaskId = taskId;
    state.eventSignatures.clear();
    if (state.streamFallbackTimer) clearTimeout(state.streamFallbackTimer);
    if (sendSocketSubscription(taskId)) return;
    connectWebSocket();
    state.streamFallbackTimer = window.setTimeout(() => {
      state.streamFallbackTimer = null;
      if (!state.socketConnected && state.currentTask?.id === taskId && isTaskActive()) openEventSource(taskId);
    }, 650);
  }

  function closeTaskStreams() {
    if (state.streamFallbackTimer) clearTimeout(state.streamFallbackTimer);
    state.streamFallbackTimer = null;
    closeEventSource();
    state.subscribedTaskId = null;
  }

  async function checkHealth({ quiet = true } = {}) {
    try {
      const payload = await apiFetch("/health", { root: true, timeout: 5_000, silent: quiet });
      const health = unwrapPayload(payload) || {};
      const status = String(firstDefined(health.status, health.state, health.ok === false ? "offline" : "ok")).toLowerCase();
      if (["ok", "healthy", "ready", "online", "true"].includes(status) || health.ok === true) {
        setConnection("online", state.socketConnected || state.eventSource ? "事件流已连接" : "本地服务在线");
      } else {
        setConnection("offline", "服务未就绪");
      }
    } catch (error) {
      setConnection("offline", "本地服务离线");
      if (!quiet) showToast(error.message || "本地服务不可用。", "error");
    }
  }

  async function loadModels() {
    try {
      const payload = await apiFetch("/models", { silent: true, timeout: 7_000 });
      const models = extractList(payload, ["models", "availableModels", "available_models"]);
      const discovered = [];
      models.forEach((model) => {
        if (typeof model === "string") {
          const value = model.trim();
          if (value) discovered.push({ id: value, label: value });
          return;
        }
        if (!model || typeof model !== "object") return;
        const label = String(firstDefined(model.label, model.displayName, model.display_name, model.name, ""));
        const id = String(firstDefined(model.id, model.value, model.model, label));
        if (label.trim() && id.trim()) discovered.push({ id: id.trim(), label: label.trim() });
      });
      if (discovered.length) {
        state.modelCatalog = discovered.filter((model, index, list) => (
          list.findIndex((candidate) => candidate.id === model.id) === index
        ));
        state.modelIds.clear();
        state.modelCatalog.forEach((model) => state.modelIds.set(model.label, model.id));
        if (!state.modelCatalog.some((model) => model.label === state.config.model)) {
          state.config.model = state.modelCatalog[0].label;
          storeConfig();
        }
        updateConfigLabels();
        populateApiKeyModelOptions();
      }
    } catch {
      // The exact UI model catalog remains available even when discovery is offline.
    }
  }

  async function loadProjects() {
    try {
      const payload = await apiFetch("/projects", { silent: true, timeout: 7_000 });
      state.projects = extractList(payload, ["projects", "recentProjects", "recent_projects"])
        .map(normalizeProject)
        .filter(Boolean);
      if (!state.projectless && !state.projectPathDraft && state.projects[0]) selectProject(state.projects[0], "desktop");
    } catch {
      // A manually entered project path is always accepted by the form.
    }
  }

  function updateCharCount() {
    const count = elements.taskPrompt.value.length;
    elements.charCount.textContent = `${count.toLocaleString("zh-CN")} / 20,000`;
    elements.charCount.classList.toggle("warning", count > 18_000);
  }

  function newTask() {
    if (isTaskActive()) {
      showToast("当前任务仍在运行；请先取消或等待任务完成。", "warning");
      return;
    }
    resetTaskView();
    elements.taskPrompt.value = "";
    updateCharCount();
    closeSidebar();
    elements.taskPrompt.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openSidebar() {
    document.body.classList.add("sidebar-visible");
    elements.sidebarOpen.setAttribute("aria-expanded", "true");
    if (window.innerWidth <= 960) requestAnimationFrame(() => elements.newTaskButton.focus());
  }

  function closeSidebar() {
    document.body.classList.remove("sidebar-visible");
    elements.sidebarOpen.setAttribute("aria-expanded", "false");
  }

  async function copyResult() {
    if (!state.result) return;
    try {
      await navigator.clipboard.writeText(state.result);
      showToast("结果已复制到剪贴板。", "success");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = state.result;
      textarea.className = "clipboard-fallback";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      showToast(copied ? "结果已复制到剪贴板。" : "复制失败，请手动选择结果。", copied ? "success" : "error");
    }
  }

  async function copyPlainText(value, successMessage) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showToast(successMessage, "success");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.className = "clipboard-fallback";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      showToast(copied ? successMessage : "复制失败，请手动复制。", copied ? "success" : "error");
    }
  }

  function effortDisplay(value) {
    const labels = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Ultra" };
    return labels[String(value || "").toLowerCase()] || capitalize(value);
  }

  function permissionDisplay(value) {
    return value === "read-only" ? "只读" : value === "workspace-write" ? "仅项目" : String(value || "");
  }

  function formatKeyDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  function populateApiKeyModelOptions(preferredId) {
    if (!elements.apiKeyModel) return;
    const previous = preferredId || elements.apiKeyModel.value || resolveModelId(state.config.model);
    elements.apiKeyModel.replaceChildren();
    state.modelCatalog.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.label;
      elements.apiKeyModel.append(option);
    });
    const available = [...elements.apiKeyModel.options].some((option) => option.value === previous);
    elements.apiKeyModel.value = available ? previous : (elements.apiKeyModel.options[0]?.value || "");
  }

  function updateApiExample() {
    const endpoint = `${location.origin}${API_BASE}/external/tasks`;
    elements.externalTaskEndpoint.textContent = endpoint;
    elements.apiExampleCode.textContent = [
      '$headers = @{ Authorization = "Bearer $env:CODEX_GATEWAY_KEY" }',
      '$body = @{',
      '  prompt = "检查并修复这个项目"',
      '  projectless = $true',
      '} | ConvertTo-Json',
      '',
      '$task = Invoke-RestMethod `',
      '  -Method Post `',
      `  -Uri "${endpoint}" \``,
      '  -Headers $headers `',
      '  -ContentType "application/json" `',
      '  -Body $body',
      '',
      '$task | ConvertTo-Json -Depth 6',
    ].join("\n");
  }

  function syncApiKeyFormToCurrentConfig() {
    populateApiKeyModelOptions(resolveModelId(state.config.model));
    elements.apiKeyEffort.value = state.config.effort;
    elements.apiKeySpeed.value = state.config.speed;
    const permission = readPermission();
    elements.apiKeyPermission.value = permission === "read-only" ? "read-only" : "workspace-write";
    updateApiExample();
  }

  function clearRevealedApiKey() {
    state.revealedApiKey = "";
    elements.apiKeySecret.value = "";
    elements.apiKeyReveal.hidden = true;
  }

  function renderApiKeys() {
    elements.apiKeyList.replaceChildren();
    const activeCount = state.apiKeys.filter((key) => key.active !== false && !key.revokedAt).length;
    elements.apiKeyCount.textContent = state.apiKeys.length
      ? `${activeCount} 个有效 · ${state.apiKeys.length} 个已创建`
      : "尚未创建访问密钥";
    elements.apiAddress.textContent = `${location.host || "127.0.0.1"} · ${activeCount} Keys`;

    if (!state.apiKeys.length) {
      const empty = document.createElement("div");
      empty.className = "api-key-empty";
      empty.textContent = "创建第一枚与模型配置绑定的 Gateway API Key";
      elements.apiKeyList.append(empty);
      return;
    }

    state.apiKeys.forEach((key) => {
      const active = key.active !== false && !key.revokedAt;
      const row = document.createElement("div");
      row.className = `api-key-row${active ? "" : " revoked"}`;

      const identity = document.createElement("div");
      identity.className = "key-identity";
      const name = document.createElement("strong");
      name.textContent = key.name || "未命名密钥";
      const masked = document.createElement("code");
      masked.textContent = `${key.maskedKey || "ccc_live_••••"}${key.createdAt ? ` · ${formatKeyDate(key.createdAt)}` : ""}`;
      identity.append(name, masked);

      const preset = document.createElement("div");
      preset.className = "key-preset";
      const values = [
        key.preset?.modelLabel || key.preset?.model,
        effortDisplay(key.preset?.effort),
        capitalize(key.preset?.speed),
        permissionDisplay(key.preset?.permission),
      ].filter(Boolean);
      values.forEach((value) => {
        const pill = document.createElement("span");
        pill.className = "preset-pill";
        pill.textContent = value;
        preset.append(pill);
      });

      const action = document.createElement("div");
      action.className = "key-action";
      const status = document.createElement("span");
      status.className = "key-status";
      status.textContent = active ? "有效" : "已撤销";
      action.append(status);
      if (active) {
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "key-revoke";
        revoke.textContent = "撤销";
        revoke.addEventListener("click", () => void revokeApiKey(key.id, revoke));
        action.append(revoke);
      }
      row.append(identity, preset, action);
      elements.apiKeyList.append(row);
    });
  }

  async function loadApiKeys({ quiet = false } = {}) {
    try {
      const payload = await apiFetch("/api-keys", { silent: quiet, timeout: 8_000 });
      state.apiKeys = extractList(payload, ["apiKeys", "api_keys", "keys"]);
      renderApiKeys();
    } catch (error) {
      elements.apiKeyCount.textContent = "读取失败";
      elements.apiKeyList.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "api-key-empty";
      empty.textContent = error.message || "无法读取 API Key。";
      elements.apiKeyList.append(empty);
      if (!quiet) showToast(error.message || "无法读取 API Key。", "error");
    }
  }

  async function createApiKey(event) {
    event.preventDefault();
    if (elements.generateApiKey.disabled) return;
    elements.generateApiKey.disabled = true;
    try {
      const payload = await apiFetch("/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: elements.apiKeyName.value.trim() || undefined,
          model: elements.apiKeyModel.value,
          effort: elements.apiKeyEffort.value.toLowerCase(),
          speed: elements.apiKeySpeed.value.toLowerCase(),
          permission: elements.apiKeyPermission.value,
        }),
      });
      if (!payload?.key) throw new Error("服务端未返回新密钥。");
      state.revealedApiKey = payload.key;
      elements.apiKeySecret.value = payload.key;
      elements.apiKeyReveal.hidden = false;
      elements.apiKeyName.value = "";
      await loadApiKeys({ quiet: true });
      elements.apiKeySecret.focus();
      elements.apiKeySecret.select();
      showToast("API Key 已生成；完整密钥只显示这一次。", "success", 6_000);
    } catch (error) {
      showToast(error.message || "API Key 生成失败。", "error", 6_000);
    } finally {
      elements.generateApiKey.disabled = false;
    }
  }

  async function revokeApiKey(id, button) {
    if (button.dataset.confirm !== "true") {
      button.dataset.confirm = "true";
      button.classList.add("armed");
      button.textContent = "再次点击";
      window.setTimeout(() => {
        if (!button.isConnected) return;
        button.dataset.confirm = "false";
        button.classList.remove("armed");
        button.textContent = "撤销";
      }, 4_000);
      return;
    }
    button.disabled = true;
    try {
      await apiFetch(`/api-keys/${encodeURIComponent(id)}/revoke`, { method: "POST" });
      await loadApiKeys({ quiet: true });
      showToast("API Key 已撤销，后续请求将被拒绝。", "success");
    } catch (error) {
      button.disabled = false;
      showToast(error.message || "撤销失败。", "error");
    }
  }

  function openApiKeyDialog() {
    clearRevealedApiKey();
    syncApiKeyFormToCurrentConfig();
    toggleModelPopover(false);
    if (!elements.apiDialog.open) elements.apiDialog.showModal();
    void loadApiKeys({ quiet: true });
  }

  function closeApiKeyDialog() {
    clearRevealedApiKey();
    elements.apiDialog.close();
  }

  function bindEvents() {
    elements.taskPrompt.addEventListener("input", updateCharCount);
    elements.taskPrompt.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void startTask();
      }
    });
    elements.projectPath.addEventListener("input", () => {
      state.projectPathDraft = elements.projectPath.value.trim();
      state.selectedProject = { path: state.projectPathDraft };
      setStoredValue("codex.projectPath", state.projectPathDraft);
      elements.projectNote.textContent = "可粘贴 Windows 完整路径，或使用原生目录选择器";
    });
    elements.projectModeProject.addEventListener("click", () => setProjectlessMode(false));
    elements.projectModeNone.addEventListener("click", () => setProjectlessMode(true));
    elements.pickProjectButton.addEventListener("click", () => void pickProject());
    elements.folderFallback.addEventListener("change", handleBrowserFolder);
    elements.runButton.addEventListener("click", () => void startTask());
    elements.newTaskButton.addEventListener("click", newTask);
    elements.refreshHistory.addEventListener("click", () => void loadHistory());
    elements.clearLog.addEventListener("click", clearLogs);
    elements.copyResult.addEventListener("click", () => void copyResult());
    elements.sidebarOpen.addEventListener("click", openSidebar);
    elements.sidebarClose.addEventListener("click", closeSidebar);
    elements.sidebarScrim.addEventListener("click", closeSidebar);

    elements.modelTrigger.addEventListener("click", () => {
      const opened = toggleModelPopover();
      if (opened) requestAnimationFrame(() => $(".setting-row", elements.modelPopover)?.focus());
    });
    elements.modelTrigger.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        toggleModelPopover(true);
        const rows = $$(".setting-row, .reset-setting", elements.modelPopover);
        requestAnimationFrame(() => rows[event.key === "ArrowDown" ? 0 : rows.length - 1]?.focus());
      }
    });
    $$(".setting-row", elements.modelPopover).forEach((row) => {
      row.addEventListener("click", () => openSubmenu(row.dataset.setting, true));
      row.addEventListener("keydown", handleMainMenuKeydown);
    });
    elements.resetSettings.addEventListener("click", resetSettings);
    elements.resetSettings.addEventListener("keydown", handleMainMenuKeydown);
    elements.createKeyFromConfig.addEventListener("click", openApiKeyDialog);
    elements.createKeyFromConfig.addEventListener("keydown", handleMainMenuKeydown);
    document.addEventListener("pointerdown", (event) => {
      if (!elements.modelPopover.hidden && !elements.modelControl.contains(event.target)) toggleModelPopover(false);
    });

    $$('input[name="permission"]').forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked && input.value === "danger-full-access") {
          showToast("完全访问允许修改项目外文件，请确认任务来源可信。", "warning", 6_000);
        }
      });
    });

    elements.apiDocsButton.addEventListener("click", openApiKeyDialog);
    elements.closeApiDialog.addEventListener("click", closeApiKeyDialog);
    elements.confirmApiDialog.addEventListener("click", closeApiKeyDialog);
    elements.apiKeyForm.addEventListener("submit", (event) => void createApiKey(event));
    elements.copyApiKey.addEventListener("click", () => {
      void copyPlainText(state.revealedApiKey, "API Key 已复制到剪贴板。");
    });
    elements.copyApiExample.addEventListener("click", () => {
      void copyPlainText(elements.apiExampleCode.textContent, "调用示例已复制。");
    });
    elements.refreshApiKeys.addEventListener("click", () => void loadApiKeys({ quiet: false }));
    elements.apiDialog.addEventListener("close", clearRevealedApiKey);
    elements.apiDialog.addEventListener("click", (event) => {
      const rect = elements.apiDialog.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) closeApiKeyDialog();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (!elements.settingSubmenu.hidden) {
          event.preventDefault();
          closeSubmenu(true);
        } else if (!elements.modelPopover.hidden) {
          event.preventDefault();
          toggleModelPopover(false);
          elements.modelTrigger.focus();
        } else if (document.body.classList.contains("sidebar-visible")) {
          closeSidebar();
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newTask();
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        connectWebSocket();
        void checkHealth();
        if (state.currentTask?.id && isTaskActive()) void refreshCurrentTask();
      }
    });
    window.addEventListener("online", () => {
      void checkHealth({ quiet: false });
      connectWebSocket();
    });
    window.addEventListener("offline", () => setConnection("offline", "网络不可用"));
    window.addEventListener("beforeunload", () => {
      closeTaskStreams();
      if (state.socketRetry) clearTimeout(state.socketRetry);
      state.socket?.close();
    });
  }

  async function initialize() {
    elements.apiAddress.textContent = location.host || "127.0.0.1";
    elements.restEndpoint.textContent = `${location.origin}${API_BASE}`;
    updateApiExample();
    populateApiKeyModelOptions();
    loadStoredPreferences();
    bindEvents();
    updateCharCount();
    renderAllLogs();
    renderTimeline();
    setResult("");
    setConnection("checking", "正在连接");
    connectWebSocket();

    const results = await Promise.allSettled([
      checkHealth({ quiet: true }),
      loadModels(),
      loadProjects(),
      loadHistory({ quiet: true }),
      loadApiKeys({ quiet: true }),
    ]);
    if (results[0].status === "rejected") setConnection("offline", "本地服务离线");
    window.setInterval(() => void checkHealth({ quiet: true }), 30_000);
  }

  void initialize();
})();
