import type {
  ApiErrorBody,
  AdminAuditEvent,
  AdminDevice,
  AdminHost,
  AdminOverview,
  AdminPage,
  AdminUser,
  AuthResponse,
  DesktopAuthorizationResponse,
  Device,
  PairingCode,
  PlatformConfig,
  PublicHost,
  SessionResponse,
} from './types'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const CSRF_COOKIE = 'ccc_platform_csrf'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly requestId?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

function cookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`
  const match = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))
  return match ? decodeURIComponent(match.slice(prefix.length)) : null
}

async function request<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = cookie(CSRF_COOKIE)
    if (csrf) headers.set('X-CSRF-Token', csrf)
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  const refreshable = ![
    '/api/v1/auth/register',
    '/api/v1/auth/login',
    '/api/v1/auth/refresh',
  ].includes(path)
  if (response.status === 401 && allowRefresh && refreshable) {
    try {
      await request<AuthResponse>('/api/v1/auth/refresh', { method: 'POST', body: '{}' }, false)
      return request<T>(path, init, false)
    } catch {
      // The original 401 is more useful to callers than a refresh failure.
    }
  }

  if (!response.ok) {
    let payload: ApiErrorBody = {}
    try {
      payload = (await response.json()) as ApiErrorBody
    } catch {
      // An upstream proxy can return an empty or non-JSON error response.
    }
    throw new ApiError(
      payload.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
      payload.error?.code ?? 'REQUEST_FAILED',
      payload.error?.requestId,
      payload.error?.details,
    )
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  config: () => request<PlatformConfig>('/api/v1/platform/config', {}, false),
  session: () => request<SessionResponse>('/api/v1/auth/session'),
  register: (input: { email: string; password: string; termsAccepted: boolean; termsVersion: string }) =>
    request<AuthResponse>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ ...input, clientType: 'browser' }),
    }, false),
  login: (input: { email: string; password: string; termsAccepted: boolean; termsVersion: string }) =>
    request<AuthResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ ...input, clientType: 'browser' }),
    }, false),
  logout: () => request<void>('/api/v1/auth/logout', { method: 'POST' }, false),
  authorizeDesktop: (codeChallenge: string) =>
    request<DesktopAuthorizationResponse>('/api/v1/auth/desktop/authorize', {
      method: 'POST',
      body: JSON.stringify({ codeChallenge }),
    }),
  devices: () => request<Device[]>('/api/v1/devices'),
  createDevice: (input: { name: string; platform: string }) =>
    request<Device>('/api/v1/devices', { method: 'POST', body: JSON.stringify(input) }),
  pairingCode: (deviceId: string) =>
    request<PairingCode>(`/api/v1/devices/${deviceId}/pairing-code`, { method: 'POST' }),
  revokeDevice: (deviceId: string) =>
    request<void>(`/api/v1/devices/${deviceId}`, { method: 'DELETE' }),
  hosts: () => request<PublicHost[]>('/api/v1/hosts'),
  createHost: (input: { deviceId: string; displayName: string }) =>
    request<PublicHost>('/api/v1/hosts', { method: 'POST', body: JSON.stringify(input) }),
  updateHost: (hostId: string, input: { displayName: string; desiredOnline: boolean }) =>
    request<PublicHost>(`/api/v1/hosts/${hostId}`, { method: 'PATCH', body: JSON.stringify(input) }),
  disableHost: (hostId: string) =>
    request<PublicHost>(`/api/v1/hosts/${hostId}/disable`, { method: 'POST' }),
  enableHost: (hostId: string) =>
    request<PublicHost>(`/api/v1/hosts/${hostId}/enable`, { method: 'POST' }),
  adminOverview: () => request<AdminOverview>('/api/v1/admin/overview'),
  adminUsers: () => request<AdminPage<AdminUser>>('/api/v1/admin/users?size=100'),
  adminDevices: () => request<AdminPage<AdminDevice>>('/api/v1/admin/devices?size=100'),
  adminHosts: () => request<AdminPage<AdminHost>>('/api/v1/admin/hosts?size=100'),
  adminAuditEvents: () => request<AdminPage<AdminAuditEvent>>('/api/v1/admin/audit-events?size=100'),
  adminDisableUser: (userId: string, reason: string) =>
    request<AdminUser>(`/api/v1/admin/users/${userId}/disable`, { method: 'POST', body: JSON.stringify({ reason }) }),
  adminEnableUser: (userId: string, reason: string) =>
    request<AdminUser>(`/api/v1/admin/users/${userId}/enable`, { method: 'POST', body: JSON.stringify({ reason }) }),
  adminRevokeDevice: (deviceId: string, reason: string) =>
    request<AdminDevice>(`/api/v1/admin/devices/${deviceId}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) }),
  adminDisableHost: (hostId: string, reason: string) =>
    request<AdminHost>(`/api/v1/admin/hosts/${hostId}/disable`, { method: 'POST', body: JSON.stringify({ reason }) }),
}
