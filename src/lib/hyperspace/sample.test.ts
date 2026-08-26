import { describe, expect, it } from 'vitest'
import { drawnSet, hashHeight, projectedPopulation, sampleThreshold } from './sample'

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

describe('hashHeight', () => {
  it('is deterministic', () => {
    expect(hashHeight(431799)).toBe(hashHeight(431799))
    expect(hashHeight(0)).toBe(hashHeight(0))
  })

  it('spreads sequential heights uniformly', () => {
    const buckets = new Array(16).fill(0)
    for (let h = 0; h < 100_000; h++) buckets[hashHeight(h) >>> 28]++
    // 6250 expected per bucket; sequential inputs must not clump.
    for (const b of buckets) {
      expect(b).toBeGreaterThan(5000)
      expect(b).toBeLessThan(7500)
    }
  })
})

describe('sampleThreshold', () => {
  it('admits everything when the population fits', () => {
    expect(sampleThreshold(5000, 9000)).toBe(0x1_0000_0000)
  })

  it('admits about the budget otherwise', () => {
    const t = sampleThreshold(950_000, 18_000)
    let kept = 0
    for (let h = 0; h < 950_000; h++) if (hashHeight(h) < t) kept++
    expect(kept).toBeGreaterThan(16_000)
    expect(kept).toBeLessThan(20_000)
  })

  it('only tightens as the population grows', () => {
    let prev = Infinity
    for (const n of [10_000, 50_000, 200_000, 950_000]) {
      const t = sampleThreshold(n, 18_000)
      expect(t).toBeLessThanOrEqual(prev)
      prev = t
    }
  })
})

describe('drawnSet', () => {
  it('draws everything under budget, exactly the budget over it', () => {
    expect(drawnSet(range(1000), 9000).size).toBe(1000)
    expect(drawnSet(range(50_000), 9000).size).toBe(9000)
  })

  it('is deterministic', () => {
    const a = drawnSet(range(30_000), 500)
    const b = drawnSet(range(30_000), 500)
    expect([...a].sort()).toEqual([...b].sort())
  })

  it('never reshuffles: a block drawn from the larger line was drawn from the smaller', () => {
    // The exact property the sync-time jank fix rests on: as the population
    // grows, dots may appear and the largest priorities may be evicted, but
    // no drawn block is ever swapped for a different equally valid sibling.
    const budget = 500
    const small = drawnSet(range(20_000), budget)
    const large = drawnSet(range(60_000), budget)
    for (const h of large) {
      if (h < 20_000) expect(small.has(h)).toBe(true)
    }
  })

  it('holds the nesting property across a whole simulated sync', () => {
    const budget = 300
    let prev = drawnSet(range(5_000), budget)
    for (const n of [9_000, 16_000, 28_000, 50_000]) {
      const next = drawnSet(range(n), budget)
      for (const h of next) {
        if (h < 5_000 && !prev.has(h)) throw new Error(`block ${h} reshuffled in at ${n}`)
      }
      // Walk the window forward: compare each step to the one before.
      prev = next
      break
    }
    // Stepwise: every consecutive pair, not just the ends.
    const sizes = [5_000, 9_000, 16_000, 28_000, 50_000]
    for (let i = 1; i < sizes.length; i++) {
      const a = drawnSet(range(sizes[i - 1]), budget)
      const b = drawnSet(range(sizes[i]), budget)
      for (const h of b) {
        if (h < sizes[i - 1]) expect(a.has(h)).toBe(true)
      }
    }
  })
})

describe('projectedPopulation', () => {
  it('is the identity once the line has fully loaded', () => {
    expect(projectedPopulation(1000, 900_000, 900_000)).toBe(1000)
    expect(projectedPopulation(1000, 0, 0)).toBe(1000)
  })

  it('scales the in-range count by the sync completeness', () => {
    expect(projectedPopulation(1000, 100_000, 900_000)).toBe(9000)
    expect(projectedPopulation(500, 450_000, 900_000)).toBe(1000)
  })

  it('never projects fewer than are already in range', () => {
    expect(projectedPopulation(1000, 900_000, 100)).toBe(1000)
  })

  it('holds the drawn set free of evictions across a whole sync', () => {
    const TOTAL = 900_000
    const BUDGET = 9_000
    let prev = new Set<number>()
    let evicted = 0
    for (let loaded = 50_000; loaded <= TOTAL; loaded += 50_000) {
      // Landfalls are the even heights; fmix32 is independent of parity.
      const inRange: number[] = []
      for (let h = 0; h < loaded; h += 2) inRange.push(h)
      const t = sampleThreshold(projectedPopulation(loaded, loaded, TOTAL), BUDGET * 2)
      const drawn = new Set(inRange.filter((h) => hashHeight(h) < t))
      for (const h of prev) if (!drawn.has(h)) evicted++
      expect(drawn.size).toBeGreaterThanOrEqual(prev.size)
      prev = drawn
    }
    expect(evicted).toBe(0)
    // And it converges on the budget rather than starving or overshooting it.
    expect(prev.size).toBeGreaterThan(BUDGET * 0.8)
    expect(prev.size).toBeLessThan(BUDGET * 1.2)
  })
})

describe('the field sizing, end to end', () => {
  // The globe view: every landfall is inside the coverage cubes, and almost
  // no port is, because a port's coordinate is its merkle root and lands
  // anywhere in the space. So the in-plane count is the landfall count and
  // the sorted view holds both planes.
  const TOTAL = 900_000
  const BUDGET = 5_000
  const sweep = (): Array<{ f: number; kept: number; drawn: Set<number> }> => {
    const out = []
    for (let step = 1; step <= 20; step++) {
      const f = step / 20
      const permCount = Math.round(TOTAL * f)
      const landfalls: number[] = []
      for (let h = 0; h < permCount; h += 2) landfalls.push(h)
      const projected = projectedPopulation(landfalls.length, permCount, TOTAL)
      const t = sampleThreshold(projected, BUDGET)
      const kept = landfalls.filter((h) => hashHeight(h) < t)
      out.push({ f, kept: kept.length, drawn: drawnSet(kept, Math.ceil(BUDGET * 1.1)) })
    }
    return out
  }

  it('projects the final in-plane population from the first frame', () => {
    for (const { f, kept } of sweep()) {
      // kept tracks the sync fraction and arrives at the budget, not past it.
      expect(kept).toBeLessThanOrEqual(BUDGET * 1.05)
      expect(kept).toBeGreaterThan(BUDGET * f * 0.9)
    }
  })

  it('never lets the budget cap become the decimation', () => {
    // A cap that bites is sized from kept.length, which moves every rebuild,
    // and that is the reshuffle: dots near the cut churn while the rest hold.
    for (const { kept, drawn } of sweep()) expect(drawn.size).toBe(kept)
  })

  it('evicts nothing across the whole sync', () => {
    let prev = new Set<number>()
    let evicted = 0
    for (const { drawn } of sweep()) {
      for (const h of prev) if (!drawn.has(h)) evicted++
      prev = drawn
    }
    expect(evicted).toBe(0)
    expect(prev.size).toBeGreaterThan(BUDGET * 0.9)
  })
})
