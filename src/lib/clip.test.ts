/**
 * clip.test.ts - the one part of clipping that is cyberspace's: where an
 * aligned region cube lands in the frame a shard is drawn in. The clipping
 * itself is covered in sno-core.
 */

import { describe, expect, it } from 'vitest'
import { regionBox } from './clip'
import {
  MAX_SCALE_EXP, OCCUPANCY_SCALE_MAX, alignTo, clampAxis, markerCentre, markerContinuous, pointCentre,
  rotateView, stepFor, topDownQuaternion, viewAxes, type Position, type ViewAxes,
} from './space'
import { alignedOrigin } from '../store/useCyberspace'

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
    // Above OCCUPANCY_SCALE_MAX markerCentre draws the shard at its true
    // coordinate, not its cell's centre, so the region's walls are measured
    // from `at` with no half cell (arkinox, 2026-10-01). Same shard, same
    // region, zoom 2^80.
    const at = { x: (5n << 80n) + 40n, y: 64n << 70n, z: 96n }
    const box = regionBox(at, 4, 0, 80, axes as never)
    // 40 is 8 past its 2^4 corner, so the walls are 8 below and 8 above.
    expect(box.min[0]).toBeCloseTo(-8)
    expect(box.max[0]).toBeCloseTo(8)
    // The out axis flips; z = 96 is a corner, so the region runs from it.
    expect(box.min[2]).toBeCloseTo(-16)
    expect(box.max[2]).toBeCloseTo(0)
  })
})

/**
 * The clip box is drawn inside the shard's group, which markerCentre placed.
 * Carried out of that frame into render space, its walls have to land on the
 * region's own walls, which the scene draws where pointCentre puts the
 * region's corners (the cage convention, lib/space.ts). This held at and
 * below 2^33 and failed from 2^34 to 2^79, where the shard was placed
 * continuously and the box was still measured from the cell centre: up to
 * half a cell off (arkinox, 2026-10-01).
 */
describe('the clip box sits on its region at every zoom', () => {
  const VIEWS: ViewAxes[] = (() => {
    const dirs = ['left', 'up', 'right', 'down'] as const
    const out: ViewAxes[] = []
    let q = topDownQuaternion()
    for (let i = 0; i < 8; i++) {
      out.push(viewAxes(q))
      q = rotateView(q, dirs[i % 4])
    }
    return out
  })()

  /** A shard spot and a viewer near it, with bits set all the way down. */
  const AT: Position = {
    x: (1n << 84n) + 0x1d3c5a7f9e1b2c3d4e5fn,
    y: 0x0fedcba9876543210abcn,
    z: (3n << 82n) + 0x123456789abcdef0123n,
  }

  /** What the old regionBox did: always the cell frame. */
  const cellFrameBox = (at: Position, height: number, unit: number, scaleExp: number, ax: ViewAxes) => {
    const h = BigInt(height)
    const half = Number(stepFor(scaleExp)) / 2
    const perUnit = 2 ** unit
    const min = [0, 0, 0], max = [0, 0, 0]
    ;[ax.right, ax.up, ax.out].forEach((a, i) => {
      const v = at[a.axis]
      const base = (v >> h) << h
      const origin = alignTo(v, scaleExp)
      const lo = (Number(base - origin) - half) / perUnit
      const hi = (Number(base + (1n << h) - origin) - half) / perUnit
      if (a.dir >= 0) { min[i] = lo; max[i] = hi } else { min[i] = -hi; max[i] = -lo }
    })
    return { min, max }
  }

  it('is exactly what it was at 2^33 and below', () => {
    for (let scaleExp = 0; scaleExp <= OCCUPANCY_SCALE_MAX; scaleExp++) {
      expect(markerContinuous(scaleExp)).toBe(false)
      for (const height of [scaleExp, scaleExp + 3, Math.min(85, scaleExp + 20)]) {
        for (const unit of [0, Math.max(0, scaleExp - 4)]) {
          for (const ax of VIEWS) {
            expect(regionBox(AT, height, unit, scaleExp, ax), `scaleExp ${scaleExp}`).toEqual(cellFrameBox(AT, height, unit, scaleExp, ax))
          }
        }
      }
    }
  })

  it('places its walls on the region\'s walls from 2^0 to 2^84', () => {
    let measured = 0
    for (let scaleExp = 0; scaleExp <= MAX_SCALE_EXP; scaleExp++) {
      // A viewer a few cells away, so the frame is not the shard's own cell.
      const step = 1n << BigInt(scaleExp)
      const anchor: Position = { x: clampAxis(AT.x - 3n * step), y: clampAxis(AT.y + 2n * step), z: AT.z }
      const origin = alignedOrigin(anchor, scaleExp)
      for (const height of [scaleExp, Math.min(85, scaleExp + 2), Math.min(85, scaleExp + 5)]) {
        // A shard sized to be seen: a few model units to the cell.
        const unit = Math.max(0, scaleExp - 3)
        const cellsPerUnit = 2 ** (unit - scaleExp)
        for (const ax of VIEWS) {
          const drawn = markerCentre(AT, origin, scaleExp, ax)
          const box = regionBox(AT, height, unit, scaleExp, ax)
          const h = BigInt(height)
          const lowCorner: Position = { x: (AT.x >> h) << h, y: (AT.y >> h) << h, z: (AT.z >> h) << h }
          const highCorner: Position = { x: lowCorner.x + (1n << h), y: lowCorner.y + (1n << h), z: lowCorner.z + (1n << h) }
          const lo = pointCentre(lowCorner, origin, scaleExp, ax)
          const hi = pointCentre(highCorner, origin, scaleExp, ax)
          for (let i = 0; i < 3; i++) {
            const walls = [drawn[i] + box.min[i] * cellsPerUnit, drawn[i] + box.max[i] * cellsPerUnit]
            const want = [Math.min(lo[i], hi[i]), Math.max(lo[i], hi[i])]
            // cellDelta's fixed point is a ten-thousandth of a cell, once for
            // the shard's place and once for the corner's.
            expect(Math.abs(walls[0] - want[0]), `scaleExp ${scaleExp} height ${height}`).toBeLessThanOrEqual(2e-4)
            expect(Math.abs(walls[1] - want[1]), `scaleExp ${scaleExp} height ${height}`).toBeLessThanOrEqual(2e-4)
            measured++
          }
        }
      }
    }
    expect(measured).toBeGreaterThan(1000)
  })

  it('was half a cell out from 2^34 to 2^79 under the old frame', () => {
    // The bug, pinned: the cell frame against a continuously placed shard.
    const ax = VIEWS[0]
    let worst = 0
    for (let scaleExp = OCCUPANCY_SCALE_MAX + 1; scaleExp < 80; scaleExp++) {
      expect(markerContinuous(scaleExp)).toBe(true)
      const unit = scaleExp - 3
      const old = cellFrameBox(AT, scaleExp + 2, unit, scaleExp, ax)
      const now = regionBox(AT, scaleExp + 2, unit, scaleExp, ax)
      for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(old.min[i] - now.min[i]) * 2 ** (unit - scaleExp))
    }
    // In cells: well over a tenth of one, the sub-cell fraction minus a half.
    expect(worst).toBeGreaterThan(0.1)
    expect(worst).toBeLessThanOrEqual(0.5 + 1e-9)
  })
})
