import { describe, expect, it } from 'vitest'
import { MAX_EXTENT, MIN_EXTENT } from 'sno-core/shards'
import { BENCH_NEAR, benchNear, benchReach, nearMoved, stepExtent } from '../gridSize'
import { holdInClip } from '../../scene/ThumbStage'

describe('GRID SIZE stepping', () => {
  it('counts in ones up to 64, as it always has', () => {
    for (let e = MIN_EXTENT; e < 64; e++) expect(stepExtent(e, 1)).toBe(e + 1)
    for (let e = 64; e > MIN_EXTENT; e--) expect(stepExtent(e, -1)).toBe(e - 1)
  })

  it('counts in sixteenths of a doubling past 64', () => {
    expect([64, 68, 124, 128, 136, 256, 272].map((e) => stepExtent(e, 1))).toEqual([68, 72, 128, 136, 144, 272, 288])
    expect([68, 128, 136, 256].map((e) => stepExtent(e, -1))).toEqual([64, 124, 128, 248])
  })

  it('comes back down through every stop it went up through', () => {
    const up = [64]
    while (up[up.length - 1] < MAX_EXTENT) up.push(stepExtent(up[up.length - 1], 1))
    const down = [MAX_EXTENT]
    while (down[down.length - 1] > 64) down.push(stepExtent(down[down.length - 1], -1))
    expect(down.reverse()).toEqual(up)
  })

  it('gets from 64 to the top in under twenty seconds of holding the key', () => {
    let e = 64, presses = 0
    while (e < MAX_EXTENT) { e = stepExtent(e, 1); presses++ }
    expect(presses).toBe(16 * Math.log2(MAX_EXTENT / 64))
    expect(presses * 110).toBeLessThan(20_000) // useRepeatable's REPEAT_MS
  })

  it('lands back on a stop from a size that is not one, as a pasted shard can leave it', () => {
    expect(stepExtent(70, 1)).toBe(72)
    expect(stepExtent(70, -1)).toBe(68)
  })

  it('holds at both ends', () => {
    expect(stepExtent(MAX_EXTENT, 1)).toBe(MAX_EXTENT)
    expect(stepExtent(MIN_EXTENT, -1)).toBe(MIN_EXTENT)
  })
})

describe('the bench camera follows the grid', () => {
  it('leaves a small grid with the 60 and the 200 it always had', () => {
    for (const e of [1, 8, 17]) expect(benchReach(e)).toEqual({ maxDistance: 60, far: 200 })
  })

  it('fits the whole grid in view at the far end, and draws past it', () => {
    for (const e of [64, 1000, MAX_EXTENT]) {
      const { maxDistance, far } = benchReach(e)
      const corner = e * Math.SQRT2
      expect(Math.atan(corner / maxDistance) * (180 / Math.PI)).toBeLessThanOrEqual(25)
      expect(far).toBeGreaterThanOrEqual(maxDistance + 2 * Math.sqrt(3) * e)
    }
  })

  it('keeps the near plane where it was for all close work', () => {
    for (const d of [0.6, 10, 60, 200]) expect(benchNear(d)).toBe(BENCH_NEAR)
  })

  it('keeps depth usable far out, where 0.05 could not sort a thing', () => {
    const resolution = (d: number, near: number): number => (d * d) / (near * 2 ** 24)
    const d = benchReach(MAX_EXTENT).maxDistance
    expect(resolution(d, BENCH_NEAR) / d).toBeGreaterThan(0.01)
    expect(resolution(d, benchNear(d)) / d).toBeLessThan(0.001)
  })

  it('does not rebuild the projection for a small drift', () => {
    expect(nearMoved(1, 1.05)).toBe(false)
    expect(nearMoved(1, 1.2)).toBe(true)
    expect(nearMoved(BENCH_NEAR, BENCH_NEAR)).toBe(false)
  })
})

describe('holdInClip', () => {
  it('gives a model that fits exactly the planes it always had', () => {
    const c = { near: 0, far: 0 }
    holdInClip(c, 1000, 100)
    expect(c).toEqual({ near: 0.01, far: 100000 })
    holdInClip(c, 1000, 100, 0.001)
    expect(c.near).toBe(0.001)
  })

  it('takes both planes out for a model that would overrun', () => {
    const c = { near: 0, far: 0 }
    holdInClip(c, 300000, 113000)
    expect(c.far).toBe(526000)
    expect(c.near).toBeCloseTo(5.26)
  })

  it('puts them back for the next small one on a reused camera', () => {
    const c = { near: 0, far: 0 }
    holdInClip(c, 300000, 113000)
    holdInClip(c, 10, 2)
    expect(c).toEqual({ near: 0.01, far: 100000 })
  })
})
