/**
 * viewWindowCarry.test.ts - the view window is carried across a landing's
 * small whole-cell shift, never across a jump (arkinox, 2026-10-15: stepping
 * the hyperspace scrubber from block 6 to block 7, two ports at random
 * coordinates, carried a fractional offset into the terrain volume's BigInt
 * and the scene and its GL context went down; Android's GPU process crashed).
 */
import { describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const { carriable, MAX_CARRY_CELLS } = await import('../useViewWindow')
const { originShift } = await import('../../lib/space')
const { useCyberspace } = await import('../../store/useCyberspace')

describe('carrying the view window', () => {
  it('carries a landing: a few whole cells', () => {
    expect(carriable(0)).toBe(true)
    expect(carriable(-3)).toBe(true)
    expect(carriable(MAX_CARRY_CELLS)).toBe(true)
  })

  it('never carries a fractional or huge shift', () => {
    expect(carriable(-560759003520296.06)).toBe(false)
    expect(carriable(0.5)).toBe(false)
    expect(carriable(MAX_CARRY_CELLS + 1)).toBe(false)
    expect(carriable(Number.NaN)).toBe(false)
  })

  it('a jump between two ideaspace ports at 2^34 is not carriable', () => {
    // Blocks 6 and 7: two ports, random 2^85 coordinates.
    const a = { x: 0x1d5a3c27e6f0b9n * 1024n, y: 0x0a2e9f31cc04d1n * 4096n, z: 0x13f00be7a9d2c5n * 2048n }
    const b = { x: 0x0b9e4d00a17f33n * 8192n, y: 0x1fe2c4a0937b18n * 512n, z: 0x07c3d9e21b44a0n * 16384n }
    const shift = originShift(a, b, 34, useCyberspace.getState().axes())
    expect(shift.every(carriable)).toBe(false)
  })
})
