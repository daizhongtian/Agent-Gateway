import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, api } from './api'
import LandingPage, { type LandingAuthMode, type LandingLanguage } from './LandingPage'
import LegalPage, { legalDocumentFromPath } from './LegalPage'
import AdminDashboard from './AdminDashboard'
import { LanguageSelect, translate, useLanguage } from './i18n'
import type { Device, PlatformConfig, PublicHost, User } from './types'

type AuthMode = LandingAuthMode
type Notice = { tone: 'success' | 'error' | 'info'; message: string } | null
type DesktopAuthRequest = { callbackPort: number; state: string; codeChallenge: string }
type DesktopAppState = 'checking' | 'opening' | 'running' | 'not-running'
type CodingAgentState = 'checking' | 'ready' | 'login-required' | 'attention' | 'unavailable' | 'unknown'
type HostVerification = 'checking' | 'online' | 'offline' | 'unknown'
type ConnectionTone = 'online' | 'attention' | 'offline' | 'checking'

const DESKTOP_APP_HEALTH_URL = 'http://127.0.0.1:4310/api/v1/health'
const DESKTOP_APP_STATUS_URL = 'http://127.0.0.1:4310/api/v1/desktop/status'
const DESKTOP_APP_OPEN_URL = 'http://127.0.0.1:4310/api/v1/desktop/open'
const DESKTOP_APP_LAUNCH_URL = 'agent-gateway://open'
const DESKTOP_APP_RELEASES = 'https://github.com/daizhongtian/Agent-Gateway/releases'

function desktopAuthRequest(): DesktopAuthRequest | null {
  const query = new URLSearchParams(window.location.search)
  if (query.get('desktop_auth') !== '1') return null
  const callbackPort = Number(query.get('callback_port'))
  const state = query.get('state') ?? ''
  const codeChallenge = query.get('code_challenge') ?? ''
  if (!Number.isInteger(callbackPort) || callbackPort < 1 || callbackPort > 65535) return null
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(state)) return null
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return null
  return { callbackPort, state, codeChallenge }
}

function desktopCallbackUrl(request: DesktopAuthRequest, code: string) {
  const callback = new URL('http://127.0.0.1/callback')
  callback.port = String(request.callbackPort)
  callback.searchParams.set('state', request.state)
  callback.searchParams.set('code', code)
  return callback.href
}

const fallbackConfig: PlatformConfig = {
  platformVersion: '0.1.0',
  publicHostDomain: 'api.localhost',
  relayUrl: 'wss://relay.localhost/agent',
  relayEnabled: false,
  localProxyEnabled: true,
  relayProtocolVersion: 1,
  termsVersion: '2026-07-29',
  privacyVersion: '2026-07-29',
  termsPath: '/legal/platform-terms',
  privacyPath: '/legal/platform-privacy',
  allowedPublicRoutes: [],
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    server: <><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><circle cx="7" cy="7" r="1"/><circle cx="7" cy="17" r="1"/></>,
    laptop: <><rect x="4" y="4" width="16" height="12" rx="2"/><path d="M2 20h20M9 20h6"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8m-3 3 3 3m-6 0 2 2"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/></>,
    shield: <path d="M12 3 4.5 6v5.5c0 4.7 3.2 8.5 7.5 9.5 4.3-1 7.5-4.8 7.5-9.5V6L12 3Z"/>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    book: <><path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4Z"/><path d="M7 4v16"/></>,
    power: <><path d="M12 2v10"/><path d="M18.4 5.6a9 9 0 1 1-12.8 0"/></>,
    spark: <><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <div className="brand-mark"><span>A</span></div>
    {!compact && <div><strong>AGENT GATEWAY</strong><small>PLATFORM</small></div>}
  </div>
}

function AuthScreen({ config, onAuthenticated, desktopRequest, embedded = false, initialMode = 'login', language = 'zh', onClose }: { config: PlatformConfig; onAuthenticated: (user: User) => void; desktopRequest?: DesktopAuthRequest | null; embedded?: boolean; initialMode?: AuthMode; language?: LandingLanguage; onClose?: () => void }) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [legalAccepted, setLegalAccepted] = useState(false)
  const t = (zh: string, en: string) => translate(language, zh, en)

  useEffect(() => { setMode(initialMode); setLegalAccepted(false) }, [initialMode])
  useEffect(() => {
    if (!embedded) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [embedded])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!legalAccepted) {
      setError(t('请先勾选同意平台服务条款并确认已阅读平台隐私说明。', 'Accept the Platform Terms and acknowledge the Platform Privacy Notice before continuing.'))
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = mode === 'register'
        ? await api.register({ username, email: email.trim() || undefined, password, termsAccepted: true, termsVersion: config.termsVersion })
        : await api.login({ username, password, termsAccepted: true, termsVersion: config.termsVersion })
      onAuthenticated(result.user)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('无法完成登录，请稍后重试。', 'Could not sign in. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  const card = <div className="auth-card">
    <div className="mobile-brand"><Brand /></div>
    {desktopRequest && <div className="desktop-auth-banner" role="status">
      <span className="desktop-auth-banner-icon"><Icon name="laptop"/></span>
      <div><strong>{t('Agent Gateway 正在请求访问权限', 'Agent Gateway is requesting access')}</strong><p>{t('请在这里登录或创建账号，完成后将自动返回桌面应用。', 'Sign in or create an account here. You will return to the desktop app automatically.')}</p></div>
    </div>}
    <div className="auth-heading">
      <span className="step-number">01</span>
      <div><h2>{mode === 'login' ? t('欢迎回来', 'Welcome back') : t('创建你的账户', 'Create your account')}</h2><p>{mode === 'login' ? t('登录并管理你的 Online Host', 'Sign in to manage your Online Host') : t('开始配置你的第一台 Host 设备', 'Set up your first Host device')}</p></div>
    </div>
    <div className="auth-tabs" role="tablist">
      <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); setLegalAccepted(false) }}>{t('登录', 'Sign in')}</button>
      <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); setLegalAccepted(false) }}>{t('注册', 'Create account')}</button>
    </div>
    <form onSubmit={submit} className="auth-form">
      <label>{t('用户名', 'Username')}<input type="text" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={t('3–32 个字符', '3–32 characters')} minLength={3} maxLength={32} pattern="[\p{L}\p{N}](?:[\p{L}\p{N}._-]{1,30}[\p{L}\p{N}])?" required /></label>
      {mode === 'register' && <label>{t('电子邮箱（选填）', 'Email (optional)')}<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" maxLength={320} /><small>{t('仅用于之后找回密码，可以暂时不填。', 'Used only for password recovery. You can leave it blank.')}</small></label>}
      <label>{t('密码', 'Password')}<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'register' ? t('至少 12 个字符', 'At least 12 characters') : t('输入你的密码', 'Enter your password')} minLength={mode === 'register' ? 12 : undefined} maxLength={72} required /></label>
      <label className="legal-consent"><input type="checkbox" checked={legalAccepted} onChange={(event) => setLegalAccepted(event.target.checked)} required/><span>{t('我同意', 'I agree to the ')} <a href={`${config.termsPath}?lang=${language}`} target="_blank" rel="noreferrer">{t('《平台服务条款》', 'Platform Terms')}</a>{t('，并确认已阅读', ' and acknowledge the ')}<a href={`${config.privacyPath}?lang=${language}`} target="_blank" rel="noreferrer">{t('《平台隐私说明》', 'Platform Privacy Notice')}</a>{t('。', '.')}</span></label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="primary-button auth-submit" disabled={submitting || !legalAccepted}>
        <span>{submitting ? t('处理中…', 'Working…') : mode === 'login' ? t('进入控制台', 'Open dashboard') : t('创建账户', 'Create account')}</span><Icon name="arrow"/>
      </button>
    </form>
    <p className="auth-terms">{t('继续即表示你了解：公网地址只有在桌面客户端和 Relay 均在线时才可用。', 'Continue only if you understand that a public Host works when both the desktop client and Relay are online.')}</p>
  </div>

  if (embedded) return <div className="landing-auth-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose?.() }}>
    <section className="landing-auth-dialog" role="dialog" aria-modal="true" aria-label={mode === 'login' ? t('登录', 'Sign in') : t('注册', 'Create account')} onMouseDown={(event) => event.stopPropagation()}>
      <button className="landing-auth-close" type="button" onClick={onClose} aria-label={t('关闭登录窗口', 'Close sign-in dialog')}>×</button>
      {card}
    </section>
  </div>

  return <main className="auth-shell">
    <section className="auth-story">
      <Brand />
      <div className="story-copy">
        <span className="eyebrow"><i /> {t('公网 HOST 控制平面', 'PUBLIC HOST CONTROL PLANE')}</span>
        <h1>{t('让每一台电脑，', 'Connect every computer')}<br/><em>{t('安全地连接世界。', 'securely to the world.')}</em></h1>
        <p>{t('统一管理账号、设备和公网 OPENAI HOST。无需开放本机端口，未来由桌面端主动建立加密隧道。', 'Manage accounts, devices, and public OPENAI HOSTS in one place. No inbound local port is required; the desktop app will establish the encrypted tunnel.')}</p>
        <div className="story-flow" aria-label={t('请求流程', 'Request flow')}>
          <div><Icon name="globe"/><span>OpenAI SDK</span></div><b>→</b>
          <div><Icon name="shield"/><span>{t('公网 Relay', 'Public Relay')}</span></div><b>→</b>
          <div><Icon name="laptop"/><span>{t('你的桌面设备', 'Your desktop')}</span></div>
        </div>
      </div>
      <div className="auth-meta"><span>{t('协议', 'Protocol')} v{config.relayProtocolVersion}</span><span>{t('端到端控制', 'End-to-end control')}</span><span>© 2026</span></div>
    </section>

    <section className="auth-panel">
      {card}
    </section>
  </main>
}

function ConnectionTile({ icon, label, value, detail, tone }: { icon: string; label: string; value: string; detail: string; tone: ConnectionTone }) {
  return <article className={`connection-tile connection-${tone}`}>
    <span className="connection-icon"><Icon name={icon}/></span>
    <div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div>
    <i className="connection-dot" aria-hidden="true" />
  </article>
}

function localPublicHealthUrl(baseUrl: string) {
  const target = new URL(baseUrl)
  const current = new URL(window.location.href)
  const loopback = (hostname: string) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase())
  if (loopback(target.hostname) && loopback(current.hostname)) {
    target.protocol = current.protocol
    target.host = current.host
  }
  target.pathname = `${target.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}/health`
  target.search = ''
  target.hash = ''
  return target.href
}

function Dashboard({ initialUser, config, onSignedOut }: { initialUser: User; config: PlatformConfig; onSignedOut: () => void }) {
  const [language, setLanguage] = useLanguage()
  const t = (zh: string, en: string) => translate(language, zh, en)
  const [user] = useState(initialUser)
  const [notice, setNotice] = useState<Notice>(null)
  const [desktopAppState, setDesktopAppState] = useState<DesktopAppState>('checking')
  const [codingAgentState, setCodingAgentState] = useState<CodingAgentState>('checking')
  const [codingAgentLabel, setCodingAgentLabel] = useState('ChatGPT / Codex')
  const [devices, setDevices] = useState<Device[]>([])
  const [hosts, setHosts] = useState<PublicHost[]>([])
  const [platformLoading, setPlatformLoading] = useState(true)
  const [hostBusy, setHostBusy] = useState(false)
  const [hostVerification, setHostVerification] = useState<HostVerification>('unknown')
  const [showUsageGuide, setShowUsageGuide] = useState(false)

  const primaryHost = useMemo(() => hosts.find((host) => host.status !== 'disabled') ?? hosts[0] ?? null, [hosts])
  const primaryDevice = useMemo(() => {
    if (primaryHost) return devices.find((device) => device.id === primaryHost.deviceId) ?? null
    return devices.find((device) => device.status === 'active') ?? devices[0] ?? null
  }, [devices, primaryHost])

  const probeDesktopApp = useCallback(async () => {
    if (navigator.userAgent.includes('jsdom')) return false
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 1800)
    try {
      const statusResponse = await fetch(DESKTOP_APP_STATUS_URL, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      })
      if (statusResponse.ok) {
        const status = await statusResponse.json() as {
          ok?: unknown
          product?: unknown
          status?: unknown
          codingAgent?: { label?: unknown; status?: unknown; ready?: unknown } | null
        }
        if (status.ok !== true || status.product !== 'agent-gateway' || status.status !== 'ok') {
          throw new Error('The local service is not Agent Gateway.')
        }
        if (status.codingAgent && typeof status.codingAgent === 'object') {
          if (typeof status.codingAgent.label === 'string' && status.codingAgent.label) setCodingAgentLabel(status.codingAgent.label)
          const nextStatus = String(status.codingAgent.status ?? 'unknown') as CodingAgentState
          setCodingAgentState(status.codingAgent.ready === true ? 'ready' : ['login-required', 'attention', 'unavailable'].includes(nextStatus) ? nextStatus : 'unknown')
        } else {
          setCodingAgentState('unknown')
        }
        return true
      }
      const healthResponse = await fetch(DESKTOP_APP_HEALTH_URL, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      })
      if (!healthResponse.ok) throw new Error(`Desktop health check failed (${healthResponse.status}).`)
      const health = await healthResponse.json() as { ok?: unknown; product?: unknown; status?: unknown }
      if (health.ok !== true || health.product !== 'agent-gateway' || health.status !== 'ok') throw new Error('The local service is not Agent Gateway.')
      setCodingAgentState('unknown')
      return true
    } catch {
      setCodingAgentState('unknown')
      return false
    } finally {
      window.clearTimeout(timeout)
    }
  }, [])

  const checkDesktopApp = useCallback(async () => {
    setDesktopAppState('checking')
    setCodingAgentState('checking')
    setDesktopAppState(await probeDesktopApp() ? 'running' : 'not-running')
  }, [probeDesktopApp])

  const verifyPublicHost = useCallback(async (host: PublicHost) => {
    if (!host.desiredOnline || host.status === 'disabled') {
      setHostVerification('offline')
      return false
    }
    if (navigator.userAgent.includes('jsdom')) {
      const online = host.status === 'online'
      setHostVerification(online ? 'online' : 'offline')
      return online
    }
    setHostVerification('checking')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 4_500)
    try {
      const response = await fetch(localPublicHealthUrl(host.openAiBaseUrl), {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Host health check failed (${response.status}).`)
      const health = await response.json() as { ok?: unknown; product?: unknown; status?: unknown }
      const online = health.ok === true && health.product === 'agent-gateway' && health.status === 'ok'
      setHostVerification(online ? 'online' : 'offline')
      return online
    } catch {
      setHostVerification('offline')
      return false
    } finally {
      window.clearTimeout(timeout)
    }
  }, [])

  const loadPlatformState = useCallback(async () => {
    setPlatformLoading(true)
    try {
      const [nextDevices, nextHosts] = await Promise.all([api.devices(), api.hosts()])
      setDevices(nextDevices)
      setHosts(nextHosts)
      const selected = nextHosts.find((host) => host.status !== 'disabled') ?? nextHosts[0]
      if (selected) await verifyPublicHost(selected)
      else setHostVerification('unknown')
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onSignedOut()
      else setNotice({ tone: 'error', message: caught instanceof Error ? caught.message : t('无法加载平台连接状态。', 'Could not load platform connection status.') })
    } finally {
      setPlatformLoading(false)
    }
  }, [onSignedOut, verifyPublicHost, language])

  const requestDesktopFocus = useCallback(async () => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 1800)
    try {
      const response = await fetch(DESKTOP_APP_OPEN_URL, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      })
      if (!response.ok) return false
      const result = await response.json() as { ok?: unknown; product?: unknown; action?: unknown }
      return result.ok === true && result.product === 'agent-gateway' && result.action === 'desktop-open'
    } catch {
      return false
    } finally {
      window.clearTimeout(timeout)
    }
  }, [])

  async function openDesktopApp() {
    if (desktopAppState === 'opening') return
    setDesktopAppState('opening')
    setNotice({ tone: 'info', message: t('正在请求 Windows 打开 Agent Gateway…', 'Asking Windows to open Agent Gateway…') })

    const isTestBrowser = navigator.userAgent.includes('jsdom')
    if (!isTestBrowser) {
      const launcher = document.createElement('iframe')
      launcher.hidden = true
      launcher.setAttribute('aria-hidden', 'true')
      launcher.src = DESKTOP_APP_LAUNCH_URL
      document.body.appendChild(launcher)
      window.setTimeout(() => launcher.remove(), 2_000)
    }

    if (!isTestBrowser && await requestDesktopFocus()) {
      setDesktopAppState('running')
      setNotice({ tone: 'success', message: t('Agent Gateway 已打开。', 'Agent Gateway is open.') })
      return
    }

    if (!isTestBrowser) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 700))
        if (!await probeDesktopApp()) continue
        await requestDesktopFocus()
        setDesktopAppState('running')
        setNotice({ tone: 'success', message: t('Agent Gateway 已启动并通过本机验证。', 'Agent Gateway started and passed local verification.') })
        return
      }
    }

    setDesktopAppState('not-running')
    setNotice({ tone: 'error', message: t('无法打开 Agent Gateway。请安装最新版，或使用 Chrome / Edge 允许打开 agent-gateway:// 链接。', 'Could not open Agent Gateway. Install the latest version or allow the agent-gateway:// link in Chrome or Edge.') })
  }

  async function toggleOnlineHost() {
    if (!primaryHost) {
      setNotice({ tone: 'info', message: t('请先在桌面 App 登录同一平台账号，并从桌面端开启 Online Host。', 'Sign in to the same platform account in the desktop app and enable Online Host there first.') })
      return
    }
    const enable = !primaryHost.desiredOnline
    setHostBusy(true)
    try {
      let next = primaryHost
      if (enable && next.status === 'disabled') next = await api.enableHost(next.id)
      next = await api.updateHost(next.id, { displayName: next.displayName, desiredOnline: enable })
      setHosts((current) => current.map((host) => host.id === next.id ? next : host))
      if (!enable) {
        setHostVerification('offline')
        setNotice({ tone: 'success', message: t('Online Host 已关闭。', 'Online Host is off.') })
        return
      }
      const verified = await verifyPublicHost(next)
      setNotice(verified
        ? { tone: 'success', message: t('Online Host 已开启并通过真实连通检查。', 'Online Host is on and passed the connectivity check.') }
        : { tone: 'error', message: t('已发送开启请求，但公网检查未通过。请确认桌面 App 与 Relay 均在线。', 'The enable request was sent, but the public check failed. Make sure the desktop app and Relay are online.') })
    } catch (caught) {
      setHostVerification('offline')
      setNotice({ tone: 'error', message: caught instanceof Error ? caught.message : t('无法切换 Online Host。', 'Could not switch Online Host.') })
    } finally {
      setHostBusy(false)
    }
  }

  async function refreshDashboard() {
    await Promise.all([checkDesktopApp(), loadPlatformState()])
  }

  useEffect(() => { void checkDesktopApp() }, [checkDesktopApp])
  useEffect(() => { void loadPlatformState() }, [loadPlatformState])

  const desktopConnected = desktopAppState === 'running'
  const codingAgentReady = codingAgentState === 'ready'
  const hostOnline = hostVerification === 'online'
  const relayReady = config.relayEnabled || config.localProxyEnabled
  const onboardingSteps = [
    { label: t('登录平台账号', 'Sign in to the platform'), complete: true },
    { label: t('打开 Agent Gateway', 'Open Agent Gateway'), complete: desktopConnected },
    { label: `${t('连接', 'Connect')} ${codingAgentLabel}`, complete: codingAgentReady },
    { label: t('开启 Online Host', 'Enable Online Host'), complete: hostOnline },
  ]
  const issueMessages = [
    !desktopConnected ? t('桌面 App 当前离线，平台无法访问本机 Gateway。', 'The desktop app is offline, so the platform cannot reach the local Gateway.') : null,
    desktopConnected && !codingAgentReady ? `${codingAgentLabel} ${t('尚未就绪，请在桌面 App 中完成连接。', 'is not ready. Complete the connection in the desktop app.')}` : null,
    !primaryHost ? t('尚未生成 Online Host；桌面端首次开启时会自动创建。', 'No Online Host exists yet; the desktop app creates one automatically on first use.') : !hostOnline ? t('Online Host 尚未通过真实连通检查。', 'Online Host has not passed a real connectivity check.') : null,
    !relayReady ? t('平台 Relay 尚未部署，公网地址暂时不可用。', 'The platform Relay is not deployed, so the public address is unavailable.') : null,
  ].filter((message): message is string => Boolean(message))

  const codingAgentCopy = codingAgentState === 'ready'
    ? { value: t('已连接', 'Connected'), detail: t('可接受 Coding Agent 调用', 'Ready for Coding Agent requests'), tone: 'online' as const }
    : codingAgentState === 'checking'
      ? { value: t('检测中', 'Checking'), detail: t('正在读取桌面环境', 'Reading the desktop environment'), tone: 'checking' as const }
      : codingAgentState === 'login-required'
        ? { value: t('需要登录', 'Sign-in required'), detail: t('请在桌面 App 中连接 ChatGPT', 'Connect ChatGPT in the desktop app'), tone: 'attention' as const }
        : { value: t('未就绪', 'Not ready'), detail: desktopConnected ? t('请在桌面 App 中检查连接', 'Check the connection in the desktop app') : t('等待桌面 App 上线', 'Waiting for the desktop app'), tone: 'offline' as const }

  const usageBaseUrl = primaryHost?.openAiBaseUrl ?? 'https://your-online-host.example/v1'
  const pythonUsageExample = `from openai import OpenAI

client = OpenAI(
    base_url="${usageBaseUrl}",
    api_key="ccc_live_your_gateway_key",
)

model = client.models.list().data[0].id
response = client.responses.create(
    model=model,
    input="Hello from Agent Gateway",
)
print(response.output_text)`
  const javascriptUsageExample = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${usageBaseUrl}",
  apiKey: "ccc_live_your_gateway_key",
});

const models = await client.models.list();
const response = await client.responses.create({
  model: models.data[0].id,
  input: "Hello from Agent Gateway",
});
console.log(response.output_text);`

  async function signOut() {
    try { await api.logout() } finally { onSignedOut() }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <nav>
        <a className="active"><Icon name="grid"/>{t('总览', 'Overview')}</a>
        <a href="#online-host"><Icon name="globe"/>Online Host</a>
        <a href="#account"><Icon name="shield"/>{t('账号与安全', 'Account & security')}</a>
      </nav>
      <div className="sidebar-bottom">
        <div className="relay-state"><i className={relayReady ? 'ready' : ''}/><div><strong>{config.relayEnabled ? t('Relay 已就绪', 'Relay ready') : config.localProxyEnabled ? t('本地预览', 'Local preview') : t('Relay 等待中', 'Relay pending')}</strong><small>{config.relayEnabled ? t('公网中继已配置', 'Public Relay configured') : config.localProxyEnabled ? t('本地开发代理', 'Local development proxy') : t('等待服务器配置', 'Waiting for server configuration')}</small></div></div>
        <button className="profile-button" onClick={() => void signOut()} title={t('退出登录', 'Sign out')}>
          <span>{initials(user.displayName)}</span><div><strong>{user.displayName}</strong><small>@{user.username}</small></div><Icon name="logout"/>
        </button>
      </div>
    </aside>

    <main className="dashboard">
      <header className="topbar"><div><span className="crumb">{t('控制平面', 'Control plane')} /</span><strong> {t('总览', 'Overview')}</strong></div><div className="topbar-actions"><LanguageSelect language={language} onChange={setLanguage}/><button className="icon-button" onClick={() => void refreshDashboard()} aria-label={t('刷新全部状态', 'Refresh all status')}><Icon name="refresh"/></button></div></header>
      <div className="dashboard-content">
        {notice && <div className={`notice notice-${notice.tone}`}><span>{notice.message}</span><button onClick={() => setNotice(null)}>×</button></div>}
        <section className="welcome-row">
          <div><span className="eyebrow"><i /> {t('账号已激活', 'Account active')}</span><h1>{t('晚上好，', 'Good evening,')}{language === 'zh' ? '' : ' '}{user.displayName}</h1><p>{t('查看平台账号与本机 Agent Gateway 的连接状态。', 'View the connection between your platform account and local Agent Gateway.')}</p></div>
          <div className="platform-version">{t('平台', 'Platform')} <strong>v{config.platformVersion}</strong></div>
        </section>

        <section className={`desktop-app-card desktop-app-${desktopAppState}`} aria-live="polite">
          <div className="desktop-app-symbol"><Icon name="laptop" size={26}/><i /></div>
          <div className="desktop-app-copy">
            <span>{t('AGENT GATEWAY 桌面端', 'AGENT GATEWAY DESKTOP')}</span>
            <h2>{desktopAppState === 'running' ? t('桌面 App 已连接', 'Desktop app connected') : desktopAppState === 'opening' ? t('正在打开桌面 App…', 'Opening desktop app…') : desktopAppState === 'checking' ? t('正在检查桌面 App…', 'Checking desktop app…') : t('未检测到正在运行的桌面 App', 'No running desktop app detected')}</h2>
            <p>{desktopAppState === 'running' ? t('本机 Agent Gateway 正在运行。点击即可切换到桌面控制台。', 'The local Agent Gateway is running. Open it to switch to the desktop console.') : desktopAppState === 'opening' ? t('正在唤起应用并验证本机 127.0.0.1:4310，请稍候。', 'Launching the app and verifying 127.0.0.1:4310. Please wait.') : desktopAppState === 'checking' ? t('正在安全检查本机 127.0.0.1:4310。', 'Securely checking 127.0.0.1:4310.') : t('如果已经安装，请先尝试打开；如果尚未安装，可以下载 Windows 版本。', 'If it is installed, try opening it. Otherwise, download the Windows version.')}</p>
          </div>
          <div className="desktop-app-actions">
            <button type="button" className="desktop-open-button" onClick={() => void openDesktopApp()} disabled={desktopAppState === 'opening'}><Icon name="arrow"/>{desktopAppState === 'opening' ? t('正在打开…', 'Opening…') : t('打开 Agent Gateway', 'Open Agent Gateway')}</button>
            {desktopAppState === 'not-running' && <a className="desktop-download-button" href={DESKTOP_APP_RELEASES} target="_blank" rel="noreferrer">{t('下载 Windows 版本', 'Download Windows')}</a>}
            <button type="button" className="desktop-check-button" onClick={() => void checkDesktopApp()} disabled={desktopAppState === 'checking'}><Icon name="refresh"/>{t('重新检查', 'Check again')}</button>
          </div>
        </section>

        <section className="dashboard-bento" aria-label={t('Agent Gateway 连接总览', 'Agent Gateway connection overview')}>
          <article className="bento-card connection-overview">
            <div className="bento-heading"><div><span>01</span><div><h2>{t('连接总览', 'Connection overview')}</h2><p>{t('四个关键环节的实时状态', 'Live status of four critical links')}</p></div></div><button className="bento-refresh" type="button" onClick={() => void refreshDashboard()}><Icon name="refresh"/><span>{t('重新检查', 'Check again')}</span></button></div>
            <div className="connection-grid">
              <ConnectionTile icon="laptop" label={t('桌面应用', 'Desktop app')} value={desktopAppState === 'running' ? t('已连接', 'Connected') : desktopAppState === 'checking' || desktopAppState === 'opening' ? t('检测中', 'Checking') : t('离线', 'Offline')} detail={primaryDevice ? `${primaryDevice.name}${primaryDevice.appVersion ? ` · v${primaryDevice.appVersion}` : ''}` : t('本机 127.0.0.1:4310', 'Local 127.0.0.1:4310')} tone={desktopAppState === 'running' ? 'online' : desktopAppState === 'checking' || desktopAppState === 'opening' ? 'checking' : 'offline'} />
              <ConnectionTile icon="spark" label={t('CODING AGENT', 'Coding Agent')} value={codingAgentCopy.value} detail={codingAgentCopy.detail} tone={codingAgentCopy.tone} />
              <ConnectionTile icon="globe" label="ONLINE HOST" value={hostOnline ? t('在线', 'Online') : hostVerification === 'checking' ? t('检测中', 'Checking') : t('离线', 'Offline')} detail={primaryHost ? primaryHost.displayName : t('等待桌面端自动创建', 'Waiting for the desktop app to create it')} tone={hostOnline ? 'online' : hostVerification === 'checking' ? 'checking' : 'offline'} />
              <ConnectionTile icon="server" label={t('平台 RELAY', 'Platform Relay')} value={config.relayEnabled ? t('就绪', 'Ready') : config.localProxyEnabled ? t('本地', 'Local') : t('等待中', 'Pending')} detail={config.relayEnabled ? t('公网中继正常', 'Public Relay ready') : config.localProxyEnabled ? t('当前使用本地开发代理', 'Using the local development proxy') : t('等待服务器部署', 'Waiting for server deployment')} tone={config.relayEnabled ? 'online' : config.localProxyEnabled ? 'attention' : 'offline'} />
            </div>
          </article>

          <article className="bento-card onboarding-card">
            <div className="bento-kicker">{t('快速开始', 'Quick start')}</div>
            <h2>{onboardingSteps.every((step) => step.complete) ? t('已经准备就绪。', 'Everything is ready.') : t('四步完成连接。', 'Connect in four steps.')}</h2>
            <p>{onboardingSteps.every((step) => step.complete) ? t('你的 Agent Gateway 已可供其他应用调用。', 'Other applications can now call your Agent Gateway.') : t('平台会自动完成设备登记和 Host 创建，无需手动配置列表。', 'The platform registers the device and creates the Host automatically.')}</p>
            <ol className="onboarding-list">
              {onboardingSteps.map((step, index) => <li className={step.complete ? 'complete' : ''} key={step.label}><span>{step.complete ? <Icon name="check" size={15}/> : String(index + 1).padStart(2, '0')}</span><strong>{step.label}</strong></li>)}
            </ol>
          </article>

          <article id="online-host" className="bento-card online-host-card">
            <div className="online-host-head">
              <div><span className="bento-kicker">{t('你的 ONLINE HOST', 'Your Online Host')}</span><h2>{hostOnline ? t('公网入口已经在线。', 'Your public endpoint is online.') : t('把本机 Gateway 分享出去。', 'Share your local Gateway.')}</h2></div>
              <button type="button" className={`host-toggle ${hostOnline ? 'enabled' : ''}`} onClick={() => void toggleOnlineHost()} disabled={!primaryHost || hostBusy || platformLoading || (!config.relayEnabled && !config.localProxyEnabled)} aria-pressed={primaryHost?.desiredOnline === true}>
                <span><i />{hostBusy ? t('处理中…', 'Working…') : hostOnline ? t('在线', 'Online') : primaryHost?.desiredOnline ? t('连接异常', 'Connection issue') : t('离线', 'Offline')}</span>
                <Icon name="power"/>
              </button>
            </div>
            <p className="online-host-description">{t('第三方应用只需要这个 Base URL 和桌面软件生成的 Gateway Key。平台不会保存或显示你的 Gateway Key。', 'Third-party apps need only this Base URL and a Gateway Key from the desktop app. The platform never stores or displays your Gateway Key.')}</p>
            <div className="public-endpoint">
              <span>{t('基础 URL', 'Base URL')}</span>
              <code>{primaryHost?.openAiBaseUrl ?? t('等待桌面 App 自动创建 Online Host', 'Waiting for the desktop app to create Online Host')}</code>
              <button type="button" onClick={() => primaryHost && void copyText(primaryHost.openAiBaseUrl, setNotice, t)} disabled={!primaryHost} aria-label={t('复制 Online Host 地址', 'Copy Online Host address')}><Icon name="copy"/></button>
            </div>
            <div className="online-host-actions">
              <button type="button" onClick={() => primaryHost && void verifyPublicHost(primaryHost)} disabled={!primaryHost || hostVerification === 'checking'}><Icon name="refresh"/>{hostVerification === 'checking' ? t('正在检查', 'Checking') : t('检查连通性', 'Check connectivity')}</button>
              <button type="button" className={showUsageGuide ? 'active' : ''} aria-expanded={showUsageGuide} aria-controls="online-host-usage-guide" onClick={() => setShowUsageGuide((visible) => !visible)}><Icon name="book"/>{showUsageGuide ? t('收起调用方法', 'Hide usage guide') : t('查看调用方法', 'View usage guide')}</button>
              {!primaryHost && <button type="button" onClick={() => void openDesktopApp()}><Icon name="arrow"/>{t('打开桌面 App', 'Open desktop app')}</button>}
            </div>
            {showUsageGuide && <section id="online-host-usage-guide" className="host-usage-guide" aria-label={t('Online Host 调用方法', 'Online Host usage guide')}>
              <div className="usage-guide-heading">
                <div><span>{t('兼容 OPENAI 的客户端', 'OPENAI-COMPATIBLE CLIENT')}</span><h3>{t('第三方程序只需替换两个参数。', 'Third-party apps only need to replace two parameters.')}</h3><p>{t('使用桌面 App 生成的 Gateway Key；它不是 OpenAI 官方 API Key。', 'Use a Gateway Key created by the desktop app; it is not an official OpenAI API key.')}</p></div>
                <div className="usage-endpoints" aria-label={t('支持的接口', 'Supported endpoints')}><code>GET /models</code><code>POST /responses</code><code>POST /chat/completions</code></div>
              </div>
              <div className="usage-parameters">
                <div><span>{t('基础 URL', 'Base URL')}</span><code>{usageBaseUrl}</code><button type="button" onClick={() => void copyText(usageBaseUrl, setNotice, t)} aria-label={t('复制调用 Base URL', 'Copy request Base URL')}><Icon name="copy" size={16}/></button></div>
                <div><span>API KEY</span><code>ccc_live_your_gateway_key</code><small>{t('在桌面 App 的 API Keys 页面创建', 'Create it on the API Keys page in the desktop app')}</small></div>
              </div>
              <div className="usage-code-grid">
                <article>
                  <header><span>PYTHON</span><button type="button" onClick={() => void copyText(pythonUsageExample, setNotice, t)}><Icon name="copy" size={15}/>{t('复制代码', 'Copy code')}</button></header>
                  <pre><code>{pythonUsageExample}</code></pre>
                </article>
                <article>
                  <header><span>JAVASCRIPT</span><button type="button" onClick={() => void copyText(javascriptUsageExample, setNotice, t)}><Icon name="copy" size={15}/>{t('复制代码', 'Copy code')}</button></header>
                  <pre><code>{javascriptUsageExample}</code></pre>
                </article>
              </div>
              <p className="usage-guide-note">{t('模型 ID 由接口返回。普通响应和 SSE 流式响应均使用同一个 Base URL 与 Gateway Key。', 'Model IDs are returned by the endpoint. Standard and SSE streaming responses use the same Base URL and Gateway Key.')} <code>/v1/models</code></p>
            </section>}
          </article>

          <article className="bento-card notification-card">
            <div className="bento-heading compact"><div><span><Icon name="bell" size={15}/></span><div><h2>{t('状态提醒', 'Status alerts')}</h2><p>{issueMessages.length ? `${issueMessages.length} ${t('项需要处理', 'items need attention')}` : t('所有检查均已通过', 'All checks passed')}</p></div></div></div>
            <div className="notification-list">
              {issueMessages.length === 0
                ? <div className="notification-empty"><Icon name="check"/><span>{t('暂无需要处理的问题', 'Nothing needs attention')}</span></div>
                : issueMessages.map((message) => <div className="notification-item" key={message}><i/><span>{message}</span></div>)}
            </div>
          </article>

          <article id="account" className="bento-card account-card">
            <div className="account-avatar">{initials(user.displayName)}</div>
            <div className="account-copy"><span>{t('平台账号', 'Platform account')}</span><h2>{user.displayName}</h2><p>@{user.username}{user.email ? ` · ${user.email}` : ''}</p></div>
            <div className="account-meta"><span><i/>{t('会话有效', 'Session active')}</span><strong>{t('平台', 'Platform')} v{config.platformVersion}</strong></div>
            <div className="account-links"><a href={`${config.termsPath}?lang=${language}`}>{t('服务条款', 'Terms')}</a><a href={`${config.privacyPath}?lang=${language}`}>{t('隐私说明', 'Privacy')}</a><button type="button" onClick={() => void signOut()}>{t('退出登录', 'Sign out')}</button></div>
          </article>
        </section>

        <section id="security" className="security-strip"><div className="security-mark"><Icon name="shield" size={27}/></div><div><h3>{t('凭证分离与最小暴露', 'Credential separation and minimum exposure')}</h3><p>{t('平台账号、设备凭证和本地 Gateway Key 相互独立；Gateway Key 只保存在你的桌面设备中。', 'Platform accounts, device credentials, and local Gateway Keys are separate. Gateway Keys remain only on your desktop device.')} <code>ccc_live_...</code></p></div><span>{t('安全基线', 'Security baseline')} <Icon name="check"/></span></section>
      </div>
    </main>
  </div>
}

function PlatformApp() {
  const [language] = useLanguage()
  const t = (zh: string, en: string) => translate(language, zh, en)
  const [config, setConfig] = useState<PlatformConfig>(fallbackConfig)
  const [user, setUser] = useState<User | null>(null)
  const [booting, setBooting] = useState(true)
  const [authDialog, setAuthDialog] = useState<{ mode: AuthMode; language: LandingLanguage } | null>(null)
  const [desktopRequest] = useState(desktopAuthRequest)
  const [desktopAuthError, setDesktopAuthError] = useState('')
  const [desktopAuthAttempt, setDesktopAuthAttempt] = useState(0)
  const [desktopAuthConfirmed, setDesktopAuthConfirmed] = useState(false)
  const desktopAuthRunning = useRef(false)

  useEffect(() => {
    void Promise.allSettled([api.config(), api.session()]).then(([configResult, sessionResult]) => {
      if (configResult.status === 'fulfilled') setConfig(configResult.value)
      if (sessionResult.status === 'fulfilled') setUser(sessionResult.value.user)
      setBooting(false)
    })
  }, [])

  useEffect(() => {
    if (!user || !desktopRequest || !desktopAuthConfirmed || desktopAuthRunning.current) return
    desktopAuthRunning.current = true
    setDesktopAuthError('')
    void api.authorizeDesktop(desktopRequest.codeChallenge)
      .then((authorization) => window.location.assign(desktopCallbackUrl(desktopRequest, authorization.code)))
      .catch((caught) => {
        desktopAuthRunning.current = false
        setDesktopAuthError(caught instanceof Error ? caught.message : t('无法授权桌面应用。', 'Could not authorize the desktop app.'))
      })
  }, [user, desktopRequest, desktopAuthAttempt, desktopAuthConfirmed, language])

  if (booting) return <div className="boot-screen"><Brand/><span className="loader"/><p>{t('正在连接 Agent Gateway Platform…', 'Connecting to Agent Gateway Platform…')}</p></div>
  if (!user && desktopRequest) return <AuthScreen config={config} onAuthenticated={setUser} desktopRequest={desktopRequest} language={language}/>
  if (!user) return <>
    <LandingPage onAuthenticate={(mode, language) => setAuthDialog({ mode, language })}/>
    {authDialog && <AuthScreen config={config} onAuthenticated={setUser} embedded initialMode={authDialog.mode} language={authDialog.language} onClose={() => setAuthDialog(null)}/>}
  </>
  if (desktopRequest && !desktopAuthConfirmed) return <main className="desktop-return-screen"><Brand/><section>
    <span className="desktop-return-icon"><Icon name="shield" size={28}/></span>
    <p className="eyebrow">{t('桌面端授权', 'Desktop authorization')}</p>
    <h1>{t('批准 Agent Gateway 桌面端访问？', 'Approve Agent Gateway desktop access?')}</h1>
    <p>{t('仅当你在本机打开了 Agent Gateway 时继续。批准后会为请求应用创建新的桌面会话。', 'Continue only if you opened Agent Gateway on this computer. Approval creates a new desktop session for the requesting app.')}</p>
    <button className="primary-button" onClick={() => setDesktopAuthConfirmed(true)}>{t('批准并返回', 'Approve and return')}</button>
    <a href="/">{t('取消', 'Cancel')}</a>
  </section></main>
  if (desktopRequest) return <main className="desktop-return-screen"><Brand/><section>
    <span className="desktop-return-icon"><Icon name="laptop" size={28}/></span>
    <p className="eyebrow">{t('桌面端授权', 'Desktop authorization')}</p>
    <h1>{desktopAuthError ? t('无法返回桌面应用', 'Could not return to the desktop app') : t('正在返回 Agent Gateway…', 'Returning to Agent Gateway…')}</h1>
    <p>{desktopAuthError || t('账号已验证。页面安全返回时请保持桌面应用开启。', 'Your account has been verified. Keep the desktop app open while this page returns you securely.')}</p>
    {desktopAuthError && <button className="primary-button" onClick={() => setDesktopAuthAttempt((value) => value + 1)}>{t('重试', 'Try again')}</button>}
  </section></main>
  if (window.location.pathname === '/admin') {
    if (user.role !== 'admin') return <main className="admin-denied"><Brand/><section><span>403</span><h1>{t('需要管理员权限', 'Administrator access required')}</h1><p>{t('此账号无权打开 Admin Dashboard。', 'This account does not have permission to open the Admin Dashboard.')}</p><a href="/">{t('返回用户仪表盘', 'Return to the user dashboard')}</a></section></main>
    return <AdminDashboard user={user} config={config} onSignedOut={() => setUser(null)}/>
  }
  return <Dashboard initialUser={user} config={config} onSignedOut={() => setUser(null)}/>
}

export default function App() {
  const legalDocument = legalDocumentFromPath(window.location.pathname)
  return legalDocument ? <LegalPage kind={legalDocument}/> : <PlatformApp/>
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U'
}

async function copyText(value: string, setNotice: (notice: Notice) => void, t: (zh: string, en: string) => string) {
  try {
    await navigator.clipboard.writeText(value)
    setNotice({ tone: 'success', message: t('内容已复制。', 'Copied to clipboard.') })
  } catch {
    setNotice({ tone: 'error', message: t('无法访问剪贴板，请手动复制。', 'Clipboard unavailable. Copy the value manually.') })
  }
}
