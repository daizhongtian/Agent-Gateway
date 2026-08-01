# Agent Gateway AI Release Guardrail

These instructions apply to every AI agent working in this repository. The goal is a reliable release with minimal duplicated local work: GitHub Actions is the authoritative full test environment, while local checks are risk-based.

## When this guardrail is mandatory

Use this procedure when a task includes any of the following:

- changing the application version;
- committing or pushing release-related changes to `V3`;
- creating or publishing a Git tag or GitHub Release;
- changing CI/CD, packaging, update metadata, authentication, Electron startup, or platform connection behavior;
- fixing a CI/CD failure that will be followed by another push or release.

For read-only questions, documentation-only analysis, or ordinary unpublished source changes, run only relevant focused checks.

## Safety rules

1. Inspect `git status --short --branch`, branch, remotes, version, and existing release artifacts before release work.
2. Preserve unrelated user changes. Never reset, discard, or overwrite them.
3. Use `V3` for V3 releases unless the user explicitly requests another branch.
4. Do not disable, weaken, skip, or delete a test merely to make a failure disappear.
5. Never publish from a dirty or divergent tracked worktree. The tag, local `V3`, and `origin/V3` must reference the same commit.
6. Do not run `npm ci`, packaging, or cleanup while another build is using `node_modules` or `release` artifacts.
7. Before deleting release output, resolve and verify the target is this repository's `release` directory. Preserve application data and encrypted platform sessions.
8. Never commit or upload credentials, session files, `.env` secrets, API keys, or secret-bearing logs.
9. Diagnose a failed focused check or GitHub job and fix its cause. Rerun that focused check plus the standard preflight; do not repeat unrelated heavy local suites unless the change affects them.
10. Treat genuine runner or network failures as infrastructure failures, but do not label reproducible product failures as infrastructure problems.

## Standard local preflight

For an ordinary V3 release, run from the repository root:

```powershell
npm ci
npm run release:preflight
```

`release:preflight` refreshes third-party notices, validates release/update configuration, and checks JavaScript syntax. Review any generated notice diff before committing.

Then run focused tests for the files changed. Examples:

- desktop/server behavior: `npm run test:coverage`;
- platform behavior: `npm run test:platform`;
- renderer/layout/localization: `npm run test:visual`;
- performance-sensitive data-path changes: `npm run performance:smoke`;
- packaging, updater, Electron startup, or bundled runtime changes: `npm run dist:all`, then `npm run test:packaged`, then `npm run checksums`.

Do not require every focused suite locally for a version-only or documentation-only release. GitHub `CI`, `Security gates`, and `Performance tests` remain the authoritative full gates on the pushed commit.

## Simple V3 publishing flow

1. Run the standard preflight and relevant focused tests.
2. Review the staged diff and run `git diff --cached --check`.
3. Commit and push the final source to `V3`.
4. Run `npm run release:v3` once.

The `release:v3` command automatically:

- verifies a clean tracked worktree and exact synchronization with `origin/V3`;
- waits for `CI`, `Security gates`, and `Performance tests` to succeed for that commit;
- creates and pushes the matching `v<package version>` tag if it does not already exist;
- waits for `Release Windows app` to build and test the installer and Portable app;
- verifies the public, stable Latest Release and its five update assets.

Use `npm run release:v3 -- --verify-only` to read back an existing release without creating or pushing anything.

If a required GitHub workflow fails, fix the cause, run the focused failing check and `npm run release:preflight`, then push the fix and rerun `npm run release:v3`. Do not move an existing version tag to a different commit.

## Required release evidence

Before reporting success, verify:

- application version and release commit SHA;
- local `V3`, `origin/V3`, and tag commit are identical;
- standard preflight and relevant focused checks passed;
- GitHub `CI`, `Security gates`, and `Performance tests` succeeded;
- `Release Windows app` succeeded;
- Release is public, stable, and marked Latest;
- installer, Portable executable, blockmap, `latest.yml`, and `SHA256SUMS.txt` are uploaded and non-empty;
- tracked worktree is clean and synchronized with `origin/V3`.

If any required item is missing, report the release as incomplete.
