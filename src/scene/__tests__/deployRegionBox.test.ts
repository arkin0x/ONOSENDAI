/**
 * deployRegionBox.test.ts - the green deploy box is drawn clipped, never
 * dropped, when its region is too big for the view, with the ZOOM OUT walls
 * on exactly the faces the region continues through (arkinox, 2026-10-16);
 * and the shard an EDIT moves breathes on the WALK walls' cycle.
 */

import { describe, expect, it } from 'vitest'
import type { Position, ViewAxes } from '../../lib/space'
import { alignedOrigin } from '../../store/useCyberspace'
import { drawnRegion } from '../DeployRegionBox'
import { movingOpacity } from '../WorldShards'
import { WALL_BREATH_SECONDS } from '../Rooms'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } as ViewAxes
const FLIPPED: ViewAxes = { right: { axis: 'x', dir: -1 }, up: { axis: 'z', dir: 1 }, out: { axis: 'y', dir: -1 } } as ViewAxes

const C = 1n << 60n
const cursor: Position = { x: C + 5n, y: C + 5n, z: C + 5n }

describe('drawnRegion', () => {
  it('draws a region that fits whole, with no clipped faces', () => {
    const r = drawnRegion(cursor, alignedOrigin(cursor, 0), 3, 0, AXES, 30)!
    expect(r.size).toEqual([8, 8, 8])
    expect(r.faces).toEqual([])
    expect(r.whole).toBe(true)
    // The region [C, C+8) sits from cell -5 to 2 around the cursor's cell.
    expect(r.centre).toEqual([-1.5, -1.5, -1.5])
  })

  it('clips a region too big for the view around the cursor, with walls on both sides', () => {
    // Height 40 at 2^0: the cursor is deep inside, far from every face.
    const mid: Position = { x: C + (1n << 39n), y: C + (1n << 39n), z: C + (1n << 39n) }
    const r = drawnRegion(mid, alignedOrigin(mid, 0), 40, 0, AXES, 30)!
    expect(r.size).toEqual([31, 31, 31])
    expect(r.centre).toEqual([0, 0, 0])
    expect(r.faces).toHaveLength(6)
  })

  it('keeps a face that is the region\'s own still', () => {
    // Height 10, the cursor 5 cells above the region's low corner: the low
    // faces are the region's, within reach; only the high faces are cut.
    const r = drawnRegion(cursor, alignedOrigin(cursor, 0), 10, 0, AXES, 30)!
    expect(r.faces).toEqual([{ slot: 0, sign: 1 }, { slot: 1, sign: 1 }, { slot: 2, sign: 1 }])
    expect(r.size).toEqual([21, 21, 21])
  })

  it('puts the walls on the render side a flipped axis turns them to', () => {
    const r = drawnRegion(cursor, alignedOrigin(cursor, 0), 10, 0, FLIPPED, 30)!
    // x and y run backwards on screen: their cut (high) faces are on the - side.
    expect(r.faces).toEqual([{ slot: 0, sign: -1 }, { slot: 1, sign: 1 }, { slot: 2, sign: -1 }])
  })

  it('is still drawn at the top of the space', () => {
    const top: Position = { x: (1n << 85n) - 1n, y: 3n, z: 1n << 84n }
    const r = drawnRegion(top, alignedOrigin(top, 0), 84, 0, AXES, 30)
    expect(r).not.toBeNull()
    expect(r!.size.every((s) => s >= 1 && s <= 31)).toBe(true)
  })

  it('draws a region smaller than a cell as a fraction of it, without a grid', () => {
    const r = drawnRegion(cursor, alignedOrigin(cursor, 3), 1, 3, AXES, 30)!
    expect(r.size).toEqual([0.25, 0.25, 0.25])
    expect(r.whole).toBe(false)
  })
})

describe('movingOpacity', () => {
  it('breathes on the WALK walls\' cycle, never vanishing', () => {
    expect(movingOpacity(0)).toBeCloseTo(movingOpacity(WALL_BREATH_SECONDS))
    expect(movingOpacity(WALL_BREATH_SECONDS / 2)).toBeGreaterThan(movingOpacity(0))
    expect(movingOpacity(0)).toBeGreaterThan(0)
  })
})
