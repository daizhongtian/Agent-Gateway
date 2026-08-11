import { randomUUID } from "node:crypto";
import express from "express";
import { asyncRoute, HttpError } from "./errors.js";
import { hasScope } from "./auth.js";
import { listModels } from "./models.js";
import { materializeOpenAIImages } from "./openai-image-input.js";
import {
  FunctionCallingModelError,
  FunctionCallingRequestError,
  appendFunctionCallingInstructions,
  chatToolDefinitions,
  decodeFunctionDecision,
  functionDecisionSchema,
  materializeFunctionCalls,
  normalizeFunctionCalling,
  responseToolDefinitions,
} from "./function-calling.js";

const TERMINAL_TASK_STATES = new Set(["completed", "failed", "cancelled"]);
const MODEL_CREATED_AT = 1_735_689_600;

function invalidRequest(code, message, param = null) {
  return new HttpError(400, code, message, { param });
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requestBody(body) {
  if (!plainObject(body)) {
    throw invalidRequest("INVALID_REQUEST", "The request body must be a JSON object.", null);
  }
  return body;
}

function requiredModel(body) {
  if (typeof body.model !== "string" || !body.model.trim()) {
    throw invalidRequest("MODEL_REQUIRED", "model is required and must be a non-empty string.", "model");
  }
  if (body.model.length > 128) {
    throw invalidRequest("INVALID_MODEL", "model must not exceed 128 characters.", "model");
  }
  return body.model.trim();
}

function streamRequested(body) {
  if (body.stream !== undefined && typeof body.stream !== "boolean") {
    throw invalidRequest("INVALID_STREAM", "stream must be a boolean.", "stream");
  }
  return body.stream === true;
}

function ensureCommonOptions(body) {
  if (body.n !== undefined && body.n !== 1) {
    throw invalidRequest("UNSUPPORTED_PARAMETER", "Only n=1 is supported.", "n");
  }
}

function normalizeFunctionConfiguration(body, endpoint) {
  try {
    return normalizeFunctionCalling(body, endpoint);
  } catch (error) {
    if (error instanceof FunctionCallingRequestError) {
      throw invalidRequest(error.code, error.message, error.param);
    }
    throw error;
  }
}

function parsedFunctionArguments(value, param) {
  if (typeof value !== "string") {
    throw invalidRequest("INVALID_TOOL_ARGUMENTS", "Function arguments must be a JSON string.", param);
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidRequest("INVALID_TOOL_ARGUMENTS", "Function arguments must contain valid JSON.", param);
  }
  if (!plainObject(parsed)) {
    throw invalidRequest("INVALID_TOOL_ARGUMENTS", "Function arguments must decode to a JSON object.", param);
  }
  return parsed;
}

function renderedToolOutput(value, param) {
  if (typeof value === "string") return value;
  if (value === null || typeof value === "number" || typeof value === "boolean" || plainObject(value) || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  throw invalidRequest("INVALID_TOOL_OUTPUT", "Tool output must be JSON-compatible or a string.", param);
}

function knownFunction(configuration, name, param) {
  if (!configuration.tools.some((tool) => tool.name === name)) {
    throw invalidRequest("UNKNOWN_TOOL", "The function call names a tool that is not present in tools.", param);
  }
}

function imageUrl(value, param) {
  const source = typeof value === "string"
    ? value
    : plainObject(value) && typeof value.url === "string"
      ? value.url
      : null;
  const sourceParam = plainObject(value) ? `${param}.url` : param;
  if (!source?.trim()) {
    throw invalidRequest("INVALID_IMAGE_URL", "image_url must contain a non-empty URL.", sourceParam);
  }
  return { source: source.trim(), param: sourceParam };
}

function validateImageDetail(value, param) {
  if (value === undefined) return;
  if (!new Set(["auto", "low", "high", "original"]).has(value)) {
    throw invalidRequest("INVALID_IMAGE_DETAIL", "Image detail must be auto, low, high, or original.", param);
  }
}

function imagePart(part, param, options) {
  if (options.role !== "user") {
    throw invalidRequest(
      "UNSUPPORTED_CONTENT_TYPE",
      "Image content is supported only in user messages.",
      param,
    );
  }
  let source;
  if (options.imageType === "image_url") {
    source = imageUrl(part.image_url, `${param}.image_url`);
    validateImageDetail(
      plainObject(part.image_url) ? part.image_url.detail ?? part.detail : part.detail,
      `${param}.image_url.detail`,
    );
  } else {
    if (part.file_id !== undefined && part.image_url === undefined) {
      throw invalidRequest(
        "UNSUPPORTED_PARAMETER",
        "Image file IDs are not supported; send a base64 image data URL in image_url.",
        `${param}.file_id`,
      );
    }
    source = imageUrl(part.image_url, `${param}.image_url`);
    validateImageDetail(part.detail, `${param}.detail`);
  }
  options.images.push(source);
  return `\n[Image ${options.images.length} attached]\n`;
}

function contentPart(part, param, allowedTypes, options) {
  if (typeof part === "string") return part;
  if (plainObject(part) && allowedTypes.has(part.type) && typeof part.text === "string") {
    return part.text;
  }
  if (plainObject(part) && part.type === options.imageType) {
    return imagePart(part, param, options);
  }
  throw invalidRequest(
    "UNSUPPORTED_CONTENT_TYPE",
    "Only text and base64 PNG, JPEG, or WebP image content are supported by this endpoint.",
    param,
  );
}

function messageText(message, param, allowedTypes, options) {
  if (typeof message.content === "string") return message.content;
  if (message.content === null && message.role === "assistant") return "";
  if (!Array.isArray(message.content)) {
    throw invalidRequest(
      "INVALID_MESSAGE_CONTENT",
      "Message content must be text or an array of text and image parts.",
      param,
    );
  }
  return message.content.map((part, index) => contentPart(
    part,
    `${param}.content[${index}]`,
    allowedTypes,
    { ...options, role: message.role },
  )).join("");
}

function renderConversation(messages, instructions = "") {
  if (!instructions && messages.length === 1 && messages[0].role === "user") {
    return messages[0].text;
  }
  const sections = [];
  if (instructions) sections.push(`DEVELOPER INSTRUCTIONS:\n${instructions}`);
  for (const message of messages) {
    sections.push(`${message.role.toUpperCase()}:\n${message.text}`);
  }
  return sections.join("\n\n");
}

function normalizeChatRequest(rawBody) {
  const body = requestBody(rawBody);
  const model = requiredModel(body);
  const stream = streamRequested(body);
  ensureCommonOptions(body);
  const functionCalling = normalizeFunctionConfiguration(body, "chat");
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw invalidRequest("MESSAGES_REQUIRED", "messages must be a non-empty array.", "messages");
  }
  const allowedRoles = new Set(["developer", "system", "user", "assistant", "tool"]);
  const allowedTypes = new Set(["text", "input_text", "output_text"]);
  const images = [];
  const knownCallIds = new Set();
  const messages = body.messages.map((message, index) => {
    const param = `messages[${index}]`;
    if (!plainObject(message) || !allowedRoles.has(message.role)) {
      throw invalidRequest(
        "UNSUPPORTED_MESSAGE_ROLE",
        "Only developer, system, user, assistant, and tool messages are supported.",
        `${param}.role`,
      );
    }
    if (message.function_call) {
      throw invalidRequest("UNSUPPORTED_PARAMETER", "Legacy function_call messages are not supported; use tool_calls.", `${param}.function_call`);
    }
    if (message.role === "tool") {
      if (typeof message.tool_call_id !== "string" || !knownCallIds.has(message.tool_call_id)) {
        throw invalidRequest(
          "UNKNOWN_TOOL_CALL",
          "tool_call_id must reference an earlier assistant tool call in this request.",
          `${param}.tool_call_id`,
        );
      }
      return {
        role: "tool",
        text: `FUNCTION RESULT ${message.tool_call_id}:\n${renderedToolOutput(message.content, `${param}.content`)}`,
      };
    }
    const text = messageText(message, param, allowedTypes, { images, imageType: "image_url" });
    if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) {
      throw invalidRequest("INVALID_TOOL_CALLS", "tool_calls must be an array.", `${param}.tool_calls`);
    }
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
      if (message.role !== "assistant") {
        throw invalidRequest("INVALID_TOOL_CALLS", "Only assistant messages may contain tool_calls.", `${param}.tool_calls`);
      }
      const calls = message.tool_calls.map((call, callIndex) => {
        const callParam = `${param}.tool_calls[${callIndex}]`;
        if (!plainObject(call) || call.type !== "function" || !plainObject(call.function)
          || typeof call.id !== "string" || !call.id || typeof call.function.name !== "string") {
          throw invalidRequest("INVALID_TOOL_CALL", "Each tool call must be a named function with an id.", callParam);
        }
        knownFunction(functionCalling, call.function.name, `${callParam}.function.name`);
        const argumentsObject = parsedFunctionArguments(call.function.arguments, `${callParam}.function.arguments`);
        knownCallIds.add(call.id);
        return { call_id: call.id, name: call.function.name, arguments: argumentsObject };
      });
      return {
        role: "assistant",
        text: [text, `FUNCTION CALLS:\n${JSON.stringify(calls)}`].filter(Boolean).join("\n\n"),
      };
    }
    return { role: message.role, text };
  });
  const prompt = appendFunctionCallingInstructions(renderConversation(messages), functionCalling);
  if (!prompt.trim()) throw invalidRequest("EMPTY_INPUT", "messages must contain text.", "messages");
  const includeUsage = plainObject(body.stream_options) && body.stream_options.include_usage === true;
  return {
    body,
    model,
    stream,
    prompt,
    includeUsage,
    images,
    functionCalling,
    outputSchema: functionCalling.active ? functionDecisionSchema(functionCalling) : null,
  };
}

function normalizeResponseInput(input, images, functionCalling) {
  if (typeof input === "string") return [{ role: "user", text: input }];
  if (!Array.isArray(input) || input.length === 0) {
    throw invalidRequest("INPUT_REQUIRED", "input must be a non-empty string or array.", "input");
  }
  const allowedRoles = new Set(["developer", "system", "user", "assistant"]);
  const allowedTypes = new Set(["input_text", "output_text", "text"]);
  const knownCallIds = new Set();
  return input.map((item, index) => {
    const param = `input[${index}]`;
    if (typeof item === "string") return { role: "user", text: item };
    if (!plainObject(item)) {
      throw invalidRequest("INVALID_INPUT", "Each input item must be a message or text item.", param);
    }
    if (item.type === "input_text" && typeof item.text === "string") {
      return { role: "user", text: item.text };
    }
    if (item.type === "input_image") {
      return {
        role: "user",
        text: imagePart(item, param, { images, imageType: "input_image", role: "user" }),
      };
    }
    if (item.type === "function_call") {
      if (typeof item.call_id !== "string" || !item.call_id || typeof item.name !== "string") {
        throw invalidRequest("INVALID_TOOL_CALL", "A function_call requires call_id and name.", param);
      }
      knownFunction(functionCalling, item.name, `${param}.name`);
      const argumentsObject = parsedFunctionArguments(item.arguments, `${param}.arguments`);
      knownCallIds.add(item.call_id);
      return {
        role: "assistant",
        text: `FUNCTION CALL:\n${JSON.stringify({ call_id: item.call_id, name: item.name, arguments: argumentsObject })}`,
      };
    }
    if (item.type === "function_call_output") {
      if (typeof item.call_id !== "string" || !knownCallIds.has(item.call_id)) {
        throw invalidRequest(
          "UNKNOWN_TOOL_CALL",
          "call_id must reference an earlier function_call item in this request.",
          `${param}.call_id`,
        );
      }
      return {
        role: "tool",
        text: `FUNCTION RESULT ${item.call_id}:\n${renderedToolOutput(item.output, `${param}.output`)}`,
      };
    }
    if ((item.type !== undefined && item.type !== "message") || !allowedRoles.has(item.role)) {
      throw invalidRequest(
        "UNSUPPORTED_INPUT_TYPE",
        "Only text, messages, function calls, function results, and supported image input are accepted.",
        param,
      );
    }
    return {
      role: item.role,
      text: messageText(item, param, allowedTypes, { images, imageType: "input_image" }),
    };
  });
}

function normalizeResponsesRequest(rawBody) {
  const body = requestBody(rawBody);
  const model = requiredModel(body);
  const stream = streamRequested(body);
  ensureCommonOptions(body);
  const functionCalling = normalizeFunctionConfiguration(body, "responses");
  if (body.previous_response_id !== undefined && body.previous_response_id !== null) {
    throw invalidRequest(
      "UNSUPPORTED_PARAMETER",
      "previous_response_id is not supported; send the conversation in input.",
      "previous_response_id",
    );
  }
  if (body.conversation !== undefined && body.conversation !== null) {
    throw invalidRequest("UNSUPPORTED_PARAMETER", "conversation is not supported.", "conversation");
  }
  if (body.instructions !== undefined && typeof body.instructions !== "string") {
    throw invalidRequest("INVALID_INSTRUCTIONS", "instructions must be a string.", "instructions");
  }
  const images = [];
  const messages = normalizeResponseInput(body.input, images, functionCalling);
  const prompt = appendFunctionCallingInstructions(
    renderConversation(messages, body.instructions ?? ""),
    functionCalling,
  );
  if (!prompt.trim()) throw invalidRequest("EMPTY_INPUT", "input must contain text.", "input");
  return {
    body,
    model,
    stream,
    prompt,
    images,
    functionCalling,
    outputSchema: functionCalling.active ? functionDecisionSchema(functionCalling) : null,
  };
}

function compactId(value) {
  return String(value).replace(/[^A-Za-z0-9]/g, "");
}

function taskIds(task) {
  const suffix = compactId(task.id) || compactId(randomUUID());
  return {
    response: `resp_${suffix}`,
    message: `msg_${suffix}`,
    chat: `chatcmpl-${suffix}`,
  };
}

function unixTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : Math.floor(Date.now() / 1_000);
}

function tokenCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function responseUsage(source) {
  const inputTokens = tokenCount(source?.input_tokens ?? source?.inputTokens);
  const cachedTokens = tokenCount(source?.cached_input_tokens ?? source?.cachedInputTokens);
  const outputTokens = tokenCount(source?.output_tokens ?? source?.outputTokens);
  const reasoningTokens = tokenCount(source?.reasoning_output_tokens ?? source?.reasoningOutputTokens);
  return {
    input_tokens: inputTokens,
    input_tokens_details: { cached_tokens: cachedTokens },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: reasoningTokens },
    total_tokens: inputTokens + outputTokens,
  };
}

function chatUsage(source) {
  const usage = responseUsage(source);
  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    prompt_tokens_details: { cached_tokens: usage.input_tokens_details.cached_tokens },
    completion_tokens_details: { reasoning_tokens: usage.output_tokens_details.reasoning_tokens },
  };
}

function responseOutputItem(task, content, status = "completed") {
  const ids = taskIds(task);
  return {
    id: ids.message,
    type: "message",
    status,
    role: "assistant",
    content: status === "in_progress" ? [] : [{
      type: "output_text",
      annotations: [],
      logprobs: [],
      text: content,
    }],
  };
}

function modelToolDecision(task, normalized) {
  if (!normalized.functionCalling?.active) {
    return { type: "message", content: task.result?.content ?? "", calls: [] };
  }
  try {
    return decodeFunctionDecision(task.result?.content, normalized.functionCalling);
  } catch (error) {
    if (error instanceof FunctionCallingModelError) {
      throw new HttpError(502, error.code, error.message);
    }
    throw error;
  }
}

function taskFunctionCalls(task, normalized, decision = modelToolDecision(task, normalized)) {
  return materializeFunctionCalls(task.id, decision);
}

function responseFunctionCallItem(call, status = "completed", argumentsValue = call.arguments) {
  return {
    id: call.id,
    type: "function_call",
    status,
    arguments: argumentsValue,
    call_id: call.callId,
    name: call.name,
  };
}

function completedResponseOutput(task, normalized) {
  const decision = modelToolDecision(task, normalized);
  if (decision.type === "message") return [responseOutputItem(task, decision.content)];
  return taskFunctionCalls(task, normalized, decision).map((call) => responseFunctionCallItem(call));
}

function responseObject(task, request, options = {}) {
  const ids = taskIds(task);
  const status = options.status ?? task.status;
  const completed = status === "completed";
  const failed = status === "failed";
  return {
    id: ids.response,
    object: "response",
    created_at: unixTime(task.createdAt),
    status,
    background: false,
    completed_at: completed ? unixTime(task.completedAt) : null,
    error: failed ? {
      code: normalizeErrorCode(task.error?.code ?? "server_error"),
      message: "The model failed to generate a response.",
    } : null,
    incomplete_details: null,
    instructions: request.body.instructions ?? null,
    max_output_tokens: Number.isInteger(request.body.max_output_tokens) ? request.body.max_output_tokens : null,
    model: task.model,
    output: completed ? completedResponseOutput(task, request) : [],
    parallel_tool_calls: request.functionCalling?.parallel ?? true,
    previous_response_id: null,
    reasoning: { effort: task.effort ?? null, summary: null },
    service_tier: "default",
    store: request.body.store !== false,
    temperature: typeof request.body.temperature === "number" ? request.body.temperature : 1,
    text: { format: { type: "text" }, verbosity: "medium" },
    tool_choice: request.body.tool_choice ?? "auto",
    tools: request.functionCalling ? responseToolDefinitions(request.functionCalling) : [],
    top_logprobs: 0,
    top_p: typeof request.body.top_p === "number" ? request.body.top_p : 1,
    truncation: "disabled",
    usage: completed ? responseUsage(task.usage) : null,
    user: typeof request.body.user === "string" ? request.body.user : null,
    metadata: plainObject(request.body.metadata) ? request.body.metadata : {},
  };
}

function chatCompletionObject(task, normalized) {
  const ids = taskIds(task);
  const decision = modelToolDecision(task, normalized);
  const calls = decision.type === "function_calls" ? taskFunctionCalls(task, normalized, decision) : [];
  return {
    id: ids.chat,
    object: "chat.completion",
    created: unixTime(task.createdAt),
    model: task.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: decision.type === "message" ? decision.content : null,
        refusal: null,
        annotations: [],
        ...(calls.length ? {
          tool_calls: calls.map((call) => ({
            id: call.callId,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          })),
        } : {}),
      },
      logprobs: null,
      finish_reason: calls.length ? "tool_calls" : "stop",
    }],
    usage: chatUsage(task.usage),
    service_tier: "default",
    system_fingerprint: null,
  };
}

function chatChunk(task, delta, finishReason = null, choices = undefined) {
  const ids = taskIds(task);
  return {
    id: ids.chat,
    object: "chat.completion.chunk",
    created: unixTime(task.createdAt),
    model: task.model,
    choices: choices ?? [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
    system_fingerprint: null,
  };
}

function taskFailure(task) {
  const error = new HttpError(
    500,
    task.error?.code ?? (task.status === "cancelled" ? "REQUEST_CANCELLED" : "MODEL_GENERATION_FAILED"),
    task.error?.message ?? "The model failed to generate a response.",
  );
  error.taskFailure = true;
  return error;
}

function currentTask(taskManager, id) {
  return taskManager.public(taskManager.get(id), { includeEvents: false });
}

function waitForTerminalTask(taskManager, id) {
  const initial = currentTask(taskManager, id);
  if (TERMINAL_TASK_STATES.has(initial.status)) return Promise.resolve(initial);
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    let stopOnManagerClose = () => {};
    const cleanup = () => {
      unsubscribe();
      stopOnManagerClose();
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        resolve(currentTask(taskManager, id));
      } catch (error) {
        reject(error);
      }
    };
    unsubscribe = taskManager.subscribe(id, (event) => {
      if (event.type === "done") finish();
    });
    stopOnManagerClose = taskManager.onClose(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new HttpError(503, "SERVER_SHUTTING_DOWN", "The server is shutting down."));
    });
    try {
      if (TERMINAL_TASK_STATES.has(currentTask(taskManager, id).status)) finish();
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
    }
  });
}

function normalizeErrorCode(code) {
  return String(code ?? "server_error")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "server_error";
}

export function publicOpenAIError(error) {
  let status = Number.isInteger(error?.status) ? error.status : 500;
  let code = error?.code;
  let message = error?.message;
  let param = error?.details?.param ?? null;
  if (error?.type === "entity.parse.failed") {
    status = 400;
    code = "INVALID_JSON";
    message = "The request body is not valid JSON.";
    param = null;
  } else if (error?.type === "entity.too.large") {
    status = 413;
    code = "REQUEST_TOO_LARGE";
    message = "The request body is too large.";
    param = null;
  }
  const type = status === 401
    ? "authentication_error"
    : status === 403
      ? "permission_error"
      : status === 429
        ? "rate_limit_error"
        : status >= 500
          ? "server_error"
          : "invalid_request_error";
  if (status >= 500 && code !== "GATEWAY_DISABLED" && !error?.taskFailure) {
    message = "The server could not complete the request.";
  }
  if (error?.taskFailure) message = "The model failed to generate a response.";
  return {
    status,
    body: {
      error: {
        message: typeof message === "string" && message ? message : "The request could not be completed.",
        type,
        param,
        code: normalizeErrorCode(code ?? (status >= 500 ? "server_error" : "invalid_request")),
      },
    },
  };
}

function requireScope(request, scope) {
  if (!hasScope(request.auth, scope)) {
    throw new HttpError(403, "FORBIDDEN", "This API key does not grant the required scope.");
  }
}

function taskInput(request, normalized) {
  const input = {
    prompt: normalized.prompt,
    projectless: true,
  };
  if (plainObject(normalized.outputSchema)) input.outputSchema = normalized.outputSchema;
  if (Array.isArray(normalized.imageIds) && normalized.imageIds.length) {
    input.imageIds = normalized.imageIds;
  }
  if (!request.auth?.taskPreset) {
    input.model = normalized.model;
    const effort = normalized.body.reasoning?.effort ?? normalized.body.reasoning_effort;
    if (typeof effort === "string") input.effort = effort;
    if (normalized.body.service_tier === "priority") input.speed = "fast";
  }
  return input;
}

async function createTaskWithImages(options) {
  const {
    request,
    normalized,
    attachmentStore,
    createTask,
  } = options;
  const prepared = await materializeOpenAIImages(normalized.images, {
    attachmentStore,
    ownerId: request.auth.sub,
  });
  try {
    return createTask(request, taskInput(request, {
      ...normalized,
      imageIds: prepared.imageIds,
    }));
  } catch (error) {
    prepared.discard();
    throw error;
  }
}

function cancelTaskQuietly(taskManager, id) {
  try {
    const task = currentTask(taskManager, id);
    if (!TERMINAL_TASK_STATES.has(task.status)) taskManager.cancel(id);
  } catch {
    // The task may have completed or been pruned while the connection closed.
  }
}

function writeResponseEvent(response, event) {
  response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  response.flush?.();
}

function writeChatData(response, data) {
  response.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
  response.flush?.();
}

function openStream(response) {
  response.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
}

function startTaskEventBridge(taskManager, taskId, listener) {
  let cursor = 0;
  let initializing = true;
  const pending = [];
  const handle = (event) => {
    if (!event || event.id <= cursor) return;
    cursor = event.id;
    listener(event);
  };
  const unsubscribe = taskManager.subscribe(taskId, (event) => {
    if (initializing) pending.push(event);
    else handle(event);
  });
  for (const event of taskManager.eventsAfter(taskId, 0)) handle(event);
  initializing = false;
  pending.sort((left, right) => left.id - right.id).forEach(handle);
  return unsubscribe;
}

function agentMessageDelta(event, state) {
  if (event.type !== "log" && event.type !== "step") return "";
  const item = event.data?.item;
  if (item?.type !== "agent_message" || typeof item.text !== "string") return "";
  const itemId = typeof item.id === "string" ? item.id : "agent-message";
  const previous = state.itemText.get(itemId) ?? "";
  state.itemText.set(itemId, item.text);
  if (item.text.startsWith(previous)) return item.text.slice(previous.length);
  return previous ? "" : item.text;
}

function streamLifecycle(options) {
  const {
    response,
    request,
    taskManager,
    task,
    registerCredentialStream,
    releaseStream,
    onEvent,
  } = options;
  let closed = false;
  let terminal = false;
  let unsubscribe = () => {};
  let stopOnManagerClose = () => {};
  let unregisterCredential = () => {};
  const close = ({ cancel = false } = {}) => {
    if (closed) return;
    closed = true;
    unsubscribe();
    stopOnManagerClose();
    unregisterCredential();
    releaseStream();
    if (cancel && !terminal) cancelTaskQuietly(taskManager, task.id);
    if (!response.writableEnded) response.end();
  };
  unregisterCredential = registerCredentialStream(request.auth?.credentialId, () => close());
  stopOnManagerClose = taskManager.onClose(() => close());
  response.once("close", () => close({ cancel: !terminal }));
  unsubscribe = startTaskEventBridge(taskManager, task.id, (event) => {
    if (closed) return;
    if (event.type === "done") terminal = true;
    onEvent(event, {
      close,
      terminalTask: () => currentTask(taskManager, task.id),
    });
  });
  if (closed) unsubscribe();
  return { close };
}

function streamResponses(options) {
  const { response, request, taskManager, task, normalized } = options;
  openStream(response);
  let sequence = 0;
  const state = { itemText: new Map(), text: "" };
  const send = (type, data = {}) => writeResponseEvent(response, {
    type,
    ...data,
    sequence_number: sequence++,
  });
  send("response.created", {
    response: responseObject(task, normalized, { status: "in_progress", content: "" }),
  });
  send("response.in_progress", {
    response: responseObject(task, normalized, { status: "in_progress", content: "" }),
  });
  if (normalized.functionCalling?.active) {
    streamLifecycle({
      ...options,
      onEvent(event, controls) {
        if (event.type !== "done") return;
        const finished = controls.terminalTask();
        if (finished.status !== "completed") {
          send("response.failed", {
            response: responseObject(finished, normalized, { status: "failed" }),
          });
          controls.close();
          return;
        }
        try {
          const decision = modelToolDecision(finished, normalized);
          if (decision.type === "message") {
            const outputItem = responseOutputItem(finished, "", "in_progress");
            send("response.output_item.added", { output_index: 0, item: outputItem });
            send("response.content_part.added", {
              item_id: outputItem.id,
              output_index: 0,
              content_index: 0,
              part: { type: "output_text", annotations: [], logprobs: [], text: "" },
            });
            if (decision.content) {
              send("response.output_text.delta", {
                item_id: outputItem.id,
                output_index: 0,
                content_index: 0,
                delta: decision.content,
                logprobs: [],
              });
            }
            const part = { type: "output_text", annotations: [], logprobs: [], text: decision.content };
            send("response.output_text.done", {
              item_id: outputItem.id,
              output_index: 0,
              content_index: 0,
              text: decision.content,
              logprobs: [],
            });
            send("response.content_part.done", {
              item_id: outputItem.id,
              output_index: 0,
              content_index: 0,
              part,
            });
            send("response.output_item.done", {
              output_index: 0,
              item: responseOutputItem(finished, decision.content),
            });
          } else {
            for (const [outputIndex, call] of taskFunctionCalls(finished, normalized, decision).entries()) {
              send("response.output_item.added", {
                output_index: outputIndex,
                item: responseFunctionCallItem(call, "in_progress", ""),
              });
              if (call.arguments) {
                send("response.function_call_arguments.delta", {
                  item_id: call.id,
                  output_index: outputIndex,
                  delta: call.arguments,
                });
              }
              send("response.function_call_arguments.done", {
                item_id: call.id,
                output_index: outputIndex,
                arguments: call.arguments,
              });
              send("response.output_item.done", {
                output_index: outputIndex,
                item: responseFunctionCallItem(call),
              });
            }
          }
          send("response.completed", { response: responseObject(finished, normalized) });
        } catch (error) {
          const failed = responseObject(finished, normalized, { status: "failed" });
          failed.error = {
            code: normalizeErrorCode(error?.code ?? "INVALID_TOOL_DECISION"),
            message: "The model returned an invalid function-calling response.",
          };
          send("response.failed", { response: failed });
        }
        controls.close();
      },
    });
    return;
  }
  const outputItem = responseOutputItem(task, "", "in_progress");
  send("response.output_item.added", { output_index: 0, item: outputItem });
  send("response.content_part.added", {
    item_id: outputItem.id,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", annotations: [], logprobs: [], text: "" },
  });
  const append = (delta) => {
    if (!delta) return;
    state.text += delta;
    send("response.output_text.delta", {
      item_id: outputItem.id,
      output_index: 0,
      content_index: 0,
      delta,
      logprobs: [],
    });
  };
  streamLifecycle({
    ...options,
    onEvent(event, controls) {
      if (!normalized.functionCalling?.active) append(agentMessageDelta(event, state));
      if (event.type !== "done") return;
      const finished = controls.terminalTask();
      if (finished.status !== "completed") {
        send("response.failed", {
          response: responseObject(finished, normalized, { status: "failed", content: "" }),
        });
        controls.close();
        return;
      }
      const finalText = finished.result?.content ?? "";
      if (finalText.startsWith(state.text)) append(finalText.slice(state.text.length));
      send("response.output_text.done", {
        item_id: outputItem.id,
        output_index: 0,
        content_index: 0,
        text: finalText,
        logprobs: [],
      });
      const part = { type: "output_text", annotations: [], logprobs: [], text: finalText };
      send("response.content_part.done", {
        item_id: outputItem.id,
        output_index: 0,
        content_index: 0,
        part,
      });
      send("response.output_item.done", {
        output_index: 0,
        item: responseOutputItem(finished, finalText),
      });
      send("response.completed", { response: responseObject(finished, normalized) });
      controls.close();
    },
  });
}

function streamChatCompletion(options) {
  const { response, task, normalized } = options;
  openStream(response);
  const state = { itemText: new Map(), text: "" };
  const sendChunk = (chunk) => writeChatData(response, {
    ...chunk,
    ...(normalized.includeUsage ? { usage: null } : {}),
  });
  sendChunk(chatChunk(task, { role: "assistant", content: "" }));
  const append = (delta) => {
    if (!delta) return;
    state.text += delta;
    sendChunk(chatChunk(task, { content: delta }));
  };
  streamLifecycle({
    ...options,
    onEvent(event, controls) {
      append(agentMessageDelta(event, state));
      if (event.type !== "done") return;
      const finished = controls.terminalTask();
      if (finished.status !== "completed") {
        const error = publicOpenAIError(taskFailure(finished));
        writeChatData(response, error.body);
        writeChatData(response, "[DONE]");
        controls.close();
        return;
      }
      let finishReason = "stop";
      try {
        if (normalized.functionCalling?.active) {
          const decision = modelToolDecision(finished, normalized);
          if (decision.type === "message") {
            append(decision.content);
          } else {
            const calls = taskFunctionCalls(finished, normalized, decision);
            sendChunk(chatChunk(finished, {
              tool_calls: calls.map((call, index) => ({
                index,
                id: call.callId,
                type: "function",
                function: { name: call.name, arguments: call.arguments },
              })),
            }));
            finishReason = "tool_calls";
          }
        } else {
          const finalText = finished.result?.content ?? "";
          if (finalText.startsWith(state.text)) append(finalText.slice(state.text.length));
        }
      } catch (error) {
        writeChatData(response, publicOpenAIError(error).body);
        writeChatData(response, "[DONE]");
        controls.close();
        return;
      }
      sendChunk(chatChunk(finished, {}, finishReason));
      if (normalized.includeUsage) {
        writeChatData(response, {
          ...chatChunk(finished, {}, null, []),
          usage: chatUsage(finished.usage),
        });
      }
      writeChatData(response, "[DONE]");
      controls.close();
    },
  });
}

export function createOpenAICompatibilityRouter(options) {
  const {
    auth,
    apiKeyStore,
    taskManager,
    attachmentStore,
    createTask,
    jsonBody = express.json({ limit: "36mb", strict: true }),
    registerCredentialStream = () => () => {},
    acquireStream = () => () => {},
  } = options;
  const router = express.Router();

  router.use(asyncRoute(async (request, response, next) => {
    if (!apiKeyStore.gatewayStatus().enabled) {
      throw new HttpError(503, "GATEWAY_DISABLED", "The external API Host is currently turned off.");
    }
    const principal = await auth.resolveBearer(request.get("authorization"), request);
    if (!principal) {
      response.set("WWW-Authenticate", 'Bearer realm="openai-compatible-api"');
      throw new HttpError(401, "INVALID_API_KEY", "A valid Bearer API key is required.");
    }
    request.auth = principal;
    next();
  }));

  router.get("/models", (request, response, next) => {
    try {
      requireScope(request, "models:read");
      const preset = request.auth.taskPreset;
      const models = preset
        ? [{ id: preset.model, label: preset.modelLabel }]
        : listModels();
      response.json({
        object: "list",
        data: models.map((model) => ({
          id: model.id,
          object: "model",
          created: MODEL_CREATED_AT,
      owned_by: "agent-gateway",
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/responses", jsonBody, asyncRoute(async (request, response) => {
    requireScope(request, "tasks:write");
    const normalized = normalizeResponsesRequest(request.body);
    let releaseStream = () => {};
    if (normalized.stream) releaseStream = acquireStream(request.auth?.credentialId);
    let task;
    try {
      task = await createTaskWithImages({ request, normalized, attachmentStore, createTask });
    } catch (error) {
      releaseStream();
      throw error;
    }
    if (normalized.stream) {
      streamResponses({
        response,
        request,
        taskManager,
        task,
        normalized,
        registerCredentialStream,
        releaseStream,
      });
      return;
    }
    const abort = () => {
      if (!response.writableEnded) cancelTaskQuietly(taskManager, task.id);
    };
    response.once("close", abort);
    const finished = await waitForTerminalTask(taskManager, task.id);
    response.off("close", abort);
    if (finished.status !== "completed") throw taskFailure(finished);
    response.json(responseObject(finished, normalized));
  }));

  router.post("/chat/completions", jsonBody, asyncRoute(async (request, response) => {
    requireScope(request, "tasks:write");
    const normalized = normalizeChatRequest(request.body);
    let releaseStream = () => {};
    if (normalized.stream) releaseStream = acquireStream(request.auth?.credentialId);
    let task;
    try {
      task = await createTaskWithImages({ request, normalized, attachmentStore, createTask });
    } catch (error) {
      releaseStream();
      throw error;
    }
    if (normalized.stream) {
      streamChatCompletion({
        response,
        request,
        taskManager,
        task,
        normalized,
        registerCredentialStream,
        releaseStream,
      });
      return;
    }
    const abort = () => {
      if (!response.writableEnded) cancelTaskQuietly(taskManager, task.id);
    };
    response.once("close", abort);
    const finished = await waitForTerminalTask(taskManager, task.id);
    response.off("close", abort);
    if (finished.status !== "completed") throw taskFailure(finished);
    response.json(chatCompletionObject(finished, normalized));
  }));

  return router;
}
