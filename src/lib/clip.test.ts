/**
 * clip.test.ts - the one part of clipping that is cyberspace's: where an
 * aligned region cube lands in the frame a shard is drawn in. The clipping
 * itself is covered in sno-core.
 */

import { describe, expect, it } from 'vitest'
import { regionBox } from './clip'

describe('the region box in a shard frame', () => {
  const axes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } } as const

  it('a shard at the low corner of its region sees the cube run from itself up 2^h', () => {
    // at is aligned to 2^4; unit 0 (one gibson per model unit); zoom 2^0, so the
    // frame's origin is at + half a gibson.
    const at = { x: 32n, y: 64n, z: 96n }
    const box = regionBox(at, 4, 0, 0, axes as never)
    expect(box.min[0]).toBeCloseTo(-0.5)
    expect(box.max[0]).toBeCloseTo(15.5)
    // The out axis points the other way: the range flips sign.
    expect(box.min[2]).toBeCloseTo(-15.5)
    expect(box.max[2]).toBeCloseTo(0.5)
  })

  it('scales with the model unit', () => {
    const at = { x: 32n, y: 64n, z: 96n }
    const box = regionBox(at, 4, 2, 0, axes as never)
    expect(box.max[0] - box.min[0]).toBeCloseTo(16 / 4)
  })

  it('a shard in the middle of its region sees walls on both sides', () => {
    const at = { x: 40n, y: 64n, z: 96n }
    const box = regionBox(at, 4, 0, 0, axes as never)
    expect(box.min[0]).toBeCloseTo(-8.5)
    expect(box.max[0]).toBeCloseTo(7.5)
  })

  it('measures from the shard itself when it is placed continuously', () => {
    // From 2^80 up the shard's group sits on its true coordinate, not on its
    // cell's centre, so the region's walls are measured from `at` with no
    // half cell (arkinox, 2026-10-01). Same shard, same region, zoom 2^80.
    const at = { x: (5n << 80n) + 40n, y: 64n << 70n, z: 96n }
    const box = regionBox(at, 4, 0, 80, axes as never, true)
    // 40 is 8 past its 2^4 corner, so the walls are 8 below and 8 above.
    expect(box.min[0]).toBeCloseTo(-8)
    expect(box.max[0]).toBeCloseTo(8)
    // The out axis flips; z = 96 is a corner, so the region runs from it.
    expect(box.min[2]).toBeCloseTo(-16)
    expect(box.max[2]).toBeCloseTo(0)
    // The cell frame at the same zoom measures from about half a 2^80 cell
    // away, which would put the walls nowhere near the shard.
    const cell = regionBox(at, 4, 0, 80, axes as never)
    expect(box.max[0] - cell.max[0]).toBeGreaterThan(2 ** 78)
  })
})
