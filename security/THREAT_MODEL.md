# Agent Gateway V3 Threat Model

## Overview

Agent Gateway V3 is a local-first Windows desktop gateway plus an optional web control plane. The desktop process exposes a loopback HTTP API that converts OpenAI-compatible or native task requests into Codex SDK executions. It stores Gateway Key policy, usage, uploads, task state, and platform credentials on the local Windows account. The platform is a React browser application backed by Spring Boot and PostgreSQL. It manages accounts, browser and desktop sessions, device pairing, Host allocation, administrator actions, and a localhost Relay preview. A future public Relay will accept Internet traffic and carry allowlisted OpenAI-compatible requests over an outbound desktop tunnel.

The primary runtime surfaces are:

- the Electron main process, isolated renderer, preload bridge, deep-link handler, update checks, and encrypted desktop state under `src/electron/`;
- the loopback Express Gateway, native task API, OpenAI-compatible API, WebSocket/SSE streams, uploads, Gateway Key store, project selection, scratch workspaces, and Codex child process under `src/server/` and `src/runner/`;
- the Spring Boot account and Host control plane under `platform/backend/`;
- the React browser client and Nginx edge under `platform/frontend/`;
- PostgreSQL migrations and persisted sessions, devices, Host mappings, usage, and audit events;
- the localhost Relay preview and the future outbound WebSocket Relay contract;
- GitHub Actions, npm, Maven, Docker, release packaging, and update metadata.

Security-sensitive assets include Codex account state and credentials, prompts and responses, project files, uploaded attachments, Gateway Keys (`ccc_live_...`), platform access and refresh tokens, CSRF tokens, one-time desktop authorization codes, device secrets, pairing codes, Host slugs, account and admin state, audit records, usage and quota state, application update trust, and host CPU, memory, disk, network, and task capacity.

## Threat Model, Trust Boundaries, and Assumptions

### Actors

- **Local operator:** controls the Windows account, chooses projects and permissions, creates Gateway Keys, and can inspect local application data. The machine owner is trusted according to `SECURITY.md`.
- **Local API caller:** a separate process that may possess one Gateway Key. It is untrusted outside the scopes, project, model, permission, token quota, and expiry attached to that key.
- **Browser user:** may be anonymous, an authenticated account owner, or an administrator. Browser input and all network metadata are attacker-controlled.
- **Remote OpenAI-compatible caller:** presents a Gateway Key through a public Host or future Relay. It must receive no platform account or local administrative privilege.
- **Paired desktop:** owns a device identifier and device secret after a one-time pairing flow. A paired device is trusted only for its account and assigned Hosts.
- **Platform operator/administrator:** can view platform metadata and revoke users, devices, and Hosts, but must not receive Codex credentials or plaintext Gateway Keys.
- **Dependency, update, or CI publisher:** is outside the runtime trust boundary. Compromise of a package, GitHub Action, release artifact, or update metadata can affect developer or operator machines.

### Trust boundaries

1. **Browser or Internet to Spring Boot:** Nginx and Spring receive untrusted methods, paths, headers, cookies, JSON, identifiers, passwords, pairing codes, and request rates. Authentication, authorization, validation, CSRF, CORS, size limits, rate limits, and safe errors must be enforced server-side.
2. **Browser cookie to bearer session:** Cookie-authenticated mutations require the double-submit CSRF value bound to the stored session hash. Bearer-authenticated desktop requests do not rely on browser ambient authority. A token from either mode must resolve to one active account and one unrevoked session.
3. **Account to account and device to device:** Every device, Host, authorization code, audit action, and persisted resource is tenant-owned. User-selected UUIDs and Host slugs are untrusted object references and must not cross ownership boundaries.
4. **Desktop renderer to Electron main:** Renderer content is not trusted with Node.js, arbitrary filesystem access, process creation, shell execution, or raw secrets. Only an explicit, validated preload API may cross this boundary; navigation, popups, permissions, downloads, and deep links are deny-by-default.
5. **Local API caller to Gateway:** Loopback does not make a caller trusted. Gateway Keys must be parsed from an authorization header, compared by hash/constant-time checks where applicable, scoped, independently revocable, quota-enforced, and excluded from logs and URLs.
6. **Gateway to Codex child process:** Prompts, project selection, model options, permission level, environment variables, cancellation, and IPC frames cross into a privileged child process. The Gateway must normalize options, restrict environment inheritance, reject dangerous permission escalation, bound IPC, and terminate work after revocation or shutdown.
7. **Gateway to local filesystem:** Project paths, attachment names and bytes, extracted document text, scratch directories, and stored JSON are attacker-influenced. Canonical paths must remain inside approved roots, files must be created without overwrite at owner-only permissions, symlinks and traversal must not escape roots, content and counts must be bounded, and cleanup must be safe.
8. **Desktop to platform:** Browser authorization uses state and PKCE; platform access, refresh, CSRF, device, and pairing credentials have separate purposes. Desktop platform tokens are stored with OS protection and must never be confused with Gateway Keys or Codex credentials.
9. **Platform to PostgreSQL:** The application assumes an authenticated private database connection and least-privilege database role. Secrets are hashed where verification is sufficient. Transactions and locking must preserve one-time redemption, rotation, quotas, and revocation under concurrency.
10. **Public Host or future Relay to local Gateway:** The public edge and desktop agent independently allow only `GET /v1/models`, `POST /v1/responses`, and `POST /v1/chat/completions`. Headers, request bodies, streams, frame order, flow-control windows, heartbeat state, concurrency, and cancellation are attacker-controlled. The Relay must never expose `/api/v1/*`, arbitrary URLs, cookies, hop-by-hop headers, platform credentials, or local network access.
11. **Build and release supply chain:** Lockfiles, Maven coordinates, GitHub Actions, Docker base images, release checksums, and Electron packaging affect code that executes on trusted machines. Workflow tokens must be least privilege, third-party actions immutable or otherwise reviewed, and vulnerable or secret-bearing changes must fail CI.

### Security objectives and invariants

- Anonymous callers can reach only explicitly public health, configuration, registration, login, refresh, desktop exchange, pairing, and public Host routes.
- A normal account cannot use administrator APIs; an administrator cannot disable itself or the last active administrator.
- Resource access is always constrained by authenticated owner, except explicit administrator actions that are audited.
- Access, refresh, CSRF, authorization, pairing, device, tunnel, and Gateway credentials are non-interchangeable, bounded, revocable, and never returned after their one-time issuance point.
- Revocation, account disablement, quota exhaustion, expiry, database failure, Relay disconnect, or shutdown fails closed and terminates or rejects subsequent privileged work.
- Gateway Key policy cannot be overridden by request input, and a normal key cannot request `danger-full-access`.
- Filesystem access remains inside the selected project or managed scratch/upload roots and uses least-privilege file modes.
- Public routing cannot become an SSRF, open proxy, Host-header bypass, cross-tenant route, or way to reach the native administration API.
- Request, response, stream, upload, queue, connection, and log sizes are bounded so one caller cannot exhaust host resources.
- Errors and diagnostics include a Request ID but exclude secrets, credentials, private file content, internal stack traces, and unsafe local paths.
- Browser and Electron content cannot execute injected script under a privileged origin or cross into unrestricted Node/Electron APIs.
- Release and CI automation uses synthetic credentials only and never attacks a production or third-party system.

### Assumptions and exclusions

- The default desktop service remains bound to loopback and runs for one trusted Windows user. A machine owner reading that user's local data is outside the documented boundary.
- Granting `workspace-write` deliberately permits changes inside the approved workspace. Deliberately granting broader Codex permissions is not itself a vulnerability unless Agent Gateway bypasses the displayed or stored policy.
- The current V3 Relay is a localhost preview; production WebSocket admission and data-plane behavior remain an unimplemented security requirement and must not be described as deployed.
- TLS termination, production database/network policy, backups, edge rate limiting, tenant isolation, and operational monitoring must be supplied by the deployment. Unsafe defaults or code paths that defeat those controls remain in scope.
- Tests use disposable local containers, synthetic accounts, synthetic keys, and temporary workspaces. Public services and production data are out of scope.

## Attack Surface, Mitigations, and Attacker Stories

### Platform authentication and account control

Relevant attacks include credential stuffing, account enumeration, oversized password denial of service, stolen refresh-token replay, CSRF, CORS abuse, desktop authorization interception, session fixation, stale administrator privilege, and disabled-account reuse. Existing controls include adaptive password encoding, a dummy hash for unknown users, session caps, access/refresh rotation, hashed stored tokens, HttpOnly cookies, CSRF binding, exact-origin credentialed CORS, PKCE/state in the desktop browser flow, status checks on every authenticated request, sensitive-route rate limits, and structured Request ID errors.

A critical failure would let an anonymous or normal user become an administrator or mint a session for another account. A high-impact failure would allow durable refresh-token replay, login bypass, or cross-account session use. Rate-limit weakness with no account compromise is normally medium or low depending on exposure and resource impact.

### Device pairing, Hosts, and tenant isolation

Attacker stories include guessing or replaying an eight-character pairing code, redeeming one code concurrently twice, pairing a revoked device, assigning a Host to another user's device, modifying another tenant's Host, continuing a tunnel after device or account revocation, or reporting `ONLINE` from desired state rather than verified presence. Existing controls include hashed one-time codes, expiry, database queries that select only unused codes, ownership-aware repositories/services, device and Host limits, cascade disable on device revocation, and a documented presence state machine.

The pairing lookup must use a database lock or atomic consume check before public deployment. The future Relay must authenticate device proofs and single-use tunnel tokens rather than trusting Host slug possession.

### Local Gateway, Gateway Keys, and Codex execution

Attacker-controlled inputs include Authorization headers, model IDs, prompts, tool-like content, stream flags, task IDs, project IDs/paths, upload IDs, file names, image data URLs, WebSocket frames, and cancellation. Existing controls include bearer parsing limits, per-key presets and scopes, rejection of request policy conflicts, prohibition of dangerous permissions for Gateway Keys, token quotas and expiry, owner-bound tasks/uploads, explicit project requirements for token callers, normalized runner options, bounded IPC, safe environment forwarding, cancellation, shutdown cleanup, and compatible error envelopes.

High-risk stories include using one key to access another key's task or upload, overriding the stored project or sandbox, retrieving a plaintext key through an API or log, running outside the allowed project, or continuing execution after deletion/expiry. Resource attacks include huge JSON or image inputs, many pending uploads, many concurrent streams, slow clients, and unbounded task queues.

### Electron, deep links, updates, and local secret storage

Attacker stories include renderer XSS reaching Node, arbitrary navigation or popup creation, a malicious `agent-gateway://` URL injecting authorization data, unsafe shell command construction, hostile update metadata, inherited environment secrets, or plaintext platform credentials. Existing controls include context isolation, a narrow preload bridge, navigation/window-open handlers, permission denial, PKCE loopback callbacks, encrypted storage, diagnostic redaction, Electron Fuses, packaged ASAR integrity, and disabled Node CLI/environment options.

Automated tests must assert BrowserWindow options and handlers rather than relying only on source-text checks. Packaged Windows release tests must confirm the protocol handler and Fuse configuration.

### Files, uploads, and scratch workspaces

Attacker stories include path traversal, symlink replacement, extension/MIME confusion, decompression or PDF parsing bombs, duplicate upload reuse, cross-owner attachment use, temporary file overwrite, unsafe cleanup, and disk exhaustion. Existing controls include canonical root checks, random identifiers, exclusive creation, mode `0600`, signature/content checks, per-owner and global counts, byte limits, TTL cleanup, owner binding, and scratch workspace revalidation.

Remaining controls require deterministic malformed-file corpora, archive/PDF size limits, concurrency tests, and Windows-specific ACL verification for persisted key, usage, and credential files.

### Relay and public routing

The localhost Relay preview uses a fixed operator-controlled upstream and explicit route/header allowlists. It does not follow redirects and rewrites Docker's gateway Host header to the loopback value expected by the desktop service. Production threats include SSRF, absolute-form targets, traversal, Host confusion, forwarded cookies or proxy headers, cross-tenant slug routing, request smuggling, oversized bodies, slow-body/slow-reader exhaustion, out-of-order or replayed frames, missing backpressure, heartbeat spoofing, and incorrect online state.

Before a public Relay is enabled, both edge and desktop implementations require the same route allowlist, strict frame schema and maximums, monotonic per-stream sequence checks, bounded stream and connection counts, cancellation, flow-control windows, and tests that every invalid transition fails closed.

### Supply chain and deployment

Lockfiles and Maven dependency management reduce drift but do not prove packages are safe. CI must scan committed secrets, dependency changes, source, Dockerfiles, Compose and Kubernetes-style configuration, container images, and workflow permissions. Third-party actions should use reviewed immutable references where practical. The March 2026 Trivy action compromise is a concrete reason not to trust mutable action tags or installer scripts with repository secrets.

## Severity Calibration (Critical, High, Medium, Low)

### Critical

- Remote unauthenticated code execution in the Electron main process, Spring service, local Gateway, Codex runner boundary, or public Relay.
- Authentication or authorization bypass that grants administrator control, exposes Codex credentials, or permits arbitrary local filesystem execution outside the approved sandbox.
- Supply-chain compromise in the official release path that can replace shipped binaries or exfiltrate release credentials.

### High

- Cross-account access to prompts, files, device secrets, session tokens, Gateway Keys, or another tenant's Host route.
- Reusable pairing, desktop authorization, refresh, device, or tunnel credentials that allow persistent account/device takeover.
- Public proxy or SSRF behavior that reaches the platform administration API, loopback services, cloud metadata, or arbitrary internal destinations.
- Gateway Key policy bypass that enables `danger-full-access`, escapes the approved project, or survives revocation.

### Medium

- CSRF on a meaningful account, device, Host, or administrator mutation when same-site controls do not otherwise prevent exploitation.
- Stored or reflected XSS in the platform without a path to desktop privileges or secrets.
- Missing request, connection, queue, upload, or stream bounds that allow a remote user to cause material but recoverable service exhaustion.
- Error, audit, or diagnostic leakage of sensitive metadata without credentials or private content.

### Low

- Limited information disclosure such as version or internal status that does not materially help bypass a boundary.
- Rate-limit or validation inconsistencies that increase noise or local resource use but require a trusted local user and do not affect other tenants.
- Defense-in-depth deployment or header gaps with no demonstrated impact under the documented local-only default.

Repository: target_sha256_576e6a6e03dca546a4c3170282d9d5c5143ada04e0f3c5ea1035e2f59ac66eb3
Version: c5ae6c8ffe17227cb789ff5c3bf68def9c9c3760
