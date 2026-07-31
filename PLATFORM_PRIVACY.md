# Agent Gateway Platform Privacy Notice

[简体中文](PLATFORM_PRIVACY.zh-CN.md) | English

Effective date / version: 2026-07-29<br>
Controller/operator: Agent Gateway open-source project individual maintainers (not an incorporated company)<br>
Contact and deletion requests: https://github.com/daizhongtian/Agent-Gateway/issues<br>
Private security reports: https://github.com/daizhongtian/Agent-Gateway/security/advisories/new

This notice describes the Agent Gateway platform control plane and Relay. Public Relay functionality is currently provided as a preview and operates only after the Host owner explicitly enables Online Host.

## Data we process

- Account data: username, optional recovery email, display name, password hash, status, verification state, and creation time.
- Authentication and security data: session-token hashes, CSRF-token hashes, expiry and revocation times, IP-derived security data, User-Agent, request ID, rate-limit and error events.
- Device data: device ID, name, platform, app version, public-key material or thumbprint, pairing/revocation state, and last-seen time.
- Host data: Host ID, public slug and address, bound device, desired and observed state, protocol version, Relay assignment, heartbeat and connection times.
- Usage and operations data: request counts, bytes, model or route metadata, token and latency statistics, status codes, errors, and audit events when implemented.
- Relay transit data: prompts, messages, files, images, headers, streaming responses, and errors only to the extent necessary to route an Online Host request. The Relay does not persist bodies or Authorization values by default.
- Communications you submit through support or security channels.

## Why we process it

We process data to create and secure accounts, authenticate sessions, pair and revoke devices, allocate and control Hosts, route and protect Relay connections, show status and usage, prevent abuse, diagnose failures, comply with legal obligations, and respond to support or security reports.

## Credential separation

The intended platform architecture does not receive Codex/OpenAI passwords, session credentials, or API keys and does not store plaintext `ccc_live_...` Gateway keys. Gateway keys are validated by the desktop application. Model credentials remain on the user's device or with the chosen model provider.

## Storage and recipients

In the current preview deployment, PostgreSQL and application containers run on operator-managed infrastructure. Public DNS, TLS termination, tunnel transport, and DDoS protection may be provided by infrastructure vendors; those providers process only the data needed for their role. Requests sent to a model are also processed independently by the model provider selected by the Host owner.

## Retention

Sessions remain until expiry, revocation, or account deletion. Device and Host records remain until revoked/deleted or account deletion. Pairing and authorization codes expire quickly and become unusable after use. Security records are kept only as long as reasonably needed for protection, troubleshooting, or legal obligations. Relay request and response bodies are not stored by default. Deployment-specific retention periods must be published before the service leaves preview.

## Your choices and rights

You may sign out, revoke devices, disable Hosts, and request access, correction, export, or deletion through the repository Issues contact without posting sensitive data publicly. For a sensitive request, first open a minimal issue asking for a private channel. Rights may vary by applicable law, and identity verification may be required. You may complain to a competent data-protection authority where the law provides that right.

## Cookies and local storage

The browser platform uses strictly necessary HttpOnly authentication cookies and a CSRF cookie. The landing page may store a theme or language preference locally. The project does not include advertising cookies, cross-site profiling, or third-party analytics.

## International transfer and minors

A public deployment may transmit data across regions depending on infrastructure and model providers; operators must disclose applicable locations and safeguards. The platform is intended for adults unless an appropriate minor-consent mechanism is introduced.

## Security and incidents

The project uses hashed passwords and session tokens, CSRF protection, rate limits, credential separation, and least-privilege design, but no system is absolutely secure. Security incidents will be investigated and notified as required by applicable law. Report vulnerabilities privately through GitHub Security Advisories.

## Changes

Material changes will be announced through the platform, repository, or another reasonable channel. A new terms or privacy version may require renewed acceptance before registration or sign-in.
