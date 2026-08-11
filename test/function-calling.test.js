import assert from "node:assert/strict";
import test from "node:test";
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
} from "../src/server/function-calling.js";

const parameters = {
  type: "object",
  properties: { query: { type: "string" } },
  required: ["query"],
  additionalProperties: false,
};

function responseTool(overrides = {}) {
  return {
    type: "function",
    name: "search",
    description: "Search knowledge.",
    parameters,
    ...overrides,
  };
}

function chatTool(overrides = {}) {
  return {
    type: "function",
    function: {
      name: "search",
      description: "Search knowledge.",
      parameters,
      ...overrides,
    },
  };
}

function requestFailure(body, endpoint, code) {
  assert.throws(
    () => normalizeFunctionCalling(body, endpoint),
    (error) => error instanceof FunctionCallingRequestError && error.code === code,
  );
}

function modelFailure(content, configuration) {
  assert.throws(
    () => decodeFunctionDecision(content, configuration),
    (error) => error instanceof FunctionCallingModelError && error.code === "INVALID_TOOL_DECISION",
  );
}

test("function tool normalization supports Responses and Chat choices without mutating callers", () => {
  const sourceParameters = structuredClone(parameters);
  const responses = normalizeFunctionCalling({ tools: [responseTool()] }, "responses");
  assert.equal(responses.active, true);
  assert.deepEqual(responses.choice, { mode: "auto" });
  assert.equal(responses.parallel, true);
  assert.deepEqual(responseToolDefinitions(responses), [{
    type: "function",
    name: "search",
    description: "Search knowledge.",
    parameters,
    strict: false,
  }]);
  responses.tools[0].parameters.properties.query.type = "number";
  assert.deepEqual(sourceParameters, parameters);

  const none = normalizeFunctionCalling({ tools: [responseTool()], tool_choice: "none" }, "responses");
  assert.equal(none.active, false);
  assert.deepEqual(none.choice, { mode: "none" });
  const required = normalizeFunctionCalling({ tools: [responseTool()], tool_choice: "required" }, "responses");
  assert.deepEqual(required.choice, { mode: "required" });
  const forced = normalizeFunctionCalling({
    tools: [responseTool()],
    tool_choice: { type: "function", name: "search" },
    parallel_tool_calls: false,
  }, "responses");
  assert.deepEqual(forced.choice, { mode: "function", name: "search" });
  assert.equal(forced.parallel, false);
  assert.equal(functionDecisionSchema(forced).properties.calls.maxItems, 1);

  const chat = normalizeFunctionCalling({
    tools: [chatTool({ strict: true })],
    tool_choice: { type: "function", function: { name: "search" } },
  }, "chat");
  assert.deepEqual(chatToolDefinitions(chat), [{
    type: "function",
    function: {
      name: "search",
      description: "Search knowledge.",
      parameters,
      strict: true,
    },
  }]);
  assert.match(appendFunctionCallingInstructions("Question", chat), /You must call only the function "search"/);
  assert.equal(appendFunctionCallingInstructions("Question", none), "Question");
  assert.match(appendFunctionCallingInstructions("Question", required), /must select at least one/i);
});

test("function tool normalization rejects malformed and oversized client definitions", () => {
  requestFailure({ tools: {} }, "responses", "INVALID_TOOLS");
  requestFailure({ tools: Array.from({ length: 65 }, () => responseTool()) }, "responses", "TOO_MANY_TOOLS");
  requestFailure({ tools: [null] }, "responses", "UNSUPPORTED_TOOL_TYPE");
  requestFailure({ tools: [{ type: "custom", name: "x" }] }, "responses", "UNSUPPORTED_TOOL_TYPE");
  requestFailure({ tools: [{ type: "function" }] }, "chat", "INVALID_TOOL");
  requestFailure({ tools: [responseTool({ name: "bad name" })] }, "responses", "INVALID_TOOL_NAME");
  requestFailure({ tools: [responseTool({ description: 42 })] }, "responses", "INVALID_TOOL_DESCRIPTION");
  requestFailure({ tools: [responseTool({ description: "x".repeat(4_097) })] }, "responses", "INVALID_TOOL_DESCRIPTION");
  requestFailure({ tools: [responseTool({ parameters: [] })] }, "responses", "INVALID_TOOL_PARAMETERS");
  requestFailure({ tools: [responseTool({ parameters: { type: "string" } })] }, "responses", "INVALID_TOOL_PARAMETERS");
  requestFailure({
    tools: [responseTool({ parameters: { type: "object", description: "x".repeat(33_000) } })],
  }, "responses", "INVALID_TOOL_PARAMETERS");
  requestFailure({ tools: [responseTool({ strict: "yes" })] }, "responses", "INVALID_TOOL_STRICT");
  requestFailure({ tools: [responseTool(), responseTool()] }, "responses", "DUPLICATE_TOOL_NAME");
  requestFailure({ tools: [responseTool()], parallel_tool_calls: "yes" }, "responses", "INVALID_PARALLEL_TOOL_CALLS");
  requestFailure({ tool_choice: "required" }, "responses", "TOOL_CHOICE_WITHOUT_TOOLS");
  requestFailure({ tools: [responseTool()], tool_choice: "sometimes" }, "responses", "INVALID_TOOL_CHOICE");
  requestFailure({
    tools: [responseTool()],
    tool_choice: { type: "function", name: "missing" },
  }, "responses", "INVALID_TOOL_CHOICE");
});

test("tool decisions distinguish final messages, required calls, parallel calls, and stable IDs", () => {
  const automatic = normalizeFunctionCalling({ tools: [responseTool()] }, "responses");
  assert.deepEqual(decodeFunctionDecision(
    JSON.stringify({ type: "message", content: "No tool needed", calls: [] }),
    automatic,
  ), { type: "message", content: "No tool needed", calls: [] });
  const calls = decodeFunctionDecision(JSON.stringify({
    type: "function_calls",
    content: "",
    calls: [{ name: "search", arguments: { query: "magnesium" } }],
  }), automatic);
  assert.deepEqual(materializeFunctionCalls("task-id", calls), [{
    id: "fc_taskid_0",
    callId: "call_taskid_0",
    name: "search",
    arguments: '{"query":"magnesium"}',
  }]);
  assert.match(appendFunctionCallingInstructions("Question", automatic), /Decide whether a function is necessary/);

  modelFailure("not json", automatic);
  modelFailure(JSON.stringify({ type: "message" }), automatic);
  modelFailure(JSON.stringify({ type: "function_calls", content: "", calls: [] }), automatic);
  modelFailure(JSON.stringify({
    type: "function_calls",
    content: "",
    calls: [{ name: "missing", arguments: {} }],
  }), automatic);
  modelFailure(JSON.stringify({
    type: "function_calls",
    content: "",
    calls: [{ name: "search", arguments: "bad" }],
  }), automatic);

  const required = normalizeFunctionCalling({ tools: [responseTool()], tool_choice: "required" }, "responses");
  modelFailure(JSON.stringify({ type: "message", content: "wrong", calls: [] }), required);
  const forced = normalizeFunctionCalling({
    tools: [responseTool(), responseTool({ name: "other" })],
    tool_choice: { type: "function", name: "search" },
  }, "responses");
  modelFailure(JSON.stringify({
    type: "function_calls",
    content: "",
    calls: [{ name: "other", arguments: { query: "x" } }],
  }), forced);
  const single = normalizeFunctionCalling({ tools: [responseTool()], parallel_tool_calls: false }, "responses");
  modelFailure(JSON.stringify({
    type: "function_calls",
    content: "",
    calls: [
      { name: "search", arguments: { query: "one" } },
      { name: "search", arguments: { query: "two" } },
    ],
  }), single);
});

test("strict function arguments enforce common JSON Schema constraints", () => {
  const strictSchema = {
    type: "object",
    $defs: { tag: { type: "string", minLength: 2, maxLength: 5, pattern: "^[a-z]+$" } },
    properties: {
      tag: { $ref: "#/$defs/tag" },
      count: { type: "integer", minimum: 1, maximum: 4 },
      ratio: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 },
      choice: { enum: ["a", "b"] },
      fixed: { const: true },
      list: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } },
      combined: { allOf: [{ type: "string" }, { minLength: 1 }] },
      alternative: { anyOf: [{ type: "string" }, { type: "number" }] },
      exclusive: { oneOf: [{ type: "string" }, { type: "number" }] },
      allowed: { not: { type: "null" } },
    },
    required: ["tag", "count", "ratio", "choice", "fixed", "list"],
    additionalProperties: false,
  };
  const configuration = normalizeFunctionCalling({
    tools: [responseTool({ strict: true, parameters: strictSchema })],
  }, "responses");
  const validArguments = {
    tag: "abc",
    count: 2,
    ratio: 0.5,
    choice: "a",
    fixed: true,
    list: ["x"],
    combined: "x",
    alternative: 1,
    exclusive: "x",
    allowed: "yes",
  };
  assert.equal(decodeFunctionDecision(JSON.stringify({
    type: "function_calls",
    content: "",
    calls: [{ name: "search", arguments: validArguments }],
  }), configuration).calls.length, 1);

  for (const invalidArguments of [
    { ...validArguments, tag: "A" },
    { ...validArguments, count: 1.5 },
    { ...validArguments, count: 5 },
    { ...validArguments, ratio: 1 },
    { ...validArguments, choice: "c" },
    { ...validArguments, fixed: false },
    { ...validArguments, list: [] },
    { ...validArguments, list: ["a", "b", "c"] },
    { ...validArguments, list: [1] },
    { ...validArguments, combined: "" },
    { ...validArguments, alternative: null },
    { ...validArguments, exclusive: null },
    { ...validArguments, allowed: null },
    { ...validArguments, extra: true },
    { tag: "abc" },
  ]) {
    modelFailure(JSON.stringify({
      type: "function_calls",
      content: "",
      calls: [{ name: "search", arguments: invalidArguments }],
    }), configuration);
  }
});
