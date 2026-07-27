import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  document.cookie = 'ccc_platform_csrf=; Max-Age=0; Path=/'
})
