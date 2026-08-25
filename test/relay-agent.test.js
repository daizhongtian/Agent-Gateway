import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { RelayAgent } from "../src/electron/relay-agent.js";

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url, protocol, options) {
    super();
    this.url = url;
    this.protocol = protocol;
    this.options = options;
    this.readyState = FakeWebSocket.OPEN;
    this.bufferedAmount = 0;
    this.terminated = false;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.#receive({
      version: 1,
      type: "WELCOME",
      sequence: 0,
      payload: {
        protocolVersion: 1,
        maxStreams: 8,
        maxChunkBytes: 64 * 1024,
        windowBytes: 1024 * 1024,
      },
    }));
  }

  send(payload, options, callback) {
    const done = typeof options === "function" ? options : callback;
    if (typeof payload === "string") {
      const frame = JSON.parse(payload);
      if (frame.type === "READY") {
        queueMicrotask(() => this.#receive({
          version: 1,
          type: "READY",
          sequence: 1,
          payload: { online: true },
        }));
      }
    }
    done?.();
  }

  close() {
    if (this.readyState >= FakeWebSocket.CLOSING) return;
    this.readyState = FakeWebSocket.CLOSED;
    queueMicrotask(() => this.emit("close"));
  }

  terminate() {
    this.terminated = true;
    this.close();
  }

  #receive(frame) {
    if (this.readyState === FakeWebSocket.OPEN) {
      this.emit("message", Buffer.from(JSON.stringify(frame)), false);
    }
  }
}

async function waitFor(predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Relay state.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("Relay reconnects when a half-open connection stops receiving heartbeat frames", async (t) => {
  FakeWebSocket.instances = [];
  let ticketRequests = 0;
  const agent = new RelayAgent({
    WebSocketImpl: FakeWebSocket,
    reconnectBaseMs: 1,
    heartbeatTimeoutMs: 25,
    heartbeatCheckMs: 5,
  });
  t.after(() => agent.stop());

  await agent.start({
    localPort: 4310,
    getTicket: async () => ({
      token: `ccc_tunnel_ticket-${++ticketRequests}`,
      relayUrl: "wss://relay.example.com/agent",
      protocolVersion: 1,
    }),
  });

  const first = FakeWebSocket.instances[0];
  await waitFor(() => ticketRequests >= 2 && agent.status().ready);

  assert.equal(first.terminated, true);
  assert.ok(FakeWebSocket.instances.length >= 2);
  assert.equal(agent.status().desired, true);
  assert.equal(agent.status().ready, true);
});
