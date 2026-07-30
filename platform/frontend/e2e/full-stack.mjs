import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const baseUrl = process.env.PLATFORM_E2E_URL ?? 'http://localhost:8088'
const executablePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const username = `e2e_${Date.now()}`
const password = 'e2e-secure-password-2026'
const displayName = username
const resultsDir = new URL('../test-results/', import.meta.url)

await mkdir(resultsDir, { recursive: true })

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({ baseURL: baseUrl, locale: 'zh-CN' })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

async function currentCsrfToken() {
  const cookies = await context.cookies(baseUrl)
  const csrf = cookies.find((entry) => entry.name === 'ccc_platform_csrf')?.value
  assert.match(csrf, /^csrf_/)
  return csrf
}

try {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '注册' }).first().waitFor()
  await page.getByRole('button', { name: '注册' }).first().click()
  const registerDialog = page.getByRole('dialog', { name: '注册' })
  await registerDialog.getByLabel('用户名').fill(username)
  await registerDialog.getByLabel('密码', { exact: true }).fill(password)
  await registerDialog.getByRole('checkbox').check()
  await registerDialog.getByRole('button', { name: '创建账户' }).last().click()
  await page.getByText(`晚上好，${displayName}`).waitFor()
  const refreshResponse = await context.request.post('/api/v1/auth/refresh', {
    headers: { 'X-CSRF-Token': await currentCsrfToken() },
  })
  assert.equal(refreshResponse.status(), 200)
  const refreshedSession = await refreshResponse.json()
  assert.match(refreshedSession.csrfToken, /^csrf_/)
  assert.equal('accessToken' in refreshedSession, false, 'Browser sessions must not expose bearer tokens')
  const csrfHeaders = { 'X-CSRF-Token': refreshedSession.csrfToken }

  await page.getByText('等待桌面 App 自动创建 Online Host').waitFor()
  assert.equal(await page.locator('.host-toggle').isDisabled(), true, 'Online Host cannot be enabled before desktop enrollment')

  const deviceResponse = await context.request.post('/api/v1/devices', {
    headers: csrfHeaders,
    data: { name: 'E2E Windows PC', platform: 'windows' },
  })
  assert.equal(deviceResponse.status(), 201)
  const device = await deviceResponse.json()

  const pairingResponse = await context.request.post(`/api/v1/devices/${device.id}/pairing-code`, { headers: csrfHeaders })
  assert.equal(pairingResponse.status(), 200)
  const pairing = await pairingResponse.json()
  const pairingCode = pairing.code
  assert.match(pairingCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/)

  const pairBody = {
    code: pairingCode,
    publicKey: '-----BEGIN PUBLIC KEY-----e2e-browser-key-material-----END PUBLIC KEY-----',
    appVersion: 'e2e-1.0.0',
    platform: 'windows',
  }

  const pairResponse = await fetch(`${baseUrl}/api/v1/desktop/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pairBody),
  })
  if (pairResponse.status !== 200) throw new Error(`Desktop pairing returned ${pairResponse.status}`)
  const paired = await pairResponse.json()
  if (!paired.deviceSecret?.startsWith('ccc_dev_')) throw new Error('Desktop pairing did not return a device secret')
  assert.deepEqual(paired.hosts, [])

  const replayResponse = await fetch(`${baseUrl}/api/v1/desktop/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pairBody),
  })
  if (replayResponse.status !== 401) throw new Error(`Pairing code replay returned ${replayResponse.status}, expected 401`)

  const hostResponse = await context.request.post('/api/v1/hosts', {
    headers: csrfHeaders,
    data: { deviceId: device.id, displayName: 'E2E Public Host' },
  })
  assert.equal(hostResponse.status(), 201)
  const createdHost = await hostResponse.json()
  const openAiHost = createdHost.openAiBaseUrl
  assert.match(openAiHost, /^http:\/\/localhost:8088\/h\/h-[a-z0-9-]+\/v1$/)

  const onlineResponse = await context.request.patch(`/api/v1/hosts/${createdHost.id}`, {
    headers: csrfHeaders,
    data: { displayName: createdHost.displayName, desiredOnline: true },
  })
  assert.equal(onlineResponse.status(), 200)
  const onlineHost = await onlineResponse.json()
  assert.equal(onlineHost.status, 'online')
  assert.equal(onlineHost.desiredOnline, true)

  // The signed-in dashboard polls Host and desktop status by design, so a
  // network-idle wait can never be a reliable readiness signal. Wait for the
  // document and the account-specific UI that this test actually depends on.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText(`晚上好，${displayName}`).waitFor()
  await page.getByText(openAiHost, { exact: true }).waitFor()
  await page.getByRole('button', { name: '查看调用方法' }).click()
  const usageGuide = page.getByRole('region', { name: 'Online Host 调用方法' })
  await usageGuide.getByText('GET /models', { exact: true }).waitFor()
  await usageGuide.getByText('POST /responses', { exact: true }).waitFor()
  await usageGuide.getByText('POST /chat/completions', { exact: true }).waitFor()
  await usageGuide.getByText('/v1/models', { exact: true }).waitFor()

  const hostToggle = page.locator('.host-toggle')
  await hostToggle.click()
  await page.getByText('Online Host 已关闭。').waitFor()
  await hostToggle.click()
  await page.getByText(/已发送开启请求|Online Host 已开启并通过真实连通检查/).waitFor({ timeout: 10_000 })

  const disableResponse = await context.request.post(`/api/v1/hosts/${createdHost.id}/disable`, { headers: csrfHeaders })
  assert.equal(disableResponse.status(), 200)
  assert.equal((await disableResponse.json()).status, 'disabled')
  const revokeResponse = await context.request.delete(`/api/v1/devices/${device.id}`, { headers: csrfHeaders })
  assert.equal(revokeResponse.status(), 204)

  await page.getByTitle('退出登录').click()
  const landingSignIn = page.getByRole('button', { name: '登录' }).first()
  await landingSignIn.waitFor()
  await landingSignIn.click()
  const loginDialog = page.getByRole('dialog', { name: '登录' })
  await loginDialog.getByLabel('用户名').fill(username)
  await loginDialog.getByLabel('密码', { exact: true }).fill(password)
  await loginDialog.getByRole('checkbox').check()
  await loginDialog.getByRole('button', { name: /进入控制台/ }).click()
  await page.getByText(`晚上好，${displayName}`).waitFor()
  const secondRefreshResponse = await context.request.post('/api/v1/auth/refresh', {
    headers: { 'X-CSRF-Token': await currentCsrfToken() },
  })
  assert.equal(secondRefreshResponse.status(), 200)
  const secondSession = await secondRefreshResponse.json()
  assert.match(secondSession.csrfToken, /^csrf_/)
  assert.equal('accessToken' in secondSession, false, 'Browser refreshes must keep bearer tokens in HttpOnly cookies')
  const persistedDevicesResponse = await context.request.get('/api/v1/devices')
  const persistedHostsResponse = await context.request.get('/api/v1/hosts')
  assert.equal(persistedDevicesResponse.status(), 200)
  assert.equal(persistedHostsResponse.status(), 200)
  const persistedDevices = await persistedDevicesResponse.json()
  const persistedHosts = await persistedHostsResponse.json()
  assert.equal(persistedDevices.find((entry) => entry.id === device.id)?.status, 'revoked')
  assert.equal(persistedHosts.find((entry) => entry.id === createdHost.id)?.status, 'disabled')
  await page.getByText(openAiHost, { exact: true }).waitFor()

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join('; ')}`)
  await page.screenshot({ path: fileURLToPath(new URL('full-stack.png', resultsDir)), fullPage: true })
  console.log(JSON.stringify({ ok: true, username, recoveryEmail: null, openAiHost, pairingReplayRejected: true }))
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL('failure.png', resultsDir)), fullPage: true }).catch(() => {})
  throw error
} finally {
  await context.close()
  await browser.close()
}
