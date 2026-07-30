# Security Control Checklist

This checklist is a release gate for Agent Gateway V3. A checked control must be backed by a maintained automated test or a named CI scan; a manual observation is not sufficient.

## Identity and sessions

- [x] Passwords use an adaptive Spring Security encoder and are never stored in plaintext (`AuthServiceTest`).
- [x] Access, refresh, CSRF, desktop-authorization, pairing, and device credentials are purpose-specific (`AuthServiceTest`, `PlatformIntegrationTest`).
- [x] Refresh and desktop authorization rotate or consume credentials atomically (`AuthServiceTest`, `PlatformLimitsIntegrationTest`).
- [x] Cookie-authenticated state changes require a matching CSRF cookie and header (`SecurityFiltersTest`).
- [x] Disabled accounts and revoked sessions/devices are rejected (`AdminIntegrationTest`, `PlatformFeatureIntegrationTest`).
- [x] Authentication errors do not disclose whether an account exists (`AuthServiceTest`).

## Authorization and isolation

- [x] Every documented HTTP operation has an entry in `API_PERMISSION_MATRIX.json` (`security-contract.test.js`).
- [x] Non-admin platform queries are account-scoped (`PlatformFeatureIntegrationTest`, `PlatformLimitsIntegrationTest`).
- [x] Cross-tenant device and Host identifiers are rejected (`PlatformFeatureIntegrationTest`).
- [x] Admin routes require `ROLE_ADMIN`; normal users cannot reach them (`AdminIntegrationTest`).
- [x] Local tasks, uploads, projects, events, and cancellation enforce principal ownership (`auth.test.js`, `server.test.js`).
- [x] Gateway Keys enforce model, effort, speed, file, project, Token-limit, and expiration policy (`openai-compat.test.js`, `server.test.js`).

## Browser, Electron, and local Gateway

- [x] BrowserWindow uses context isolation, sandboxing, disabled Node integration, web security, and navigation guards (`security-contract.test.js`).
- [x] The preload bridge exposes an allowlisted API only (`protocol-and-secrets.test.js`).
- [x] Local desktop service binds to loopback and rejects untrusted Host headers (`server-config.test.js`, `desktop-port.test.js`).
- [x] Bearer parsing is bounded and comparison is timing-safe (`auth.test.js`).
- [x] Request bodies, attachments, task queues, SSE clients, task duration, and history are bounded (`server.test.js`, `openai-compat.test.js`).
- [x] API errors and diagnostics redact credentials (`protocol-and-secrets.test.js`, `diagnostics.test.js`).

## Files and secrets

- [x] Project and upload paths are canonicalized beneath approved roots (`server.test.js`).
- [x] Temporary uploads have owner, count, size, and TTL controls (`server.test.js`).
- [x] Desktop secrets use the operating-system protection boundary and restricted file modes where available (`protocol-and-secrets.test.js`).
- [x] Repository text is scanned for committed Gateway Keys, provider secrets, private keys, and AWS access keys (`security-contract.test.js`).
- [x] Local `.env` files, build artifacts, coverage, and release output are ignored (`security-contract.test.js`).

## Relay and network boundaries

- [x] The preview relay maps only health, models, Responses, and Chat Completions routes (`LocalRelayControllerTest`).
- [x] Relay forwarding strips hop-by-hop and unsafe headers, rejects redirects, rewrites Host, and applies a request-size limit (`LocalRelayControllerTest`).
- [x] OpenAI-compatible inference routes preserve Gateway Key authentication at the desktop (`LocalRelayControllerTest`, `openai-compat.test.js`).
- [ ] Production Relay must implement authenticated device tunnels, one-use enrollment, per-frame sequence validation, backpressure, rate limits, and tenant isolation before `RELAY_ENABLED=true` outside local preview.
- [ ] Production public Host must terminate TLS, set secure cookies, enforce trusted proxy configuration, and run external DAST before release.

## Supply chain and containers

- [x] npm and Maven installs use committed lock/resolution data in CI.
- [x] Runtime containers do not run the application as root (`security-contract.test.js`).
- [x] Development database and frontend ports bind to loopback (`security-contract.test.js`).
- [x] Containers use `no-new-privileges` (`security-contract.test.js`).
- [ ] Pull-request security workflow must pass CodeQL, dependency review, secret scanning, dependency audits, and API/security contract tests.
- [ ] Nightly security workflow must pass container scanning and the disposable Docker DAST/recovery suite.

## Operations and recovery

- [x] Request IDs are generated or validated and returned consistently (`PlatformIntegrationTest`, `server.test.js`).
- [x] Administrative actions create audit events (`AdminIntegrationTest`).
- [ ] Disposable recovery tests must prove database persistence, backend restart recovery, expired-session rejection, and revoked-device/Host behavior.
- [ ] Security scan evidence is retained by CI without retaining passwords, session cookies, Gateway Keys, or uploaded user content.

The unchecked items are deliberate release blockers for a production public Relay, not claims that the current local V3 preview already provides those controls.
