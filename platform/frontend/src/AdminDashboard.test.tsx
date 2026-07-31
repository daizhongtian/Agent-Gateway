import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminDashboard from './AdminDashboard'
import { ApiError } from './api'
import type { PlatformConfig, User } from './types'

const apiMocks = vi.hoisted(() => ({
  adminOverview: vi.fn(),
  adminUsers: vi.fn(),
  adminDevices: vi.fn(),
  adminHosts: vi.fn(),
  adminAuditEvents: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return { ...actual, api: apiMocks }
})

const admin: User = {
  id: 'admin-1', username: 'admin', email: 'admin@example.com', displayName: 'Platform Admin',
  status: 'active', role: 'admin', emailVerified: true, createdAt: '2026-07-20T10:00:00Z',
}
const member: User = {
  id: 'user-2', username: 'member', email: 'member@example.com', displayName: 'Team Member',
  status: 'active', role: 'user', emailVerified: false, createdAt: '2026-07-21T10:00:00Z',
}
const config: PlatformConfig = {
  platformVersion: '0.1.0', publicHostDomain: 'api.localhost', relayUrl: 'wss://relay.localhost/agent',
  relayEnabled: false, localProxyEnabled: true, relayProtocolVersion: 1,
  termsVersion: '2026-07-29', privacyVersion: '2026-07-29',
  termsPath: '/legal/platform-terms', privacyPath: '/legal/platform-privacy', allowedPublicRoutes: [],
}

function overview(totalUsers = 2, onlineHosts = 1) {
  return {
    totalUsers, activeUsers: totalUsers, disabledUsers: 0, activeDevices: 7,
    revokedDevices: 0, onlineHosts, disabledHosts: 5, auditEvents: 9,
  }
}

describe('read-only Admin user overview', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('agent-gateway-language', 'zh')
    for (const mock of Object.values(apiMocks)) mock.mockReset()
    apiMocks.adminOverview.mockResolvedValue(overview())
    apiMocks.adminUsers.mockResolvedValue({ items: [member, admin], page: 0, size: 100, totalItems: 2, totalPages: 1 })
    apiMocks.logout.mockResolvedValue(undefined)
  })

  it('shows database user and online Host counts with only a read-only user table', async () => {
    render(<AdminDashboard user={admin} config={config} onSignedOut={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: '查看平台用户。' })).toBeTruthy()
    expect(screen.getByText('数据库用户')).toBeTruthy()
    expect(screen.getByText('当前在线 Host')).toBeTruthy()
    expect(screen.getByText('@member', { exact: false })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '账号' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: '操作' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^设备/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Online Hosts/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^审计记录/ })).toBeNull()
    expect(apiMocks.adminDevices).not.toHaveBeenCalled()
    expect(apiMocks.adminHosts).not.toHaveBeenCalled()
    expect(apiMocks.adminAuditEvents).not.toHaveBeenCalled()
  })

  it('refreshes only overview and users', async () => {
    const actor = userEvent.setup()
    render(<AdminDashboard user={admin} config={config} onSignedOut={vi.fn()} />)
    await screen.findByText('@member', { exact: false })

    await actor.click(screen.getByRole('button', { name: '刷新数据' }))
    await waitFor(() => expect(apiMocks.adminOverview).toHaveBeenCalledTimes(2))
    expect(apiMocks.adminUsers).toHaveBeenCalledTimes(2)
    expect(apiMocks.adminDevices).not.toHaveBeenCalled()
    expect(apiMocks.adminHosts).not.toHaveBeenCalled()
  })

  it('localizes the reduced dashboard and signs out', async () => {
    const actor = userEvent.setup()
    const signedOut = vi.fn()
    render(<AdminDashboard user={admin} config={config} onSignedOut={signedOut} />)
    await screen.findByRole('heading', { name: '查看平台用户。' })

    await actor.selectOptions(screen.getByRole('combobox', { name: '选择语言' }), 'en')
    expect(await screen.findByRole('heading', { name: 'View platform users.' })).toBeTruthy()
    expect(screen.getByText('Database users')).toBeTruthy()
    expect(screen.getByText('Hosts online now')).toBeTruthy()
    await actor.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(apiMocks.logout).toHaveBeenCalled())
    expect(signedOut).toHaveBeenCalled()
  })

  it('handles authorization expiry and an empty user database', async () => {
    apiMocks.adminOverview.mockRejectedValueOnce(new ApiError('Session expired', 401, 'SESSION_EXPIRED'))
    const signedOut = vi.fn()
    const { unmount } = render(<AdminDashboard user={admin} config={config} onSignedOut={signedOut} />)
    await waitFor(() => expect(signedOut).toHaveBeenCalled())
    unmount()

    apiMocks.adminOverview.mockResolvedValue(overview(0, 0))
    apiMocks.adminUsers.mockResolvedValue({ items: [], page: 0, size: 100, totalItems: 0, totalPages: 0 })
    render(<AdminDashboard user={admin} config={config} onSignedOut={vi.fn()} />)
    expect(await screen.findByText('还没有可显示的数据。')).toBeTruthy()
  })
})
