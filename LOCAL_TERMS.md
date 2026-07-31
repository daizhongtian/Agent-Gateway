# Agent Gateway Desktop Installation and Use Terms

[简体中文](LOCAL_TERMS.zh-CN.md) | English

Effective date: 2026-07-29<br>
Terms version: 2026-07-29<br>
Publisher: Agent Gateway open-source project maintainers (individuals; not an incorporated company)<br>
Repository: https://github.com/daizhongtian/Agent-Gateway<br>
General contact: https://github.com/daizhongtian/Agent-Gateway/issues<br>
Security reports: https://github.com/daizhongtian/Agent-Gateway/security/advisories/new

Please read these terms before installing or using Agent Gateway. Selecting **I Agree**, completing installation, or continuing to use a portable build means that you accept these terms and acknowledge the Privacy Notice and Security Policy. If you do not agree, do not install or use the software.

## 1. Project identity and scope

Agent Gateway is an independent, community-maintained open-source project. It is not an OpenAI product and is not developed, endorsed, warranted, or supported by OpenAI, Codex, or another model provider.

These terms cover official Release installers, portable builds, and local functionality distributed by this repository. Source code and third-party open-source components remain available under the MIT License or their respective licenses. These terms do not reduce rights granted by those licenses.

Agent Gateway exposes coding-agent capabilities through controlled compatible interfaces and provides Gateway keys, model and permission policies, task state, and usage management.

## 2. Local-first and Online Host boundaries

The desktop service listens on a loopback address such as `127.0.0.1` by default. Installing Agent Gateway alone does not expose your computer, files, or API to the internet. Local callers still require a valid Gateway key while the Host is enabled.

Online Host is a separate, user-initiated feature. It requires signing in to a compatible Agent Gateway platform, a working Relay, and an explicit enable action. A compatible deployment may provide a public Relay, but installing the repository alone does not publish the local Gateway or automatically enable Online Host.

If you expose the local service through a changed bind address, port forwarding, reverse proxy, tunnel, VPN, container mapping, or another mechanism, you are responsible for TLS, authentication, authorization, rate limits, auditing, key management, network isolation, data compliance, and incident response.

## 3. Local data and network communication

The software may process or store settings, Gateway-key verification data and encrypted recoverable copies, model and permission policies, task state, call history, token and latency statistics, temporary attachments, and diagnostic metadata. Details and deletion instructions are in [PRIVACY.md](PRIVACY.md).

When you invoke a model, prompts, authorized project content, attachments, images, task parameters, and results may be sent through the local coding-agent runtime to the model service you use. That processing is also governed by the provider's terms, privacy policy, account settings, and retention rules.

A `ccc_live_...` Gateway key authenticates Agent Gateway. It is not an OpenAI API key. Treat it as sensitive: do not publish it or place it in repositories, chats, screenshots, or uncontrolled logs.

An update check may contact GitHub Releases for public version metadata. The project does not include advertising trackers, user profiling, or third-party crash telemetry. Material future telemetry must be disclosed before activation and separately consented to when required.

## 4. Files and automated actions

Use the lowest file permission necessary. Do not grant write or unrestricted access to an untrusted caller or project. A coding agent may read, create, modify, or delete content within the permission you grant. Back up important data and review high-risk actions involving credentials, production systems, or irreversible changes.

AI output can be incomplete, inaccurate, or unsuitable. Do not use unverified output as the sole basis for medical, legal, financial, life-safety, critical-infrastructure, or other high-risk decisions.

## 5. Your responsibilities

You must only process data and systems you are authorized to access. You must not use the software for unauthorized intrusion, malware, credential theft, privacy violations, fraud, unlawful surveillance, or other unlawful conduct. Protect Gateway keys, provider credentials, and device access. Follow applicable law, contracts, and organizational policies. If a credential leaks or a device is compromised, revoke affected keys, stop the Host, and take appropriate remedial action.

## 6. Third-party services and components

The software may depend on Codex/OpenAI, GitHub, npm, Windows secure storage, and other third-party components. Their availability, pricing, account eligibility, data handling, and changes are controlled by their operators. The Agent Gateway maintainers do not guarantee continued availability or compatibility of third-party services.

## 7. Updates, support, and stopping use

Maintainers may publish fixes and security updates but do not promise a release schedule, support term, SLA, or continuous availability. You may stop using and uninstall the software at any time. Uninstalling may not remove application data, project files, provider-account data, or third-party records; follow the Privacy Notice for deletion steps. Revoke exposed Gateway keys before cleaning logs, screenshots, history, or backups.

## 8. Open source, no warranty, and liability

To the maximum extent permitted by applicable law, the software is provided **as is** and **as available**, without warranties of error-free or uninterrupted operation, merchantability, fitness for a particular purpose, data preservation, or absolute security.

No local application, AI model, or credential system can guarantee the absence of defects, attacks, mistakes, or data loss. To the extent permitted by law, maintainers are not liable for indirect loss, lost profit, interruption, or data loss caused by misconfiguration, third-party services, excessive permissions, self-managed public exposure, missing backups, or violation of these terms. Nothing excludes liability or mandatory consumer rights that cannot legally be excluded.

## 9. Changes

These terms may change with product, security, or legal requirements. Material changes to processing purposes, core boundaries, responsibility, or user rights will be announced through the installer, application, repository, or another reasonable channel. A new terms version may require renewed acceptance.

## 10. Governing rules and contact

Mandatory law and jurisdiction are determined by the rules that legally apply to the individual maintainer and the user; these terms do not waive non-excludable consumer or data-protection rights. Contact the maintainers through the repository Issues page. Report vulnerabilities privately through GitHub Security Advisories and never post real credentials or private data in a public issue.
