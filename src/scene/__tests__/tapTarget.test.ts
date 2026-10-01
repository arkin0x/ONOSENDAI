/**
 * tapTarget.test.ts: what can be tapped in the world. A shard too small to
 * see takes no taps; a small visible one gets a fingertip-sized target; a
 * large one's target is exactly what it draws (arkinox, 2026-09-30).
 */

import { describe, expect, it } from 'vitest'
import { MAX_EXTENT } from 'sno-core/shards'
import { MAX_SCREENS, MAX_VIEWPORT_PX, MIN_TARGET_PX, MIN_VISIBLE_PX, farCullDoublings, pxPerUnit, targetSpan } from '../TapTarget'
import { CAMERA_NEAR, FOV } from '../camera'

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

describe('the far bound (arkinox, 2026-10-01)', () => {
  // The largest model, along its diagonal, at the nearest drawn distance on the tallest screen.
  const worstPx = (doublings: number): number => Math.sqrt(3) * (2 * MAX_EXTENT + 1) * 2 ** -doublings * pxPerUnit(FOV, MAX_VIEWPORT_PX, CAMERA_NEAR)

  it('is 22 doublings at the shipped constants', () => {
    expect(farCullDoublings()).toBe(22)
  })

  it('is the tightest safe value: the worst case still shows at one less, and cannot at the bound', () => {
    const n = farCullDoublings()
    expect(worstPx(n - 1)).toBeGreaterThanOrEqual(MIN_VISIBLE_PX)
    expect(worstPx(n)).toBeLessThan(MIN_VISIBLE_PX)
  })
})

describe('too big to tap', () => {
  it('a shard wider than MAX_SCREENS screens takes no taps; one just under still does', () => {
    const viewport = 844
    expect(targetSpan([3, 1, 1], 1000, viewport)).toBeNull()
    expect(targetSpan([MAX_SCREENS * viewport / 1000 - 0.01, 1, 1], 1000, viewport)).not.toBeNull()
  })
})
