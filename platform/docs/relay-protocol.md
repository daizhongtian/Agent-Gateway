# Relay protocol v1

Status: **implemented for the single-node production deployment**. The desktop opens an outbound WSS connection, while the public Relay exposes the allowlisted `/h/{slug}/*` HTTP surface.

## Goals

- The desktop opens one outbound `wss://` connection. No inbound local port is exposed.
- One connection multiplexes several OpenAI-compatible HTTP requests.
- Response body chunks preserve SSE latency and ordering.
- The agent can only dispatch to the fixed loopback Agent Gateway port.
- Neither the cloud control plane nor Relay stores `ccc_live_...` credentials.

## Enrollment

1. An authenticated account creates a device record.
2. `POST /api/v1/devices/{deviceId}/pairing-code` returns an eight-character code valid for ten minutes.
3. The V3 desktop app generates a device key pair locally.
4. It calls `POST /api/v1/desktop/pair` with the code, public key, app version, and platform.
5. The server returns `deviceId` and `deviceSecret` once. The desktop stores both using the OS secure store.

Pairing code redemption is rate-limited at the Edge and must use a database lock so the same code cannot be redeemed twice.

## Tunnel Token exchange

The signed-in desktop authenticates with its platform session, device ID, Host ID, and paired device secret. The server verifies account ownership, device state, Host intent, and the hashed device secret, then issues a database-backed single-use token with a maximum five-minute lifetime bound to that device and Host.

The long-lived device secret must never be sent on the WebSocket URL or placed in application logs.

## WebSocket admission

```text
GET wss://relay.example.com/agent
Authorization: Bearer ccc_tunnel_<opaque>
Sec-WebSocket-Protocol: ccc-relay-v1
```

After admission, the Relay sends a `WELCOME` frame containing the negotiated limits. The desktop then sends `READY` and starts heartbeats.

## Frame envelope

Every text control frame is JSON:

```json
{
  "version": 1,
  "type": "REQUEST_START",
  "streamId": "str_opaque",
  "sequence": 0,
  "payload": {}
}
```

Required frame types:

```text
WELCOME
READY
PING
PONG
REQUEST_START
REQUEST_BODY
REQUEST_END
RESPONSE_START
RESPONSE_BODY
RESPONSE_END
CANCEL
WINDOW_UPDATE
ERROR
GO_AWAY
```

Large bodies use binary frames prefixed by the 16-byte UUID representation of `streamId`; JSON control frames remain below 16 KiB. `WINDOW_UPDATE` implements per-stream request and response backpressure so a slow caller cannot consume unbounded desktop or Relay memory.

## Allowlist

The public Edge and desktop agent independently enforce:

```text
GET  /v1/models
POST /v1/responses
POST /v1/chat/completions
```

An optional no-secret health path can be handled at the Edge. The agent must reject `/api/v1/*`, `/`, arbitrary URLs, absolute-form request targets, path traversal, and unsupported methods.

## Header policy

Forward only required request headers, including:

```text
Authorization
Content-Type
Accept
OpenAI-Beta
OpenAI-Organization
OpenAI-Project
X-Client-Request-Id
```

Strip `Cookie`, `Host`, `Connection`, `Upgrade`, proxy headers, and all hop-by-hop headers. The desktop recreates the loopback request with `Host: 127.0.0.1:<configured-port>` so the existing local Host-header protection remains intact.

Response headers are also allowlisted. Preserve `Content-Type`, `Cache-Control`, `X-Request-Id`, and SSE behavior; strip cookies and hop-by-hop headers.

## Presence state

```text
allocated + no tunnel       OFFLINE
healthy READY + heartbeat   ONLINE
missed heartbeat threshold  DEGRADED
socket closed               OFFLINE
owner/device disabled       DISABLED
```

Only the Relay presence service may set `ONLINE`. Account APIs can set `desiredOnline`, but that is intent rather than proof of connectivity.

## Privacy

The public Relay terminates TLS for normal OpenAI SDK compatibility and can technically observe forwarded request content. Production logging must redact authorization headers and disable request/response body logging by default.
