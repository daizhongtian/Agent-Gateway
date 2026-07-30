import { performance } from "node:perf_hooks";

export function providerHeaders(settings = {}) {
  return {
    "x-fake-initial-delay-ms": String(settings.initialDelayMs ?? 40),
    "x-fake-chunk-interval-ms": String(settings.chunkIntervalMs ?? 15),
    "x-fake-chunks": String(settings.chunks ?? 8),
    "x-fake-error-rate": String(settings.errorRate ?? 0),
    "x-fake-jitter-ms": String(settings.jitterMs ?? 0),
    "x-fake-output-bytes": String(settings.outputBytes ?? 128),
  };
}

function parseBlock(block) {
  let eventName = null;
  const data = [];
  for (const rawLine of block.split(/\r?\n/u)) {
    if (rawLine.startsWith("event:")) eventName = rawLine.slice(6).trim();
    if (rawLine.startsWith("data:")) data.push(rawLine.slice(5).trimStart());
  }
  if (!data.length) return null;
  const source = data.join("\n");
  if (source === "[DONE]") return { eventName: eventName ?? "done", data: "[DONE]" };
  try { return { eventName, data: JSON.parse(source) }; }
  catch { return { eventName, data: null, malformed: true }; }
}

function deltaText(event) {
  if (event?.type === "response.output_text.delta") return String(event.delta ?? "");
  const chatDelta = event?.choices?.[0]?.delta?.content;
  return typeof chatDelta === "string" ? chatDelta : "";
}

export async function consumeSse(response, { startedAt = performance.now(), onEvent = () => {} } = {}) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Streaming response did not include a body.");
  const decoder = new TextDecoder();
  let buffer = "";
  let bytesReceived = 0;
  let eventCount = 0;
  let firstEventAt = null;
  let firstTokenAt = null;
  let previousTokenAt = null;
  let previousEventAt = null;
  let previousSequence = null;
  let sseOrderErrors = 0;
  let malformedEvents = 0;
  let terminalSeen = false;
  let failedTerminal = false;
  const sseIntervalsMs = [];
  const sseTokenIntervalsMs = [];
  let text = "";

  const accept = async (block) => {
    const parsed = parseBlock(block);
    if (!parsed) return;
    const at = performance.now();
    if (firstEventAt === null) firstEventAt = at;
    if (previousEventAt !== null) sseIntervalsMs.push(at - previousEventAt);
    previousEventAt = at;
    eventCount += 1;
    if (parsed.malformed) {
      malformedEvents += 1;
      sseOrderErrors += 1;
      return;
    }
    if (parsed.data === "[DONE]") {
      terminalSeen = true;
      await onEvent(parsed, at);
      return;
    }
    const sequence = parsed.data?.sequence_number;
    if (Number.isInteger(sequence)) {
      if (previousSequence !== null && sequence !== previousSequence + 1) sseOrderErrors += 1;
      previousSequence = sequence;
    }
    const delta = deltaText(parsed.data);
    if (delta) {
      if (firstTokenAt === null) firstTokenAt = at;
      if (previousTokenAt !== null) sseTokenIntervalsMs.push(at - previousTokenAt);
      previousTokenAt = at;
    }
    text += delta;
    if (parsed.data?.type === "response.failed" || parsed.data?.type === "error" || parsed.data?.error) {
      failedTerminal = true;
    }
    if (parsed.data?.type === "response.completed"
      || parsed.data?.type === "response.failed"
      || parsed.data?.choices?.some?.((choice) => choice.finish_reason)) {
      terminalSeen = true;
    }
    await onEvent(parsed, at);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesReceived += value.byteLength;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.search(/\r?\n\r?\n/u)) >= 0) {
      const match = /\r?\n\r?\n/u.exec(buffer.slice(boundary));
      const separatorLength = match?.[0]?.length ?? 2;
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + separatorLength);
      await accept(block);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) await accept(buffer);
  if (eventCount > 0 && !terminalSeen) sseOrderErrors += 1;
  const completedAt = performance.now();
  return {
    latencyMs: completedAt - startedAt,
    timeToFirstEventMs: firstEventAt === null ? null : firstEventAt - startedAt,
    ttftMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
    bytesReceived,
    eventCount,
    malformedEvents,
    terminalSeen,
    failedTerminal,
    sseOrderErrors,
    sseIntervalsMs,
    sseTokenIntervalsMs,
    text,
  };
}

export async function timedFetch(url, options = {}) {
  const startedAt = performance.now();
  const response = await fetch(url, options);
  const payload = await response.arrayBuffer();
  return {
    ok: response.ok,
    status: response.status,
    latencyMs: performance.now() - startedAt,
    bytesReceived: payload.byteLength,
    headers: response.headers,
    payload,
  };
}

export async function jsonRequest(url, options = {}) {
  const headers = new Headers(options.headers);
  let body = options.body;
  if (body !== undefined && typeof body !== "string" && !ArrayBuffer.isView(body)) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }
  const response = await fetch(url, { ...options, headers, body });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* Some negative probes intentionally return no JSON. */ }
  return { response, payload, text };
}
