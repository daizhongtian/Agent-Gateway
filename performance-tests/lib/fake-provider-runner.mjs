import { performance } from "node:perf_hooks";
import { RunnerCancelledError, RunnerError } from "../../src/runner/codex-runner.js";
import { consumeSse, providerHeaders } from "./http-client.mjs";

function usageFromResponse(response) {
  const usage = response?.usage ?? {};
  return {
    input_tokens: Number(usage.input_tokens) || 0,
    cached_input_tokens: Number(usage.input_tokens_details?.cached_tokens) || 0,
    output_tokens: Number(usage.output_tokens) || 0,
    reasoning_output_tokens: Number(usage.output_tokens_details?.reasoning_tokens) || 0,
  };
}

export class FakeProviderRunner {
  constructor(options) {
    this.baseUrl = String(options.baseUrl).replace(/\/$/u, "");
    this.settings = { ...(options.settings ?? {}) };
    this.active = new Set();
    this.observations = new Map();
    this.callSequence = 0;
  }

  configure(settings = {}) {
    this.settings = { ...this.settings, ...settings };
  }

  takeObservation(prompt) {
    const queue = this.observations.get(prompt);
    const observation = queue?.shift?.() ?? null;
    if (queue && queue.length === 0) this.observations.delete(prompt);
    return observation;
  }

  run(task, options = {}) {
    const controller = new AbortController();
    const call = ++this.callSequence;
    let finished = false;
    this.active.add(controller);
    const promise = (async () => {
      const startedAt = performance.now();
      let content = "";
      let usage = null;
      let initialized = false;
      const messageId = `fake_message_${call}`;
      const threadId = `fake_thread_${call}`;
      try {
        const response = await fetch(`${this.baseUrl}/v1/responses`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...providerHeaders(this.settings),
          },
          body: JSON.stringify({
            model: "fake-model",
            input: task.prompt,
            stream: true,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new RunnerError(
            String(body?.error?.code ?? "FAKE_PROVIDER_ERROR").toUpperCase(),
            "The Fake AI Provider rejected the request.",
          );
        }

        let providerTtftMs = null;
        const stream = await consumeSse(response, {
          startedAt,
          onEvent: ({ data }, at) => {
            if (!data || data === "[DONE]") return;
            if (!initialized) {
              initialized = true;
              options.onEvent?.({ kind: "sdk", event: { type: "thread.started", thread_id: threadId } });
              options.onEvent?.({ kind: "sdk", event: { type: "turn.started" } });
              options.onEvent?.({
                kind: "sdk",
                event: { type: "item.started", item: { id: messageId, type: "agent_message", text: "" } },
              });
            }
            if (data.type === "response.output_text.delta") {
              if (providerTtftMs === null && data.delta) providerTtftMs = at - startedAt;
              content += String(data.delta ?? "");
              options.onEvent?.({
                kind: "sdk",
                event: { type: "item.updated", item: { id: messageId, type: "agent_message", text: content } },
              });
            }
            if (data.type === "response.completed") usage = usageFromResponse(data.response);
          },
        });
        options.onEvent?.({
          kind: "sdk",
          event: { type: "item.completed", item: { id: messageId, type: "agent_message", text: content } },
        });
        options.onEvent?.({ kind: "sdk", event: { type: "turn.completed", usage } });
        const observation = {
          providerLatencyMs: stream.latencyMs,
          providerTtftMs: providerTtftMs ?? stream.ttftMs,
          providerSseOrderErrors: stream.sseOrderErrors,
        };
        const queue = this.observations.get(task.prompt) ?? [];
        queue.push(observation);
        this.observations.set(task.prompt, queue);
        finished = true;
        return { content, usage, threadId };
      } catch (error) {
        if (controller.signal.aborted) throw new RunnerCancelledError();
        throw error;
      } finally {
        this.active.delete(controller);
      }
    })();
    return {
      promise,
      cancel: () => {
        if (finished || controller.signal.aborted) return false;
        controller.abort();
        return true;
      },
    };
  }

  async close() {
    for (const controller of this.active) controller.abort();
    this.active.clear();
  }
}
