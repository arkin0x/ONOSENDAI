/**
 * useProofListener.test.ts - the proof worker starts ahead of the first move,
 * so a deploy cannot take its file from under an open tab (lib/workers.ts).
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ preload: vi.fn(), setHandler: vi.fn(), cleanup: null as null | (() => void) }))
vi.mock('react', async (orig) => ({ ...(await orig() as object), useEffect: (fn: () => () => void) => { mocks.cleanup = fn() } }))
vi.mock('../../lib/workers', () => ({ preloadProofWorker: mocks.preload, setProofHandler: mocks.setHandler }))
vi.mock('../../store/useCyberspace', () => ({ useCyberspace: { getState: () => ({ applyProofMessage: vi.fn() }) } }))

import { useProofListener } from '../useProofListener'

beforeEach(() => { vi.useFakeTimers(); mocks.preload.mockClear(); mocks.setHandler.mockClear() })
afterEach(() => { vi.useRealTimers() })

it('starts the worker after the start-up burst, and not at all if it unmounts first', () => {
  useProofListener()
  expect(mocks.preload).not.toHaveBeenCalled()
  vi.advanceTimersByTime(10_000)
  expect(mocks.preload).toHaveBeenCalledTimes(1)
  useProofListener()
  mocks.cleanup?.()
  vi.advanceTimersByTime(10_000)
  expect(mocks.preload).toHaveBeenCalledTimes(1)
  expect(mocks.setHandler).toHaveBeenLastCalledWith(null)
})
