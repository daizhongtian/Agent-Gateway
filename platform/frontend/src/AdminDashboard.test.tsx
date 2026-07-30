import { render, screen, waitFor, within } from '@testing-library/react'
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
  adminDisableUser: vi.fn(),
  adminEnableUser: vi.fn(),
  adminRevokeDevice: vi.fn(),
  adminDisableHost: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return { ...actual, api: apiMocks }
})

const admin: User = {
  id: 'admin-1', email: 'admin@example.com', displayName: 'Platform Admin',
  status: 'active', role: 'admin', emailVerified: true, createdAt: '2026-07-20T10:00:00Z',
}
const member: User = {
  id: 'user-2', email: 'member@example.com', displayName: 'Team Member',
  status: 'active', role: 'user', emailVerified: false, createdAt: '2026-07-21T10:00:00Z',
}
const config: PlatformConfig = {
  platformVersion: '0.1.0', publicHostDomain: 'api.localhost', relayUrl: 'wss://relay.localhost/agent',
  relayEnabled: false, localProxyEnabled: true, relayProtocolVersion: 1,
  termsVersion: '2026-07-29', privacyVersion: '2026-07-29',
  termsPath: '/legal/platform-terms', privacyPath: '/legal/platform-privacy', allowedPublicRoutes: [],
}

describe('minimum Admin Dashboard', () => {
  beforeEach(() => {
    localStorage.clear()
    for (const mock of Object.values(apiMocks)) mock.mockReset()
    apiMocks.adminOverview.mockResolvedValue({
      totalUsers: 2, activeUsers: 2, disabledUsers: 0, activeDevices: 1,
      revokedDevices: 0, onlineHosts: 1, disabledHosts: 0, auditEvents: 1,
    })
    apiMocks.adminUsers.mockResolvedValue({ items: [member, admin], page: 0, size: 100, totalItems: 2, totalPages: 1 })
    apiMocks.adminDevices.mockResolvedValue({ items: [{
      id: 'device-1', userId: member.id, userEmail: member.email, name: 'Office PC', platform: 'WINDOWS',
      status: 'active', appVersion: '1.0.0', lastSeenAt: '2026-07-29T12:00:00Z', createdAt: '2026-07-21T10:00:00Z',
    }], page: 0, size: 100, totalItems: 1, totalPages: 1 })
    apiMocks.adminHosts.mockResolvedValue({ items: [{
      id: 'host-1', userId: member.id, userEmail: member.email, deviceId: 'device-1', displayName: 'Office Host',
      status: 'online', desiredOnline: true, lastHeartbeatAt: '2026-07-29T12:00:00Z', createdAt: '2026-07-21T10:00:00Z',
    }], page: 0, size: 100, totalItems: 1, totalPages: 1 })
    apiMocks.adminAuditEvents.mockResolvedValue({ items: [{
      id: 'audit-1', actorId: admin.id, actorEmail: admin.email, action: 'ADMIN_HOST_DISABLED', outcome: 'success',
      targetType: 'host', targetId: 'host-1', reason: 'maintenance', requestId: 'req_123', createdAt: '2026-07-29T12:00:00Z',
    }], page: 0, size: 100, totalItems: 1, totalPages: 1 })
    apiMocks.adminDisableUser.mockResolvedValue({ ...member, status: 'disabled' })
    apiMocks.adminRevokeDevice.mockResolvedValue({ status: 'revoked' })
    apiMocks.adminDisableHost.mockResolvedValue({ status: 'disabled' })
    apiMocks.logout.mockResolvedValue(undefined)
  })

  it('loads the minimum overview and never offers self-disable', async () => {
    render(<AdminDashboard user={admin} config={config} onSignedOut={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: '保持平台可控。' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '平台概览' })).toBeTruthy()
    expect(screen.getByText('2', { selector: '.admin-summary strong' })).toBeTruthy()
    const adminRow = screen.getAllByText(admin.email).map((node) => node.closest('tr')).find(Boolean)!
    expect(within(adminRow).getByText('当前管理员')).toBeTruthy()
    expect(within(adminRow).queryByRole('button', { name: '停用' })).toBeNull()
    expect(apiMocks.adminOverview).toHaveBeenCalledTimes(1)
    expect(apiMocks.adminAuditEvents).toHaveBeenCalledTimes(1)
  })

  it('confirms a user disable with a reason and refreshes every data set', async () => {
    const actor = userEvent.setup()
    render(<AdminDashboard user={admin} config={config} onSignedOut={vi.fn()} />)
    await screen.findByText(member.email)

    await actor.click(screen.getByRole('button', { name: '停用' }))
    const dialog = screen.getByRole('dialog')
    await actor.type(within(dialog).getByLabelText(/原因/), 'policy review')
    await actor.click(within(dialog).getByRole('button', { name: '确认操作' }))

    await waitFor(() => expect(apiMocks.adminDisableUser).toHaveBeenCalledWith(member.id, 'policy review'))
    expect(await screen.findByText('操作已完成并写入审计记录。')).toBeTruthy()
    expect(apiMocks.adminOverview).toHaveBeenCalledTimes(2)
  })

  it('manages device and Host actions and exposes the audit log', async () => {
    const actor = userEvent.setup()
    render(<AdminDashboard user={admin} config={config} onSignedOut={vi.fn()} />)
    await screen.findByText(member.email)

    await actor.click(screen.getByRole('button', { name: /^设备/ }))
    await actor.click(screen.getByRole('button', { name: '撤销' }))
    await actor.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认操作' }))
    await waitFor(() => expect(apiMocks.adminRevokeDevice).toHaveBeenCalledWith('device-1', ''))

    await actor.click(screen.getByRole('button', { name: /^Online Hosts/ }))
    await actor.click(screen.getByRole('button', { name: '停用' }))
    await actor.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认操作' }))
    await waitFor(() => expect(apiMocks.adminDisableHost).toHaveBeenCalledWith('host-1', ''))

    await actor.click(screen.getByRole('button', { name: /^审计记录/ }))
    expect(screen.getByText('ADMIN_HOST_DISABLED')).toBeTruthy()
    expect(screen.getByText('req_123')).toBeTruthy()
    expect(screen.getByText('maintenance')).toBeTruthy()
  })

  it('switches the complete Admin UI to English and persists the choice', async () => {
    const actor = userEvent.setup()
    render(<AdminDashboard user={admin} config={config} onSignedOut={vi.fn()} />)
    await screen.findByRole('heading', { name: '保持平台可控。' })

    await actor.click(screen.getByRole('button', { name: 'EN' }))
    expect(await screen.findByRole('heading', { name: 'Keep the platform under control.' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Users/ })).toBeTruthy()
    expect(localStorage.getItem('agent-gateway-admin-language')).toBe('en')
  })

  it('shows terminal resource states, enables a disabled user, and supports cancellation', async () => {
    const disabled = { ...member, id: 'user-disabled', email: 'disabled@example.com', status: 'disabled' }
    apiMocks.adminUsers.mockResolvedValue({ items: [disabled, admin], page: 0, size: 100, totalItems: 2, totalPages: 1 })
    apiMocks.adminDevices.mockResolvedValue({ items: [{
      id: 'device-revoked', userId: disabled.id, userEmail: disabled.email, name: 'Retired PC', platform: 'WINDOWS',
      status: 'revoked', appVersion: null, lastSeenAt: null, createdAt: '2026-07-21T10:00:00Z',
    }], page: 0, size: 100, totalItems: 1, totalPages: 1 })
    apiMocks.adminHosts.mockResolvedValue({ items: [{
      id: 'host-disabled', userId: disabled.id, userEmail: disabled.email, deviceId: 'device-revoked', displayName: 'Retired Host',
      status: 'disabled', desiredOnline: false, lastHeartbeatAt: null, createdAt: '2026-07-21T10:00:00Z',
    }], page: 0, size: 100, totalItems: 1, totalPages: 1 })
    apiMocks.adminAuditEvents.mockResolvedValue({ items: [{
      id: 'audit-system', actorId: null, actorEmail: null, action: 'SYSTEM_EVENT', outcome: 'failure',
      targetType: null, targetId: null, reason: null, requestId: null, createdAt: '2026-07-29T12:00:00Z',
    }], page: 0, size: 100, totalItems: 1, totalPages: 1 })
    apiMocks.adminEnableUser.mockResolvedValue({ ...disabled, status: 'active' })
    const actor = userEvent.setup()
    render(<AdminDashboard user={admin} config={config} onSignedOut={vi.fn()} />)
    await screen.findByText(disabled.email)

    await actor.click(screen.getByRole('button', { name: '恢复' }))
    expect(screen.getByRole('heading', { name: '恢复这个用户？' })).toBeTruthy()
    await actor.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await actor.click(screen.getByRole('button', { name: '恢复' }))
    await actor.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认操作' }))
    await waitFor(() => expect(apiMocks.adminEnableUser).toHaveBeenCalledWith(disabled.id, ''))

    await actor.click(screen.getByRole('button', { name: /^设备/ }))
    expect((screen.getByRole('button', { name: '已撤销' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    await actor.click(screen.getByRole('button', { name: /^Online Hosts/ }))
    expect((screen.getByRole('button', { name: '已停用' }) as HTMLButtonElement).disabled).toBe(true)
    await actor.click(screen.getByRole('button', { name: /^审计记录/ }))
    expect(screen.getByText('SYSTEM_EVENT')).toBeTruthy()
    expect(screen.getByText('系统')).toBeTruthy()
  })

  it('handles refresh, sign-out, API failures, and dismissible feedback', async () => {
    const actor = userEvent.setup()
    const signedOut = vi.fn()
    render(<AdminDashboard user={admin} config={config} onSignedOut={signedOut} />)
    await screen.findByText(member.email)

    await actor.click(screen.getByRole('button', { name: '刷新数据' }))
    await waitFor(() => expect(apiMocks.adminOverview).toHaveBeenCalledTimes(2))
    await actor.click(screen.getByRole('button', { name: '停用' }))
    apiMocks.adminDisableUser.mockRejectedValueOnce(new Error('Administrative operation failed'))
    await actor.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认操作' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Administrative operation failed')
    await actor.click(within(screen.getByRole('alert')).getByRole('button'))
    expect(screen.queryByRole('alert')).toBeNull()

    await actor.click(screen.getByRole('button', { name: '退出' }))
    await waitFor(() => expect(apiMocks.logout).toHaveBeenCalled())
    expect(signedOut).toHaveBeenCalled()
  })

  it('reports authorization expiry and renders a stable empty English state', async () => {
    localStorage.setItem('agent-gateway-admin-language', 'en')
    apiMocks.adminOverview.mockRejectedValueOnce(new ApiError('Session expired', 401, 'SESSION_EXPIRED'))
    const signedOut = vi.fn()
    const { unmount } = render(<AdminDashboard user={admin} config={config} onSignedOut={signedOut} />)
    await waitFor(() => expect(signedOut).toHaveBeenCalled())
    unmount()

    apiMocks.adminOverview.mockResolvedValue(emptyOverviewForTest())
    apiMocks.adminUsers.mockResolvedValue({ items: [], page: 0, size: 100, totalItems: 0, totalPages: 0 })
    apiMocks.adminDevices.mockResolvedValue({ items: [], page: 0, size: 100, totalItems: 0, totalPages: 0 })
    apiMocks.adminHosts.mockResolvedValue({ items: [], page: 0, size: 100, totalItems: 0, totalPages: 0 })
    apiMocks.adminAuditEvents.mockResolvedValue({ items: [], page: 0, size: 100, totalItems: 0, totalPages: 0 })
    render(<AdminDashboard user={admin} config={config} onSignedOut={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Keep the platform under control.' })).toBeTruthy()
    expect(screen.getByText('There is no data to display yet.')).toBeTruthy()
  })
})

function emptyOverviewForTest() {
  return { totalUsers: 0, activeUsers: 0, disabledUsers: 0, activeDevices: 0, revokedDevices: 0, onlineHosts: 0, disabledHosts: 0, auditEvents: 0 }
}
