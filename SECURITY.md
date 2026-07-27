# Security Policy

Coding Agent Gateway is a community-maintained project. It is not an OpenAI product and is not developed, endorsed, or supported by OpenAI. Do not send vulnerabilities in this project to OpenAI unless the issue is independently present in an OpenAI service or product.

## Supported versions

Security fixes are provided for the latest release published on the repository's GitHub Releases page and for the current `main` branch while the next release is being prepared. Older releases and unofficial binaries are not supported. If a report affects an older version, first verify whether the latest release is still affected.

| Version | Supported |
| --- | --- |
| Latest GitHub Release | Yes |
| Current `main` branch | Best effort, pre-release |
| Older releases | No |
| Third-party builds or modified distributions | No |

## Reporting a vulnerability

Please do not publish exploit details, credentials, private project content, or personal information in a public issue.

1. Open the repository's **Security** tab and choose **Report a vulnerability** to use GitHub private vulnerability reporting, when that option is available.
2. Include the affected version/commit, Windows version or server environment, attack prerequisites, impact, minimal reproduction steps, and a proposed mitigation if known.
3. Use synthetic test data. Redact Gateway keys (`ccc_live_...`), OpenAI API keys, Codex credentials, cookies, local paths, prompts, attachments, logs, and task results.
4. If private vulnerability reporting is unavailable, open a minimal public issue that says only that you need a private security contact. Do not include vulnerability details. A maintainer can then arrange a private GitHub channel.

The maintainers will acknowledge and triage reports when available, but this volunteer project does not promise a fixed response or remediation SLA. Reporters are asked to allow reasonable time for investigation and release before public disclosure.

## Compromised credentials

- Delete a compromised Gateway key immediately in the application. Deletion invalidates subsequent requests and terminates that key's active tasks and streams.
- Rotate a compromised `API_TOKEN`, `API_KEY_ENCRYPTION_KEY`, OpenAI API key, or Codex credential at its source. Restart every affected service instance.
- Do not post a real secret in a security report. A secret shared in chat, logs, screenshots, issues, or commits must be treated as compromised even if it is later removed.
- Removing a secret from the current Git tree does not remove it from Git history. Rotate first, then follow GitHub's documented sensitive-data removal procedure if necessary.

## Security boundaries

The default desktop mode is designed for one trusted Windows user and listens on loopback. Gateway keys authenticate other local programs but are not a multi-tenant isolation mechanism. The standalone server's token mode is deployment scaffolding, not a complete public SaaS security boundary.

Before exposing the service beyond a trusted machine, operators are responsible for TLS, strong identity, least-privilege authorization, tenant-isolated execution environments and storage, rate limits, audit logging, secret management, backup security, egress controls, and timely dependency updates. See [PRIVACY.md](PRIVACY.md) for operator access to prompts and files.

## Out of scope

The following are normally not treated as vulnerabilities in this repository unless they bypass a documented boundary:

- an administrator or machine owner reading local application data;
- a user deliberately granting `workspace-write` or `danger-full-access` and Codex acting within that permission;
- denial of service from a fully trusted local administrator;
- warnings caused solely by unsigned Windows binaries or SmartScreen reputation;
- an OpenAI/Codex service issue that is not caused by this project's code;
- unsupported old releases or modified third-party distributions.

## Safe testing

Test only systems and data you own or are authorized to assess. Do not run destructive tests against public services, other users, or production workspaces. Prefer a disposable Windows account or VM, synthetic projects, projectless mode, read-only permission, and newly generated test credentials.
