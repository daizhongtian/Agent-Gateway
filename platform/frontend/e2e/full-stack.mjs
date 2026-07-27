import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const baseUrl = process.env.PLATFORM_E2E_URL ?? 'http://localhost:8088'
const executablePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const email = `e2e.${Date.now()}@example.com`
const password = 'e2e-secure-password-2026'
const displayName = 'E2E Tester'
const resultsDir = new URL('../test-results/', import.meta.url)

await mkdir(resultsDir, { recursive: true })

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({ baseURL: baseUrl, locale: 'zh-CN' })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

try {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByLabel('显示名称').fill(displayName)
  await page.getByLabel('电子邮箱').fill(email)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: /创建账户/ }).click()
  await page.getByText(`晚上好，${displayName}`).waitFor()

  await page.getByRole('button', { name: /添加设备/ }).first().click()
  const deviceForm = page.locator('#devices form.inline-form')
  await deviceForm.getByLabel('设备名称').fill('E2E Windows PC')
  await deviceForm.getByRole('button', { name: '添加设备' }).click()
  const deviceRow = page.locator('.device-row').filter({ hasText: 'E2E Windows PC' })
  await deviceRow.waitFor()
  await deviceRow.getByRole('button', { name: /配对码/ }).click()
  const pairingCode = (await page.locator('.pair-code').innerText()).trim()
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(pairingCode)) {
    throw new Error(`Unexpected pairing code: ${pairingCode}`)
  }
  await page.locator('.modal-close').click()

  await page.getByRole('button', { name: /新建 Host/ }).click()
  const hostForm = page.locator('#hosts form.inline-form')
  await hostForm.getByLabel('Host 名称').fill('E2E Public Host')
  await hostForm.getByRole('button', { name: '预留地址' }).click()
  const hostCard = page.locator('.host-card').filter({ hasText: 'E2E Public Host' })
  await hostCard.waitFor()
  const openAiHost = (await hostCard.locator('.endpoint-box code').innerText()).trim()
  if (!/^https:\/\/h-[a-z0-9-]+\.api\.test\.local\/v1$/.test(openAiHost)) {
    throw new Error(`Unexpected OPENAI HOST address: ${openAiHost}`)
  }

  const pairResponse = await fetch(`${baseUrl}/api/v1/desktop/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: pairingCode,
      publicKey: '-----BEGIN PUBLIC KEY-----e2e-browser-key-material-----END PUBLIC KEY-----',
      appVersion: 'e2e-1.0.0',
      platform: 'windows',
    }),
  })
  if (pairResponse.status !== 200) throw new Error(`Desktop pairing returned ${pairResponse.status}`)
  const paired = await pairResponse.json()
  if (!paired.deviceSecret?.startsWith('ccc_dev_')) throw new Error('Desktop pairing did not return a device secret')
  if (paired.hosts?.[0]?.openAiBaseUrl !== openAiHost) throw new Error('Paired Host address does not match the dashboard')

  const replayResponse = await fetch(`${baseUrl}/api/v1/desktop/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: pairingCode,
      publicKey: '-----BEGIN PUBLIC KEY-----e2e-browser-key-material-----END PUBLIC KEY-----',
      appVersion: 'e2e-1.0.0',
      platform: 'windows',
    }),
  })
  if (replayResponse.status !== 401) throw new Error(`Pairing code replay returned ${replayResponse.status}, expected 401`)

  await page.getByRole('button', { name: '刷新' }).click()
  await page.locator('.device-row .status-active').waitFor()
  await hostCard.getByRole('button', { name: '停用' }).click()
  await hostCard.locator('.status-disabled').waitFor()
  await hostCard.getByRole('button', { name: '启用' }).click()
  await hostCard.locator('.status-offline').waitFor()
  await hostCard.getByRole('button', { name: '停用' }).click()
  await hostCard.locator('.status-disabled').waitFor()

  page.once('dialog', (dialog) => dialog.accept())
  await deviceRow.locator('.danger-action').click()
  await page.locator('.device-row .status-revoked').waitFor()

  await page.getByTitle('退出登录').click()
  await page.getByRole('button', { name: '登录' }).waitFor()
  await page.getByLabel('电子邮箱').fill(email)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: /进入控制台/ }).click()
  await page.getByText(`晚上好，${displayName}`).waitFor()
  await page.locator('.device-row .status-revoked').waitFor()
  await page.locator('.host-card .status-disabled').waitFor()

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join('; ')}`)
  await page.screenshot({ path: fileURLToPath(new URL('full-stack.png', resultsDir)), fullPage: true })
  console.log(JSON.stringify({ ok: true, email, openAiHost, pairingReplayRejected: true }))
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL('failure.png', resultsDir)), fullPage: true }).catch(() => {})
  throw error
} finally {
  await context.close()
  await browser.close()
}
