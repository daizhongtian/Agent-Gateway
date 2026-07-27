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
  allowedPublicRoutes: ['GET /v1/models'],
}

const device: Device = {
  id: 'device-1',
  name: 'My Windows PC',
  platform: 'windows',
  status: 'pending',
  appVersion: null,
  pairedAt: null,
  lastSeenAt: null,
  createdAt: '2026-07-26T10:00:00Z',
}

const host: PublicHost = {
  id: 'host-1',
  deviceId: device.id,
  deviceName: device.name,
  displayName: 'Primary Host',
  slug: 'h-test-host',
  openAiBaseUrl: 'https://h-test-host.api.test.local/v1',
  status: 'offline',
  desiredOnline: false,
  relayReady: false,
  protocolVersion: 1,
  lastHeartbeatAt: null,
  createdAt: '2026-07-26T10:00:00Z',
}

describe('App user flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.config.mockResolvedValue(config)
    apiMocks.session.mockRejectedValue(new Error('not signed in'))
    apiMocks.register.mockResolvedValue({ user })
    apiMocks.login.mockResolvedValue({ user })
    apiMocks.logout.mockResolvedValue(undefined)
    apiMocks.devices.mockResolvedValue([])
    apiMocks.hosts.mockResolvedValue([])
    apiMocks.createDevice.mockResolvedValue(device)
    apiMocks.createHost.mockResolvedValue(host)
    apiMocks.pairingCode.mockResolvedValue({
      code: 'ABCD-1234',
      expiresAt: '2026-07-26T11:00:00Z',
      deviceId: device.id,
    })
    apiMocks.disableHost.mockResolvedValue({ ...host, status: 'disabled' })
    apiMocks.enableHost.mockResolvedValue(host)
    apiMocks.revokeDevice.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('registers an account and enters the dashboard', async () => {
    const actor = userEvent.setup()
    render(<App />)

    await actor.click(await screen.findByRole('button', { name: '注册' }))
    await actor.type(screen.getByLabelText('电子邮箱'), 'owner@example.com')
    await actor.type(screen.getByLabelText('密码'), 'a-secure-password')
    await actor.click(screen.getByRole('button', { name: /创建账户/ }))

    expect(apiMocks.register).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'a-secure-password',
    })
    expect(await screen.findByText('晚上好，Tester')).toBeTruthy()
    await waitFor(() => expect(apiMocks.devices).toHaveBeenCalled())
    expect(apiMocks.hosts).toHaveBeenCalled()
  })

  it('loads a session and manages devices, pairing codes and Hosts', async () => {
    apiMocks.session.mockResolvedValue({ user, accessExpiresAt: null })
    const actor = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('晚上好，Tester')).toBeTruthy()

    await actor.click(screen.getByRole('button', { name: /添加设备/ }))
    const addButtons = screen.getAllByRole('button', { name: '添加设备' })
    await actor.click(addButtons[addButtons.length - 1])
    await waitFor(() => expect(apiMocks.createDevice).toHaveBeenCalledWith({
      name: 'My Windows PC',
      platform: 'windows',
    }))
    expect(await screen.findByText('My Windows PC')).toBeTruthy()

    await actor.click(screen.getByRole('button', { name: /配对码/ }))
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    await actor.click(screen.getByText('ABCD-1234'))
    expect((await screen.findByText('已复制到剪贴板。')).textContent).toBe('已复制到剪贴板。')
    await actor.click(within(screen.getByRole('dialog')).getByRole('button', { name: '×' }))

    await actor.click(screen.getByRole('button', { name: /新建 Host/ }))
    await actor.click(screen.getByRole('button', { name: '预留地址' }))
    await waitFor(() => expect(apiMocks.createHost).toHaveBeenCalledWith({
      deviceId: device.id,
      displayName: 'Primary Host',
    }))
    expect(await screen.findByText(host.openAiBaseUrl)).toBeTruthy()

    await actor.click(screen.getByRole('button', { name: '停用' }))
    await waitFor(() => expect(apiMocks.disableHost).toHaveBeenCalledWith(host.id))
    expect(await screen.findByText('已停用')).toBeTruthy()
  })

  it('shows backend errors and keeps the authentication screen usable', async () => {
    apiMocks.login.mockRejectedValue(new Error('邮箱或密码错误'))
    const actor = userEvent.setup()
    render(<App />)

    await actor.type(await screen.findByLabelText('电子邮箱'), 'bad@example.com')
    await actor.type(screen.getByLabelText('密码'), 'wrong-password')
    await actor.click(screen.getByRole('button', { name: /进入控制台/ }))

    expect((await screen.findByRole('alert')).textContent).toContain('邮箱或密码错误')
    expect((screen.getByRole('button', { name: /进入控制台/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})
