# V3 release workflow

The release path intentionally separates deterministic product failures from temporary network and shared-runner failures.

## Before an ordinary push

Run one command from a clean working tree:

```powershell
npm run ci:prepush
```

It installs both locked JavaScript dependency trees and runs the release configuration, syntax, desktop coverage, platform, visual, and isolated Fake Provider performance checks. Dependency installation retries only recognized network failures. Assertions, compilation errors, coverage failures, and product errors are never retried or ignored.

## Publish a V3 release

Update and commit the version first, close any locally running copy that uses files under `release/`, then run:

```powershell
npm run release:v3:push
```

This command verifies the branch, clean tracked worktree, remote divergence, and version tag before doing expensive work. It then runs the complete pre-push suite, builds and tests the installer and Portable application locally, pushes the already validated commit, waits for GitHub gates, creates the tag, and verifies the public Latest Release.

The existing read-only verification command remains available:

```powershell
npm run release:v3 -- --verify-only
```

## Gate policy

- Every V3 push: deterministic CI, security gates, and isolated Fake Provider performance smoke.
- Scheduled/manual: normal regression, spike, stress, soak, fault, full-chain performance, and deeper security validation.
- Release tag: Windows build, packaged startup/install/uninstall smoke, updater metadata, checksums, and asset verification.

GitHub API rate limits, timeouts, 429 responses, and 5xx responses are retried with bounded backoff. Real test failures remain blocking.
