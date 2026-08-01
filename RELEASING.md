# Releasing Agent Gateway V3

The normal release path intentionally keeps local work short and lets GitHub Actions perform the authoritative full checks.

## 1. Prepare and push V3

Update the version and release notes, then run:

```powershell
npm ci
npm run release:preflight
```

Run the focused test for the area changed, review the diff, commit, and push `V3`.

## 2. Publish with one command

```powershell
npm run release:v3
```

The command waits for GitHub `CI`, `Security gates`, and `Performance tests`, creates and pushes the version tag, waits for the Windows Release workflow, and verifies the published Latest Release.

It is safe to rerun after an interruption when the existing tag still points to the same V3 commit.

For a read-only check of an existing release:

```powershell
npm run release:v3 -- --verify-only
```

Packaging, updater, Electron startup, or bundled runtime changes still require a local package smoke test before pushing:

```powershell
npm run dist:all
npm run test:packaged
npm run checksums
```
