/**
 * What these prove: the two claims the density label under the ring makes.
 *
 * "1,000 of 24,318" is only honest if the second number is COUNTED and not
 * projected. It is, because inside a sphere the stop field turns its identity
 * prefilter off and decodes every in-plane row in the ball cover: the test
 * below pins that to the property that makes it true, which is that ADMIT_ALL
 * sits above the whole range of hashHeight, so the filter admits every row
 * there can ever be rather than merely every row seen so far.
 *
 * And the first number is the readable density: the same thousand the open
 * view is sized to (SPHERE_MAX_POINTS), so a sphere that holds 13,076
 * landfalls draws a thousand of them and says so, instead of drawing all of
 * them into a solid sheet. "133 of 133" is what a sphere with fewer than a
 * thousand inside reads.
 */
import { describe, expect, it } from 'vitest'
import { ADMIT_ALL, MAX_POINTS, SPHERE_MAX_POINTS } from './StopField'
import { hashHeight } from '../lib/hyperspace/sample'
import { drawnSet } from '../lib/hyperspace/sample'
import { sphereSelection } from '../lib/hyperspace/interest'

describe('the sphere regime admits every row in the cover', () => {
  it('ADMIT_ALL is above the whole range of hashHeight, so nothing is filtered', () => {
    // hashHeight is a 32-bit avalanche returned through >>> 0, so its range is
    // 0 .. 2^32 - 1 and the threshold is 2^32 exactly.
    expect(ADMIT_ALL).toBe(2 ** 32)
    let max = 0
    // The chain is near a million blocks; walk well past it, and include the
    // edges of the 32-bit word where an avalanche is most likely to top out.
    for (let h = 0; h < 200_000; h++) max = Math.max(max, hashHeight(h))
    for (const h of [0, 1, 0xffff, 0x7fff_ffff, 0xffff_ffff, 2 ** 32 - 1]) {
      max = Math.max(max, hashHeight(h))
      expect(hashHeight(h)).toBeLessThan(ADMIT_ALL)
    }
    expect(max).toBeLessThan(ADMIT_ALL)
    expect(max).toBeGreaterThan(2 ** 31)
  })

  it('the sphere budget is the readable thousand, the same as the open view', () => {
    // At 2^49 the sphere around a point on Earth held 13,076 landfalls and at
    // 2^48 3,276; drawn whole at five pixels under the bloom they were a
    // solid sheet (arkinox, 2026-09-24). The budget is the density a person
    // can read, and the label carries the rest: "1,000 of 13,076".
    expect(MAX_POINTS).toBe(1_000)
    expect(SPHERE_MAX_POINTS).toBe(MAX_POINTS)
    expect(SPHERE_MAX_POINTS).toBeLessThan(3_276)
  })

  it('one budget for the whole regime keeps the sample nested as you zoom in', () => {
    // A smaller sphere's candidates are a subset of a larger one's, and the
    // budget does not move, so no dot that stays inside is ever re-dealt: a
    // height drawn in the large sphere is drawn in the small one. The small
    // sphere fills its budget from fewer candidates, so it may draw MORE;
    // zooming in only ever adds dots, never takes one away.
    const big = Array.from({ length: 5_000 }, (_, i) => i * 7)
    const small = big.filter((_, i) => i % 3 === 0)
    const drawnBig = drawnSet(big, SPHERE_MAX_POINTS)
    const drawnSmall = drawnSet(small, SPHERE_MAX_POINTS)
    for (const h of small) if (drawnBig.has(h)) expect(drawnSmall.has(h)).toBe(true)
    expect(drawnBig.size).toBe(SPHERE_MAX_POINTS)
    expect(drawnSmall.size).toBe(SPHERE_MAX_POINTS)
    expect(drawnSmall.size).toBeGreaterThan([...small].filter((h) => drawnBig.has(h)).length)
  })

  it('the cap still bounds the buffer when a sphere really does hold more', () => {
    const heights = Array.from({ length: SPHERE_MAX_POINTS * 2 }, (_, i) => i)
    // Squared distances well above SELF_GIBSONS squared, or every candidate
    // would be read as the centre's own stop and passed over.
    const d2 = heights.map((_, i) => BigInt(i + 1) * (1n << 70n))
    const sel = sphereSelection(heights, d2, SPHERE_MAX_POINTS)
    // The budget, plus at most the nearest riding on top of it.
    expect(sel.drawn.size).toBeGreaterThanOrEqual(SPHERE_MAX_POINTS)
    expect(sel.drawn.size).toBeLessThanOrEqual(SPHERE_MAX_POINTS + 1)
    // The nearest is drawn whatever its hash said.
    expect(sel.nearest?.height).toBe(heights[0])
    expect(sel.drawn.has(heights[0])).toBe(true)
  })
})
