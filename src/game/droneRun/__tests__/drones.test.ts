import { describe, expect, it } from 'vitest'
import { SPECK_FROM, SPECK_FULL, SPECK_GONE, speckShare } from '../Drones'

describe('speckShare: the far drone speck', () => {
  it('shows nothing close, where the drone itself is plain to see', () => {
    expect(speckShare(5)).toBe(0)
    expect(speckShare(SPECK_FROM)).toBe(0)
  })
  it('is full from SPECK_FULL through 30 to 50 gibsons, where the fog takes the drone', () => {
    expect(speckShare(SPECK_FULL)).toBe(1)
    for (const d of [30, 40, 50]) expect(speckShare(d)).toBeGreaterThan(0.8)
  })
  it('grows smoothly between, and is gone past SPECK_GONE', () => {
    const mid = speckShare((SPECK_FROM + SPECK_FULL) / 2)
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThan(0.7)
    expect(speckShare(SPECK_GONE)).toBe(0)
    expect(speckShare(SPECK_GONE + 50)).toBe(0)
  })
})
