import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import LegalPage, { legalDocumentFromPath } from './LegalPage'

describe('LegalPage', () => {
  it('maps only the two documented legal routes', () => {
    expect(legalDocumentFromPath('/legal/platform-terms')).toBe('platform-terms')
    expect(legalDocumentFromPath('/legal/platform-privacy')).toBe('platform-privacy')
    expect(legalDocumentFromPath('/legal/unknown')).toBeNull()
  })

  it('renders Chinese terms and switches the whole document to English', async () => {
    window.history.replaceState({}, '', '/legal/platform-terms?lang=zh')
    const actor = userEvent.setup()
    render(<LegalPage kind="platform-terms" />)

    expect(screen.getByRole('heading', { name: '平台服务条款与 Online Host 风险确认' })).toBeTruthy()
    expect(screen.getByText('Agent Gateway 开源项目个人维护者（非注册公司）')).toBeTruthy()
    await actor.click(screen.getByRole('button', { name: 'English' }))
    expect(screen.getByRole('heading', { name: 'Platform Terms and Online Host Risk Notice' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Read the Platform Privacy Notice/ }).getAttribute('href'))
      .toBe('/legal/platform-privacy?lang=en')
    expect(document.title).toBe('Platform Terms and Online Host Risk Notice · Agent Gateway')
  })

  it('renders English privacy content and switches back to Chinese', async () => {
    window.history.replaceState({}, '', '/legal/platform-privacy?lang=en')
    const actor = userEvent.setup()
    render(<LegalPage kind="platform-privacy" />)

    expect(screen.getByRole('heading', { name: 'Platform Privacy Notice' })).toBeTruthy()
    expect(screen.getByText('Cookies, local preferences, and telemetry')).toBeTruthy()
    await actor.click(screen.getByRole('button', { name: '简体中文' }))
    expect(screen.getByRole('heading', { name: '平台隐私说明' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /阅读平台服务条款/ }).getAttribute('href'))
      .toBe('/legal/platform-terms?lang=zh')
  })
})
