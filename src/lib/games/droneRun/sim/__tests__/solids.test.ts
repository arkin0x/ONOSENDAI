/**
 * solids.test.ts - the collision geometry (sim/solids.ts) and building it
 * from authored shards (sim/fromShards.ts): casts across grid
 * cells, two-sided faces, balls, drops, the constrain and opacity rules, the
 * region cut, and the render-frame Z flip undone.
 */

import { describe, expect, it } from 'vitest'
import { buildSolids, ceilingAbove, groundBelow, segmentCast, segmentClear, sphereHits, spherePush } from '../solids'
import { trianglesFromShards } from '../fromShards'
import { withConstrain } from '../../../../walkConstrain'
import { fromPayload, ticksOf } from 'sno-core/shards'

/** A box's 8 corners and its 12 triangles, as a payload writes them. */
const boxVerts = (lo: number[], hi: number[]) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]])
const BOX_FACES = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]].flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]])
import { boxTris, boxes, groundSlab, plumbWall } from './helpers'
import type { Vec3 } from '../../types'

describe('solids: queries', () => {
  const s = boxes([[10, 0, 10], [12, 4, 30]])

  it('segmentCast finds the first face across many cells, and its normal faces the caster', () => {
    const h = segmentCast(s, [0, 2, 20], [40, 2, 20])
    expect(h).not.toBeNull()
    expect(h!.point[0]).toBeCloseTo(10, 9)
    expect(h!.t).toBeCloseTo(10 / 40, 9)
    expect(h!.normal).toEqual([-1, 0, 0].map((x) => x + 0) as Vec3)
    const back = segmentCast(s, [40, 2, 20], [0, 2, 20])
    expect(back!.point[0]).toBeCloseTo(12, 9)
    expect(back!.normal[0]).toBeCloseTo(1, 9)
  })

  it('faces are two-sided: a cast from inside hits the far wall', () => {
    const h = segmentCast(s, [11, 2, 20], [20, 2, 20])
    expect(h!.point[0]).toBeCloseTo(12, 9)
  })

  it('a segment that stops short, or passes beside, hits nothing', () => {
    expect(segmentCast(s, [0, 2, 20], [9.9, 2, 20])).toBeNull()
    expect(segmentCast(s, [0, 5, 20], [40, 5, 20])).toBeNull()
    expect(segmentClear(s, [0, 5, 20], [40, 5, 20])).toBe(true)
    expect(segmentClear(s, [0, 2, 20], [40, 2, 20])).toBe(false)
  })

  it('a cast along a shared edge leaves no seam', () => {
    // Two boxes side by side; the cast runs exactly along the edge where their tops meet the shared face.
    const two = boxes([[0, 0, 0], [4, 4, 4]], [[4, 0, 0], [8, 4, 4]])
    expect(segmentCast(two, [6, 10, 2], [6, -10, 2])!.point[1]).toBeCloseTo(4, 9)
    expect(segmentCast(two, [4, 10, 2], [4, -10, 2])!.point[1]).toBeCloseTo(4, 9)
  })

  it('sphereHits and spherePush', () => {
    expect(sphereHits(s, [9.6, 2, 20], 0.5)).toBe(true)
    expect(sphereHits(s, [9.4, 2, 20], 0.5)).toBe(false)
    const out: Vec3 = [0, 0, 0]
    expect(spherePush(s, [9.8, 2, 20], 0.5, out)).toBeGreaterThan(0)
    // Two triangles of the face meet under it: the deepest pushes, once.
    expect(out[0]).toBeCloseTo(-0.3, 9)
    // FLAT faces only (the top), or walls only.
    expect(sphereHits(s, [11, 4.3, 20], 0.5, 'walls')).toBe(false)
    expect(sphereHits(s, [11, 4.3, 20], 0.5, 'flats')).toBe(true)
  })

  it('groundBelow and ceilingAbove', () => {
    expect(groundBelow(s, 11, 10, 20, 20)).toBeCloseTo(4, 9)
    expect(groundBelow(s, 11, 10, 20, 5)).toBeNull()
    expect(ceilingAbove(s, 11, -5, 20, 10)).toBeCloseTo(0, 9)
  })

  it('an empty soup answers nothing', () => {
    const e = buildSolids([])
    expect(segmentCast(e, [0, 0, 0], [1, 1, 1])).toBeNull()
    expect(sphereHits(e, [0, 0, 0], 1)).toBe(false)
  })

  it('degenerate triangles are dropped', () => {
    const t = buildSolids([0, 0, 0, 1, 1, 1, 2, 2, 2, ...boxTris([0, 0, 0], [1, 1, 1])])
    expect(t.count).toBe(12)
  })
})

describe('solids from shards placed where they stand', () => {
  it('a ground slab placed at y 64 is a floor at 64 everywhere across it, and its side is a wall', () => {
    const s = buildSolids(trianglesFromShards([{ shard: groundSlab(), at: [64, 64, 64] }]))
    expect(s.count).toBeGreaterThan(100)
    for (const [x, z] of [[50, 50], [64, 64], [77, 70], [49, 78]]) expect(groundBelow(s, x, 80, z, 30)).toBeCloseTo(64, 9)
    // Beside the tile (it spans 16 each way): nothing below.
    expect(groundBelow(s, 81, 80, 64, 40)).toBeNull()
    const side = segmentCast(s, [90, 60, 64], [64, 60, 64])
    expect(side!.point[0]).toBeCloseTo(80, 6)
  })

  it('the frames line up with WALK: a shard stands on cyberspace Z where the scene draws it', () => {
    // A block from z 2 to 6 in its payload, off centre so a flip would show. sno-core reads a payload's
    // z turned round into its model (model z = -payload z, which is cyberspace z: the scene draws the model's
    // z on cyberspace Z, and WALK measures walls the same way), so it stands at cyberspace z -6..-2 from its origin.
    const block = fromPayload({ v: 2, name: 'block', unit: 0, mode: 'solid', vertices: boxVerts([-1, 0, 2], [1, 2, 6]), colors: Array(8).fill(1), faces: BOX_FACES, constrain: 'all' }, 'block')!
    const s = buildSolids(trianglesFromShards([{ shard: block, at: [100, 64, 100] }]))
    expect(block.vertices.map((v) => ticksOf(v)[2] / 120).sort((a, b) => a - b)[0]).toBe(-6)
    expect(segmentCast(s, [100, 65, 120], [100, 65, 80])!.point[2]).toBeCloseTo(98, 6)
    expect(segmentCast(s, [100, 65, 80], [100, 65, 120])!.point[2]).toBeCloseTo(94, 6)
    // And the unit: at unit 1 a model unit is 2 gibsons.
    const big = fromPayload({ v: 2, name: 'block', unit: 1, mode: 'solid', vertices: boxVerts([-1, 0, 2], [1, 2, 6]), colors: Array(8).fill(1), faces: BOX_FACES, constrain: 'all' }, 'block2')!
    const s2 = buildSolids(trianglesFromShards([{ shard: big, at: [100, 64, 100] }]))
    expect(segmentCast(s2, [100, 65, 120], [100, 65, 70])!.point[2]).toBeCloseTo(96, 6)
  })

  it('an authored wall stands inside its model bounds', () => {
    const wall = plumbWall()
    const zs = wall.vertices.map((v) => ticksOf(v)[2] / 120)
    const s = buildSolids(trianglesFromShards([{ shard: wall, at: [100, 64, 100] }]))
    expect(segmentCast(s, [100, 68, 120], [100, 68, 80])!.point[2]).toBeLessThanOrEqual(100 + Math.max(...zs) + 1e-4)
    expect(segmentCast(s, [100, 68, 80], [100, 68, 120])!.point[2]).toBeGreaterThanOrEqual(100 + Math.min(...zs) - 1e-4)
  })

  it('constrain off is not solid; opacity 0 with constrain all IS solid; opaque at opacity 0 is not', () => {
    const off = trianglesFromShards([{ shard: withConstrain(plumbWall(), 'off'), at: [100, 64, 100] }])
    expect(off.length).toBe(0)
    const ghost = trianglesFromShards([{ shard: plumbWall({ opacity: 0, constrain: 'all' }), at: [100, 64, 100] }])
    expect(ghost.length).toBeGreaterThan(0)
    const opaqueGhost = trianglesFromShards([{ shard: plumbWall({ opacity: 0, constrain: 'opaque' }), at: [100, 64, 100] }])
    expect(opaqueGhost.length).toBe(0)
  })

  it('a shard is cut at its region: the part across the wall is not solid', () => {
    // A tile centred on x 0 reaches 16 past the region's low wall (-0.5); only x from about -1 survives.
    const s = buildSolids(trianglesFromShards([{ shard: groundSlab(), at: [0, 64, 64] }]))
    expect(groundBelow(s, 5, 80, 64, 30)).toBeCloseTo(64, 9)
    expect(groundBelow(s, -0.9, 80, 64, 30)).toBeCloseTo(64, 9)
    expect(groundBelow(s, -5, 80, 64, 30)).toBeNull()
    // A bag of height 4: cut to its 16-gibson region (x 48..63 holds 50).
    const small = buildSolids(trianglesFromShards([{ shard: groundSlab(), at: [50, 64, 64], height: 4 }]))
    expect(groundBelow(small, 55, 80, 70, 30)).toBeCloseTo(64, 9)
    expect(groundBelow(small, 40, 80, 70, 30)).toBeNull()
    expect(groundBelow(small, 64, 80, 70, 30)).toBeNull()
  })
})
