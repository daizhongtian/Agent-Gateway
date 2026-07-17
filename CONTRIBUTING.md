# Contributing to Codex Control Center

Thank you for helping improve the project. Codex Control Center is an independent community project and is not an OpenAI product or an official OpenAI contribution channel.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security vulnerabilities must follow [SECURITY.md](SECURITY.md), not a public issue or pull request.

## Before starting

1. Search existing issues and pull requests.
2. Open an issue for a large behavior, security-boundary, persistence-format, installer, or API change before investing substantial work.
3. Keep a pull request focused on one problem. Avoid drive-by formatting or dependency churn.
4. Never include real prompts, projects, local paths, screenshots with private data, Gateway keys, OpenAI keys, cookies, credentials, or generated user-data stores.

## Development setup

Requirements:

- Windows 10 or 11 for Electron/installer verification;
- Node.js 20.16 or newer;
- npm;
- Codex authentication only when intentionally running a real SDK integration test.

Install the exact lockfile dependencies and run the local application:

```powershell
npm ci
npm run dev
```

Most server tests use a fake runner and must not spend model tokens. Do not make an automated test depend on a contributor's real Codex account.

## Required checks

Run these before opening a pull request:

```powershell
npm run check
npm test
npm run test:visual
```

For installer or packaging changes, also build the affected target and test it on a clean Windows user or disposable VM. Verify startup, environment detection, upgrade behavior, uninstall behavior, Gateway key/usage retention, and both project and projectless tasks.

## Code and API changes

- Preserve Electron isolation: no renderer Node integration, broad preload bridge, unsafe navigation, or credentials in renderer-accessible storage.
- Treat local paths, prompts, file contents, task events, results, and keys as sensitive.
- Validate paths on the server and preserve owner isolation for tasks and uploads.
- Keep errors structured and redact secrets from logs/events.
- `/api/v1` clients must remain compatible with additive fields. Any externally visible route, request/response field, status code, limit, auth behavior, or event change must update `docs/openapi.yaml`, README compatibility notes, tests, and `CHANGELOG.md`.
- A breaking API change requires explicit maintainer agreement and a new API major version; do not silently repurpose an existing field.
- Changes to on-disk data formats require a versioned migration, failure-safe backup/rollback behavior, and upgrade tests.

## Documentation and user interface

- Keep Chinese and English user-facing strings synchronized.
- Use plain language and do not imply that the project is developed, endorsed, certified, or supported by OpenAI.
- Update screenshots only with synthetic data and redacted paths/credentials.
- Update privacy and security documentation when data flow, storage, network access, authentication, permissions, or update behavior changes.

## Commits and pull requests

- Use descriptive, imperative commit messages.
- Explain the problem, solution, risk, and verification in the pull request template.
- Link related issues and call out migrations or compatibility impact.
- Keep generated `release/`, user data, logs, test credentials, and local `.env` files out of commits.
- Contributions are submitted under the repository's MIT license unless explicitly agreed otherwise before submission.

Maintainers may request changes, split an oversized pull request, or decline work that cannot be safely maintained.
