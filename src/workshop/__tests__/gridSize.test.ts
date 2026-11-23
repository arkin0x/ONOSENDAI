import { describe, expect, it } from 'vitest'
import { MAX_EXTENT, MIN_EXTENT } from 'sno-core/shards'
import { stepExtent } from '../gridSize'
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

describe('holdInClip', () => {
  it('gives a model that fits exactly the planes it always had', () => {
    const c = { near: 0, far: 0 }
    // A 64-unit shard, the largest there was: reach about 111, framed about 400 out.
    holdInClip(c, 400, 111)
    expect(c).toEqual({ near: 0.01, far: 100000 })
    holdInClip(c, 400, 111, 0.001)
    expect(c.near).toBe(0.001)
  })

  it('takes both planes out for a model that would overrun', () => {
    const c = { near: 0, far: 0 }
    holdInClip(c, 300000, 113000)
    expect(c.far).toBe(526000)
    expect(c.near).toBeCloseTo(52.6)
  })

  it('pulls the near plane out for a large model inside the far plane, so its depth still sorts', () => {
    // A 4,096-unit shard: reach about 7,094, framed about 25,500 out.
    const c = { near: 0, far: 0 }
    holdInClip(c, 25500, 7094)
    expect(c.far).toBe(100000)
    expect(c.near).toBeCloseTo(3.97, 2)
    const resolution = (d: number, near: number): number => (d * d) / (near * 2 ** 24)
    expect(resolution(25500, 0.01) / 7094).toBeGreaterThan(0.5)
    expect(resolution(25500, c.near) / 7094).toBeLessThan(0.002)
    // Never past what is nearest the camera: the sphere's near side is 18,406 out.
    expect(c.near).toBeLessThan(25500 - 7094)
  })

  it('puts them back for the next small one on a reused camera', () => {
    const c = { near: 0, far: 0 }
    holdInClip(c, 300000, 113000)
    holdInClip(c, 10, 2)
    expect(c).toEqual({ near: 0.01, far: 100000 })
  })
})
