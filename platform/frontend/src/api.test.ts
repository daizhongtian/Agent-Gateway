import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from './api'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('platform API client', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('sends JSON, credentials and the CSRF header for mutations', async () => {
    document.cookie = 'ccc_platform_csrf=csrf-test-token; Path=/'
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'dev-1', name: 'PC' }))

    await api.createDevice({ name: 'PC', platform: 'windows' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/devices')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    const headers = new Headers(init?.headers)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('X-CSRF-Token')).toBe('csrf-test-token')
  })

  it('authorizes a desktop PKCE challenge through the signed-in browser session', async () => {
    document.cookie = 'ccc_platform_csrf=csrf-desktop-auth; Path=/'
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'ccc_dac_once', expiresAt: '2026-07-28T12:00:00Z' }, 201))

    const result = await api.authorizeDesktop('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ')

    expect(result.code).toBe('ccc_dac_once')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/auth/desktop/authorize')
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-desktop-auth')
    expect(JSON.parse(String(init?.body))).toEqual({ codeChallenge: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ' })
  })

  it('refreshes once after a protected request returns 401 and retries it', async () => {
    document.cookie = 'ccc_platform_csrf=csrf-refresh; Path=/'
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'u1' }, csrfToken: 'next-csrf' }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'u1', email: 'owner@example.com' } }))

    const result = await api.session()

    expect(result.user.email).toBe('owner@example.com')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/auth/session',
      '/api/v1/auth/refresh',
      '/api/v1/auth/session',
    ])
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('X-CSRF-Token')).toBe('csrf-refresh')
  })

  it('does not recursively refresh failed login or refresh calls', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'INVALID_CREDENTIALS', message: 'Bad login' } }, 401))

    await expect(api.login({ email: 'x@example.com', password: 'bad', termsAccepted: true, termsVersion: '2026-07-29' }))
      .rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Bad login' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('preserves structured API error diagnostics', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid fields',
        requestId: 'req_123',
        details: { email: 'must be valid' },
      },
    }, 400))

    const failure = await api.createDevice({ name: 'x', platform: 'bad' }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      requestId: 'req_123',
      details: { email: 'must be valid' },
    })
  })

  it('supports empty 204 responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(api.logout()).resolves.toBeUndefined()
  })

  it('keeps the original protected-request error when session refresh fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'SESSION_EXPIRED', message: 'Sign in again' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'REFRESH_EXPIRED' } }, 401))

    await expect(api.hosts()).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_EXPIRED',
      message: 'Sign in again',
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/hosts',
      '/api/v1/auth/refresh',
    ])
  })

  it('uses stable fallback diagnostics for empty or non-JSON proxy errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))

    await expect(api.config()).rejects.toMatchObject({
      status: 502,
      code: 'REQUEST_FAILED',
      message: 'Request failed with status 502',
    })
  })

  it('exposes every device and Host operation through its documented route', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/devices') || url.endsWith('/hosts')) return jsonResponse([])
      if (url.includes('/pairing-code')) return jsonResponse({ code: 'PAIR-1234' })
      if (url.endsWith('/disable') || url.endsWith('/enable') || url.includes('/hosts/')) {
        return jsonResponse({ id: 'host-1' })
      }
      if (url.includes('/devices/')) return new Response(null, { status: 204 })
      return jsonResponse({ id: 'created' }, 201)
    })

    await api.devices()
    await api.createDevice({ name: 'Office PC', platform: 'windows' })
    await api.pairingCode('device-1')
    await api.revokeDevice('device-1')
    await api.hosts()
    await api.createHost({ deviceId: 'device-1', displayName: 'Office Host' })
    await api.updateHost('host-1', { displayName: 'Renamed', desiredOnline: true })
    await api.disableHost('host-1')
    await api.enableHost('host-1')

    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)).toEqual([
      'GET /api/v1/devices',
      'POST /api/v1/devices',
      'POST /api/v1/devices/device-1/pairing-code',
      'DELETE /api/v1/devices/device-1',
      'GET /api/v1/hosts',
      'POST /api/v1/hosts',
      'PATCH /api/v1/hosts/host-1',
      'POST /api/v1/hosts/host-1/disable',
      'POST /api/v1/hosts/host-1/enable',
    ])
  })

  it('registers and logs in with browser client metadata', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'user-1' } }, 201))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'user-1' } }))

    const input = {
      email: 'owner@example.com',
      password: 'a-secure-password',
      termsAccepted: true,
      termsVersion: '2026-07-29',
    }
    await api.register(input)
    await api.login(input)

    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(String(call[1]?.body))).toMatchObject({ ...input, clientType: 'browser' })
    }
  })
})
