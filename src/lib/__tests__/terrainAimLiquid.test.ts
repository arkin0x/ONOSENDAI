/**
 * terrainAimLiquid.test.ts - the cursor aims at liquids (lib/terrain/raycast.ts
 * aimTest; owner, 2026-11-28: "I still can't pick up tide water"): from open
 * space the ray stops at Tidewater and Magmaflow like any block, so they can
 * be mined; from inside a pool it passes through the pool you are in to the
 * block past it, and aims at a liquid again once it has crossed open space.
 * Walking is unchanged: a liquid is still walked through (blocks.ts solid).
 */

import { describe, expect, it } from 'vitest'
import { aimTest, raycast } from '../terrain/raycast'
import { EMPTY, liquid, solid } from '../terrain/blocks'

const GRIDSTONE = 1
const TIDEWATER = 11
const MAGMAFLOW = 12

/** A line of cells along +x from cell 0, as a block lookup (everything else open space). */
function row(...ids: number[]): (i: number, j: number, k: number) => number {
  return (i, j, k) => (j === 0 && k === 0 && i >= 0 && i < ids.length ? ids[i] : EMPTY)
}

/** The cell the cursor's ray takes, cast from cell 0 along +x. */
const aimed = (blocks: (i: number, j: number, k: number) => number): number | null =>
  raycast([0, 0, 0], [1, 0, 0], 8, aimTest(blocks))?.cell[0] ?? null

describe('the cursor and liquids', () => {
  it('stops at Tidewater from open space, with the face it came in through', () => {
    const hit = raycast([0, 0, 0], [1, 0, 0], 8, aimTest(row(EMPTY, EMPTY, TIDEWATER, GRIDSTONE)))
    expect(hit?.cell).toEqual([2, 0, 0])
    expect(hit?.normal).toEqual([-1, 0, 0])
  })

  it('stops at Magmaflow from open space', () => {
    expect(aimed(row(EMPTY, MAGMAFLOW, GRIDSTONE))).toBe(1)
  })

  it('from inside a pool, passes through it to the block past it', () => {
    expect(aimed(row(TIDEWATER, TIDEWATER, TIDEWATER, GRIDSTONE))).toBe(3)
  })

  it('from inside a pool, aims at another liquid once it has crossed open space', () => {
    expect(aimed(row(TIDEWATER, TIDEWATER, EMPTY, EMPTY, TIDEWATER, GRIDSTONE))).toBe(4)
  })

  it('from inside a pool, stops at a different liquid touching it (Magmaflow beside Tidewater)', () => {
    expect(aimed(row(TIDEWATER, TIDEWATER, MAGMAFLOW, GRIDSTONE))).toBe(2)
    expect(aimed(row(MAGMAFLOW, TIDEWATER, GRIDSTONE))).toBe(1)
  })

  it('cast from open space (where a ray enters the blocks), takes a liquid in its very first cell', () => {
    const hit = raycast([0, 0, 0], [1, 0, 0], 8, aimTest(row(TIDEWATER, GRIDSTONE), true))
    expect(hit?.cell).toEqual([0, 0, 0])
    expect(hit?.distance).toBe(0)
  })

  it('still stops at solid blocks first, and at nothing past its reach', () => {
    expect(aimed(row(EMPTY, GRIDSTONE, TIDEWATER))).toBe(1)
    expect(aimed(row(EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, TIDEWATER))).toBe(null)
  })

  it('leaves walking alone: liquids are still walked through', () => {
    expect(liquid(TIDEWATER)).toBe(true)
    expect(liquid(MAGMAFLOW)).toBe(true)
    expect(liquid(GRIDSTONE)).toBe(false)
    expect(solid(TIDEWATER)).toBe(false)
    expect(solid(MAGMAFLOW)).toBe(false)
    expect(solid(GRIDSTONE)).toBe(true)
  })
})
