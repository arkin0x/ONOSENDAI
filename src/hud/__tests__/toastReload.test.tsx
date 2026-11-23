/**
 * toastReload.test.tsx - a toast for a state only a fresh load gets out of
 * (a chain held, a saved chain cleared) carries a RELOAD button.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// A server render reads a zustand store's initial state; here each hook
// reads the live state, as a mounted component in the browser does.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { ToastChip } from '../ToastChip'
import { useToast } from '../../store/useToast'

describe('a toast that only a reload gets out of', () => {
  it('carries a RELOAD button; one without the flag does not', () => {
    useToast.getState().show({ label: 'CHAIN HELD', meta: 'Another tab moved first.', mark: 'block', sticky: true, reload: true })
    expect(renderToStaticMarkup(<ToastChip />)).toContain('>RELOAD</button>')
    useToast.getState().show({ label: 'STORE ROWS', meta: 'probe pass', mark: 'build', sticky: true })
    expect(renderToStaticMarkup(<ToastChip />)).not.toContain('RELOAD')
  })
})
