import { describe, expect, it } from 'vitest'
import { buildMovePlan, nextStep, planSummary, routeNeedsCloud, type Ceilings } from './movePlan'

/** This machine hops to 2^18 and sidesteps to 2^23; HOSAKA hops to 2^27. */
const base = { hop: 18, sidestep: 23, cloudHop: 27, cloudSidestep: 29 }
const cheapest: Ceilings = { ...base, offloadFrom: Infinity }
// Measured for this machine and this provider (lib/crossover): from h21 up.
const fastest: Ceilings = { ...base, offloadFrom: 21 }

const at = (x: bigint): { x: bigint; y: bigint; z: bigint } => ({ x, y: 1n << 84n, z: 1n << 84n })

// A crossing this machine can only sidestep: above its hop ceiling, inside
// its sidestep ceiling, and inside HOSAKA's hop cap.
const from = at(1n << 84n)
const to = at((1n << 84n) ^ (1n << 21n))

describe('the route profile', () => {
  it('cheapest walks it: this machine sidesteps across, and pays nothing', () => {
    const step = nextStep(from, to, cheapest)
    expect(step?.source).toBe('local')
    expect(routeNeedsCloud(from, to, cheapest)).toBe(false)
    expect(planSummary(from, to, cheapest).cloudSteps).toBe(0)
  })

  it('fastest buys it: one paid hop instead of the walk', () => {
    const step = nextStep(from, to, fastest)
    expect(step?.source).toBe('cloud')
    expect(step?.kind).toBe('hop')
    expect(routeNeedsCloud(from, to, fastest)).toBe(true)
    // And it is the whole crossing in one step, not a step toward a wall.
    expect(step?.to.x).toBe(to.x)
  })

  it('fastest is fewer steps for the same journey', () => {
    const walked = buildMovePlan(from, to, cheapest).length
    const bought = buildMovePlan(from, to, fastest).length
    expect(walked).toBeGreaterThan(bought)
    expect(bought).toBe(1)
  })

  it('neither profile pays for a hop this machine can make', () => {
    const near = at((1n << 84n) ^ (1n << 12n))
    for (const c of [cheapest, fastest]) {
      const step = nextStep(from, near, c)
      expect(step?.source).toBe('local')
      expect(step?.kind).toBe('hop')
    }
  })

  it('a boundary above every cloud cap is nobody’s, under either profile', () => {
    const far = at((1n << 84n) ^ (1n << 40n))
    for (const c of [cheapest, fastest]) {
      expect(nextStep(far, from, c)?.source).toBe('infeasible')
    }
  })

  it('with no cloud, the profile changes nothing', () => {
    const alone: Ceilings = { hop: 18, sidestep: 23, cloudHop: 0, cloudSidestep: 0, offloadFrom: 21 }
    const step = nextStep(from, to, alone)
    expect(step?.source).toBe('local')
    expect(routeNeedsCloud(from, to, alone)).toBe(false)
  })

  it('a boundary above HOSAKA’s hop is walked to and sidestepped across, either way', () => {
    // h28: past this machine entirely and past HOSAKA's hop cap of 27, so no
    // one can hop it. Both profiles walk to the wall and pay for the crossing.
    const over = at((1n << 84n) ^ (1n << 28n))
    for (const c of [cheapest, fastest]) {
      expect(nextStep(from, over, c)?.source).toBe('local')
      const summary = planSummary(from, over, c)
      expect(summary.cloudSteps).toBeGreaterThan(0)
    }
  })

  it('fastest decides on the crossing, not on the step in hand', () => {
    // The first step toward the wall is an ordinary local hop; taking it
    // because it is local would walk the whole way there before the choice
    // ever came up. Under fastest the paid hop is offered immediately.
    expect(nextStep(from, to, cheapest)?.kind).toBe('hop')
    expect(nextStep(from, to, cheapest)?.source).toBe('local')
    expect(nextStep(from, to, fastest)?.source).toBe('cloud')
  })
})
