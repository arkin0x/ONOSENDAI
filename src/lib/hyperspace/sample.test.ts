import { describe, expect, it } from 'vitest'
import { drawnSet, hashHeight, sampleThreshold } from './sample'

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
