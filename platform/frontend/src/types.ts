export type User = {
  id: string
  email: string
  displayName: string
  status: string
  emailVerified: boolean
  createdAt: string
}

export type AuthResponse = {
  user: User
  accessExpiresAt: string
  refreshExpiresAt: string
  csrfToken: string
}

export type DesktopAuthorizationResponse = {
  code: string
  expiresAt: string
}

export type SessionResponse = {
  user: User
  accessExpiresAt: string | null
}

export type Device = {
  id: string
  name: string
  platform: string
  status: 'pending' | 'active' | 'revoked'
  appVersion: string | null
  pairedAt: string | null
  lastSeenAt: string | null
  createdAt: string
}

export type PublicHost = {
  id: string
  deviceId: string
  deviceName: string
  displayName: string
  slug: string
  openAiBaseUrl: string
  status: 'offline' | 'online' | 'degraded' | 'disabled'
  desiredOnline: boolean
  relayReady: boolean
  protocolVersion: number
  lastHeartbeatAt: string | null
  createdAt: string
}

export type PlatformConfig = {
  platformVersion: string
  publicHostDomain: string
  relayUrl: string
  relayEnabled: boolean
  localProxyEnabled: boolean
  relayProtocolVersion: number
  termsVersion: string
  privacyVersion: string
  termsPath: string
  privacyPath: string
  allowedPublicRoutes: string[]
}

export type PairingCode = {
  code: string
  expiresAt: string
  deviceId: string
}

export type ApiErrorBody = {
  error?: {
    code?: string
    message?: string
    requestId?: string
    details?: Record<string, unknown>
  }
}
