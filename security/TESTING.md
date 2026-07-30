# Repeatable Security Testing

All security verification for Agent Gateway is repository-owned, deterministic where practical, and safe for repeat execution. Tests use synthetic credentials and disposable local resources. They must never target a production account, public Host, or user dataset.

## Test tiers

### Pull request

Run on every pull request and push to `main` or `V3`:

```text
npm run security:contract
npm run security:dependencies
npm run test:all
npm run security:dast:quick
```

The tier validates the API permission matrix, Electron/container/security invariants, repository secret patterns, dependency advisories, unit/integration tests, and a disposable Docker abuse test. CodeQL, dependency review, and Gitleaks run as separate least-privilege CI jobs.

### Nightly and manual

Run nightly and before a public Relay release:

```text
npm run security:all
```

This adds the full disposable Docker DAST, rate-limit and resource bursts, backend/database restart recovery, and container image scanning. The Compose project name is unique, ports bind to loopback, credentials are generated in memory, and `docker compose down --volumes --remove-orphans` always removes the dedicated environment.

## Local commands

```text
npm run security:contract
npm run security:dependencies
npm run security:dast:quick
npm run security:dast
```

Requirements for dynamic tests: Docker Engine with Compose v2 and unused loopback ports in the generated ranges. The script refuses a Compose project name outside `agent-gateway-security-*` before cleanup.

## What is covered

- Browser/Spring authentication, refresh rotation, CSRF, rate limits, role enforcement, and error behavior.
- Tenant isolation for accounts, devices, Hosts, and administrator-only operations.
- Desktop session and bearer authorization, Gateway Key scopes and policy, task/upload ownership, Token limits, and expiry.
- Electron sandbox/preload/navigation constraints and local loopback/Host-header boundaries.
- Secret patterns, dependency advisories, build configuration, non-root containers, and loopback development ports.
- Relay route allowlisting, header filtering, request limits, downstream Gateway Key preservation, and offline behavior.
- Malformed JSON, invalid identifiers, traversal encodings, property floods, nested input, CORS, unauthorized requests, concurrent health probes, sensitive-endpoint rate limits, and restart recovery.

## Evidence and failures

CI retains reports and logs for failed security jobs. Tests must redact or avoid passwords, cookies, authorization codes, device secrets, and Gateway Keys. A reproducible failure is fixed in code, accompanied by a regression test, and the same tier is rerun. Skipping or weakening a control requires an explicit change to `security/CONTROL_CHECKLIST.md` and security review.

The production Relay requirements that remain unchecked in the control checklist are release blockers. A passing local-preview suite does not certify an undeployed Relay.
