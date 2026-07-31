import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LandingPage from './LandingPage'

describe('LandingPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('agent-gateway-language', 'en')
    window.localStorage.setItem('agent-gateway-theme', 'dark')
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    })
  })

  it('persists theme and language choices and forwards the selected authentication mode', async () => {
    const actor = userEvent.setup()
    const onAuthenticate = vi.fn()
    render(<LandingPage onAuthenticate={onAuthenticate} />)

    const page = screen.getByTestId('landing-page')
    expect(page.getAttribute('data-theme')).toBe('dark')
    fireEvent.pointerMove(page, { clientX: 120, clientY: 240 })
    expect(page.style.getPropertyValue('--pointer-x')).toBe('120px')

    await actor.click(screen.getByRole('button', { name: 'Switch to light mode' }))
    expect(page.getAttribute('data-theme')).toBe('light')
    expect(window.localStorage.getItem('agent-gateway-theme')).toBe('light')

    await actor.selectOptions(screen.getByRole('combobox', { name: 'Choose language' }), 'zh')
    expect(window.localStorage.getItem('agent-gateway-language')).toBe('zh')
    expect(document.documentElement.lang).toBe('zh-CN')

    await actor.click(screen.getAllByRole('button', { name: '注册' })[0])
    expect(onAuthenticate).toHaveBeenLastCalledWith('register', 'zh')
    await actor.click(screen.getAllByRole('button', { name: /登录/ })[0])
    expect(onAuthenticate).toHaveBeenLastCalledWith('login', 'zh')
  })

  it('switches every documented code sample and local or Online Host mode', async () => {
    const actor = userEvent.setup()
    render(<LandingPage onAuthenticate={vi.fn()} />)

    expect(screen.getByLabelText('API example').textContent).toContain('from openai import OpenAI')
    await actor.click(screen.getByRole('tab', { name: 'JavaScript' }))
    expect(screen.getByLabelText('API example').textContent).toContain('import OpenAI from "openai"')
    await actor.click(screen.getByRole('tab', { name: 'cURL' }))
    expect(screen.getByLabelText('API example').textContent).toContain('curl "http://127.0.0.1:4310/v1/responses"')
    await actor.click(screen.getByRole('tab', { name: 'Streaming' }))
    expect(screen.getByLabelText('API example').textContent).toContain('stream=True')

    await actor.click(screen.getByRole('button', { name: 'Online Host' }))
    expect(screen.getByText('https://your-public-host.example/v1')).toBeTruthy()
    expect(screen.getByText('Explicit user opt-in')).toBeTruthy()
    expect(screen.getByLabelText('API example').textContent).toContain('https://your-public-host.example/v1')
    await actor.click(screen.getByRole('button', { name: 'Local Host' }))
    expect(screen.getByText('Available locally')).toBeTruthy()
  })

  it('reports clipboard success and failure through an accessible status message', async () => {
    const actor = userEvent.setup()
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<LandingPage onAuthenticate={vi.fn()} />)

    await actor.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByText('Code copied')).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('http://127.0.0.1:4310/v1'))
    await actor.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByText('Clipboard unavailable')).toBeTruthy()
  })

  it('updates reading progress, active navigation, and reveal state on browser events', async () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 })
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const section = this.dataset.landingSection
      return { top: section === 'security' ? 200 : 800 } as DOMRect
    })
    render(<LandingPage onAuthenticate={vi.fn()} />)

    fireEvent.scroll(window)
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Security' })[0].className).toContain('active'))
    const progress = document.querySelector<HTMLElement>('.landing-progress')
    expect(progress?.style.transform).toBe('scaleX(0.5)')
    expect(document.querySelectorAll('.landing-reveal:not(.is-visible)')).toHaveLength(0)
    rect.mockRestore()
  })

  it('initializes and cleans up the optional canvas animation in a real browser environment', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Chrome')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 480 })
    const context = {
      setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      fillStyle: '', strokeStyle: '', lineWidth: 0,
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    let draw: FrameRequestCallback | undefined
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      draw ??= callback
      return 1
    })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

    const view = render(<LandingPage onAuthenticate={vi.fn()} />)
    expect(context.setTransform).toHaveBeenCalled()
    draw?.(0)
    expect(context.clearRect).toHaveBeenCalled()
    expect(context.arc).toHaveBeenCalled()
    expect(requestFrame).toHaveBeenCalled()

    view.unmount()
    expect(cancelFrame).toHaveBeenCalledWith(1)
  })
})
