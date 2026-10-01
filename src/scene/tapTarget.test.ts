/**
 * tapTarget.test.ts: what can be tapped in the world. A shard too small to
 * see takes no taps; a small visible one gets a fingertip-sized target; a
 * large one's target is exactly what it draws (arkinox, 2026-09-30).
 */

import { describe, expect, it } from 'vitest'
import { MIN_TARGET_PX, MIN_VISIBLE_PX, pxPerUnit, targetSpan } from './TapTarget'

describe('pxPerUnit', () => {
  it('is the viewport height over the view height at that distance', () => {
    // fov 90: at distance 1 the view is 2 units tall.
    expect(pxPerUnit(90, 800, 1)).toBeCloseTo(400)
    expect(pxPerUnit(90, 800, 4)).toBeCloseTo(100)
  })
})

describe('targetSpan', () => {
  it('takes no taps under the visible floor: a speck zoomed out to 2^52', () => {
    expect(targetSpan([1e-9, 1e-9, 1e-9], 1000)).toBeNull()
    expect(targetSpan([0.003, 0.001, 0.001], 1000)).toBeNull()
  })

  it('a visible but small shard gets a fingertip-sized target', () => {
    const span = targetSpan([0.01, 0.005, 0.005], 1000)!
    for (const d of span) expect(d * 1000).toBeCloseTo(MIN_TARGET_PX)
  })

  it("a large shard's target is exactly what it draws, each axis on its own", () => {
    const span = targetSpan([2, 0.001, 1], 1000)!
    expect(span[0]).toBe(2)
    expect(span[2]).toBe(1)
    expect(span[1] * 1000).toBeCloseTo(MIN_TARGET_PX)
  })

  it('the floor sits where the drawn extent crosses MIN_VISIBLE_PX', () => {
    expect(targetSpan([MIN_VISIBLE_PX / 1000 - 1e-6, 0, 0], 1000)).toBeNull()
    expect(targetSpan([MIN_VISIBLE_PX / 1000, 0, 0], 1000)).not.toBeNull()
  })
})
