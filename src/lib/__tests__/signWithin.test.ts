/**
 * signWithin.test.ts - a remote signer that never answers fails within its
 * patience instead of hanging what awaited it; a prompt one is untouched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onSignerAnswered, SIGN_PATIENCE_MS, SignerTimeout, signWithin } from '../signWithin'

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

/**
 * A relay's AUTH takes a signature that comes after the limit (relay.ts
 * authSign): a bunker slower than 15 s otherwise never signed the canonical
 * relay in, and every list it gates stayed empty (HIDDEN BAGS, 2026-11-04).
 */
describe('a signature after the limit', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const signed = { ...template, id: 'x', pubkey: 'p', sig: 's' }
  const after = (ms: number) => ({ signEvent: () => new Promise((r) => setTimeout(() => r(signed as never), ms)) as never })

  it('still fails the wait at the limit, and hands the late signature to `late`', async () => {
    const late = vi.fn()
    const wait = signWithin(after(SIGN_PATIENCE_MS + 5_000), template, SIGN_PATIENCE_MS, late)
    const failed = expect(wait).rejects.toBeInstanceOf(SignerTimeout)
    await vi.advanceTimersByTimeAsync(SIGN_PATIENCE_MS + 1)
    await failed
    expect(late).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(late).toHaveBeenCalledWith(signed)
  })

  it('does not call `late` for a signature in time', async () => {
    const late = vi.fn()
    const wait = signWithin(after(1_000), template, SIGN_PATIENCE_MS, late)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(wait).resolves.toBe(signed)
    await vi.advanceTimersByTimeAsync(SIGN_PATIENCE_MS)
    expect(late).not.toHaveBeenCalled()
  })

  it('says the signer answered, in time or late, and not when it refused', async () => {
    const heard = vi.fn()
    const off = onSignerAnswered(heard)
    await expect(signWithin({ signEvent: async () => signed as never }, template)).resolves.toBe(signed)
    expect(heard).toHaveBeenCalledTimes(1)
    const wait = signWithin(after(SIGN_PATIENCE_MS + 1_000), template, SIGN_PATIENCE_MS, () => {})
    const failed = expect(wait).rejects.toBeInstanceOf(SignerTimeout)
    await vi.advanceTimersByTimeAsync(SIGN_PATIENCE_MS + 1_000)
    await failed
    expect(heard).toHaveBeenCalledTimes(2)
    await expect(signWithin({ signEvent: async () => { throw new Error('denied') } }, template)).rejects.toThrow('denied')
    expect(heard).toHaveBeenCalledTimes(2)
    off()
  })
})
