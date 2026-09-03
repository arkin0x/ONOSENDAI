/**
 * signWithin.test.ts - a remote signer that never answers fails within its
 * patience instead of hanging what awaited it; a prompt one is untouched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SIGN_PATIENCE_MS, SignerTimeout, signWithin } from './signWithin'

const template = { kind: 1, created_at: 1, tags: [], content: '' }

describe('signWithin', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('passes a prompt signature through', async () => {
    const signed = { ...template, id: 'x', pubkey: 'p', sig: 's' }
    await expect(signWithin({ signEvent: async () => signed as never }, template)).resolves.toBe(signed)
  })

  it('gives up on a signer that never answers, after its patience', async () => {
    const never = { signEvent: () => new Promise<never>(() => { /* the bunker is gone */ }) }
    const p = signWithin(never, template)
    const settled = vi.fn()
    p.then(settled, settled)
    await vi.advanceTimersByTimeAsync(SIGN_PATIENCE_MS - 1)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(p).rejects.toBeInstanceOf(SignerTimeout)
  })
})
