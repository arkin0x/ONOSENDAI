/**
 * walkWalls.test.ts - WALK's striped walls: a wall of height h carries h
 * stripes in every 10 cells, evenly spaced, so a harder wall is denser.
 */
import { describe, expect, it } from 'vitest'
import { STRIPE_SPAN_CELLS, stripePeriod } from '../Rooms'

describe('stripePeriod', () => {
  it('puts h stripes in every 10 cells', () => {
    expect(STRIPE_SPAN_CELLS).toBe(10)
    expect(stripePeriod(1)).toBe(10)
    expect(stripePeriod(5)).toBe(2)
    expect(STRIPE_SPAN_CELLS / stripePeriod(27)).toBeCloseTo(27)
  })

  it('is denser the harder the wall', () => {
    expect(stripePeriod(6)).toBeLessThan(stripePeriod(5))
  })
})
