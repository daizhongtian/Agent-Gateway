# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) for public releases.

## [1.0.7] - 2026-07-26

### Added

- OpenAI-compatible `GET /v1/models`, `POST /v1/responses`, and `POST /v1/chat/completions` endpoints backed by the existing native task manager.
- Non-streaming and SSE streaming response conversion, OpenAI-shaped errors, per-request `X-Request-Id`, model-bound Gateway key authentication, and compatibility regression tests.
- Base64 PNG, JPEG, and WebP image input for normal and streaming Responses and Chat Completions calls, converted locally into the existing Codex SDK `local_image` task pipeline without proxying requests to the OpenAI API.

### Changed

- The OpenAPI contract and README now document the OpenAI-compatible `/v1` base URL while retaining the native asynchronous task API.
- The repository README now displays English by default and keeps the complete Simplified Chinese guide available inline.
- The `main` branch remains the local Host edition and does not include the V2 Online Host or Tailscale Funnel controls.

### Fixed

- English Gateway monitoring now translates the Model and Permission labels and renders relative call times without Chinese text.

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

[1.0.7]: https://github.com/daizhongtian/codex_sdk/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/daizhongtian/codex_sdk/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/daizhongtian/codex_sdk/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/daizhongtian/codex_sdk/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/daizhongtian/codex_sdk/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/daizhongtian/codex_sdk/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/daizhongtian/codex_sdk/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/daizhongtian/codex_sdk/compare/875a4b4...v1.0.0
[0.5.2]: https://github.com/daizhongtian/codex_sdk/tree/875a4b4
