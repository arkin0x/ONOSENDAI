/**
 * clipTangent.test.ts - where a hidden shard is cut at its region, measured
 * on the half-gibson planes that shapes built on whole units end on.
 *
 * arkinox, 2026-11-15: a 2^12 bridge reaching across a region wall was cut at
 * the wall, while the Landscape Kit meadow beside it, in the next region,
 * stopped half a gibson short of the same wall, so the two never met. An
 * object stands on the centre of its gibson, so a shape built on whole units
 * ends on a half gibson and a wall (between two gibsons) can never meet it.
 * The cut now runs half a gibson outside every wall (lib/clip.ts
 * REGION_CUT_MARGIN).
 */

import { describe, expect, it } from 'vitest'
import { flatten, fromPayload, type ShardModel } from 'sno-core/shards'
import { REGION_CUT_MARGIN, WALK_CUT_MARGIN, boxContains, regionBox, type Box } from '../clip'
import { placedPose } from '../pose'
import { shardGeometry } from '../../scene/ShardMesh'
import type { Position, ViewAxes } from '../space'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }

/** A point in model units (multiples of 1/120) as a whole vertex and its ticks (DECK-0003 §1.2). */
function split(p: number[]): { v: number[]; t: number[] } {
  const v = p.map((c) => Math.floor(c))
  return { v, t: p.map((c, i) => Math.round((c - v[i]) * 120)) }
}

function model(name: string, points: number[][], faces: number[][], unit = 0): ShardModel {
  const parts = points.map(split)
  const vertices = parts.map((q) => q.v)
  const s = fromPayload({ v: 2, name, unit, mode: 'solid', vertices, ticks: parts.map((q) => q.t), colors: vertices.map(() => 1), faces }, `${name}-${JSON.stringify(points)}-${unit}`)
  if (!s) throw new Error(name)
  return s
}

/** A closed box from lo to hi, in model units, wound outward. */
function slab(lo: number[], hi: number[], unit = 0): ShardModel {
  const points = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]])
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
  return model('slab', points, quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]), unit)
}

/** A single flat quad lying in the plane x = `x`, across y and z from -1 to 1 (model units). */
function sheetAt(x: number): ShardModel {
  return model('sheet', [[x, -1, -1], [x, 1, -1], [x, 1, 1], [x, -1, 1]], [[0, 1, 2], [0, 2, 3]])
}

/** A region corner well away from zero, with low bits clear up to 2^12. */
const WALL: Position = { x: (3n << 60n) + (5n << 12n), y: (7n << 50n) + (9n << 12n), z: (11n << 40n) + (2n << 12n) }
const at = (dx: number, dy = 100, dz = 100): Position => ({ x: WALL.x + BigInt(dx), y: WALL.y + BigInt(dy), z: WALL.z + BigInt(dz) })

/** What a shard hidden at `p` in a region of height `h` draws, as gibsons on x from the wall WALL.x, and how many of its faces survive whole. */
function drawnX(s: ShardModel, p: Position, h: number, margin?: number): { lo: number; hi: number; triangles: number; whole: boolean; box: Box } {
  const box = regionBox(p, h, s.unit, AXES, margin)
  const g = shardGeometry(s, box, placedPose(AXES))
  // Whole: every vertex of the shape lies inside the cut, so nothing of it is cut away.
  const whole = boxContains(box, flatten(s, placedPose(AXES)).positions)
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < g.positions.length; i += 3) { lo = Math.min(lo, g.positions[i]); hi = Math.max(hi, g.positions[i]) }
  const per = 2 ** s.unit
  // The shard's frame sits at its coordinate plus half a gibson (itemCentre).
  const origin = Number(p.x - WALL.x) + 0.5
  return { lo: origin + lo * per, hi: origin + hi * per, triangles: g.index.length / 3, whole, box }
}

describe('the cut runs half a gibson outside the region walls', () => {
  it('is the region walls grown by half a gibson on every side, and the walls themselves with margin 0', () => {
    expect(REGION_CUT_MARGIN).toBe(0.5)
    // Hidden one gibson in from the low corner of a 2^4 region: walls at -1.5 and +14.5 about its frame.
    const p = at(1)
    expect(regionBox(p, 4, 0, AXES, 0).min[0]).toBe(-1.5)
    expect(regionBox(p, 4, 0, AXES, 0).max[0]).toBe(14.5)
    expect(regionBox(p, 4, 0, AXES).min[0]).toBe(-2)
    expect(regionBox(p, 4, 0, AXES).max[0]).toBe(15)
    // The out axis points the other way: 4 gibsons into its 2^4 region on z,
    // walls at -4.5 and +11.5 about the frame, cut at -5 and +12, flipped.
    expect(regionBox(p, 4, 0, AXES).min[2]).toBe(-12)
    expect(regionBox(p, 4, 0, AXES).max[2]).toBe(5)
    // In model units at unit 1: half of every gibson figure.
    expect(regionBox(p, 4, 1, AXES).max[0]).toBe(7.5)
  })
})

describe('a face on the cut is drawn, a face past it is cut', () => {
  // A 16 room centred on its region's middle: hidden at the region's centre
  // gibson, base + 8, its frame sits at base + 8.5, so it spans base + 0.5 to
  // base + 16.5. The Maze Kit's tiles hidden in their own 2^4 bag were cut
  // on the +side for this half gibson.
  it('keeps a whole-unit slab whose high face lies on the high cut', () => {
    const s = slab([-8, -1, -2], [8, 1, 2])
    const d = drawnX(s, at(8), 4)
    expect(d.hi).toBe(16.5)
    expect(d.lo).toBe(0.5)
    expect(d.whole).toBe(true)
    // Cut at the wall itself, it lost its high face and half a gibson.
    const old = drawnX(s, at(8), 4, 0)
    expect(old.hi).toBe(16)
  })

  it('keeps a whole-unit slab whose low face lies on the low cut', () => {
    const s = slab([-8, -1, -2], [8, 1, 2])
    const d = drawnX(s, at(7), 4)
    expect(d.lo).toBe(-0.5)
    expect(d.hi).toBe(15.5)
    expect(d.whole).toBe(true)
    expect(drawnX(s, at(7), 4, 0).lo).toBe(0)
  })

  it('keeps a face lying in the cut plane itself, on either side', () => {
    // Hidden at base + 15 (the top gibson of a 2^4 region), frame at base + 15.5: the high cut is 1 out.
    expect(drawnX(sheetAt(1), at(15), 4).triangles).toBe(2)
    // Hidden at base + 0, frame at base + 0.5: the low cut is 1 back.
    expect(drawnX(sheetAt(-1), at(0), 4).triangles).toBe(2)
  })

  it('drops a face lying just past the cut, and cuts a slab that crosses it at the cut', () => {
    expect(drawnX(sheetAt(1 + 1 / 120), at(15), 4).triangles).toBe(0)
    expect(drawnX(sheetAt(-1 - 1 / 120), at(0), 4).triangles).toBe(0)
    // Two gibsons further in than the room above: it truly crosses into the next region.
    const d = drawnX(slab([-8, -1, -2], [8, 1, 2]), at(10), 4)
    expect(d.lo).toBe(2.5)
    expect(d.hi).toBe(16.5)
  })

  it('still draws a one-gibson cube at the top gibson whole', () => {
    // Its faces end on whole gibsons, half a gibson either side of its frame.
    const cube = slab([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5])
    for (const margin of [0, REGION_CUT_MARGIN]) {
      expect(drawnX(cube, at(15), 4, margin).whole).toBe(true)
      expect(drawnX(cube, at(0), 4, margin).whole).toBe(true)
    }
  })
})

describe('shapes across a region wall meet with no strip', () => {
  // The wall between two 2^12 regions is at WALL.x + 4096; call it x = 4096.
  const H = 12
  const W = 4096

  it("arkinox's bridge and meadow: before, half a gibson apart; now, meeting", () => {
    // A 128 meadow (unit 0) hidden 65 below the wall, in the lower region, and
    // a 32-long bridge (unit 1, 16 model units) hidden 13 above it, in the upper.
    const meadow = slab([-64, -16, -64], [64, 3, 64])
    const bridge = slab([-8, 0, -2], [8, 8, 2], 1)
    const m = drawnX(meadow, at(W - 65), H)
    const b = drawnX(bridge, at(W + 13), H)
    expect(m.hi).toBe(W - 0.5)
    expect(b.lo).toBe(W - 0.5)
    // What the owner saw: the bridge cut at the wall, the meadow half a gibson short of it.
    const mOld = drawnX(meadow, at(W - 65), H, 0)
    const bOld = drawnX(bridge, at(W + 13), H, 0)
    expect(bOld.lo - mOld.hi).toBe(0.5)
  })

  it('a row of 64 tiles crossing the wall meets on both phases of the grid, each tile in its own region', () => {
    const tile = slab([-32, -16, -32], [32, 0, 32])
    // A tile hidden at c spans c + 0.5 - 32 to c + 0.5 + 32.
    // Phase A: tile edges on W + 0.5. The lower tile reaches past the wall.
    // Phase B: tile edges on W - 0.5. The upper tile reaches back past it.
    for (const [lower, upper] of [[W - 32, W + 32], [W - 33, W + 31]]) {
      const a = drawnX(tile, at(lower), H)
      const b = drawnX(tile, at(upper), H)
      expect(b.lo - a.hi, `tiles at ${lower} and ${upper}`).toBe(0)
      // Each draws whole: neither is cut, and neither overlaps the other.
      expect(a.whole).toBe(true)
      expect(b.whole).toBe(true)
      expect(a.hi - a.lo).toBe(64)
      expect(b.hi - b.lo).toBe(64)
      const aOld = drawnX(tile, at(lower), H, 0)
      const bOld = drawnX(tile, at(upper), H, 0)
      expect(bOld.lo - aOld.hi, `tiles at ${lower} and ${upper}, cut at the wall`).toBe(0.5)
    }
  })

  it('puts the two regions\' cuts on two different planes, a gibson apart', () => {
    const lowCut = drawnX(slab([-1, -1, -1], [1, 1, 1]), at(W - 1), H).box.max[0] + (W - 1) + 0.5
    const highCut = drawnX(slab([-1, -1, -1], [1, 1, 1]), at(W), H).box.min[0] + W + 0.5
    expect(lowCut).toBe(W + 0.5)
    expect(highCut).toBe(W - 0.5)
  })
})

describe('two shapes that both reach deep across a wall overlap by one gibson at most', () => {
  // Known cost of the margin: two floors, one from each region, that both
  // cross the wall by half a gibson or more, are each drawn half a gibson
  // past it, so their faces share a strip one gibson wide (coplanar faces
  // there can flicker). Cut at the wall they met edge to edge. Whole-unit
  // tiles never cross by more than half a gibson, so they do not overlap.
  it('overlaps two deep-crossing floors by exactly one gibson, and whole-unit tiles not at all', () => {
    const W = 4096
    const floor = slab([-8, -1, -2], [8, 0, 2])
    const low = drawnX(floor, at(W - 4), 12)
    const high = drawnX(floor, at(W + 3), 12)
    expect(low.hi - high.lo).toBe(1)
    expect(drawnX(floor, at(W - 4), 12, 0).hi - drawnX(floor, at(W + 3), 12, 0).lo).toBe(0)
    const tile = slab([-32, -16, -32], [32, 0, 32])
    expect(drawnX(tile, at(W - 32), 12).hi - drawnX(tile, at(W + 32), 12).lo).toBe(0)
  })
})

describe('WALK holds a walker a hair inside the drawn cut', () => {
  it('cuts walls just under half a gibson out, so the next region\'s first gibson centre is past them', () => {
    expect(WALK_CUT_MARGIN).toBeLessThan(REGION_CUT_MARGIN)
    expect(REGION_CUT_MARGIN - WALK_CUT_MARGIN).toBeLessThan(0.01)
    // Hidden at the top gibson of a 2^4 region: the walls' cut sits short of
    // the centre of the next region's first gibson, one whole gibson up.
    const box = regionBox(at(15), 4, 0, AXES, WALK_CUT_MARGIN)
    expect(box.max[0]).toBeLessThan(1)
    expect(box.max[0]).toBeGreaterThan(0.5)
    // Exact in a float, at every unit: no wall lands a rounding error off it.
    for (const unit of [0, 1, 3]) {
      const b = regionBox(at(15), 4, unit, AXES, WALK_CUT_MARGIN)
      expect(Math.fround(b.max[0])).toBe(b.max[0])
    }
  })
})
