import { useEffect, useMemo, useRef, useState } from 'react'

export type LandingAuthMode = 'login' | 'register'
type LandingTheme = 'dark' | 'light'
export type LandingLanguage = 'zh' | 'en'
type CodeTab = 'python' | 'javascript' | 'curl' | 'stream'
type HostMode = 'local' | 'online'

const GITHUB = 'https://github.com/daizhongtian/Agent-Gateway'
const RELEASES = `${GITHUB}/releases`
const V3_SOURCE = `${GITHUB}/tree/V3`

function preferredTheme(): LandingTheme {
  const saved = window.localStorage.getItem('agent-gateway-theme')
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function preferredLanguage(): LandingLanguage {
  const saved = window.localStorage.getItem('agent-gateway-language')
  if (saved === 'zh' || saved === 'en') return saved
  return window.navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function codeSample(tab: CodeTab, baseUrl: string) {
  if (tab === 'javascript') return `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: "ccc_live_...",
});

const models = await client.models.list();
const model = models.data[0].id;

const response = await client.responses.create({
  model,
  input: "Review this repository and propose a fix.",
});

console.log(response.output_text);`

  if (tab === 'curl') return `curl "${baseUrl}/responses" \\
  -H "Authorization: Bearer ccc_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "YOUR_MODEL_ID",
    "input": "Reply with exactly: connected"
  }'`

  if (tab === 'stream') return `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="ccc_live_...",
)

model = client.models.list().data[0].id
stream = client.responses.create(
    model=model,
    input="Explain this project in three sentences.",
    stream=True,
)

for event in stream:
    if event.type == "response.output_text.delta":
        print(event.delta, end="", flush=True)`

  return `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="ccc_live_...",
)

model = client.models.list().data[0].id

response = client.responses.create(
    model=model,
    input="Review this repository and propose a fix.",
)

print(response.output_text)`
}

function ParticleField({ theme }: { theme: LandingTheme }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    // jsdom intentionally omits a canvas implementation. The animation is
    // progressive enhancement, so skip it in non-browser test environments.
    if (navigator.userAgent.includes('jsdom')) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    let frame = 0
    let width = 0
    let height = 0
    let particles: Array<{ x: number; y: number; vx: number; vy: number; radius: number; alpha: number }> = []

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.floor(width * ratio)
      canvas.height = Math.floor(height * ratio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const count = Math.max(18, Math.min(48, Math.floor(width / 32)))
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.1,
        vy: (Math.random() - 0.5) * 0.1,
        radius: Math.random() * 1.1 + 0.35,
        alpha: Math.random() * 0.2 + 0.06,
      }))
    }

    const draw = () => {
      context.clearRect(0, 0, width, height)
      particles.forEach((particle, index) => {
        particle.x += particle.vx
        particle.y += particle.vy
        if (particle.x < -15) particle.x = width + 15
        if (particle.x > width + 15) particle.x = -15
        if (particle.y < -15) particle.y = height + 15
        if (particle.y > height + 15) particle.y = -15
        const colors = theme === 'dark'
          ? ['168,140,255', '102,227,209', '255,255,255']
          : ['104,82,200', '20,142,133', '70,83,102']
        context.beginPath()
        context.fillStyle = `rgba(${colors[index % colors.length]},${particle.alpha})`
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
        context.fill()
      })
      for (let first = 0; first < particles.length; first += 1) {
        for (let second = first + 1; second < particles.length; second += 1) {
          const a = particles[first]
          const b = particles[second]
          const distance = Math.hypot(a.x - b.x, a.y - b.y)
          if (distance >= 105) continue
          context.beginPath()
          context.strokeStyle = theme === 'dark'
            ? `rgba(155,148,195,${(1 - distance / 105) * 0.045})`
            : `rgba(75,89,112,${(1 - distance / 105) * 0.055})`
          context.lineWidth = 0.6
          context.moveTo(a.x, a.y)
          context.lineTo(b.x, b.y)
          context.stroke()
        }
      }
      frame = window.requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize, { passive: true })
    frame = window.requestAnimationFrame(draw)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [theme])

  return <canvas className="landing-particles" ref={canvasRef} aria-hidden="true" />
}

function GatewayIllustration() {
  return <div className="gateway-illustration" aria-label="Agent Gateway request flow illustration">
    <div className="illustration-grid" />
    <div className="route route-agent"><i /></div>
    <div className="route route-runtime"><i /></div>
    <div className="route route-device"><i /></div>
    <div className="gateway-console">
      <header><div><span className="console-mark">A</span><strong>AGENT GATEWAY</strong></div><span className="console-dots">•••</span></header>
      <div className="console-body">
        <aside><small>CONSOLE</small><b>API Gateway</b><span>Gateway Keys</span><span>Task history</span><span>Settings</span><em>Platform account<br/>Device paired · V3</em></aside>
        <div className="console-main">
          <div className="console-title"><span><small>LIVE HOST</small><strong>OpenAI API Console</strong></span><b><i /> HOST ONLINE</b></div>
          <div className="console-endpoint"><span>OPENAI HOST</span><code>http://127.0.0.1:4310/v1</code></div>
          <div className="console-kpis"><span>ACTIVE<strong>03</strong></span><span>SUCCESS<strong>99.8%</strong></span><span>TOKENS<strong>42K</strong></span></div>
          <div className="console-requests"><header><span>LIVE REQUESTS</span><span>LATENCY</span></header><p><i/><span><b>POST /v1/responses</b><small>ccc_live_dev_agent</small></span><em>1.8s</em></p><p><i/><span><b>POST /v1/chat/completions</b><small>ccc_live_ide_plugin</small></span><em>2.4s</em></p><p><i/><span><b>GET /v1/models</b><small>ccc_live_mobile</small></span><em>24ms</em></p></div>
        </div>
      </div>
    </div>
    <div className="orbit-node orbit-agent"><b>⌘</b><span><strong>AI Agent / IDE</strong><small>OpenAI SDK request</small></span></div>
    <div className="orbit-node orbit-device"><b>▯</b><span><strong>Any device</strong><small>one stable base_url</small></span></div>
    <div className="orbit-node orbit-runtime"><b>◇</b><span><strong>Codex runtime</strong><small>local execution</small></span></div>
  </div>
}

function MiniVisual({ type }: { type: 'compatibility' | 'policy' | 'metrics' | 'platform' }) {
  if (type === 'policy') return <div className="mini-policy" aria-hidden="true"><p><span>MODEL</span><b>codex</b></p><p><span>TOKEN LIMIT</span><i><b /></i></p><p><span>PERMISSION</span><b>read-only</b></p></div>
  if (type === 'metrics') return <div className="mini-metrics" aria-hidden="true"><div className="metric-bars"><i/><i/><i/><i/><i/><i/><i/></div><p><span>REQUESTS</span><b>+24.8%</b></p></div>
  if (type === 'platform') return <div className="mini-platform" aria-hidden="true"><span>CODEX<strong>ACTIVE</strong></span><i>→</i><span>CLAUDE<strong>FUTURE</strong></span><i>→</i><span>GEMINI<strong>FUTURE</strong></span></div>
  return <div className="mini-orbit" aria-hidden="true"><i/><b>AG</b><span>SDK</span><span>SSE</span><span>IMG</span></div>
}

function SecurityVisual() {
  return <div className="security-visual" aria-label="Open source security boundaries">
    <div className="security-rings" />
    <div className="security-shield"><span>✓</span></div>
    <div className="security-file file-security"><b>&lt;/&gt;</b><span>SECURITY.md<small>public policy</small></span></div>
    <div className="security-file file-openapi"><b>01</b><span>openapi.yaml<small>auditable contract</small></span></div>
    <div className="security-file file-license"><b>MIT</b><span>LICENSE<small>open source</small></span></div>
    <div className="security-file file-privacy"><b>•••</b><span>PRIVACY.md<small>data boundary</small></span></div>
    <div className="security-stats"><span>DEFAULT NETWORK<b>LOOPBACK</b></span><span>PRODUCT TRACKERS<b>NONE</b></span><span>SOURCE ACCESS<b>PUBLIC</b></span></div>
  </div>
}

function DownloadDock({ language }: { language: LandingLanguage }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en
  return <aside className="landing-download-dock" aria-label={t('下载', 'Downloads')}>
    <small>DOWNLOAD</small>
    <a href={RELEASES} target="_blank" rel="noreferrer" aria-label={t('Windows 安装版', 'Windows installer')}><b>⊞</b><span>{t('Windows 安装版', 'Windows installer')}</span></a>
    <a href={RELEASES} target="_blank" rel="noreferrer" aria-label="Windows Portable"><b>▣</b><span>Windows Portable</span></a>
    <button type="button" disabled aria-label={t('macOS 尚未发布', 'macOS not released')}><i/><b>⌘</b><span>{t('macOS · 尚未发布', 'macOS · Not released')}</span></button>
    <a href={V3_SOURCE} target="_blank" rel="noreferrer" aria-label={t('V3 源码', 'V3 source code')}><b>&lt;/&gt;</b><span>{t('V3 源码', 'V3 source')}</span></a>
  </aside>
}

export default function LandingPage({ onAuthenticate }: { onAuthenticate: (mode: LandingAuthMode, language: LandingLanguage) => void }) {
  const [theme, setTheme] = useState<LandingTheme>(preferredTheme)
  const [language, setLanguage] = useState<LandingLanguage>(preferredLanguage)
  const [activeSection, setActiveSection] = useState('overview')
  const [progress, setProgress] = useState(0)
  const [codeTab, setCodeTab] = useState<CodeTab>('python')
  const [hostMode, setHostMode] = useState<HostMode>('local')
  const [toast, setToast] = useState('')
  const pageRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<number | null>(null)
  const baseUrl = hostMode === 'local' ? 'http://127.0.0.1:4310/v1' : 'https://your-public-host.example/v1'
  const sample = useMemo(() => codeSample(codeTab, baseUrl), [codeTab, baseUrl])
  const t = (zh: string, en: string) => language === 'zh' ? zh : en

  useEffect(() => {
    window.localStorage.setItem('agent-gateway-theme', theme)
    document.documentElement.dataset.landingTheme = theme
    document.documentElement.style.colorScheme = theme
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (meta) meta.content = theme === 'dark' ? '#080a0f' : '#e9edf3'
    return () => {
      delete document.documentElement.dataset.landingTheme
      document.documentElement.style.colorScheme = ''
    }
  }, [theme])

  useEffect(() => {
    window.localStorage.setItem('agent-gateway-language', language)
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  }, [language])

  useEffect(() => {
    const update = () => {
      const maximum = document.documentElement.scrollHeight - window.innerHeight
      setProgress(maximum > 0 ? Math.min(1, window.scrollY / maximum) : 0)
      let current = 'overview'
      document.querySelectorAll<HTMLElement>('[data-landing-section]').forEach((section) => {
        if (section.getBoundingClientRect().top <= window.innerHeight * 0.4) current = section.dataset.landingSection ?? current
      })
      setActiveSection(current)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  useEffect(() => {
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.landing-reveal').forEach((element) => element.classList.add('is-visible'))
      return
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' })
    document.querySelectorAll('.landing-reveal').forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])

  function pointerGlow(event: React.PointerEvent<HTMLDivElement>) {
    pageRef.current?.style.setProperty('--pointer-x', `${event.clientX}px`)
    pageRef.current?.style.setProperty('--pointer-y', `${event.clientY}px`)
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(sample)
      setToast(t('代码已复制', 'Code copied'))
    } catch {
      setToast(t('无法访问剪贴板', 'Clipboard unavailable'))
    }
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1800)
  }

  return <div className="landing-page" data-testid="landing-page" data-theme={theme} ref={pageRef} onPointerMove={pointerGlow}>
    <ParticleField theme={theme}/>
    <div className="landing-pointer-glow" aria-hidden="true" />
    <div className="landing-progress" style={{ transform: `scaleX(${progress})` }} />

    <header className={`landing-header ${progress > 0.01 ? 'is-scrolled' : ''}`}>
      <div className="landing-nav-shell">
        <button className="theme-toggle" type="button" onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? t('切换到浅色模式', 'Switch to light mode') : t('切换到暗色模式', 'Switch to dark mode')} title={theme === 'dark' ? t('浅色模式', 'Light mode') : t('暗色模式', 'Dark mode')}>
          <span aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span>
        </button>
        <a className="landing-brand" href="#top" aria-label="Agent Gateway home"><span className="landing-brand-mark">A</span><span><strong>Agent Gateway</strong><small>OpenAI-compatible host</small></span></a>
        <nav aria-label={t('主要导航', 'Primary navigation')}>
          <a className={activeSection === 'overview' ? 'active' : ''} href="#overview">{t('功能', 'Overview')}</a>
          <a className={activeSection === 'connect' ? 'active' : ''} href="#connect">{t('接入', 'Connect')}</a>
          <a className={activeSection === 'security' ? 'active' : ''} href="#security">{t('安全', 'Security')}</a>
        </nav>
        <div className="landing-header-actions">
          <button className="language-toggle" type="button" onClick={() => setLanguage((current) => current === 'zh' ? 'en' : 'zh')} aria-label={language === 'zh' ? 'Switch to English' : '切换到中文'}>{language === 'zh' ? 'EN' : '中'}</button>
          <a className="github-link" href={V3_SOURCE} target="_blank" rel="noreferrer" aria-label={t('查看 GitHub 源码', 'View source on GitHub')}>GH ↗</a>
          <button className="header-register" type="button" onClick={() => onAuthenticate('register', language)}>{t('注册', 'Create account')}</button>
          <button className="header-login" type="button" onClick={() => onAuthenticate('login', language)}>{t('登录', 'Sign in')} <span>→</span></button>
        </div>
      </div>
    </header>

    <DownloadDock language={language}/>

    <main id="top">
      <section className="landing-hero">
        <div className="landing-section-shell hero-layout">
          <div className="hero-copy landing-reveal is-visible">
            <span className="landing-eyebrow"><i/> OPENAI-COMPATIBLE GATEWAY · V3</span>
            <h1>{t('让你的 Coding Agent，', 'Your coding agent.')}<br/><em>{t('被任何应用调用。', 'Any application.')}</em></h1>
            <p>{t('Agent Gateway 把本机 Codex 转换成标准的 OpenAI 兼容 API。你的 Agent、IDE、自动化工具与内部应用，无需重写调用逻辑，就能通过统一 Gateway Key 安全接入。', 'Agent Gateway turns your local Codex runtime into a standard OpenAI-compatible API. Agents, IDEs, automations and internal tools connect through one controlled Gateway key without rewriting their integration.')}</p>
            <div className="hero-actions"><a className="landing-primary" href={RELEASES} target="_blank" rel="noreferrer">↓ {t('下载 Windows 版本', 'Download for Windows')}</a><button className="landing-secondary" type="button" onClick={() => onAuthenticate('login', language)}>{t('登录平台', 'Sign in to platform')} →</button></div>
            <div className="hero-meta"><span><i/>Windows x64</span><span><i/>{t('MIT 开源', 'MIT licensed')}</span><span><i/>{t('本地优先', 'Local-first')}</span><span><i/>Codex SDK Provider</span></div>
          </div>
          <div className="hero-visual landing-reveal is-visible"><GatewayIllustration/></div>
        </div>
        <div className="landing-section-shell signal-strip landing-reveal"><div><strong>OpenAI Compatible</strong><span>{t('Responses、Chat Completions 与模型列表。', 'Responses, Chat Completions and model listing.')}</span></div><div><strong>Gateway Key</strong><span>{t('按模型、权限、Token 与期限独立控制。', 'Independent model, permission, token and expiry policy.')}</span></div><div><strong>SSE Streaming</strong><span>{t('保留实时输出、请求 ID 与兼容错误。', 'Live output, request IDs and compatible errors.')}</span></div><div><strong>Local-first</strong><span>{t('默认仅监听本机回环地址，随时关闭 Host。', 'Loopback by default, with an explicit Host switch.')}</span></div></div>
      </section>

      <section className="landing-content-section" id="overview" data-landing-section="overview">
        <div className="landing-section-shell">
          <div className="landing-section-heading"><div className="section-kicker landing-reveal"><span>01</span>{t('软件功能', 'What it does')}</div><div className="section-title landing-reveal"><h2>{t('一个网关，连接你的全部 Agent 工作流。', 'One gateway for every agent workflow you own.')}</h2><p>{t('它不是另一个聊天窗口，而是位于应用与 Coding Agent 之间的兼容、权限和观测基础设施：Codex 先行，未来 Provider 可扩展，而调用方保持同一套接口。', 'It is not another chat window. It is the compatibility, policy and observability layer between your software and a coding agent: Codex first, provider-ready, with one stable client contract.')}</p></div></div>
          <div className="feature-grid">
            <article className="feature-card wide landing-reveal"><small>01 / COMPATIBILITY</small><b>/v1 · JSON · SSE</b><h3>{t('保留你的 OpenAI SDK 调用方式。', 'Keep the OpenAI SDK integration you already use.')}</h3><p>{t('兼容 GET /v1/models、POST /v1/responses 与 POST /v1/chat/completions，支持普通响应、SSE 流式响应、图片输入和兼容错误。', 'Supports models, Responses and Chat Completions with standard responses, SSE streaming, image input and OpenAI-shaped errors.')}</p><MiniVisual type="compatibility"/></article>
            <article className="feature-card landing-reveal"><small>02 / POLICY</small><b>PER KEY</b><h3>{t('把权限绑定到每一枚 Key。', 'Bind policy to every key.')}</h3><p>{t('分别设置模型、推理强度、速度、文件权限、累计 Token 上限与自动到期时间。', 'Set model, effort, speed, file permissions, cumulative token limit and expiry independently.')}</p><MiniVisual type="policy"/></article>
            <article className="feature-card landing-reveal"><small>03 / OBSERVABILITY</small><b>LIVE METRICS</b><h3>{t('看见每一次调用。', 'See every request as it happens.')}</h3><p>{t('按 Gateway Key 查看任务、连接、Token、延迟、成功率和模型用量。', 'Track tasks, connections, tokens, latency, success rate and model usage by Gateway key.')}</p><MiniVisual type="metrics"/></article>
            <article className="feature-card wide landing-reveal"><small>04 / PLATFORM</small><b>V3 FOUNDATION</b><h3>{t('从本机 Host，走向稳定的跨设备入口。', 'From a local Host to a stable cross-device entry point.')}</h3><p>{t('V3 已加入平台账号、持久登录、设备登记、自动配对与稳定 Host 分配。当前公开 Relay 尚未部署，真正远程访问仍需要 Relay 上线。', 'V3 adds accounts, persistent sessions, device enrollment, automatic pairing and stable Host allocation. The public Relay is not deployed yet and is still required for real remote access.')}</p><MiniVisual type="platform"/></article>
          </div>
          <div className="architecture-flow landing-reveal"><span>Your AI Agent</span><i>→</i><span>Gateway Key</span><i>→</i><span className="flow-core">Agent Gateway<b/></span><i>→</i><span>Codex SDK</span></div>
        </div>
      </section>

      <section className="landing-content-section connect-section" id="connect" data-landing-section="connect">
        <div className="landing-section-shell">
          <div className="landing-section-heading"><div className="section-kicker landing-reveal"><span>02</span>{t('AI Agent 如何调用', 'Connect your agent')}</div><div className="section-title landing-reveal"><h2>{t('保留你的 Agent。只替换两行配置。', 'Keep your agent. Replace only two lines.')}</h2><p>{t('现有 OpenAI 客户端继续工作。将 base_url 指向 Agent Gateway，再使用桌面端生成的 ccc_live_... Gateway Key。', 'Your existing OpenAI client keeps working. Point base_url at Agent Gateway and use a ccc_live_... Gateway key created by the desktop app.')}</p></div></div>
          <div className="connect-layout">
            <ol className="connect-steps landing-reveal"><li><span>01</span><div><h3>{t('开启 API Host', 'Enable API Host')}</h3><p>{t('桌面应用默认监听 127.0.0.1:4310。', 'The desktop app listens on 127.0.0.1:4310 by default.')}</p></div></li><li><span>02</span><div><h3>{t('创建 Gateway Key', 'Create a Gateway key')}</h3><p>{t('选择模型、权限、Token 上限与自动到期时间。', 'Choose model, permissions, token limit and expiry.')}</p></div></li><li><span>03</span><div><h3>{t('调用标准接口', 'Call standard endpoints')}</h3><p>models · responses · chat/completions</p></div></li></ol>
            <div className="code-window landing-reveal">
              <header><div className="code-tabs" role="tablist">{(['python','javascript','curl','stream'] as CodeTab[]).map((tab) => <button role="tab" aria-selected={codeTab === tab} className={codeTab === tab ? 'active' : ''} onClick={() => setCodeTab(tab)} key={tab}>{tab === 'stream' ? 'Streaming' : tab === 'javascript' ? 'JavaScript' : tab === 'curl' ? 'cURL' : 'Python'}</button>)}</div><button className="copy-code" type="button" onClick={() => void copyCode()}>{t('复制', 'Copy')}</button></header>
              <div className="host-switch"><div><button className={hostMode === 'local' ? 'active' : ''} onClick={() => setHostMode('local')}>Local Host</button><button className={hostMode === 'online' ? 'active' : ''} onClick={() => setHostMode('online')}>Online Host</button></div><span className={hostMode === 'online' ? 'warning' : ''}><i/>{hostMode === 'online' ? t('需要部署公网 Relay', 'Requires a deployed public Relay') : t('本机可用', 'Available locally')}</span></div>
              <div className="base-url"><span>BASE URL</span><code>{baseUrl}</code></div>
              <pre aria-label={t('调用示例', 'API example')}>{sample.split('\n').map((line, index) => <span className="code-line" key={`${index}-${line}`}><b>{String(index + 1).padStart(2, '0')}</b><code>{line || ' '}</code></span>)}</pre>
              <footer><span><i className={hostMode === 'online' ? 'warning' : ''}/>{hostMode === 'online' ? 'RELAY DEPLOYMENT REQUIRED' : 'OPENAI SDK READY'}</span><small>X-Request-Id · SSE · JSON</small></footer>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-content-section security-section" id="security" data-landing-section="security">
        <div className="landing-section-shell">
          <div className="landing-section-heading"><div className="section-kicker landing-reveal"><span>03</span>{t('安全保证', 'Security boundaries')}</div><div className="section-title landing-reveal"><h2>{t('不要相信口号。审查边界与源码。', 'Do not trust slogans. Inspect the boundaries and source.')}</h2><p>{t('安全来自透明、最小权限与可撤销控制。', 'Trust comes from transparency, least privilege and revocable control.')}</p></div></div>
          <div className="security-layout"><SecurityVisual/><div className="security-copy landing-reveal"><h3>{t('安全，是看得见的设计。', 'Security should be visible in the design.')}</h3><p>{t('默认本机运行、凭据分层、权限按 Key 绑定、日志与用量可追踪。你可以检查每一类数据如何被处理，而不是依赖黑盒承诺。', 'Local by default, separated credentials, per-key policy and observable usage. Inspect how each class of data is handled instead of relying on a black-box promise.')}</p><div className="security-list"><article><span>&lt;/&gt;</span><div><h4>{t('完整源码公开，可独立审查', 'Complete source, independently inspectable')}</h4><p>{t('桌面端、平台控制面、兼容层、安全策略与隐私说明都在 V3 分支公开。', 'Desktop, control plane, compatibility layer, security policy and privacy notice are public in V3.')}</p></div></article><article><span>◇</span><div><h4>{t('本地优先，凭据明确分离', 'Local-first with explicit credential separation')}</h4><p>{t('平台账号、设备凭据、Gateway Key 和上游凭据用途不同，不应相互替代。', 'Platform sessions, device credentials, Gateway keys and upstream credentials serve separate purposes.')}</p></div></article><article><span>⌁</span><div><h4>{t('Key 可限制、到期与永久撤销', 'Keys can be constrained, expired and revoked')}</h4><p>{t('删除 Key 会使后续请求失效，并终止该 Key 的活动任务和流。', 'Deleting a key invalidates later requests and terminates its active tasks and streams.')}</p></div></article></div><div className="security-links"><a href={`${GITHUB}/blob/V3/SECURITY.md`} target="_blank" rel="noreferrer">Security Policy ↗</a><a href={`${GITHUB}/blob/V3/PRIVACY.md`} target="_blank" rel="noreferrer">Privacy Notice ↗</a><a href={V3_SOURCE} target="_blank" rel="noreferrer">V3 Source ↗</a></div><div className="operator-note"><strong>{t('公网部署提示：', 'Public deployment note:')}</strong>{t('公开 Relay 上线前仍需配置 TLS、强身份验证、限流、审计、租户隔离和密钥管理。', 'Before a public Relay goes live, configure TLS, strong authentication, rate limits, audit logging, tenant isolation and secret management.')}</div></div></div>
        </div>
      </section>

      <section className="landing-final-cta"><div className="landing-section-shell"><div className="cta-card landing-reveal"><div><span className="landing-eyebrow"><i/> YOUR AGENT · YOUR HOST · YOUR RULES</span><h2>{t('让现有 AI 应用，直接接入你的 Coding Agent。', 'Connect the AI software you already use to your coding agent.')}</h2><p>{t('从本机开发与调试开始。下载 Windows 版本，创建第一枚 Gateway Key，然后用熟悉的 OpenAI SDK 发出请求。', 'Start with local development and debugging. Download Windows, create your first Gateway key and send a request with the OpenAI SDK you know.')}</p></div><div><button className="landing-primary" type="button" onClick={() => onAuthenticate('register', language)}>{t('创建平台账号', 'Create platform account')} →</button><a className="landing-secondary" href={RELEASES} target="_blank" rel="noreferrer">{t('下载 Windows', 'Download Windows')} ↓</a><small>{t('Windows 安装版与 Portable · macOS 暂未发布', 'Windows installer and Portable · macOS not released yet')}</small></div></div></div></section>
    </main>

    <footer className="landing-footer"><div><strong>Agent Gateway</strong><span>© 2026 Contributors · MIT License</span></div><nav><a href="#overview">{t('功能', 'Overview')}</a><a href="#connect">{t('接入', 'Connect')}</a><a href="#security">{t('安全', 'Security')}</a><a href={`/legal/platform-terms?lang=${language}`}>{t('服务条款', 'Terms')}</a><a href={`/legal/platform-privacy?lang=${language}`}>{t('隐私', 'Privacy')}</a><a href={GITHUB} target="_blank" rel="noreferrer">GitHub ↗</a></nav></footer>
    <div className="mobile-download-bar"><span><strong>Agent Gateway</strong><small>Windows x64 · V3</small></span><a href={RELEASES} target="_blank" rel="noreferrer">{t('下载', 'Download')} ↓</a><button type="button" onClick={() => onAuthenticate('login', language)}>{t('登录', 'Sign in')}</button></div>
    <div className={`landing-toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
  </div>
}
