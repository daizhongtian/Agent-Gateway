# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) for public releases.

## [1.0.0] - Unreleased

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

[1.0.0]: https://github.com/daizhongtian/codex_sdk/compare/875a4b4...HEAD
[0.5.2]: https://github.com/daizhongtian/codex_sdk/tree/875a4b4
