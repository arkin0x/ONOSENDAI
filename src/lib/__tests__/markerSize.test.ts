/**
 * Stop markers and their labels are sized on screen (arkinox, 2026-10-15):
 * a cube is its true size when that is larger, else a fixed pixel size, and
 * its label sits just above its top at every zoom.
 */
import { describe, expect, it } from 'vitest'
import { CUBE_REACH, DEST_CUBE_PX, FLEET_CUBE_PX, CREDIT_FADE, LABEL_GAP_PX, MARK_RECEDE_FLOOR, NAME_FADE, fadeShare, cellsForPixels, labelLiftPx, markerSide, pixelsForCells, projScaleOf, recedeShare } from '../markerSize'

const proj = projScaleOf(915, 55)

describe('markers held at a size on screen', () => {
  it('pixels and cells convert both ways at any depth', () => {
    for (const depth of [0.5, 3, 26, 400]) {
      expect(pixelsForCells(cellsForPixels(12, depth, proj), depth, proj)).toBeCloseTo(12, 9)
    }
  })

  it('a sub-pixel gibson (2^84) is drawn at the pixel size, the same on screen near or far', () => {
    const gibson = 2 ** -84
    for (const depth of [0.8, 5, 60]) {
      expect(pixelsForCells(markerSide(gibson, DEST_CUBE_PX, depth, proj), depth, proj)).toBeCloseTo(DEST_CUBE_PX, 6)
      expect(pixelsForCells(markerSide(gibson * 0.5, FLEET_CUBE_PX, depth, proj), depth, proj)).toBeCloseTo(FLEET_CUBE_PX, 6)
    }
  })

  it('a gibson larger on screen than the floor (2^0, close) keeps its true size', () => {
    expect(markerSide(1, DEST_CUBE_PX, 2, proj)).toBe(1)
  })

  it("lifts a label by the marker's reach on screen plus a gap plus half the label", () => {
    const lift = labelLiftPx(2 ** -84, FLEET_CUBE_PX, 4, proj, 9)
    expect(lift).toBeCloseTo(FLEET_CUBE_PX * CUBE_REACH + LABEL_GAP_PX + 4.5, 9)
    // The same few pixels at 2^84 and at 2^76: the gap no longer grows with the zoom.
    expect(labelLiftPx(2 ** -76, FLEET_CUBE_PX, 30, proj, 9)).toBeCloseTo(lift, 6)
    // A true-size cube larger than the floor lifts its label above its own top.
    const big = labelLiftPx(1, FLEET_CUBE_PX, 2, proj, 9)
    expect(big).toBeCloseTo(pixelsForCells(1, 2, proj) * CUBE_REACH + LABEL_GAP_PX + 4.5, 9)
  })

  it('the destination stands out but does not dominate', () => {
    expect(DEST_CUBE_PX).toBeGreaterThan(FLEET_CUBE_PX)
    expect(DEST_CUBE_PX).toBeLessThanOrEqual(2 * FLEET_CUBE_PX)
  })
})

/**
 * A hidden item's mark recedes with distance (arkinox, 2026-10-25: "the chest
 * marker does not scale with distance. it needs to. its too large at large
 * distances").
 */
describe('a hidden item mark recedes past the reach', () => {
  // WALK's reach: the headlamp's least, 8 cells (scene/headlamp.ts REACH_MIN).
  const reach = 8

  it('is full size anywhere within the reach, near or at it', () => {
    for (const depth of [0.05, 1, 4, 8]) {
      expect(recedeShare(depth, reach, MARK_RECEDE_FLOOR)).toBe(1)
    }
  })

  it('shrinks as reach over depth past it: twice the reach is half the size', () => {
    expect(recedeShare(16, reach, 0)).toBeCloseTo(0.5, 12)
    expect(recedeShare(10, reach, MARK_RECEDE_FLOOR)).toBeCloseTo(0.8, 12)
  })

  it('never grows with distance', () => {
    let last = Infinity
    for (let depth = 0.5; depth < 400; depth *= 1.3) {
      const share = recedeShare(depth, reach, MARK_RECEDE_FLOOR)
      expect(share).toBeLessThanOrEqual(last)
      last = share
    }
  })

  it('stops at its floor far off, so a mark never vanishes', () => {
    expect(recedeShare(1e6, reach, MARK_RECEDE_FLOOR)).toBe(MARK_RECEDE_FLOOR)
  })

  it('keeps its shape at every zoom: the same share at the same depth in reaches', () => {
    for (const r of [8, 26, 96]) {
      expect(recedeShare(r * 2, r, 0)).toBeCloseTo(0.5, 12)
      expect(recedeShare(r, r, 0)).toBe(1)
    }
  })

  it('is full size for a depth or reach it cannot use', () => {
    expect(recedeShare(Number.NaN, reach, MARK_RECEDE_FLOOR)).toBe(1)
    expect(recedeShare(20, 0, MARK_RECEDE_FLOOR)).toBe(1)
    expect(recedeShare(20, Number.NaN, MARK_RECEDE_FLOOR)).toBe(1)
  })
})

/**
 * A mark's words keep their size and fade far off instead of shrinking past
 * legible, the credit line before the name (review of #518).
 */
describe('a hidden item label fades far off', () => {
  const reach = 8

  it('is whole out to where its fade begins, near or at the reach', () => {
    for (const depth of [0.05, 4, 8, 8 * CREDIT_FADE[0]]) expect(fadeShare(depth, reach, CREDIT_FADE[0], CREDIT_FADE[1])).toBe(1)
    for (const depth of [0.05, 8, 16, 8 * NAME_FADE[0]]) expect(fadeShare(depth, reach, NAME_FADE[0], NAME_FADE[1])).toBe(1)
  })

  it('is gone at and past where its fade ends: the credit past twice the reach, the name past three times', () => {
    expect(CREDIT_FADE[1]).toBe(2)
    expect(NAME_FADE[1]).toBe(3)
    for (const depth of [16, 20, 400]) expect(fadeShare(depth, reach, CREDIT_FADE[0], CREDIT_FADE[1])).toBe(0)
    for (const depth of [24, 30, 400]) expect(fadeShare(depth, reach, NAME_FADE[0], NAME_FADE[1])).toBe(0)
  })

  it('fades smoothly and never comes back with distance', () => {
    let last = 2
    for (let depth = 10; depth <= 26; depth += 0.25) {
      const a = fadeShare(depth, reach, CREDIT_FADE[0], CREDIT_FADE[1])
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(1)
      expect(a).toBeLessThanOrEqual(last)
      last = a
    }
    // Halfway through its fade, half shown (smoothstep is symmetric).
    expect(fadeShare(8 * 1.75, reach, 1.5, 2)).toBeCloseTo(0.5, 12)
  })

  it('drops the credit line wholly before the name begins to fade', () => {
    expect(CREDIT_FADE[1]).toBeLessThanOrEqual(NAME_FADE[0])
    for (let depth = 0; depth <= 40; depth += 0.5) {
      expect(fadeShare(depth, reach, CREDIT_FADE[0], CREDIT_FADE[1])).toBeLessThanOrEqual(fadeShare(depth, reach, NAME_FADE[0], NAME_FADE[1]))
    }
  })

  it('keeps its shape at every reach, and is whole for a reach it cannot use', () => {
    for (const r of [8, 26, 96]) expect(fadeShare(r * 1.75, r, 1.5, 2)).toBeCloseTo(0.5, 12)
    expect(fadeShare(50, 0, 1.5, 2)).toBe(1)
    expect(fadeShare(50, Number.NaN, 1.5, 2)).toBe(1)
    expect(fadeShare(Number.NaN, reach, 1.5, 2)).toBe(1)
  })
})
