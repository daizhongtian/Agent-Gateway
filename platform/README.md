# Agent Gateway Platform

Spring Boot + React control plane for Agent Gateway accounts, registered devices, and stable OpenAI-compatible Host allocations. V3 connects this platform directly to the desktop application.

## What is implemented

- Username-and-password browser and desktop registration, login, refresh, logout, and account session APIs, with an optional recovery email.
- Hashed opaque access and rotating refresh tokens.
- HttpOnly `SameSite=Strict` session cookies plus synchronizer CSRF checks.
- Device registration, revocation, and short-lived one-time pairing codes.
- A public desktop pairing contract that returns a device secret once.
- Stable, opaque OPENAI HOST allocation such as `http://localhost:8088/h/h-abc/v1` during local development.
- V3 local forwarding for exactly `GET /v1/models`, `POST /v1/responses`, and `POST /v1/chat/completions`.
- Streaming SSE, Gateway authorization, image request bodies, compatible errors, and Request IDs are passed through without storing the Gateway key.
- Host enable/disable and desired-online state connected to the desktop account controls.
- PostgreSQL migrations for accounts, sessions, devices, Hosts, pairing codes, future tunnel tokens, tunnel sessions, usage buckets, and audit events.
- React control console for all currently active account operations.
- Docker images and a local three-service Compose stack.
- An OpenAPI contract and a versioned Relay protocol specification for the later public deployment phase.

The included V3 transport is intentionally a localhost development provider. It proves the complete account, pairing, Host lifecycle, and OpenAI-compatible forwarding flow. A deployed outbound Relay is still required before the same workflow is reachable from other devices over the internet.

## Directory layout

```text
platform/
  backend/                 Spring Boot 4.1 / Java 21 API
  frontend/                React 19.2 / TypeScript / Vite 8 console
  docs/                    API and future Relay contracts
  compose.yaml             PostgreSQL + backend + frontend
  .env.example             deployment configuration template
```

## Local run with Docker

1. Copy `.env.example` to `.env`.
2. Keep `RELAY_ENABLED=false`, `LOCAL_PROXY_ENABLED=true`, and `LOCAL_GATEWAY_BASE_URL=http://host.docker.internal:4310` for local development.
3. Start the stack:

```powershell
docker compose --env-file .env up --build
```

Open `http://localhost:8088`. Keep Agent Gateway running on port 4310. PostgreSQL and the platform console are bound to loopback only; the backend and `/h/{slug}/v1/*` proxy are reached through the frontend reverse proxy.

The V3 desktop app connects to `https://platform.agentgatewayplatform.cc` by default. For local platform development, start the desktop app with `CODING_AGENT_PLATFORM_URL=http://localhost:8088`.

### Bootstrap administrator

The Admin Dashboard is intentionally not linked from the public landing page or user dashboard. Open `/admin` directly and sign in with an administrator account. For a new deployment, set `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_EMAIL`, and `BOOTSTRAP_ADMIN_PASSWORD` in the deployment environment for the first successful backend startup. The password must contain 12-72 characters. Remove all three bootstrap values after the account has been verified; the administrator account remains in PostgreSQL.

## Local development without Docker

Requirements:

- Java 21
- Node.js 24+
- PostgreSQL 17/18

The repository includes Maven Wrapper, so a separate Maven installation is not required.

Backend:

```powershell
cd backend
.\mvnw.cmd spring-boot:run
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Vite proxies `/api` to `http://localhost:8080`.

## Tests

Backend unit, integration, security-boundary, configuration, and OpenAPI contract tests:

```powershell
cd backend
.\mvnw.cmd test
```

Frontend tests, type checking, and production build:

```powershell
cd frontend
npm test
npm run check
npm run build
```

With the Docker stack running on `http://localhost:8088`, execute the real Chrome/PostgreSQL flow:

```powershell
cd frontend
npm run test:e2e
```

The E2E target can be overridden with `PLATFORM_E2E_URL`. See [docs/test-report.md](docs/test-report.md) for the complete coverage matrix and latest verified results.

## Before public deployment

- Replace all development passwords.
- Put the console and backend behind HTTPS.
- Set `SECURE_COOKIES=true`.
- Set the exact `FRONTEND_ORIGIN`; never use `*` with credentialed requests.
- Configure SMTP/email verification before allowing unrestricted registration.
- Add Redis-backed rate limits before running multiple backend replicas.
- Add wildcard DNS and TLS only when the Relay gateway exists.
- Keep `RELAY_ENABLED=false` until external `/v1/*` routing has passed end-to-end security tests.
- Never expose the PostgreSQL port publicly.

## Planned connection phase

The next phase will consume, rather than redesign, these contracts:

1. The desktop app requests or redeems a one-time pairing code.
2. The server returns a device credential once.
3. The desktop exchanges that credential for a short-lived Tunnel Token.
4. The desktop opens an outbound WSS connection to `RELAY_URL`.
5. Relay presence changes the Host from `offline` to `online`.
6. The public Edge forwards only allowlisted `/v1/*` calls through that WSS connection.

See `docs/relay-protocol.md` for the trust and framing rules.
