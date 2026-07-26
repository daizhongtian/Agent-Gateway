# Codex Control Center

[简体中文](README.md) | [English](README_EN.md)

Codex Control Center is a Windows desktop console for the Codex SDK. It brings task input, model and reasoning controls, project management, file permissions, live status, logs, results, API keys, and usage monitoring into one application. The same backend also exposes HTTP APIs for scripts, IDE extensions, and internal tools.

> [!IMPORTANT]
> Codex Control Center is an independent community project. It is not an OpenAI product and is not developed, endorsed, or supported by OpenAI. Codex, OpenAI, and related marks belong to their respective owners. You remain responsible for complying with the terms that apply to your OpenAI/Codex account and services.

## Quick start: use it as an OpenAI-compatible Host

A third-party application normally needs only two connection settings. Requests go to Codex Control Center and are converted into local Codex SDK tasks. This is a simulated OpenAI-compatible protocol surface, not an OpenAI API proxy, and `/v1` requests are never forwarded to `api.openai.com`:

```text
base_url = https://zhongtian.tail61e438.ts.net/v1
api_key  = ccc_live_GatewayKeyGeneratedByThisApp
```

- Use the HTTPS address above for public access. On the Host computer, use `http://127.0.0.1:4310/v1` instead.
- A `ccc_live_...` value is a Codex Control Center Gateway key created by the Host administrator. It is **not an OpenAI API key**.
- The OpenAI Python SDK is used only as a compatible client. Tasks are executed by the Codex SDK and Codex login on the Host computer.
- Never put a real key in source code, a README, screenshots, or chat. Give each caller a separate key so usage and revocation remain independent.
- The Host computer, Codex Control Center, Tailscale, API Host, and public Host must remain online.
- The **Check online** button next to `OPENAI HOST` verifies the real public HTTPS route, OpenAI authentication behavior, and `X-Request-Id` without sending a real Gateway key.

Existing programs can keep using the official OpenAI Python SDK and replace only `base_url` and `api_key`:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://zhongtian.tail61e438.ts.net/v1",
    api_key="ccc_live_a_new_key_from_the_host_admin",
)

model = client.models.list().data[0].id
response = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "Reply with exactly: connected"}],
)
print(response.choices[0].message.content)
```

Supported compatibility routes:

```text
GET  /v1/models
POST /v1/responses
POST /v1/chat/completions
```

Both normal JSON responses and `stream=True` SSE streams are supported. The original asynchronous task API remains available under `/api/v1/tasks` and `/api/v1/external/tasks`.

## Highlights

- Windows Electron desktop application and headless HTTP service share the same server implementation.
- Run Codex tasks with explicit Model, Effort, Speed, sandbox, and approval settings.
- Work with registered projects or isolated projectless temporary workspaces.
- Upload images and general attachments through owner-bound, one-time upload IDs.
- Generate model-bound `ccc_live_...` Gateway keys for third-party applications.
- Use OpenAI-compatible Models, Responses, and Chat Completions APIs, including streaming, compatible errors, and Request IDs.
- Publish the loopback-only service through Tailscale Funnel without directly exposing the local port.
- Verify the public Host from the dashboard with a provider-aware checker designed to support additional tunnel providers later.
- Monitor active calls, latency, status, token usage, model usage, and per-key usage.
- Disable the external API Host without disabling the desktop application or deleting existing keys.
- Protect desktop administration with a private HttpOnly session and Electron context isolation.

## Requirements

- Windows 10 or Windows 11 for the desktop application
- Node.js 20.16 or newer for development
- npm
- A working Codex login or an OpenAI API key for the Codex SDK runtime
- Tailscale, only when using the built-in public Host feature

## Download and first launch

Download Windows artifacts only from this repository's [GitHub Releases](https://github.com/daizhongtian/codex_sdk/releases):

- `Codex-Control-Center-Setup-<version>-x64.exe`: an NSIS installer with an installation directory selector and shortcuts.
- `Codex-Control-Center-Portable-<version>-x64.exe`: a single-file portable build.

The current Windows builds are not code-signed, so SmartScreen may display an unknown-publisher warning. Verify that the file came from this repository and compare its SHA-256 value with the checksum published for the same release:

```powershell
Get-FileHash -Algorithm SHA256 ".\Codex-Control-Center-Setup-<version>-x64.exe"
```

The first-launch readiness screen checks the bundled Codex runtime, optional external CLI, optional desktop application, and login status. This readiness check is local and does not start a model task.

For development, install dependencies:

```powershell
npm install
```

## Codex authentication

The desktop application can reuse the login cached by Codex CLI:

```powershell
npm install --global @openai/codex
codex.cmd login
codex.cmd login status
```

You can also authenticate the Codex runtime with a metered OpenAI API key:

```powershell
$env:OPENAI_API_KEY = "your-key"
$env:OPENAI_API_KEY | codex.cmd login --with-api-key
```

Do not commit credentials or send them to browser code. Server automation should inject secrets through process environment variables, container secrets, or a managed secret store. See the [Codex authentication documentation](https://developers.openai.com/codex/auth) and [Codex SDK documentation](https://developers.openai.com/codex/sdk).

## Run the desktop application

Development mode:

```powershell
npm run dev
```

Normal start:

```powershell
npm start
```

The desktop service listens on `127.0.0.1:4310` by default. You can choose another fixed port under **Settings → Fixed API port** and restart the application. Advanced users can temporarily override the saved value:

```powershell
$env:CODEX_DESKTOP_PORT = "4310"
npm start
```

The application uses a single-instance lock. A second launch focuses the existing window. Enable **Minimize to tray** if the API should continue running after the main window is closed.

## Run the headless HTTP service

```powershell
$env:HOST = "127.0.0.1"
$env:PORT = "4310"
npm run server
```

Health check:

```powershell
curl.exe http://127.0.0.1:4310/health
```

The machine-readable API contract is [`docs/openapi.yaml`](docs/openapi.yaml).

## HTTP API overview

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Process and service health. |
| `GET` | `/v1/models` | OpenAI-compatible model list for the current Gateway key. |
| `POST` | `/v1/responses` | OpenAI-compatible Responses API, normal or streaming. |
| `POST` | `/v1/chat/completions` | OpenAI-compatible Chat Completions API, normal or streaming. |
| `GET` | `/api/v1/models` | Model, Effort, Speed, and upload-limit catalog. |
| `GET` | `/api/v1/usage` | Persistent administrator usage summary. |
| `POST` | `/api/v1/usage/reset` | Start a new usage statistics generation. |
| `GET/POST` | `/api/v1/api-keys` | List metadata or generate a Gateway key. |
| `GET` | `/api/v1/api-keys/:id/secret` | Reveal a recoverable encrypted Gateway key. |
| `DELETE` | `/api/v1/api-keys/:id` | Permanently delete a Gateway key and its encrypted secret. |
| `GET/POST` | `/api/v1/gateway` | Read or change the external API Host switch. |
| `GET/POST` | `/api/v1/projects` | List or register project directories. |
| `POST` | `/api/v1/uploads/files` | Upload an administrator task file or image. |
| `GET/POST` | `/api/v1/tasks` | List tasks or create an asynchronous Codex task. |
| `GET` | `/api/v1/tasks/:id` | Read task status, result, or error. |
| `POST` | `/api/v1/tasks/:id/cancel` | Cancel a queued or running task. |
| `GET` | `/api/v1/tasks/:id/events` | Replay and stream task events with SSE. |
| `GET` | `/api/v1/external/profile` | Read the current Gateway key profile. |
| `POST` | `/api/v1/external/uploads/files` | Upload a caller-owned attachment or image. |
| `GET/POST` | `/api/v1/external/tasks` | List or create tasks owned by the current Gateway key. |
| `GET` | `/api/v1/external/tasks/:id/events` | Stream the caller's task events. |
| `POST` | `/api/v1/external/tasks/:id/cancel` | Cancel the caller's task. |
| `WS` | `/ws` | Optional multi-task real-time channel. |

In headless `AUTH_MODE=token`, administrator `/api/*` calls use:

```powershell
curl.exe -H "Authorization: Bearer $env:API_TOKEN" http://127.0.0.1:4310/api/v1/models
```

## Model-bound Gateway keys

Create keys from **API Keys & Usage** or from the model menu. A key binds Model, Effort, Speed, and file permission settings on the server:

- Windows uses system secure storage to encrypt the recoverable secret.
- Disk storage keeps a SHA-256 verification hash and encrypted ciphertext separately, not plaintext.
- External calls must use `/api/v1/external/*` or `/v1/*` with `Authorization: Bearer ccc_live_...`.
- Native API requests cannot override the key preset. Conflicts return `409 API_KEY_PRESET_CONFLICT`.
- OpenAI-compatible requests require a `model` field for client compatibility, but execution uses the model bound to the key.
- Each key can read and cancel only its own tasks.
- Deleting a key permanently removes its record and encrypted secret, invalidates subsequent calls, cancels its active tasks, and closes its streams.
- Disabling API Host makes external routes return `503 GATEWAY_DISABLED` while preserving keys for later use.

Use a separate key for every client. Never give callers the administrator token or the server-side OpenAI credential.

## OpenAI-compatible calls

Normal Responses and Chat Completions calls are translated directly into Codex SDK tasks; they are not forwarded to the OpenAI API:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:4310/v1",
    api_key="ccc_live_...",
)

model = client.models.list().data[0].id

response = client.responses.create(
    model=model,
    input="Reply with exactly: connected",
)
print(response.output_text)

chat = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "Reply with exactly: connected"}],
)
print(chat.choices[0].message.content)
```

Image input reuses this application's existing Codex SDK `local_image` pipeline. The compatibility layer accepts PNG, JPEG, or WebP Base64 data URLs:

```python
import base64
from pathlib import Path

data_url = "data:image/jpeg;base64," + base64.b64encode(
    Path("photo.jpg").read_bytes()
).decode("ascii")

vision = client.responses.create(
    model=model,
    input=[{
        "role": "user",
        "content": [
            {"type": "input_text", "text": "Describe this image"},
            {"type": "input_image", "image_url": data_url},
        ],
    }],
)
print(vision.output_text)
```

For Chat Completions, use `{"type": "image_url", "image_url": {"url": data_url}}`. Images work in both normal and streaming calls.

Streaming calls use the standard OpenAI SDK interface:

```python
stream = client.responses.create(
    model=model,
    input="Explain what this project does",
    stream=True,
)
for event in stream:
    if event.type == "response.output_text.delta":
        print(event.delta, end="", flush=True)

chat_stream = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "Explain what this project does"}],
    stream=True,
    stream_options={"include_usage": True},
)
for chunk in chat_stream:
    if chunk.choices:
        print(chunk.choices[0].delta.content or "", end="", flush=True)
```

Compatibility behavior:

- Every OpenAI-compatible request creates the same native asynchronous task used by the desktop application.
- Non-streaming calls wait for completion. Streaming calls translate native events to OpenAI SSE.
- Compatible calls use an isolated projectless temporary workspace.
- Text and image input are supported. Responses accepts `input_image`; Chat Completions accepts `image_url`. Images are validated locally, converted to Codex SDK `local_image` inputs, and removed from temporary storage when the task ends.
- To prevent server-side request forgery (SSRF), image input currently accepts only PNG, JPEG, or WebP Base64 data URLs. Remote image URLs and OpenAI `file_id` values are not fetched or accepted.
- Audio, client-defined function tools, `previous_response_id`, and hosted conversations are not currently supported.
- Every `/v1` success or error response includes `X-Request-Id: req_...`.
- Non-streaming errors use `{ "error": { "message", "type", "param", "code" } }`.
- Chat streams end with `data: [DONE]`. Responses streams end with `response.completed` or `response.failed`.

## Public Host with Tailscale Funnel

V2 can publish the loopback-only desktop service as a public HTTPS endpoint through Tailscale Funnel. Tailscale is not bundled with the application. Install it from the [official Tailscale download page](https://tailscale.com/download/windows), sign in, and keep it running.

1. Keep the fixed API port available; the default is `4310`.
2. Create a separate `ccc_live_...` key for every caller.
3. Open **Settings → Free public Host**.
4. Click **Go online**, then confirm public access.
5. Complete Tailscale Funnel/HTTPS authorization if prompted.
6. Copy the resulting `https://device.tailnet.ts.net/v1` base URL.

The dashboard displays both the local and public OpenAI Host addresses. Use the **Local Host / Public Host** control to switch the visible address.

### Check online

The **Check online** button asks the Electron main process to refresh the active provider and perform two credential-free external probes:

1. `GET /health` must return a healthy response.
2. `GET /v1/models` without a key must return an OpenAI-shaped `401 invalid_api_key` with a valid `X-Request-Id`.

The expected `401` proves that public routing works and authentication is still enforced. The checker never sends a real Gateway key. Renderer code supplies only a registered provider ID, not an arbitrary URL, which prevents the button from becoming a general-purpose request proxy.

The current provider ID is `tailscale-funnel`. The generic checker and provider resolver are designed so Cloudflare Tunnel or another public Host channel can be added later without rewriting the dashboard or probe logic.

The desktop application uses these fixed Tailscale operations:

```powershell
tailscale up --timeout=60s
tailscale funnel --bg --yes --https=443 http://127.0.0.1:4310
tailscale funnel status --json
```

Turning the public Host off removes only the verified HTTPS 443 mapping for the current local API. The application refuses to overwrite a Funnel route owned by another local service.

Tailscale stores the Funnel configuration, but Codex Control Center still serves the API. Public calls fail when the computer is off, Tailscale is disconnected, or the application exits. Enable **Minimize to tray** if the Host should survive closing the window.

## Native asynchronous task example

Gateway callers do not need to repeat model settings because the key preset is enforced by the server:

```powershell
$headers = @{ Authorization = "Bearer $env:CODEX_GATEWAY_KEY" }
$body = @{
  prompt = "Inspect this project and explain the result"
  projectless = $true
} | ConvertTo-Json

$task = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4310/api/v1/external/tasks" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body

Invoke-RestMethod `
  -Uri "http://127.0.0.1:4310/api/v1/external/tasks/$($task.id)" `
  -Headers $headers
```

For attachments, upload the binary to `/api/v1/external/uploads/files` first, then place the returned `file.id` in `fileIds`. Upload IDs are owner-bound and single-use. Executables, installers, shortcuts, libraries, and disk images are rejected.

Default attachment limits are 12 files per task, up to 4 images, 25 MiB per file, and 100 MiB total. Unused uploads expire after 30 minutes. Bound temporary files are cleaned when a task completes, fails, is cancelled, or the service stops.

## Usage dashboard

The desktop dashboard aggregates usage returned by the Codex SDK:

- Total tokens = input tokens + output tokens.
- Cached tokens are a subset of input tokens.
- Reasoning tokens are a subset of output tokens.
- Statistics include task counts, success rate, active tasks, model totals, and per-key totals.
- Statistics persist independently of the in-memory task history limit.

Reset starts a new statistics generation. Tasks started before the reset do not write into the new generation. Dashboard values are SDK usage data, not OpenAI billing or cost estimates.

## API behavior, errors, and limits

- `/api/v1` is the current stable native API version. Clients must ignore unknown optional JSON fields and event types.
- Human-readable messages and logs are not stable protocol fields. Automations should inspect HTTP status, `error.code`, task `status`, structured events, and final results.
- Native JSON errors use `{ "error": { "code": "...", "message": "...", "details": ... } }`.
- `POST /tasks` returns `202 Accepted`; poll or stream until `completed`, `failed`, or `cancelled`.
- Default limits include a 1 MiB JSON body, 200,000 prompt characters, 2 concurrent tasks, 50 unfinished tasks, 100 SSE/WebSocket connections, and 32 task subscriptions per WebSocket.
- SSE uses increasing event IDs. Reconnect with `Last-Event-ID` or `?after=<id>`, then read the task snapshot to cover gaps.
- Task creation has no idempotency key. Retrying an uncertain `POST /tasks` can create duplicate tasks.

Common HTTP statuses include `400`, `401`, `403`, `404`, `409`, `413`, `415`, `422`, `429`, and `503`.

## Configuration

`.env.example` documents available variables; the application does not automatically load it. Set variables in the process environment or use Docker `--env-file`. Never commit a secret-bearing `.env` file.

| Variable | Default/example | Description |
| --- | --- | --- |
| `CODEX_DESKTOP_PORT` | saved setting, default `4310` | Override the Electron embedded service port. Use `0` only for automated tests. |
| `TAILSCALE_PATH` | auto-discovered | Optional full path to Tailscale CLI. |
| `HOST` | `127.0.0.1` | Headless service listen address. |
| `PORT` | `4310` | Headless service listen port. |
| `AUTH_MODE` | `none` | Loopback development may use `none`; non-loopback deployments must use `token`. |
| `API_TOKEN` | empty | Administrator Bearer token; at least 32 characters for non-loopback use. |
| `API_KEY_STORE_PATH` | automatic | Persistent Gateway key hash and encrypted-secret store. |
| `API_KEY_ENCRYPTION_KEY` | empty | Headless-service key encryption secret, at least 32 characters. Desktop uses Windows secure storage. |
| `USAGE_STORE_PATH` | automatic | Persistent aggregate usage store. |
| `ALLOWED_PROJECT_ROOTS` | empty | Comma- or semicolon-separated project root allowlist. |
| `ALLOWED_HOSTS` | empty | Exact additional Host names accepted by a loopback service. |
| `CORS_ORIGINS` | empty | Explicit browser origins; do not expose execution APIs with `*`. |
| `SCRATCH_ROOT` | system temporary directory | Root for isolated projectless workspaces. |
| `ATTACHMENT_UPLOAD_ROOT` | system temporary directory | Temporary attachment storage root. |
| `MAX_TASK_FILES` | `12` | Maximum files per task. |
| `MAX_TASK_IMAGES` | `4` | Maximum images per task. |
| `MAX_FILE_BYTES` | `26214400` | Maximum bytes per file. |
| `MAX_TASK_ATTACHMENT_BYTES` | `104857600` | Maximum total attachment bytes per task. |
| `ATTACHMENT_UPLOAD_TTL_MS` | `1800000` | Lifetime of an unbound upload. |
| `OPENAI_COMPAT_BODY_LIMIT` | `36mb` | JSON body limit for the simulated `/v1/responses` and `/v1/chat/completions` routes so Base64 images fit; image count and byte limits still apply. |
| `TRUST_PROXY` | `false` | Enable only behind a trusted reverse proxy. |
| `MAX_CONCURRENT_TASKS` | `2` | Maximum running tasks per process. |
| `MAX_QUEUED_TASKS` | `50` | Maximum unfinished tasks. |
| `MAX_SSE_CONNECTIONS` | `100` | SSE and WebSocket connection limit. |
| `TASK_TIMEOUT_MS` | `1800000` | Task timeout in milliseconds. |
| `TASK_HISTORY_LIMIT` | `200` | Completed tasks retained in process memory. |
| `EVENT_HISTORY_LIMIT` | `500` | Events retained per task. |
| `EVENT_HISTORY_BYTES` | `2097152` | Event byte budget per task. |
| `LOG_LEVEL` | `info` | Server log level. |
| `ALLOW_DANGEROUS_TASKS` | `false` | Permit specially scoped full-access tasks outside loopback. |
| `ALLOW_TASK_NETWORK` | `false` | Permit specially scoped task network access outside loopback. |
| `OPENAI_API_KEY` | empty | Optional server-side credential used by the Codex SDK runtime. |

Generate a local administrator token:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:API_TOKEN = [Convert]::ToHexString($bytes)
```

Projects, tasks, events, and final results are currently stored in process memory and are cleared on restart. Gateway keys and aggregate usage persist in their configured stores. A multi-writer or multi-host deployment must move identity, revocation, usage, audit, and task state into transactional infrastructure.

## Data, privacy, and permissions

Desktop persistent data normally lives under `%APPDATA%\codex-control-center\`. Temporary attachments and projectless workspaces use the system temporary directory. Prompts, selected project content, attachments, and results are passed to the Codex SDK and may be sent to OpenAI/Codex services.

A `ccc_live_...` key authenticates only this project's external API. It cannot call the OpenAI API directly. The project does not include product analytics, advertising trackers, or third-party crash telemetry. See [`PRIVACY.md`](PRIVACY.md) and [`SECURITY.md`](SECURITY.md).

Task permissions:

- `read-only`: analyze, explain, and review without writing files.
- `workspace-write`: write inside the workspace and explicit writable roots.
- `danger-full-access`: disable the filesystem sandbox; use only in an isolated, fully trusted environment.

`ALLOWED_PROJECT_ROOTS` is the service-entry path allowlist. The Codex sandbox is a separate execution-time boundary. Remote multi-user deployments should use separate containers or virtual machines, credentials, work volumes, and network policies per tenant.

## Docker headless deployment

### V2 guided Docker + Tailscale setup

On Windows, set the server-side model credential without posting it to chat, screenshots, or GitHub:

```powershell
$env:OPENAI_API_KEY = "your OpenAI API key"
```

Then run from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-online-host.ps1 -EnableFunnel
```

The script generates ignored local files:

- `.env.docker.local`: administrator token, Gateway-key encryption secret, and model-service credential. Keep it only on the Host.
- `.env.client.local`: `OPENAI_BASE_URL` and a generated `OPENAI_API_KEY`. In this client file, the value is a `ccc_live_...` Gateway key, not the upstream OpenAI key.

The compose file binds Docker only to `127.0.0.1:4311`; Tailscale Funnel is the public entry point. Re-running the script reuses existing secrets. Omit `-EnableFunnel` for local-only startup and use `-SkipBuild` when the image is already current.

Maintenance commands:

```powershell
docker compose -f compose.online.yaml ps
docker compose -f compose.online.yaml logs --tail 100 api
docker compose -f compose.online.yaml restart api
docker compose -f compose.online.yaml down
tailscale funnel --https=443 http://127.0.0.1:4311 off
```

`docker compose down` preserves volumes. Do not add `-v` unless permanent deletion of Gateway keys and usage data is intended.

Manual build:

```powershell
docker build -t codex-control-center .
```

Safe loopback-only test run:

```powershell
docker run --rm --name codex-control-center `
  -p 127.0.0.1:4310:4310 `
  -e API_TOKEN="$env:API_TOKEN" `
  -e OPENAI_API_KEY="$env:OPENAI_API_KEY" `
  -v "C:\work:/workspaces:rw" `
  -v "codex-control-data:/data" `
  codex-control-center
```

Do not publish the container as `-p 4310:4310`. Keep the loopback binding and use a controlled HTTPS tunnel or reverse proxy. The included token mode is deployment scaffolding, not a complete internet multi-tenant identity system.

## Build Windows artifacts

```powershell
npm run check
npm test
npm run dist:portable
npm run dist:setup
```

Both executables are written to `release/`. The build enables ASAR integrity validation and disables `NODE_OPTIONS`, CLI inspection, and extra file-protocol privileges. The current artifacts are unsigned; published release notes must retain the SmartScreen warning and SHA-256 values.

## Contributing and project documents

- License: [`LICENSE`](LICENSE)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)
- Contributing guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Code of Conduct: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- Security policy: [`SECURITY.md`](SECURITY.md)
- Privacy notice: [`PRIVACY.md`](PRIVACY.md)
- OpenAPI 3.1 contract: [`docs/openapi.yaml`](docs/openapi.yaml)

## Troubleshooting

- **Codex is not signed in:** run `codex.cmd login status`, then `codex.cmd login` if necessary.
- **Port already in use:** close the conflicting process or choose another fixed desktop port. Use `PORT` for the headless service.
- **Project rejected:** verify that the resolved project path is inside `ALLOWED_PROJECT_ROOTS`.
- **Container cannot write:** give the container's non-root `node` user permission to the mounted workspace and select `workspace-write`.
- **Public Host check returns `HOST_FORBIDDEN`:** refresh the tunnel provider status, then run **Check online** again. The provider refresh registers the exact public hostname without allowing arbitrary Host headers.
- **Remote request is unauthorized:** verify that the caller uses `Authorization: Bearer ccc_live_...` for `/v1/*` and `/api/v1/external/*`. Never give a third party `API_TOKEN`.
