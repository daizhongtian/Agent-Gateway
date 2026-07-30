import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, api } from './api'
import LandingPage, { type LandingAuthMode, type LandingLanguage } from './LandingPage'
import LegalPage, { legalDocumentFromPath } from './LegalPage'
import AdminDashboard from './AdminDashboard'
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
  const t = (zh: string, en: string) => language === 'zh' ? zh : en

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
      <div><strong>Agent Gateway is requesting access</strong><p>Sign in or create an account here. You will return to the desktop app automatically.</p></div>
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
        <span className="eyebrow"><i /> PUBLIC HOST CONTROL PLANE</span>
        <h1>让每一台电脑，<br/><em>安全地连接世界。</em></h1>
        <p>账户、设备和公网 OPENAI HOST 的统一管理平台。无需开放本机端口，未来由桌面端主动建立加密隧道。</p>
        <div className="story-flow" aria-label="Request flow">
          <div><Icon name="globe"/><span>OpenAI SDK</span></div><b>→</b>
          <div><Icon name="shield"/><span>Public Relay</span></div><b>→</b>
          <div><Icon name="laptop"/><span>Your Desktop</span></div>
        </div>
      </div>
      <div className="auth-meta"><span>Protocol v{config.relayProtocolVersion}</span><span>End-to-end control</span><span>© 2026</span></div>
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
      else setNotice({ tone: 'error', message: caught instanceof Error ? caught.message : '无法加载平台连接状态。' })
    } finally {
      setPlatformLoading(false)
    }
  }, [onSignedOut, verifyPublicHost])

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
    setNotice({ tone: 'info', message: '正在请求 Windows 打开 Agent Gateway…' })

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
      setNotice({ tone: 'success', message: 'Agent Gateway 已打开。' })
      return
    }

    if (!isTestBrowser) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 700))
        if (!await probeDesktopApp()) continue
        await requestDesktopFocus()
        setDesktopAppState('running')
        setNotice({ tone: 'success', message: 'Agent Gateway 已启动并通过本机验证。' })
        return
      }
    }

    setDesktopAppState('not-running')
    setNotice({ tone: 'error', message: '无法打开 Agent Gateway。请安装最新版，或使用 Chrome / Edge 允许打开 agent-gateway:// 链接。' })
  }

  async function toggleOnlineHost() {
    if (!primaryHost) {
      setNotice({ tone: 'info', message: '请先在桌面 App 登录同一平台账号，并从桌面端开启 Online Host。' })
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
        setNotice({ tone: 'success', message: 'Online Host 已关闭。' })
        return
      }
      const verified = await verifyPublicHost(next)
      setNotice(verified
        ? { tone: 'success', message: 'Online Host 已开启并通过真实连通检查。' }
        : { tone: 'error', message: '已发送开启请求，但公网检查未通过。请确认桌面 App 与 Relay 均在线。' })
    } catch (caught) {
      setHostVerification('offline')
      setNotice({ tone: 'error', message: caught instanceof Error ? caught.message : '无法切换 Online Host。' })
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
    { label: '登录平台账号', complete: true },
    { label: '打开 Agent Gateway', complete: desktopConnected },
    { label: `连接 ${codingAgentLabel}`, complete: codingAgentReady },
    { label: '开启 Online Host', complete: hostOnline },
  ]
  const issueMessages = [
    !desktopConnected ? '桌面 App 当前离线，平台无法访问本机 Gateway。' : null,
    desktopConnected && !codingAgentReady ? `${codingAgentLabel} 尚未就绪，请在桌面 App 中完成连接。` : null,
    !primaryHost ? '尚未生成 Online Host；桌面端首次开启时会自动创建。' : !hostOnline ? 'Online Host 尚未通过真实连通检查。' : null,
    !relayReady ? '平台 Relay 尚未部署，公网地址暂时不可用。' : null,
  ].filter((message): message is string => Boolean(message))

  const codingAgentCopy = codingAgentState === 'ready'
    ? { value: '已连接', detail: '可接受 Coding Agent 调用', tone: 'online' as const }
    : codingAgentState === 'checking'
      ? { value: '检测中', detail: '正在读取桌面环境', tone: 'checking' as const }
      : codingAgentState === 'login-required'
        ? { value: '需要登录', detail: '请在桌面 App 中连接 ChatGPT', tone: 'attention' as const }
        : { value: '未就绪', detail: desktopConnected ? '请在桌面 App 中检查连接' : '等待桌面 App 上线', tone: 'offline' as const }

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
        <a className="active"><Icon name="grid"/>总览</a>
        <a href="#online-host"><Icon name="globe"/>Online Host</a>
        <a href="#account"><Icon name="shield"/>账号与安全</a>
        {user.role === 'admin' && <a href="/admin"><Icon name="server"/>Admin</a>}
      </nav>
      <div className="sidebar-bottom">
        <div className="relay-state"><i className={relayReady ? 'ready' : ''}/><div><strong>{config.relayEnabled ? 'Relay ready' : config.localProxyEnabled ? 'Local preview' : 'Relay pending'}</strong><small>{config.relayEnabled ? '公网中继已配置' : config.localProxyEnabled ? '本地开发代理' : '等待服务器配置'}</small></div></div>
        <button className="profile-button" onClick={() => void signOut()} title="退出登录">
          <span>{initials(user.displayName)}</span><div><strong>{user.displayName}</strong><small>@{user.username}</small></div><Icon name="logout"/>
        </button>
      </div>
    </aside>

    <main className="dashboard">
      <header className="topbar"><div><span className="crumb">CONTROL PLANE /</span><strong> OVERVIEW</strong></div><button className="icon-button" onClick={() => void refreshDashboard()} aria-label="刷新全部状态"><Icon name="refresh"/></button></header>
      <div className="dashboard-content">
        {notice && <div className={`notice notice-${notice.tone}`}><span>{notice.message}</span><button onClick={() => setNotice(null)}>×</button></div>}
        <section className="welcome-row">
          <div><span className="eyebrow"><i /> ACCOUNT ACTIVE</span><h1>晚上好，{user.displayName}</h1><p>查看平台账号与本机 Agent Gateway 的连接状态。</p></div>
          <div className="platform-version">PLATFORM <strong>v{config.platformVersion}</strong></div>
        </section>

        <section className={`desktop-app-card desktop-app-${desktopAppState}`} aria-live="polite">
          <div className="desktop-app-symbol"><Icon name="laptop" size={26}/><i /></div>
          <div className="desktop-app-copy">
            <span>AGENT GATEWAY DESKTOP</span>
            <h2>{desktopAppState === 'running' ? '桌面 App 已连接' : desktopAppState === 'opening' ? '正在打开桌面 App…' : desktopAppState === 'checking' ? '正在检查桌面 App…' : '未检测到正在运行的桌面 App'}</h2>
            <p>{desktopAppState === 'running' ? '本机 Agent Gateway 正在运行。点击即可切换到桌面控制台。' : desktopAppState === 'opening' ? '正在唤起应用并验证本机 127.0.0.1:4310，请稍候。' : desktopAppState === 'checking' ? '正在安全检查本机 127.0.0.1:4310。' : '如果已经安装，请先尝试打开；如果尚未安装，可以下载 Windows 版本。'}</p>
          </div>
          <div className="desktop-app-actions">
            <button type="button" className="desktop-open-button" onClick={() => void openDesktopApp()} disabled={desktopAppState === 'opening'}><Icon name="arrow"/>{desktopAppState === 'opening' ? '正在打开…' : '打开 Agent Gateway'}</button>
            {desktopAppState === 'not-running' && <a className="desktop-download-button" href={DESKTOP_APP_RELEASES} target="_blank" rel="noreferrer">下载 Windows 版本</a>}
            <button type="button" className="desktop-check-button" onClick={() => void checkDesktopApp()} disabled={desktopAppState === 'checking'}><Icon name="refresh"/>重新检查</button>
          </div>
        </section>

        <section className="dashboard-bento" aria-label="Agent Gateway connection overview">
          <article className="bento-card connection-overview">
            <div className="bento-heading"><div><span>01</span><div><h2>连接总览</h2><p>四个关键环节的实时状态</p></div></div><button className="bento-refresh" type="button" onClick={() => void refreshDashboard()}><Icon name="refresh"/><span>重新检查</span></button></div>
            <div className="connection-grid">
              <ConnectionTile icon="laptop" label="DESKTOP APP" value={desktopAppState === 'running' ? '已连接' : desktopAppState === 'checking' || desktopAppState === 'opening' ? '检测中' : '离线'} detail={primaryDevice ? `${primaryDevice.name}${primaryDevice.appVersion ? ` · v${primaryDevice.appVersion}` : ''}` : '本机 127.0.0.1:4310'} tone={desktopAppState === 'running' ? 'online' : desktopAppState === 'checking' || desktopAppState === 'opening' ? 'checking' : 'offline'} />
              <ConnectionTile icon="spark" label="CODING AGENT" value={codingAgentCopy.value} detail={codingAgentCopy.detail} tone={codingAgentCopy.tone} />
              <ConnectionTile icon="globe" label="ONLINE HOST" value={hostOnline ? 'Online' : hostVerification === 'checking' ? '检测中' : 'Offline'} detail={primaryHost ? primaryHost.displayName : '等待桌面端自动创建'} tone={hostOnline ? 'online' : hostVerification === 'checking' ? 'checking' : 'offline'} />
              <ConnectionTile icon="server" label="PLATFORM RELAY" value={config.relayEnabled ? 'Ready' : config.localProxyEnabled ? 'Local' : 'Pending'} detail={config.relayEnabled ? '公网中继正常' : config.localProxyEnabled ? '当前使用本地开发代理' : '等待服务器部署'} tone={config.relayEnabled ? 'online' : config.localProxyEnabled ? 'attention' : 'offline'} />
            </div>
          </article>

          <article className="bento-card onboarding-card">
            <div className="bento-kicker">QUICK START</div>
            <h2>{onboardingSteps.every((step) => step.complete) ? '已经准备就绪。' : '四步完成连接。'}</h2>
            <p>{onboardingSteps.every((step) => step.complete) ? '你的 Agent Gateway 已可供其他应用调用。' : '平台会自动完成设备登记和 Host 创建，无需手动配置列表。'}</p>
            <ol className="onboarding-list">
              {onboardingSteps.map((step, index) => <li className={step.complete ? 'complete' : ''} key={step.label}><span>{step.complete ? <Icon name="check" size={15}/> : String(index + 1).padStart(2, '0')}</span><strong>{step.label}</strong></li>)}
            </ol>
          </article>

          <article id="online-host" className="bento-card online-host-card">
            <div className="online-host-head">
              <div><span className="bento-kicker">YOUR ONLINE HOST</span><h2>{hostOnline ? '公网入口已经在线。' : '把本机 Gateway 分享出去。'}</h2></div>
              <button type="button" className={`host-toggle ${hostOnline ? 'enabled' : ''}`} onClick={() => void toggleOnlineHost()} disabled={!primaryHost || hostBusy || platformLoading || (!config.relayEnabled && !config.localProxyEnabled)} aria-pressed={primaryHost?.desiredOnline === true}>
                <span><i />{hostBusy ? '处理中…' : hostOnline ? 'Online' : primaryHost?.desiredOnline ? '连接异常' : 'Offline'}</span>
                <Icon name="power"/>
              </button>
            </div>
            <p className="online-host-description">第三方应用只需要这个 Base URL 和桌面软件生成的 Gateway Key。平台不会保存或显示你的 Gateway Key。</p>
            <div className="public-endpoint">
              <span>BASE URL</span>
              <code>{primaryHost?.openAiBaseUrl ?? '等待桌面 App 自动创建 Online Host'}</code>
              <button type="button" onClick={() => primaryHost && void copyText(primaryHost.openAiBaseUrl, setNotice)} disabled={!primaryHost} aria-label="复制 Online Host 地址"><Icon name="copy"/></button>
            </div>
            <div className="online-host-actions">
              <button type="button" onClick={() => primaryHost && void verifyPublicHost(primaryHost)} disabled={!primaryHost || hostVerification === 'checking'}><Icon name="refresh"/>{hostVerification === 'checking' ? '正在检查' : '检查连通性'}</button>
              <button type="button" className={showUsageGuide ? 'active' : ''} aria-expanded={showUsageGuide} aria-controls="online-host-usage-guide" onClick={() => setShowUsageGuide((visible) => !visible)}><Icon name="book"/>{showUsageGuide ? '收起调用方法' : '查看调用方法'}</button>
              {!primaryHost && <button type="button" onClick={() => void openDesktopApp()}><Icon name="arrow"/>打开桌面 App</button>}
            </div>
            {showUsageGuide && <section id="online-host-usage-guide" className="host-usage-guide" aria-label="Online Host 调用方法">
              <div className="usage-guide-heading">
                <div><span>OPENAI-COMPATIBLE CLIENT</span><h3>第三方程序只需替换两个参数。</h3><p>使用桌面 App 生成的 Gateway Key；它不是 OpenAI 官方 API Key。</p></div>
                <div className="usage-endpoints" aria-label="支持的接口"><code>GET /models</code><code>POST /responses</code><code>POST /chat/completions</code></div>
              </div>
              <div className="usage-parameters">
                <div><span>BASE URL</span><code>{usageBaseUrl}</code><button type="button" onClick={() => void copyText(usageBaseUrl, setNotice)} aria-label="复制调用 Base URL"><Icon name="copy" size={16}/></button></div>
                <div><span>API KEY</span><code>ccc_live_your_gateway_key</code><small>在桌面 App 的 API Keys 页面创建</small></div>
              </div>
              <div className="usage-code-grid">
                <article>
                  <header><span>PYTHON</span><button type="button" onClick={() => void copyText(pythonUsageExample, setNotice)}><Icon name="copy" size={15}/>复制代码</button></header>
                  <pre><code>{pythonUsageExample}</code></pre>
                </article>
                <article>
                  <header><span>JAVASCRIPT</span><button type="button" onClick={() => void copyText(javascriptUsageExample, setNotice)}><Icon name="copy" size={15}/>复制代码</button></header>
                  <pre><code>{javascriptUsageExample}</code></pre>
                </article>
              </div>
              <p className="usage-guide-note">模型 ID 由 <code>/v1/models</code> 返回。普通响应和 SSE 流式响应均使用同一个 Base URL 与 Gateway Key。</p>
            </section>}
          </article>

          <article className="bento-card notification-card">
            <div className="bento-heading compact"><div><span><Icon name="bell" size={15}/></span><div><h2>状态提醒</h2><p>{issueMessages.length ? `${issueMessages.length} 项需要处理` : '所有检查均已通过'}</p></div></div></div>
            <div className="notification-list">
              {issueMessages.length === 0
                ? <div className="notification-empty"><Icon name="check"/><span>暂无需要处理的问题</span></div>
                : issueMessages.map((message) => <div className="notification-item" key={message}><i/><span>{message}</span></div>)}
            </div>
          </article>

          <article id="account" className="bento-card account-card">
            <div className="account-avatar">{initials(user.displayName)}</div>
            <div className="account-copy"><span>PLATFORM ACCOUNT</span><h2>{user.displayName}</h2><p>@{user.username}{user.email ? ` · ${user.email}` : ''}</p></div>
            <div className="account-meta"><span><i/>Session active</span><strong>Platform v{config.platformVersion}</strong></div>
            <div className="account-links"><a href={`${config.termsPath}?lang=zh`}>服务条款</a><a href={`${config.privacyPath}?lang=zh`}>隐私说明</a><button type="button" onClick={() => void signOut()}>退出登录</button></div>
          </article>
        </section>

        <section id="security" className="security-strip"><div className="security-mark"><Icon name="shield" size={27}/></div><div><h3>凭证分离与最小暴露</h3><p>平台账号、设备凭证和本地 <code>ccc_live_...</code> Gateway Key 相互独立；Gateway Key 只保存在你的桌面设备中。</p></div><span>SECURITY BASELINE <Icon name="check"/></span></section>
      </div>
    </main>
  </div>
}

function PlatformApp() {
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
        setDesktopAuthError(caught instanceof Error ? caught.message : 'Could not authorize the desktop app.')
      })
  }, [user, desktopRequest, desktopAuthAttempt, desktopAuthConfirmed])

  if (booting) return <div className="boot-screen"><Brand/><span className="loader"/><p>正在连接 Agent Gateway Platform…</p></div>
  if (!user && desktopRequest) return <AuthScreen config={config} onAuthenticated={setUser} desktopRequest={desktopRequest}/>
  if (!user) return <>
    <LandingPage onAuthenticate={(mode, language) => setAuthDialog({ mode, language })}/>
    {authDialog && <AuthScreen config={config} onAuthenticated={setUser} embedded initialMode={authDialog.mode} language={authDialog.language} onClose={() => setAuthDialog(null)}/>}
  </>
  if (desktopRequest && !desktopAuthConfirmed) return <main className="desktop-return-screen"><Brand/><section>
    <span className="desktop-return-icon"><Icon name="shield" size={28}/></span>
    <p className="eyebrow">DESKTOP AUTHORIZATION</p>
    <h1>Approve Agent Gateway desktop access?</h1>
    <p>Continue only if you opened Agent Gateway on this computer. Approval creates a new desktop session for the requesting app.</p>
    <button className="primary-button" onClick={() => setDesktopAuthConfirmed(true)}>Approve and return</button>
    <a href="/">Cancel</a>
  </section></main>
  if (desktopRequest) return <main className="desktop-return-screen"><Brand/><section>
    <span className="desktop-return-icon"><Icon name="laptop" size={28}/></span>
    <p className="eyebrow">DESKTOP AUTHORIZATION</p>
    <h1>{desktopAuthError ? 'Could not return to the desktop app' : 'Returning to Agent Gateway…'}</h1>
    <p>{desktopAuthError || 'Your account has been verified. Keep the desktop app open while this page returns you securely.'}</p>
    {desktopAuthError && <button className="primary-button" onClick={() => setDesktopAuthAttempt((value) => value + 1)}>Try again</button>}
  </section></main>
  if (window.location.pathname === '/admin') {
    if (user.role !== 'admin') return <main className="admin-denied"><Brand/><section><span>403</span><h1>Administrator access required</h1><p>This account does not have permission to open the Admin Dashboard.</p><a href="/">Return to the user dashboard</a></section></main>
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

async function copyText(value: string, setNotice: (notice: Notice) => void) {
  try {
    await navigator.clipboard.writeText(value)
    setNotice({ tone: 'success', message: 'Online Host 地址已复制。' })
  } catch {
    setNotice({ tone: 'error', message: '无法访问剪贴板，请手动复制地址。' })
  }
}
