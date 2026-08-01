# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) for public releases.

## [Unreleased]

## [3.0.9] - 2026-08-01

### Fixed

- The backend OpenAPI contract test now includes the Relay tunnel-token endpoint in its expected path and operation counts.

## [3.0.8] - 2026-08-01

### Fixed

- Release verification now covers desktop Relay resume, failure reporting, shutdown, and default local-port behavior so the security coverage gate remains above its enforced threshold.

## [3.0.7] - 2026-08-01

### Added

- A production-capable outbound WSS Relay connects an explicitly enabled desktop Host to path-based public OpenAI-compatible endpoints without exposing the desktop loopback port.
- Short-lived single-use tunnel tokens, Relay presence and heartbeat tracking, fixed route/header allowlists, bounded streaming flow control, concurrency limits, and end-to-end Relay tests.
- The platform Docker stack now includes a health-checked Relay service, and the desktop reconnects it automatically after startup when Online Host is enabled.
- OpenAI-compatible `GET /v1/models`, `POST /v1/responses`, and `POST /v1/chat/completions` endpoints backed by the existing native task manager.
- Non-streaming and SSE streaming response conversion, OpenAI-shaped errors, per-request `X-Request-Id`, model-bound Gateway key authentication, and compatibility regression tests.
- Base64 PNG, JPEG, and WebP image input for normal and streaming Responses and Chat Completions calls, converted locally into the existing Codex SDK `local_image` task pipeline without proxying requests to the OpenAI API.
- A one-click Tailscale Funnel controller in the Windows desktop settings detects installation and login state, refuses conflicting port 443 routes, enables or disables the current fixed API port, and exposes a copyable public OpenAI `base_url`.
- Tailscale command execution is isolated in the Electron main process with fixed arguments, bounded output and timeouts, structured errors, and unit coverage for discovery, connection, conflicts, enable, and disable behavior.
- The API Gateway dashboard now has a provider-aware public Host check that verifies the external HTTPS health route, OpenAI authentication boundary, compatible error shape, and `X-Request-Id` without sending a Gateway key. The main-process provider registry currently resolves Tailscale Funnel and can add Cloudflare or other tunnel channels later.

### Changed

- The OpenAPI contract and README now document the OpenAI-compatible `/v1` base URL while retaining the native asynchronous task API.
- The GitHub documentation now includes a complete English README and language links between the Chinese and English editions.
- The V2 desktop build keeps the embedded API on loopback while Tailscale terminates public HTTPS; third-party callers continue to authenticate only with model-bound `ccc_live_...` Gateway keys.
- Loopback Host-header protection now accepts only the exact Tailscale device DNS name discovered by the desktop process, so Funnel traffic works without weakening the DNS-rebinding guard for arbitrary hosts.
- The API Gateway dashboard now shows the OpenAI-compatible Host address and lets users switch the visible endpoint between the active Tailscale public URL and the local `/v1` URL.

### Fixed

- Public Host checks now bypass local Tailscale MagicDNS and validate the real public Funnel edge. The V2 desktop app monitors that path at startup and periodically, and performs a cooldown-limited HTTPS 443 route rebuild after repeated TLS failures.
- Tailscale Funnel disable and repair operations now use the current CLI's verified `--https=443 off` form.

## [1.0.6] - 2026-07-22

### Added

- The Windows desktop app now uses persistent fixed API port `4310` by default.
- Settings includes a bilingual fixed-port editor that validates availability before saving and applies changes after restart.
- Packaged smoke tests verify that a saved port is reused by the portable application.

### Changed

- `CODEX_DESKTOP_PORT` remains available as an explicit override, while automatic port allocation with `0` is reserved for testing.
- Startup now reports a clear error when the selected fixed port is unavailable instead of silently changing the endpoint.

## [1.0.5] - 2026-07-21

### Added

- A complete light appearance can now be selected from Settings and persists across restarts.
- Theme controls and supporting copy are available in both Chinese and English.

### Changed

- Model API key creation and management now appears before API Gateway monitoring on the home screen.
- Light appearance typography, status chips, key rows, and sidebar controls now use high-contrast colors designed for pale surfaces.
- Visual regression coverage now verifies panel order, theme switching, persistence, localization, and responsive layout.

## [1.0.4] - 2026-07-18

### Added

- Optional persistent minimize-to-tray mode keeps the Host and local API online when the window is closed or minimized.
- The Windows tray menu can reopen the console or fully quit and shut down the background service.
- Packaged smoke tests now create the real bundled tray icon in addition to starting the bundled Codex runtime.

## [1.0.3] - 2026-07-18

### Changed

- Update checking and safe diagnostic export now live in a compact bilingual Settings dialog opened from the bottom-right corner.
- The large release/data panel and backup/restore actions were removed from the home screen.

## [1.0.2] - 2026-07-18

### Fixed

- Release validation now catches a stale third-party notices version before a tag is pushed.

## [1.0.1] - 2026-07-18

### Fixed

- Packaged readiness checks now use only the physical `app.asar.unpacked` Codex runtime and no longer mistake an ASAR virtual path for a runnable executable.
- The bundled runtime check allows additional first-launch time for Windows security scanning.
- Windows release smoke tests now start the bundled Codex runtime in win-unpacked, portable, and installed builds without calling a model or consuming tokens.

## [1.0.0] - 2026-07-17

### Added

- Windows NSIS installer alongside the existing portable executable.
- First-run Codex environment readiness checks for the bundled runtime, optional CLI/App presence, and authentication status without spending model tokens.
- In-app GitHub Release update checking with a manual download flow.
- GitHub release automation for checks, tests, Windows artifacts, release notes, and SHA-256 checksums.
- OpenAPI 3.1 documentation for administrator and Gateway task APIs, uploads, projects, SSE, usage, and key management.
- Security policy, privacy notice, contribution guide, code of conduct, and issue/pull-request templates.
- Versioned local-data schema checks, automatic pre-upgrade backups, and validated manual backup/restore with rollback safeguards.

### Changed

- Public project metadata and documentation now consistently identify the project as an independent community project under the MIT license.
- Windows build documentation now covers installed and portable editions, data retention, unsigned-binary warnings, and checksum verification.
- API compatibility, structured error, reconnect, retry, and runtime-limit behavior is explicitly documented.

### Security

- Release guidance requires origin and SHA-256 verification because Windows artifacts are intentionally unsigned.
- Environment and update checks are designed not to expose credentials, prompts, attachments, results, or Gateway secrets.

## [0.5.2] - 2026-07-17

### Added

- Model-bound Gateway keys with secure reveal and permanent deletion.
- Host enable/disable controls, cumulative usage dashboard, model breakdown, and reset support.
- Image, PDF, Office/OpenDocument, source, text, archive, and general attachment upload flow.
- Chinese/English desktop interface and portable Windows build.

### Fixed

- Usage counting and per-model aggregation behavior.
- Model selection/preset enforcement for different Gateway keys.

[3.0.9]: https://github.com/daizhongtian/Agent-Gateway/compare/v3.0.8...v3.0.9
[3.0.8]: https://github.com/daizhongtian/Agent-Gateway/compare/v3.0.7...v3.0.8
[3.0.7]: https://github.com/daizhongtian/Agent-Gateway/compare/v3.0.6...v3.0.7
[1.0.6]: https://github.com/daizhongtian/Agent-Gateway/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/daizhongtian/Agent-Gateway/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/daizhongtian/Agent-Gateway/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/daizhongtian/Agent-Gateway/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/daizhongtian/Agent-Gateway/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/daizhongtian/Agent-Gateway/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/daizhongtian/Agent-Gateway/compare/875a4b4...v1.0.0
[0.5.2]: https://github.com/daizhongtian/Agent-Gateway/tree/875a4b4
