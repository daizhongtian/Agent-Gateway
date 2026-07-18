# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) for public releases.

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

[1.0.3]: https://github.com/daizhongtian/codex_sdk/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/daizhongtian/codex_sdk/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/daizhongtian/codex_sdk/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/daizhongtian/codex_sdk/compare/875a4b4...v1.0.0
[0.5.2]: https://github.com/daizhongtian/codex_sdk/tree/875a4b4
