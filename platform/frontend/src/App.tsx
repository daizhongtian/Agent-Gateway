import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, api } from './api'
import type { Device, PairingCode, PlatformConfig, PublicHost, User } from './types'

type AuthMode = 'login' | 'register'
type Notice = { tone: 'success' | 'error' | 'info'; message: string } | null
type DesktopAuthRequest = { callbackPort: number; state: string; codeChallenge: string }

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
    spark: <><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <div className="brand-mark"><span>C</span></div>
    {!compact && <div><strong>CODEX</strong><small>CONTROL PLATFORM</small></div>}
  </div>
}

function StatusPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    online: '在线', offline: '离线', degraded: '连接异常', disabled: '已停用',
    active: '已配对', pending: '待配对', revoked: '已撤销',
  }
  return <span className={`status-pill status-${status}`}><i />{labels[status] ?? status}</span>
}

function AuthScreen({ config, onAuthenticated, desktopRequest }: { config: PlatformConfig; onAuthenticated: (user: User) => void; desktopRequest?: DesktopAuthRequest | null }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const result = mode === 'register'
        ? await api.register({ email, password })
        : await api.login({ email, password })
      onAuthenticated(result.user)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法完成登录，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

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
      <div className="auth-card">
        <div className="mobile-brand"><Brand /></div>
        {desktopRequest && <div className="desktop-auth-banner" role="status">
          <span className="desktop-auth-banner-icon"><Icon name="laptop"/></span>
          <div><strong>Agent Gateway is requesting access</strong><p>Sign in or create an account here. You will return to the desktop app automatically.</p></div>
        </div>}
        <div className="auth-heading">
          <span className="step-number">01</span>
          <div><h2>{mode === 'login' ? '欢迎回来' : '创建你的账户'}</h2><p>{mode === 'login' ? '登录并管理你的 Online Host' : '开始配置你的第一台 Host 设备'}</p></div>
        </div>
        <div className="auth-tabs" role="tablist">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>登录</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>注册</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label>电子邮箱<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" maxLength={320} required /></label>
          <label>密码<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'register' ? '至少 12 个字符' : '输入你的密码'} minLength={mode === 'register' ? 12 : undefined} maxLength={72} required /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="primary-button auth-submit" disabled={submitting}>
            <span>{submitting ? '处理中…' : mode === 'login' ? '进入控制台' : '创建账户'}</span><Icon name="arrow"/>
          </button>
        </form>
        <p className="auth-terms">继续即表示你了解：公网地址只有在桌面客户端和 Relay 均在线时才可用。</p>
      </div>
    </section>
  </main>
}

function EmptyState({ icon, title, description, action }: { icon: string; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name={icon} size={25}/></div><h3>{title}</h3><p>{description}</p>{action}</div>
}

function Dashboard({ initialUser, config, onSignedOut }: { initialUser: User; config: PlatformConfig; onSignedOut: () => void }) {
  const [user] = useState(initialUser)
  const [devices, setDevices] = useState<Device[]>([])
  const [hosts, setHosts] = useState<PublicHost[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice>(null)
  const [showDeviceForm, setShowDeviceForm] = useState(false)
  const [showHostForm, setShowHostForm] = useState(false)
  const [deviceName, setDeviceName] = useState('My Windows PC')
  const [devicePlatform, setDevicePlatform] = useState('windows')
  const [hostName, setHostName] = useState('Primary Host')
  const [hostDeviceId, setHostDeviceId] = useState('')
  const [pairing, setPairing] = useState<PairingCode | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextDevices, nextHosts] = await Promise.all([api.devices(), api.hosts()])
      setDevices(nextDevices)
      setHosts(nextHosts)
      if (!hostDeviceId && nextDevices.length) setHostDeviceId(nextDevices[0].id)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onSignedOut()
      else setNotice({ tone: 'error', message: caught instanceof Error ? caught.message : '加载平台数据失败。' })
    } finally {
      setLoading(false)
    }
  }, [hostDeviceId, onSignedOut])

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => ({
    online: hosts.filter((host) => host.status === 'online').length,
    offline: hosts.filter((host) => host.status === 'offline').length,
    paired: devices.filter((device) => device.status === 'active').length,
  }), [devices, hosts])

  async function createDevice(event: FormEvent) {
    event.preventDefault()
    setBusy('device')
    try {
      const created = await api.createDevice({ name: deviceName, platform: devicePlatform })
      setDevices((current) => [created, ...current])
      setHostDeviceId(created.id)
      setShowDeviceForm(false)
      setNotice({ tone: 'success', message: '设备记录已创建。生成配对码后即可供未来桌面端绑定。' })
    } catch (caught) { setNotice({ tone: 'error', message: errorMessage(caught) }) }
    finally { setBusy('') }
  }

  async function createHost(event: FormEvent) {
    event.preventDefault()
    if (!hostDeviceId) return
    setBusy('host')
    try {
      const created = await api.createHost({ deviceId: hostDeviceId, displayName: hostName })
      setHosts((current) => [created, ...current])
      setShowHostForm(false)
      setNotice({ tone: 'success', message: 'OPENAI HOST 地址已预留。Relay 配置完成后可保持同一地址上线。' })
    } catch (caught) { setNotice({ tone: 'error', message: errorMessage(caught) }) }
    finally { setBusy('') }
  }

  async function createPairing(device: Device) {
    setBusy(`pair-${device.id}`)
    try { setPairing(await api.pairingCode(device.id)) }
    catch (caught) { setNotice({ tone: 'error', message: errorMessage(caught) }) }
    finally { setBusy('') }
  }

  async function revokeDevice(device: Device) {
    if (!window.confirm(`确定撤销“${device.name}”吗？它关联的 Host 也会被停用。`)) return
    setBusy(`revoke-${device.id}`)
    try {
      await api.revokeDevice(device.id)
      await load()
      setNotice({ tone: 'success', message: '设备已撤销，相关凭证和 Host 已停用。' })
    } catch (caught) { setNotice({ tone: 'error', message: errorMessage(caught) }) }
    finally { setBusy('') }
  }

  async function setHostEnabled(host: PublicHost) {
    setBusy(`host-${host.id}`)
    try {
      const next = host.status === 'disabled' ? await api.enableHost(host.id) : await api.disableHost(host.id)
      setHosts((current) => current.map((item) => item.id === host.id ? next : item))
      setNotice({ tone: 'success', message: host.status === 'disabled' ? 'Host 已启用，仍需桌面 Relay 连接后才能上线。' : 'Host 已停用。' })
    } catch (caught) { setNotice({ tone: 'error', message: errorMessage(caught) }) }
    finally { setBusy('') }
  }

  async function signOut() {
    try { await api.logout() } finally { onSignedOut() }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <nav>
        <a className="active"><Icon name="grid"/>总览</a>
        <a href="#hosts"><Icon name="server"/>Online Hosts<span>{hosts.length}</span></a>
        <a href="#devices"><Icon name="laptop"/>设备<span>{devices.length}</span></a>
        <a href="#security"><Icon name="shield"/>安全与协议</a>
      </nav>
      <div className="sidebar-bottom">
        <div className="relay-state"><i className={config.relayEnabled ? 'ready' : ''}/><div><strong>{config.relayEnabled ? 'Relay ready' : 'Relay pending'}</strong><small>{config.relayEnabled ? '中继已配置' : '等待服务器配置'}</small></div></div>
        <button className="profile-button" onClick={() => void signOut()} title="退出登录">
          <span>{initials(user.displayName)}</span><div><strong>{user.displayName}</strong><small>{user.email}</small></div><Icon name="logout"/>
        </button>
      </div>
    </aside>

    <main className="dashboard">
      <header className="topbar"><div><span className="crumb">CONTROL PLANE /</span><strong> OVERVIEW</strong></div><button className="icon-button" onClick={() => void load()} aria-label="刷新"><Icon name="refresh"/></button></header>
      <div className="dashboard-content">
        {notice && <div className={`notice notice-${notice.tone}`}><span>{notice.message}</span><button onClick={() => setNotice(null)}>×</button></div>}
        <section className="welcome-row">
          <div><span className="eyebrow"><i /> ACCOUNT ACTIVE</span><h1>晚上好，{user.displayName}</h1><p>管理你的设备、预留公网地址，并为桌面端连接做好准备。</p></div>
          <div className="platform-version">PLATFORM <strong>v{config.platformVersion}</strong></div>
        </section>

        <section className="metric-grid">
          <article><span className="metric-icon green"><Icon name="server"/></span><div><small>TOTAL HOSTS</small><strong>{hosts.length.toString().padStart(2, '0')}</strong><p><b>{stats.online}</b> online · {stats.offline} offline</p></div></article>
          <article><span className="metric-icon blue"><Icon name="laptop"/></span><div><small>REGISTERED DEVICES</small><strong>{devices.length.toString().padStart(2, '0')}</strong><p><b>{stats.paired}</b> paired securely</p></div></article>
          <article><span className="metric-icon amber"><Icon name="globe"/></span><div><small>RELAY STATUS</small><strong className="metric-word">{config.relayEnabled ? 'READY' : 'PENDING'}</strong><p>{config.relayEnabled ? 'Accepting tunnels' : 'Server connection later'}</p></div></article>
        </section>

        <section id="hosts" className="panel-section">
          <div className="section-heading"><div><span>02</span><div><h2>OPENAI HOSTS</h2><p>稳定公网地址与桌面设备的映射</p></div></div><button className="secondary-button" onClick={() => setShowHostForm((value) => !value)} disabled={!devices.some((device) => device.status !== 'revoked')}><Icon name="plus"/>新建 Host</button></div>
          {showHostForm && <form className="inline-form" onSubmit={createHost}><label>Host 名称<input value={hostName} onChange={(event) => setHostName(event.target.value)} minLength={2} maxLength={80} required /></label><label>绑定设备<select value={hostDeviceId} onChange={(event) => setHostDeviceId(event.target.value)} required>{devices.filter((device) => device.status !== 'revoked').map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><button className="primary-button" disabled={busy === 'host'}>{busy === 'host' ? '创建中…' : '预留地址'}</button></form>}
          <div className="host-list">
            {!loading && hosts.length === 0 && <EmptyState icon="server" title="还没有 OPENAI HOST" description="先登记一台设备，再预留一个稳定的公网地址。" action={<button className="text-button" disabled={!devices.length} onClick={() => setShowHostForm(true)}>创建第一个 Host →</button>} />}
            {hosts.map((host) => <article className="host-card" key={host.id}>
              <div className="host-card-head"><div className="host-symbol"><Icon name="server" size={23}/></div><div className="host-title"><div><h3>{host.displayName}</h3><StatusPill status={host.status}/></div><p>绑定到 {host.deviceName} · Protocol v{host.protocolVersion}</p></div><button className="quiet-button" onClick={() => void setHostEnabled(host)} disabled={busy === `host-${host.id}`}>{host.status === 'disabled' ? '启用' : '停用'}</button></div>
              <div className="endpoint-box"><span>OPENAI HOST</span><code>{host.openAiBaseUrl}</code><button onClick={() => void copy(host.openAiBaseUrl, setNotice)} aria-label="复制地址"><Icon name="copy"/></button></div>
              <div className="host-foot"><span><i className={host.relayReady ? 'ready' : ''}/>{host.relayReady ? 'Relay 可用，等待客户端连接' : '地址已预留，Relay 尚未配置'}</span><small>最后心跳：{host.lastHeartbeatAt ? formatDate(host.lastHeartbeatAt) : '尚未连接'}</small></div>
            </article>)}
          </div>
        </section>

        <section id="devices" className="panel-section">
          <div className="section-heading"><div><span>03</span><div><h2>DEVICES</h2><p>允许建立反向隧道的设备身份</p></div></div><button className="secondary-button" onClick={() => setShowDeviceForm((value) => !value)}><Icon name="plus"/>添加设备</button></div>
          {showDeviceForm && <form className="inline-form" onSubmit={createDevice}><label>设备名称<input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} minLength={2} maxLength={80} required /></label><label>操作系统<select value={devicePlatform} onChange={(event) => setDevicePlatform(event.target.value)}><option value="windows">Windows</option><option value="macos">macOS</option><option value="linux">Linux</option></select></label><button className="primary-button" disabled={busy === 'device'}>{busy === 'device' ? '添加中…' : '添加设备'}</button></form>}
          <div className="device-table">
            {!loading && devices.length === 0 && <EmptyState icon="laptop" title="还没有登记设备" description="添加用户电脑，为将来桌面端安全配对做好准备。" action={<button className="text-button" onClick={() => setShowDeviceForm(true)}>添加第一台设备 →</button>} />}
            {devices.length > 0 && <div className="table-head"><span>设备</span><span>状态</span><span>客户端</span><span>最近在线</span><span /></div>}
            {devices.map((device) => <div className="device-row" key={device.id}><div className="device-name"><span><Icon name="laptop"/></span><div><strong>{device.name}</strong><small>{device.platform.toUpperCase()} · {device.id.slice(0, 8)}</small></div></div><StatusPill status={device.status}/><span className="muted">{device.appVersion ?? '尚未配对'}</span><span className="muted">{device.lastSeenAt ? formatDate(device.lastSeenAt) : '—'}</span><div className="row-actions"><button onClick={() => void createPairing(device)} disabled={device.status === 'revoked' || busy === `pair-${device.id}`}><Icon name="key"/>配对码</button><button className="danger-action" onClick={() => void revokeDevice(device)} disabled={device.status === 'revoked' || busy === `revoke-${device.id}`} title="撤销设备"><Icon name="trash"/></button></div></div>)}
          </div>
        </section>

        <section id="security" className="security-strip"><div className="security-mark"><Icon name="shield" size={27}/></div><div><h3>凭证分离与最小暴露</h3><p>账户 Session、设备密钥、Tunnel Token 和本地 <code>ccc_live_...</code> Gateway Key 相互独立；公共 Edge 将只允许 OpenAI 兼容路由。</p></div><span>SECURITY BASELINE <Icon name="check"/></span></section>
      </div>
    </main>

      {pairing && <div className="modal-backdrop" role="presentation" onMouseDown={() => setPairing(null)}><div className="pairing-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setPairing(null)}>×</button><span className="pair-icon"><Icon name="key" size={27}/></span><p className="eyebrow">ONE-TIME DEVICE PAIRING</p><h2>设备配对码</h2><p>V3 桌面应用登录同一账号后会自动完成配对；此手动代码只能使用一次，并会在 {formatDate(pairing.expiresAt)} 失效。</p><button className="pair-code" onClick={() => void copy(pairing.code, setNotice)}>{pairing.code}<Icon name="copy"/></button><small>不要把配对码发送给不受信任的人。</small></div></div>}
  </div>
}

export default function App() {
  const [config, setConfig] = useState<PlatformConfig>(fallbackConfig)
  const [user, setUser] = useState<User | null>(null)
  const [booting, setBooting] = useState(true)
  const [desktopRequest] = useState(desktopAuthRequest)
  const [desktopAuthError, setDesktopAuthError] = useState('')
  const [desktopAuthAttempt, setDesktopAuthAttempt] = useState(0)
  const desktopAuthRunning = useRef(false)

  useEffect(() => {
    void Promise.allSettled([api.config(), api.session()]).then(([configResult, sessionResult]) => {
      if (configResult.status === 'fulfilled') setConfig(configResult.value)
      if (sessionResult.status === 'fulfilled') setUser(sessionResult.value.user)
      setBooting(false)
    })
  }, [])

  useEffect(() => {
    if (!user || !desktopRequest || desktopAuthRunning.current) return
    desktopAuthRunning.current = true
    setDesktopAuthError('')
    void api.authorizeDesktop(desktopRequest.codeChallenge)
      .then((authorization) => window.location.assign(desktopCallbackUrl(desktopRequest, authorization.code)))
      .catch((caught) => {
        desktopAuthRunning.current = false
        setDesktopAuthError(caught instanceof Error ? caught.message : 'Could not authorize the desktop app.')
      })
  }, [user, desktopRequest, desktopAuthAttempt])

  if (booting) return <div className="boot-screen"><Brand/><span className="loader"/><p>正在连接 Control Plane…</p></div>
  if (!user) return <AuthScreen config={config} onAuthenticated={setUser} desktopRequest={desktopRequest}/>
  if (desktopRequest) return <main className="desktop-return-screen"><Brand/><section>
    <span className="desktop-return-icon"><Icon name="laptop" size={28}/></span>
    <p className="eyebrow">DESKTOP AUTHORIZATION</p>
    <h1>{desktopAuthError ? 'Could not return to the desktop app' : 'Returning to Agent Gateway…'}</h1>
    <p>{desktopAuthError || 'Your account has been verified. Keep the desktop app open while this page returns you securely.'}</p>
    {desktopAuthError && <button className="primary-button" onClick={() => setDesktopAuthAttempt((value) => value + 1)}>Try again</button>}
  </section></main>
  return <Dashboard initialUser={user} config={config} onSignedOut={() => setUser(null)}/>
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}

async function copy(value: string, setNotice: (notice: Notice) => void) {
  try {
    await navigator.clipboard.writeText(value)
    setNotice({ tone: 'success', message: '已复制到剪贴板。' })
  } catch {
    setNotice({ tone: 'error', message: '无法访问剪贴板，请手动复制。' })
  }
}
