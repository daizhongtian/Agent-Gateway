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
})
