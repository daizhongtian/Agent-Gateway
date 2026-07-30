import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Device, PlatformConfig, PublicHost, User } from './types'

const apiMocks = vi.hoisted(() => ({
  config: vi.fn(),
  session: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  authorizeDesktop: vi.fn(),
  devices: vi.fn(),
  createDevice: vi.fn(),
  pairingCode: vi.fn(),
  revokeDevice: vi.fn(),
  hosts: vi.fn(),
  createHost: vi.fn(),
  updateHost: vi.fn(),
  disableHost: vi.fn(),
  enableHost: vi.fn(),
}))

vi.mock('./api', () => ({
  api: apiMocks,
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public code = 'TEST_ERROR') {
      super(message)
    }
  },
}))

import App from './App'

const user: User = {
  id: 'user-1',
  email: 'owner@example.com',
  displayName: 'Tester',
  status: 'active',
  emailVerified: false,
  createdAt: '2026-07-26T10:00:00Z',
}

const config: PlatformConfig = {
  platformVersion: '0.1.0',
  publicHostDomain: 'api.test.local',
  relayUrl: 'wss://relay.test.local/agent',
  relayEnabled: false,
  localProxyEnabled: true,
  relayProtocolVersion: 1,
  termsVersion: '2026-07-29',
  privacyVersion: '2026-07-29',
  termsPath: '/legal/platform-terms',
  privacyPath: '/legal/platform-privacy',
  allowedPublicRoutes: ['GET /v1/models'],
}

const device: Device = {
  id: 'device-1',
  name: 'Office PC',
  platform: 'windows',
  status: 'active',
  appVersion: '3.0.0',
  pairedAt: '2026-07-26T10:00:00Z',
  lastSeenAt: '2026-07-26T10:00:00Z',
  createdAt: '2026-07-26T10:00:00Z',
}

const host: PublicHost = {
  id: 'host-1',
  deviceId: 'device-1',
  deviceName: 'Office PC',
  displayName: 'Office Host',
  slug: 'office-host',
  openAiBaseUrl: 'https://office-host.example.com/v1',
  status: 'online',
  desiredOnline: true,
  relayReady: true,
  protocolVersion: 1,
  lastHeartbeatAt: '2026-07-26T10:00:00Z',
  createdAt: '2026-07-26T10:00:00Z',
}

describe('App user flows', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
    apiMocks.config.mockResolvedValue(config)
    apiMocks.session.mockRejectedValue(new Error('not signed in'))
    apiMocks.register.mockResolvedValue({ user })
    apiMocks.login.mockResolvedValue({ user })
    apiMocks.logout.mockResolvedValue(undefined)
    apiMocks.authorizeDesktop.mockResolvedValue({ code: 'ccc_dac_once', expiresAt: '2026-07-28T12:00:00Z' })
    apiMocks.devices.mockResolvedValue([])
    apiMocks.hosts.mockResolvedValue([])
    apiMocks.createDevice.mockResolvedValue(undefined)
    apiMocks.createHost.mockResolvedValue(undefined)
    apiMocks.pairingCode.mockResolvedValue(undefined)
    apiMocks.disableHost.mockResolvedValue(undefined)
    apiMocks.enableHost.mockResolvedValue(undefined)
    apiMocks.revokeDevice.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('explains that desktop authorization continues in the browser platform', async () => {
    window.history.replaceState({}, '', '/?desktop_auth=1&callback_port=49152&state=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ&code_challenge=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ')
    render(<App />)

    expect(await screen.findByText('Agent Gateway is requesting access')).toBeTruthy()
    expect(screen.getByText(/return to the desktop app automatically/i)).toBeTruthy()
  })

  it('registers an account and enters the dashboard', async () => {
    const actor = userEvent.setup()
    render(<App />)

    await actor.click(await screen.findByRole('button', { name: 'Create account' }))
    const registerDialog = screen.getByRole('dialog')
    await actor.type(within(registerDialog).getByLabelText('Email'), 'owner@example.com')
    await actor.type(within(registerDialog).getByLabelText('Password'), 'a-secure-password')
    const registerButtons = within(registerDialog).getAllByRole('button', { name: /^Create account$/ })
    expect((registerButtons[registerButtons.length - 1] as HTMLButtonElement).disabled).toBe(true)
    await actor.click(within(registerDialog).getByRole('checkbox'))
    await actor.click(registerButtons[registerButtons.length - 1])

    expect(apiMocks.register).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'a-secure-password',
      termsAccepted: true,
      termsVersion: '2026-07-29',
    })
    expect(await screen.findByText('晚上好，Tester')).toBeTruthy()
    await waitFor(() => expect(apiMocks.devices).toHaveBeenCalled())
    expect(apiMocks.hosts).toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: '连接总览' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '四步完成连接。' })).toBeTruthy()
  })

  it('loads a session without exposing manual device or Host management', async () => {
    apiMocks.session.mockResolvedValue({ user, accessExpiresAt: null })
    const actor = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('晚上好，Tester')).toBeTruthy()
    expect(await screen.findByText('未检测到正在运行的桌面 App')).toBeTruthy()
    expect(screen.getByRole('link', { name: '下载 Windows 版本' }).getAttribute('href')).toBe('https://github.com/daizhongtian/Agent-Gateway/releases')

    await actor.click(screen.getByRole('button', { name: '打开 Agent Gateway' }))
    expect(await screen.findByText(/无法打开 Agent Gateway/)).toBeTruthy()
    expect(screen.queryByText('OPENAI HOSTS')).toBeNull()
    expect(screen.queryByText('DEVICES')).toBeNull()
    expect(screen.queryByText('TOTAL HOSTS')).toBeNull()
    expect(screen.queryByText('REGISTERED DEVICES')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Online Host 调用方法' })).toBeNull()
    await actor.click(screen.getByRole('button', { name: '查看调用方法' }))
    expect(screen.getByRole('region', { name: 'Online Host 调用方法' })).toBeTruthy()
    expect(screen.getByText('第三方程序只需替换两个参数。')).toBeTruthy()
    expect(screen.getByText('ccc_live_your_gateway_key')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '查看调用方法' })).toBeNull()
    await waitFor(() => expect(apiMocks.devices).toHaveBeenCalled())
    expect(apiMocks.hosts).toHaveBeenCalled()
    expect(screen.getByText(/尚未生成 Online Host/)).toBeTruthy()
  })

  it('shows backend errors and keeps the authentication screen usable', async () => {
    apiMocks.login.mockRejectedValue(new Error('邮箱或密码错误'))
    const actor = userEvent.setup()
    render(<App />)

    await actor.click(await screen.findByRole('button', { name: 'Sign in' }))
    const loginDialog = screen.getByRole('dialog')
    await actor.type(within(loginDialog).getByLabelText('Email'), 'bad@example.com')
    await actor.type(within(loginDialog).getByLabelText('Password'), 'wrong-password')
    const loginButton = within(loginDialog).getByRole('button', { name: /Open dashboard/ })
    await actor.click(within(loginDialog).getByRole('checkbox'))
    await actor.click(loginButton)

    expect((await screen.findByRole('alert')).textContent).toContain('邮箱或密码错误')
    expect((loginButton as HTMLButtonElement).disabled).toBe(false)
  })

  it('switches the landing page theme and keeps the choice', async () => {
    const actor = userEvent.setup()
    render(<App />)

    const landing = await screen.findByTestId('landing-page')
    expect(landing.getAttribute('data-theme')).toBe('dark')
    await actor.click(screen.getByRole('button', { name: 'Switch to light mode' }))
    expect(landing.getAttribute('data-theme')).toBe('light')
    expect(window.localStorage.getItem('agent-gateway-theme')).toBe('light')
  })

  it('renders platform legal documents without starting an account session', async () => {
    window.history.replaceState({}, '', '/legal/platform-terms?lang=en')
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Platform Terms and Online Host Risk Notice' })).toBeTruthy()
    expect(screen.getByText(/not an incorporated company/i)).toBeTruthy()
    expect(apiMocks.session).not.toHaveBeenCalled()
  })

  it('signs in from the landing dialog and can sign out from the dashboard', async () => {
    const actor = userEvent.setup()
    render(<App />)

    await actor.click(await screen.findByRole('button', { name: 'Sign in' }))
    const dialog = screen.getByRole('dialog')
    await actor.type(within(dialog).getByLabelText('Email'), 'owner@example.com')
    await actor.type(within(dialog).getByLabelText('Password'), 'a-secure-password')
    await actor.click(within(dialog).getByRole('checkbox'))
    await actor.click(within(dialog).getByRole('button', { name: 'Open dashboard' }))

    expect(apiMocks.login).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'a-secure-password',
      termsAccepted: true,
      termsVersion: '2026-07-29',
    })
    expect(await screen.findByText('晚上好，Tester')).toBeTruthy()
    await actor.click(screen.getAllByRole('button', { name: '退出登录' })[0])
    await waitFor(() => expect(apiMocks.logout).toHaveBeenCalled())
    expect(await screen.findByTestId('landing-page')).toBeTruthy()
  })

  it('closes the embedded authentication dialog without changing session state', async () => {
    const actor = userEvent.setup()
    render(<App />)
    await actor.click(await screen.findByRole('button', { name: 'Create account' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    await actor.click(screen.getByRole('button', { name: 'Close sign-in dialog' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(apiMocks.register).not.toHaveBeenCalled()
  })

  it('retries a failed desktop browser authorization after a valid signed-in session', async () => {
    window.history.replaceState({}, '', '/?desktop_auth=1&callback_port=49152&state=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ&code_challenge=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ')
    apiMocks.session.mockResolvedValue({ user, accessExpiresAt: null })
    apiMocks.authorizeDesktop.mockRejectedValueOnce(new Error('Desktop authorization expired'))
      .mockRejectedValueOnce(new Error('Still unavailable'))
    const actor = userEvent.setup()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Could not return to the desktop app' })).toBeTruthy()
    expect(screen.getByText('Desktop authorization expired')).toBeTruthy()
    await actor.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(apiMocks.authorizeDesktop).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Still unavailable')).toBeTruthy()
  })

  it('renders an online Host, copies usage configuration, and toggles it off and on', async () => {
    apiMocks.session.mockResolvedValue({ user, accessExpiresAt: null })
    apiMocks.devices.mockResolvedValue([device])
    apiMocks.hosts.mockResolvedValue([host])
    const offline = { ...host, status: 'offline' as const, desiredOnline: false }
    apiMocks.updateHost.mockResolvedValueOnce(offline).mockResolvedValueOnce(host)
    const actor = userEvent.setup()
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: clipboard })
    render(<App />)

    expect(await screen.findByText('公网入口已经在线。')).toBeTruthy()
    expect(screen.getByText('https://office-host.example.com/v1')).toBeTruthy()
    await actor.click(screen.getByRole('button', { name: '复制 Online Host 地址' }))
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('https://office-host.example.com/v1'))
    expect(await screen.findByText('Online Host 地址已复制。')).toBeTruthy()

    await actor.click(screen.getByRole('button', { name: /^Online$/ }))
    expect(apiMocks.updateHost).toHaveBeenLastCalledWith('host-1', {
      displayName: 'Office Host',
      desiredOnline: false,
    })
    expect(await screen.findByText('Online Host 已关闭。')).toBeTruthy()

    await actor.click(screen.getByRole('button', { name: /^Offline$/ }))
    expect(apiMocks.updateHost).toHaveBeenLastCalledWith('host-1', {
      displayName: 'Office Host',
      desiredOnline: true,
    })
    expect(await screen.findByText('Online Host 已开启并通过真实连通检查。')).toBeTruthy()

    await actor.click(screen.getByRole('button', { name: '查看调用方法' }))
    expect(screen.getByText(/base_url="https:\/\/office-host.example.com\/v1"/)).toBeTruthy()
    await actor.click(screen.getAllByRole('button', { name: /复制代码/ })[0])
    expect(clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining('ccc_live_your_gateway_key'))
  })

  it('enables a disabled Host before requesting it online', async () => {
    apiMocks.session.mockResolvedValue({ user, accessExpiresAt: null })
    const disabled = { ...host, status: 'disabled' as const, desiredOnline: false }
    const enabled = { ...host, status: 'offline' as const, desiredOnline: false }
    apiMocks.devices.mockResolvedValue([device])
    apiMocks.hosts.mockResolvedValue([disabled])
    apiMocks.enableHost.mockResolvedValue(enabled)
    apiMocks.updateHost.mockResolvedValue(host)
    const actor = userEvent.setup()
    render(<App />)

    await waitFor(() => expect((screen.getByRole('button', { name: /^Offline$/ }) as HTMLButtonElement).disabled).toBe(false))
    await actor.click(screen.getByRole('button', { name: /^Offline$/ }))
    expect(apiMocks.enableHost).toHaveBeenCalledWith('host-1')
    expect(apiMocks.updateHost).toHaveBeenCalledWith('host-1', {
      displayName: 'Office Host',
      desiredOnline: true,
    })
  })

  it('verifies and focuses a real local desktop service without using custom protocol state as proof', async () => {
    apiMocks.session.mockResolvedValue({ user, accessExpiresAt: null })
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Chrome')
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        product: 'agent-gateway',
        status: 'ok',
        codingAgent: { label: 'ChatGPT', status: 'ready', ready: true },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        product: 'agent-gateway',
        action: 'desktop-open',
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const actor = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('桌面 App 已连接')).toBeTruthy()
    expect(screen.getByText('可接受 Coding Agent 调用')).toBeTruthy()
    await actor.click(screen.getByRole('button', { name: '打开 Agent Gateway' }))
    expect(await screen.findByText('Agent Gateway 已打开。')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
