/**
 * walkWalls.test.ts - WALK's grid walls: a wall of height h carries h lines
 * in every 10 cells each way, evenly spaced, so a harder wall is denser; where
 * lines crowd under GRID_MIN_PX they thin out instead of filling in; and the
 * walls draw after the shards, so depth decides which is in front.
 */
import { describe, expect, it } from 'vitest'
import { GRID_MIN_PX, GRID_SPAN_CELLS, WALL_RENDER_ORDER, gridLod, gridPeriod } from '../Rooms'

describe('gridPeriod', () => {
  it('puts h lines in every 10 cells', () => {
    expect(GRID_SPAN_CELLS).toBe(10)
    expect(gridPeriod(1)).toBe(10)
    expect(gridPeriod(5)).toBe(2)
    expect(GRID_SPAN_CELLS / gridPeriod(27)).toBeCloseTo(27)
  })

  it('is denser the harder the wall', () => {
    expect(gridPeriod(6)).toBeLessThan(gridPeriod(5))
  })
})

describe('gridLod', () => {
  it('draws every line at GRID_MIN_PX apart or wider', () => {
    expect(gridLod(GRID_MIN_PX)).toEqual({ every: 1, between: 1 })
    expect(gridLod(40)).toEqual({ every: 1, between: 1 })
  })

  it('fades every other line out as the spacing halves', () => {
    const just = gridLod(GRID_MIN_PX * 0.999)
    expect(just.every).toBe(2)
    expect(just.between).toBeGreaterThan(0.99)
    const half = gridLod(GRID_MIN_PX / Math.SQRT2)
    expect(half.every).toBe(2)
    expect(half.between).toBeCloseTo(0.5)
  })

  it('keeps thinning: lines a quarter as far apart keep one in four', () => {
    const q = gridLod(GRID_MIN_PX / 4)
    expect(q.every).toBe(8)
    expect(q.between).toBeCloseTo(1)
  })

  it('never draws a full-strength line closer than GRID_MIN_PX', () => {
    for (const px of [2.9, 2, 1.3, 0.7, 0.2, 0.05]) {
      const { every } = gridLod(px)
      expect(every * px).toBeGreaterThanOrEqual(GRID_MIN_PX)
    }
  })

  it('is continuous where a level hands over to the next', () => {
    const below = gridLod(GRID_MIN_PX / 2 + 1e-9)
    const above = gridLod(GRID_MIN_PX / 2 - 1e-9)
    // Just wider than half: every other line, the in-between ones nearly gone.
    expect(below.every).toBe(2)
    expect(below.between).toBeLessThan(0.01)
    // Just narrower: every fourth line, the in-between (old every-other) at full.
    expect(above.every).toBe(4)
    expect(above.between).toBeGreaterThan(0.99)
  })
})

describe('wall render order', () => {
  it('draws walls after the shards, which sort at the default order', () => {
    expect(WALL_RENDER_ORDER).toBeGreaterThan(0)
  })
})
