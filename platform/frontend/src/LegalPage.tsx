import { useEffect, useState } from 'react'

export type LegalDocument = 'platform-terms' | 'platform-privacy'
type Language = 'zh' | 'en'
type Section = { title: string; paragraphs: string[] }

const META = {
  zh: {
    operator: 'Agent Gateway 开源项目个人维护者（非注册公司）',
    effective: '生效日期 / 版本：2026-07-29',
    contact: '仓库、支持与删除请求',
    security: '私密安全报告',
  },
  en: {
    operator: 'Agent Gateway open-source project individual maintainers (not an incorporated company)',
    effective: 'Effective date / version: 2026-07-29',
    contact: 'Repository, support and deletion requests',
    security: 'Private security reports',
  },
} as const

const TERMS: Record<Language, Section[]> = {
  zh: [
    { title: '1. 运营主体与服务范围', paragraphs: ['平台由 Agent Gateway 开源项目个人维护者运营，不是 OpenAI 产品，也不代表 OpenAI、Codex 或其他模型服务提供商。平台可提供账户与会话、设备登记和撤销、一次性配对、Host 地址分配、在线状态、Online Host 开关、中继转发、用量与安全事件等功能。', '本仓库当前提供本地开发预览平台，尚未部署生产公网 Relay。公网 Online Host 条款在未来公共 Relay 实际提供时适用。'] },
    { title: '2. 账户资格与安全', paragraphs: ['你应具有接受本条款的民事行为能力；代表组织使用时应已经获得授权。请提供可接收通知的邮箱，并妥善保护密码、会话、设备凭据、配对码和 Gateway Key。不得与未经授权的人共享账户。'] },
    { title: '3. 设备与 Host', paragraphs: ['只能登记你拥有、管理或获授权使用的设备。配对码和设备凭据不得交给未经授权的人。分配 Host 地址不代表设备一定在线；实际可用性取决于桌面 App、网络、Relay、本地 Gateway、模型账户和第三方服务。'] },
    { title: '4. Online Host 工作方式与风险', paragraphs: ['Online Host 仅在用户明确操作后启用。持有有效 Gateway Key 的调用方可能通过互联网消耗你的设备、网络、电力、模型账户额度和 Token。请使用独立 Key、最低权限、Token 限额和到期时间。', 'Online Host 不是对平台运营者不可见的端到端加密。公网 Edge 或 Relay 通常需要终止 TLS，并在传输中处理请求头、正文、附件、流式响应和错误。不得传输你无权处理或不适合由 Relay 接触的内容。'] },
    { title: '5. 平台处理的数据', paragraphs: ['平台可能处理账户与密码哈希、会话和安全数据、设备身份与状态、Host 地址与心跳、请求数量、模型、Token、延迟、状态码、错误和 Request ID，以及转发请求所必需的内容。具体目的、保留和删除方式见《平台隐私说明》。'] },
    { title: '6. 凭据分离', paragraphs: ['当前架构不应在平台保存 ccc_live_... Gateway Key 明文，也不应接收 Codex/OpenAI 登录凭据或 API Key。Gateway Key 由本地 Agent Gateway 验证，模型凭据保留在设备或模型服务商处。'] },
    { title: '7. 内容与有限许可', paragraphs: ['你保留内容的合法权利。为提供路由、中继、流式传输、安全、恢复和支持，你授予平台仅限服务目的的处理许可，并确认有权提交提示词、文件、图片、源代码和个人信息。平台不取得你的内容所有权。'] },
    { title: '8. Host 管理者责任', paragraphs: ['向他人分发 Gateway Key 时，你负责决定调用人、权限和期限并及时撤销。应告知调用方：请求由你的设备和模型账户执行；你可能看到本地任务与日志；Relay 和模型服务商可能处理请求。不得利用 Online Host 规避第三方账户、用量、地域或许可限制。'] },
    { title: '9. 禁止行为', paragraphs: ['不得利用平台攻击未授权系统、传播恶意软件、窃取凭据、钓鱼、欺诈、骚扰、违法监控、处理违法取得的个人信息、侵犯他人权利、绕过安全控制、破坏基础设施，或违反适用法律和有约束力的第三方条款。'] },
    { title: '10. 安全事件', paragraphs: ['平台采取与风险相适应的措施，但不承诺绝对安全。发现异常时应关闭 Online Host、撤销相关 Key 和设备、更新凭据，并通过 GitHub Security Advisories 私密报告。'] },
    { title: '11. 可用性与预览', paragraphs: ['Beta、Preview 和实验服务可能中断、延迟或变化，不适合要求 SLA 的关键工作负载。除另有协议外，不保证持续可用、固定延迟、并发或永久保留功能。'] },
    { title: '12. 费用与资源', paragraphs: ['当前开源开发预览不收取平台费用。未来收费前必须明确展示价格、额度、续费、退款和税费规则。平台费用不包含模型订阅、Token、网络、电力和设备成本。'] },
    { title: '13. 停用、删除与终止', paragraphs: ['你可以关闭 Online Host、撤销设备或申请删除账户。关闭 Host 不会自动删除本地 Gateway Key。严重违规、安全风险或法律要求可能导致暂停或终止。'] },
    { title: '14. 无担保与责任限制', paragraphs: ['在法律允许的最大范围内，平台、Relay、Online Host 和 AI 输出按“现状”和“可用状态”提供，不保证绝对安全、持续可用、准确或适合特定用途。本条款不排除依法不得排除的责任或强制性权利。'] },
    { title: '15. 条款变更', paragraphs: ['一般变更可在平台或仓库公布。涉及收费、数据处理、Online Host 风险、责任或用户权利的重大变更将显著提示，并在需要时重新取得同意。'] },
    { title: '16. 适用规则与争议', paragraphs: ['适用法律和管辖由依法对个人运营者与用户具有约束力的规则确定。本条款不影响不可放弃的消费者、隐私或数据保护权利。'] },
    { title: '17. 联系', paragraphs: ['一般支持和删除请求请使用 GitHub Issues；漏洞请使用 GitHub Security Advisories 私密报告。禁止在公开 Issue 中发布真实凭据、个人信息或私有文件。'] },
  ],
  en: [
    { title: '1. Operator and service scope', paragraphs: ['The platform is operated by individual maintainers of the Agent Gateway open-source project. It is not an OpenAI product and does not represent OpenAI, Codex, or another model provider. It may provide accounts, sessions, device registration and revocation, pairing, Host allocation, presence, Online Host control, Relay forwarding, usage and security events.', 'The repository currently provides a local development preview. A production public Relay has not been deployed. Public Online Host terms apply if and when that service is made available.'] },
    { title: '2. Account eligibility and security', paragraphs: ['You must have legal capacity to accept these terms and authority when acting for an organization. Provide a reachable email and protect passwords, sessions, device credentials, pairing codes, and Gateway keys. Do not share an account with unauthorized people.'] },
    { title: '3. Devices and Hosts', paragraphs: ['Only register devices you own, manage, or are authorized to use. Do not transfer pairing codes or device credentials to unauthorized parties. A reserved Host address does not mean a device is online; availability depends on the desktop app, network, Relay, local Gateway, model account, and third-party services.'] },
    { title: '4. Online Host operation and risk', paragraphs: ['Online Host requires an explicit enable action. A caller holding a valid Gateway key may consume your device, network, electricity, model allowance, and tokens. Use separate keys, least privilege, token limits, expiry, and prompt revocation.', 'Online Host is not end-to-end encrypted against the platform operator. A public Edge or Relay normally terminates TLS and processes headers, bodies, attachments, streams, and errors. Do not transmit content you lack authority to process or that should not be accessible to a Relay.'] },
    { title: '5. Data processed', paragraphs: ['The platform may process account and password-hash data, sessions and security events, device identity and state, Host addresses and heartbeats, request counts, model, token, latency, status, errors and request IDs, and content necessary to relay a request. See the Platform Privacy Notice for purposes, retention, and deletion.'] },
    { title: '6. Credential separation', paragraphs: ['The intended architecture does not store plaintext ccc_live_... Gateway keys in the platform and does not receive Codex/OpenAI credentials or API keys. Gateway keys are validated locally; model credentials remain on the device or with the provider.'] },
    { title: '7. Content and limited permission', paragraphs: ['You retain lawful rights in your content and grant only the service-limited permission needed for routing, relaying, streaming, security, recovery, and support. You confirm authority to submit prompts, files, images, source code, and personal data.'] },
    { title: '8. Host administrator responsibilities', paragraphs: ['If you distribute Gateway keys, you control callers, permissions, duration, and revocation. Inform callers that your device and model account execute requests, that you may see local tasks and logs, and that Relay and model providers may process requests. Do not use Online Host to evade provider restrictions.'] },
    { title: '9. Prohibited conduct', paragraphs: ['Do not attack unauthorized systems, distribute malware, steal credentials, phish, defraud, harass, unlawfully monitor, process unlawfully obtained personal data, infringe rights, bypass security controls, disrupt infrastructure, or violate applicable law or binding third-party terms.'] },
    { title: '10. Security incidents', paragraphs: ['No system is absolutely secure. On abnormal activity, disable Online Host, revoke affected keys and devices, update credentials, and report privately through GitHub Security Advisories.'] },
    { title: '11. Availability and preview', paragraphs: ['Beta, Preview, and experimental services may be interrupted, delayed, or changed and are unsuitable for workloads requiring an SLA. Continuous availability, fixed latency, concurrency, or permanent features are not guaranteed unless separately agreed.'] },
    { title: '12. Fees and resources', paragraphs: ['The current open-source development preview has no platform fee. Future charges must be disclosed before billing. Model subscriptions, tokens, network, electricity, and hardware remain separate costs.'] },
    { title: '13. Disablement, deletion, and termination', paragraphs: ['You may disable Online Host, revoke devices, or request account deletion. Disabling a Host does not delete local Gateway keys. Serious violations, security risks, or legal requirements may cause suspension or termination.'] },
    { title: '14. No warranty and liability', paragraphs: ['To the maximum extent permitted by law, the platform, Relay, Online Host, and AI output are provided as is and as available, without promises of absolute security, availability, accuracy, or fitness. Mandatory rights and liabilities remain unaffected.'] },
    { title: '15. Changes', paragraphs: ['General changes may be published on the platform or repository. Material changes to fees, data handling, Online Host risk, liability, or user rights will receive prominent notice and renewed acceptance when required.'] },
    { title: '16. Applicable rules and disputes', paragraphs: ['Mandatory law and jurisdiction are determined by rules that legally apply to the individual operator and user. Non-excludable consumer, privacy, and data-protection rights remain unaffected.'] },
    { title: '17. Contact', paragraphs: ['Use GitHub Issues for support and deletion requests and GitHub Security Advisories for private vulnerability reports. Never publish real credentials, personal data, or private files in a public issue.'] },
  ],
}

const PRIVACY: Record<Language, Section[]> = {
  zh: [
    { title: '处理的数据', paragraphs: ['平台可能处理账户和密码哈希、会话及 CSRF 令牌哈希、IP 衍生安全数据、User-Agent、Request ID、设备身份与状态、Host 地址与心跳、用量与错误，以及未来 Relay 转发请求所必需的提示词、文件、图片、请求头、流式响应和错误。'] },
    { title: '处理目的', paragraphs: ['用于创建和保护账户、认证会话、配对和撤销设备、分配和控制 Host、路由并保护 Relay、展示状态和用量、防止滥用、诊断故障，以及响应客服或安全报告。'] },
    { title: '凭据分离', paragraphs: ['平台不应接收 Codex/OpenAI 密码、会话凭据或 API Key，也不应保存 ccc_live_... Gateway Key 明文。Gateway Key 由桌面 App 验证。'] },
    { title: '存储、接收方与保留', paragraphs: ['当前预览的数据库和容器运行在本机。未来公网部署使用的托管、数据库、DNS、TLS、防护、日志或邮件服务商必须在上线前披露。会话保留至到期或撤销，设备和 Host 保留至删除，临时代码快速到期；Relay 默认不应保存请求和响应正文。'] },
    { title: '你的选择与权利', paragraphs: ['你可以退出、撤销设备、关闭 Host，并通过 GitHub Issues 申请访问、更正、导出或删除。敏感请求请先要求私密沟通渠道，不要公开个人信息。具体权利和身份验证要求取决于适用法律。'] },
    { title: 'Cookie、本地偏好与遥测', paragraphs: ['浏览器平台使用严格必要的 HttpOnly 登录 Cookie 和 CSRF Cookie，并可在本地保存主题或语言。本项目不包含广告 Cookie、跨站画像或第三方分析。'] },
    { title: '安全、跨境与变更', paragraphs: ['任何系统均无法保证绝对安全。未来跨区域部署的位置和保护措施必须在上线前披露。重大隐私变化会显著提示，并可能要求重新确认。'] },
  ],
  en: [
    { title: 'Data processed', paragraphs: ['The platform may process account and password hashes, session and CSRF token hashes, IP-derived security data, User-Agent, request IDs, device identity and state, Host addresses and heartbeats, usage and errors, and content necessary for a future Relay such as prompts, files, images, headers, streams, and errors.'] },
    { title: 'Purposes', paragraphs: ['Data is used to create and secure accounts, authenticate sessions, pair and revoke devices, allocate and control Hosts, route and protect Relay traffic, show status and usage, prevent abuse, diagnose failures, and respond to support or security reports.'] },
    { title: 'Credential separation', paragraphs: ['The platform should not receive Codex/OpenAI passwords, session credentials, or API keys and should not store plaintext ccc_live_... Gateway keys. Gateway keys are validated by the desktop app.'] },
    { title: 'Storage, recipients, and retention', paragraphs: ['The current preview database and containers run locally. Hosting, database, DNS, TLS, protection, logging, or email providers for a future public deployment must be disclosed before launch. Sessions last until expiry or revocation, devices and Hosts until deletion, temporary codes expire quickly, and Relay bodies should not be stored by default.'] },
    { title: 'Your choices and rights', paragraphs: ['You may sign out, revoke devices, disable Hosts, and request access, correction, export, or deletion through GitHub Issues. Ask for a private channel for sensitive requests. Applicable rights and identity checks vary by law.'] },
    { title: 'Cookies, local preferences, and telemetry', paragraphs: ['The browser platform uses strictly necessary HttpOnly authentication cookies and a CSRF cookie and may store theme or language locally. The project includes no advertising cookies, cross-site profiling, or third-party analytics.'] },
    { title: 'Security, international transfer, and changes', paragraphs: ['No system is absolutely secure. A future cross-region deployment must disclose locations and safeguards before launch. Material privacy changes will receive prominent notice and may require renewed acknowledgment.'] },
  ],
}

export function legalDocumentFromPath(pathname: string): LegalDocument | null {
  if (pathname === '/legal/platform-terms') return 'platform-terms'
  if (pathname === '/legal/platform-privacy') return 'platform-privacy'
  return null
}

export default function LegalPage({ kind }: { kind: LegalDocument }) {
  const queryLanguage = new URLSearchParams(window.location.search).get('lang')
  const [language, setLanguage] = useState<Language>(queryLanguage === 'en' ? 'en' : 'zh')
  const terms = kind === 'platform-terms'
  const title = terms
    ? language === 'zh' ? '平台服务条款与 Online Host 风险确认' : 'Platform Terms and Online Host Risk Notice'
    : language === 'zh' ? '平台隐私说明' : 'Platform Privacy Notice'
  const intro = terms
    ? language === 'zh' ? '注册或登录前，你必须主动同意本条款并确认已阅读平台隐私说明。当前平台是本地开发预览，尚未部署生产公网 Relay。' : 'Before registration or sign-in, you must actively accept these terms and acknowledge the Platform Privacy Notice. The current platform is a local development preview without a production public Relay.'
    : language === 'zh' ? '本说明介绍平台控制面与未来 Relay 如何处理数据。当前平台仅为本地开发预览。' : 'This notice describes data handling by the platform control plane and future Relay. The current platform is a local development preview.'

  useEffect(() => { document.title = `${title} · Agent Gateway` }, [title])

  return <main className="legal-page">
    <header className="legal-header">
      <a href="/" className="legal-brand"><span>A</span><strong>AGENT GATEWAY</strong></a>
      <div><button type="button" onClick={() => setLanguage((current) => current === 'zh' ? 'en' : 'zh')}>{language === 'zh' ? 'English' : '简体中文'}</button><a href="/">{language === 'zh' ? '返回首页' : 'Back home'} →</a></div>
    </header>
    <article className="legal-document">
      <div className="legal-kicker">LEGAL · VERSION 2026-07-29</div>
      <h1>{title}</h1>
      <p className="legal-intro">{intro}</p>
      <dl className="legal-meta"><div><dt>{language === 'zh' ? '运营主体' : 'Operator'}</dt><dd>{META[language].operator}</dd></div><div><dt>{language === 'zh' ? '生效信息' : 'Effective information'}</dt><dd>{META[language].effective}</dd></div></dl>
      {(terms ? TERMS[language] : PRIVACY[language]).map((section) => <section key={section.title}><h2>{section.title}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}
      <section className="legal-contact"><h2>{language === 'zh' ? '联系渠道' : 'Contact channels'}</h2><p>{META[language].contact}: <a href="https://github.com/daizhongtian/Agent-Gateway/issues" target="_blank" rel="noreferrer">GitHub Issues ↗</a></p><p>{META[language].security}: <a href="https://github.com/daizhongtian/Agent-Gateway/security/advisories/new" target="_blank" rel="noreferrer">GitHub Security Advisories ↗</a></p></section>
      <footer><a href={terms ? `/legal/platform-privacy?lang=${language}` : `/legal/platform-terms?lang=${language}`}>{terms ? language === 'zh' ? '阅读平台隐私说明' : 'Read the Platform Privacy Notice' : language === 'zh' ? '阅读平台服务条款' : 'Read the Platform Terms'} →</a></footer>
    </article>
  </main>
}
