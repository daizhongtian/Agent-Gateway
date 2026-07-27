# Codex Control Platform

Independent Spring Boot + React control plane for user accounts, registered devices, and stable public OpenAI-compatible Host allocations.

This directory is deliberately isolated from the existing Codex Control Center desktop application. Nothing under the repository's existing `src/`, `public/`, or desktop packaging configuration is changed by this platform.

## What is implemented

- Browser registration, login, refresh, logout, and account session APIs.
- Hashed opaque access and rotating refresh tokens.
- HttpOnly `SameSite=Strict` session cookies plus synchronizer CSRF checks.
- Device registration, revocation, and short-lived one-time pairing codes.
- A public desktop pairing contract that returns a device secret once.
- Stable, opaque OPENAI HOST allocation such as `https://h-abc.api.example.com/v1`.
- Host enable/disable and desired-online state without falsely marking a Host online.
- PostgreSQL migrations for accounts, sessions, devices, Hosts, pairing codes, future tunnel tokens, tunnel sessions, usage buckets, and audit events.
- React control console for all currently active account operations.
- Docker images and a local three-service Compose stack.
- An OpenAPI contract and a versioned Relay protocol specification for the later desktop/Relay phase.

The actual public Relay is intentionally not enabled here. Until a Relay server and the desktop tunnel client are connected, every allocated Host remains offline.

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
2. Keep `RELAY_ENABLED=false` until the Relay is deployed.
3. Start the stack:

```powershell
docker compose --env-file .env up --build
```

Open `http://localhost:8088`. PostgreSQL is bound to loopback only; the backend is reachable through the frontend reverse proxy.

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
