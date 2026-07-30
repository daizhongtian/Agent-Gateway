# Agent Gateway Platform Terms and Online Host Risk Notice

[简体中文](PLATFORM_TERMS.zh-CN.md) | English

Effective date: 2026-07-29<br>
Terms version: 2026-07-29<br>
Operator: Agent Gateway open-source project maintainers (individuals; not an incorporated company)<br>
Repository and support: https://github.com/daizhongtian/Agent-Gateway<br>
Security reports: https://github.com/daizhongtian/Agent-Gateway/security/advisories/new

These terms apply to Agent Gateway platform accounts, sessions, device pairing, Host allocation, Online Host, Relay forwarding, the control panel, and related services. Creating an account or signing in requires an unchecked, affirmative acceptance of these terms and acknowledgment of the Platform Privacy Notice.

The repository currently provides a **local development preview** of the platform. A production public Relay has not been deployed. Descriptions of public Online Host behavior govern that feature if and when a public Relay is made available.

## 1. Operator and service scope

The platform is operated by the individual maintainers of the Agent Gateway open-source project. It is not an OpenAI product and does not represent OpenAI, Codex, or another model provider. It may provide account and session management, device registration and revocation, one-time pairing, Host allocation, presence, Online Host control, Relay forwarding, usage data, and security events. Availability depends on the deployed version and region.

Open-source code remains governed by its license. Repository names, project content, domains, and non-open-source hosted infrastructure remain with their respective owners.

## 2. Account eligibility and security

You must have legal capacity to accept these terms. If you act for an organization, you confirm that you are authorized. Choose a unique username; if you add a recovery email, keep it reachable. Protect passwords, sessions, device credentials, pairing codes, and Gateway keys, and do not share an account with unauthorized people. The platform may require email verification or additional security checks when an email is supplied. The service is intended for adults unless a future deployment provides an appropriate minor-consent mechanism.

## 3. Devices and Hosts

Only register devices you own, manage, or are authorized to use. Pairing codes and device credentials must not be transferred to unauthorized parties. A reserved Host address does not mean the device is online. Availability depends on the desktop app, network, Relay, local Gateway, model account, and third-party services. Hosts or devices may be limited, moved, re-paired, or suspended for security, maintenance, abuse prevention, capacity, or legal reasons.

## 4. Online Host operation and risk

Online Host is enabled only by an explicit user action. When active, callers holding a valid Gateway key may send internet requests that consume your device, network, electricity, model-account allowance, tokens, and other resources. Use separate keys for callers, least privilege, token limits, expiry, and prompt revocation.

Online Host is not end-to-end encrypted against the platform operator. A public edge or Relay normally terminates TLS and processes headers, bodies, attachments, streaming responses, and errors to remain compatible with ordinary OpenAI clients. The platform should avoid logging Authorization, Gateway keys, request bodies, and response bodies and should minimize operational logs, but infrastructure, incident response, legal obligations, or mistakes may cause limited retention. Do not use Online Host for content you are not authorized to transmit or that should not be accessible to a Relay operator.

## 5. Data processed

The platform may process account data; password hashes; sessions; IP, User-Agent, and security events; device identity and status; Host addresses and presence; request counts, model, token, latency, status, error category, and request ID; content necessary to relay a request; and support or security reports you submit. The [Platform Privacy Notice](PLATFORM_PRIVACY.md) explains purposes, storage, retention, and deletion.

## 6. Credential separation

The intended architecture does not store plaintext `ccc_live_...` Gateway keys in the platform and does not receive your Codex/OpenAI login credential or API key. Gateway keys are validated by your local Agent Gateway; model credentials remain on your device or with the model provider. A future architectural change must be disclosed before implementation.

## 7. Your content

You retain lawful rights in your content. You grant the platform a non-exclusive, worldwide, service-limited permission to route, relay, stream, secure, recover, and support the service, including processing by necessary infrastructure providers. You confirm that you have authority to submit prompts, files, images, source code, and personal data. The platform does not acquire ownership of your content and does not control a third-party model provider's independent handling.

## 8. Host administrator responsibilities

If you distribute Gateway keys, you administer that access. Decide who may call, what they may use, and for how long; keep reasonable authorization and revocation records. Inform callers that your device and model account execute requests, that you may see local tasks and logs, that a Relay may technically access transit content, and that the model provider also processes requests. Do not use Online Host to evade provider account, usage, regional, or licensing restrictions, or to resell a personal service at scale without any required authorization.

## 9. Prohibited conduct

Do not use the platform to attack unauthorized systems, distribute malware, steal credentials, phish, defraud, harass, unlawfully monitor, process unlawfully obtained personal data, infringe rights, bypass security controls, disrupt infrastructure, or violate applicable law or binding third-party terms. Related accounts, devices, Hosts, keys, or connections may be restricted or terminated, and evidence may be preserved when reasonably necessary.

## 10. Security incidents

The platform applies risk-appropriate safeguards but does not promise absolute security. If you detect abnormal activity, disable Online Host, revoke affected keys and devices, update credentials, and report privately through GitHub Security Advisories. Never post a real key, personal data, private file, or exploitable vulnerability in a public issue.

## 11. Availability, preview, and changes

Beta, Preview, and experimental services may be interrupted, delayed, or changed and are unsuitable for workloads requiring an SLA. Unless a separate paid agreement states otherwise, continuous availability, fixed latency, concurrency, or permanent features are not guaranteed. Material adverse changes will be announced when reasonably possible.

## 12. Fees and resources

The current open-source development preview has no platform fee. A future price, allowance, renewal, refund, or tax rule must be shown before charging. Platform fees would not include model-provider subscriptions, tokens, network, electricity, or hardware costs generated by your Host.

## 13. Disablement, deletion, and termination

You may disable Online Host, revoke a device, or request account deletion. Disabling a Host does not automatically delete local Gateway keys. Some security records may be retained when required; details appear in the Privacy Notice. Serious violations, security risks, or legal requirements may result in suspension or termination.

## 14. No warranty and liability

To the maximum extent permitted by law, the platform, Relay, Online Host, and AI output are provided **as is** and **as available** without a promise of absolute security, availability, accuracy, or fitness for a particular purpose. You are responsible for permissions, key distribution, callers, content, automation, and model accounts. Nothing excludes liability or mandatory consumer rights that cannot legally be excluded.

## 15. Changes to these terms

General changes may be published on the site or repository. Material changes to fees, data handling, Online Host risk, liability, or user rights will receive a prominent notice and renewed acceptance when required. If you reject a material update, disable Hosts and stop using the platform before it takes effect.

## 16. Applicable rules and disputes

Mandatory law and jurisdiction are determined by rules that legally apply to the individual operator and the user. These terms do not waive non-excludable consumer, privacy, or data-protection rights. Contact the maintainers through GitHub Issues before starting a formal dispute where practical.

## 17. Contact

Operator: Agent Gateway open-source project individual maintainers<br>
Support and deletion requests: https://github.com/daizhongtian/Agent-Gateway/issues<br>
Private security reports: https://github.com/daizhongtian/Agent-Gateway/security/advisories/new
