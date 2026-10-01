/**
 * clip.test.ts - the one part of clipping that is cyberspace's: where an
 * aligned region cube lands in the frame a shard is drawn in. The clipping
 * itself is covered in sno-core.
 */

import { describe, expect, it } from 'vitest'
import { clipMesh, regionBox } from './clip'
import {
  MAX_SCALE_EXP, alignTo, clampAxis, itemCentre, pointCentre,
  rotateView, stepFor, topDownQuaternion, viewAxes, type Position, type ViewAxes,
} from './space'
import { alignedOrigin } from '../store/useCyberspace'

describe('the region box in a shard frame', () => {
  const axes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } } as const

  it('a shard at the low corner of its region sees the cube run from itself up 2^h', () => {
    // at is aligned to 2^4; unit 0 (one gibson per model unit). The frame's
    // origin is at + half a gibson.
    const at = { x: 32n, y: 64n, z: 96n }
    const box = regionBox(at, 4, 0, axes as never)
    expect(box.min[0]).toBeCloseTo(-0.5)
    expect(box.max[0]).toBeCloseTo(15.5)
    // The out axis points the other way: the range flips sign.
    expect(box.min[2]).toBeCloseTo(-15.5)
    expect(box.max[2]).toBeCloseTo(0.5)
  })

  it('scales with the model unit', () => {
    const at = { x: 32n, y: 64n, z: 96n }
    const box = regionBox(at, 4, 2, axes as never)
    expect(box.max[0] - box.min[0]).toBeCloseTo(16 / 4)
  })

  it('a shard in the middle of its region sees walls on both sides', () => {
    const at = { x: 40n, y: 64n, z: 96n }
    const box = regionBox(at, 4, 0, axes as never)
    expect(box.min[0]).toBeCloseTo(-8.5)
    expect(box.max[0]).toBeCloseTo(7.5)
  })
})

/**
 * The clip box is drawn inside the shard's group, which itemCentre places at
 * the shard's true coordinate plus half a gibson at every zoom, so the box is
 * a fact about the data, not about the zoom. Carried out of that frame into
 * render space, its walls land on the region's own walls, which the cages
 * draw where pointCentre puts the region's corners (arkinox, 2026-10-01).
 */
describe('the clip box is the same at every zoom and sits on its region', () => {
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

  /** A shard spot, with bits set all the way down. */
  const AT: Position = {
    x: (1n << 84n) + 0x1d3c5a7f9e1b2c3d4e5fn,
    y: 0x0fedcba9876543210abcn,
    z: (3n << 82n) + 0x123456789abcdef0123n,
  }

  /** What regionBox did at 2^0 before: the cell frame, which there is the gibson's centre. */
  const cellFrameBoxAtZero = (at: Position, height: number, unit: number, ax: ViewAxes) => {
    const h = BigInt(height)
    const half = Number(stepFor(0)) / 2
    const perUnit = 2 ** unit
    const min = [0, 0, 0], max = [0, 0, 0]
    ;[ax.right, ax.up, ax.out].forEach((a, i) => {
      const v = at[a.axis]
      const base = (v >> h) << h
      const origin = alignTo(v, 0)
      const lo = (Number(base - origin) - half) / perUnit
      const hi = (Number(base + (1n << h) - origin) - half) / perUnit
      if (a.dir >= 0) { min[i] = lo; max[i] = hi } else { min[i] = -hi; max[i] = -lo }
    })
    return { min, max }
  }

  it('is exactly what it was at 2^0', () => {
    for (const height of [0, 4, 9, 30]) {
      for (const unit of [0, 1, 3]) {
        for (const ax of VIEWS) expect(regionBox(AT, height, unit, ax)).toEqual(cellFrameBoxAtZero(AT, height, unit, ax))
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
      for (const height of [Math.max(0, scaleExp - 2), scaleExp, Math.min(85, scaleExp + 5)]) {
        const unit = Math.max(0, scaleExp - 3)
        const cellsPerUnit = 2 ** (unit - scaleExp)
        for (const ax of VIEWS) {
          const drawn = itemCentre(AT, origin, scaleExp, ax)
          const box = regionBox(AT, height, unit, ax)
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

  it('cuts a shard to the same shape at every zoom, where the old frame lost it', () => {
    // The case arkinox's zoom-out lost: a 16-gibson shard at unit 0, hidden
    // off centre in a 2^4 region. Its group used to sit at its cell's centre
    // at each zoom, with the box measured from there, and once a cell was
    // larger than the region the box slid off the shard: the cut changed at
    // every zoom and was empty from 2^6. Now both are measured from the shard.
    const at: Position = { x: (5n << 40n) + 13n, y: (7n << 40n) + 2n, z: (9n << 40n) + 9n }
    const ax = VIEWS[0]
    const E = 8
    const pos: number[] = []
    const quad = (p: number[][]): number[] => { const i = pos.length / 3; for (const v of p) pos.push(...v); return [i, i + 1, i + 2, i, i + 2, i + 3] }
    const index = [
      ...quad([[-E, -E, 0], [E, -E, 0], [E, E, 0], [-E, E, 0]]),
      ...quad([[-E, 0, -E], [-E, 0, E], [E, 0, E], [E, 0, -E]]),
      ...quad([[0, -E, -E], [0, E, -E], [0, E, E], [0, -E, E]]),
    ]
    const mesh = { positions: new Float32Array(pos), colors: new Float32Array(pos.length).fill(1), index }
    const triangles = (box: ReturnType<typeof regionBox>): number => clipMesh(mesh, box).index.length / 3
    /** The old box at a zoom: measured from the centre of the zoom's cell. */
    const oldBox = (scaleExp: number): ReturnType<typeof regionBox> => {
      const h = 4n, half = Number(stepFor(scaleExp)) / 2
      const min: [number, number, number] = [0, 0, 0], max: [number, number, number] = [0, 0, 0]
      ;[ax.right, ax.up, ax.out].forEach((a, i) => {
        const v = at[a.axis], base = (v >> h) << h, origin = alignTo(v, scaleExp)
        const lo = Number(base - origin) - half, hi = Number(base + (1n << h) - origin) - half
        if (a.dir >= 0) { min[i] = lo; max[i] = hi } else { min[i] = -hi; max[i] = -lo }
      })
      return { min, max }
    }
    const now = triangles(regionBox(at, 4, 0, ax))
    expect(now).toBeGreaterThan(0)
    const before = new Set<number>()
    for (let scaleExp = 0; scaleExp <= MAX_SCALE_EXP; scaleExp++) {
      // The drawing at every zoom uses this one box: the shape cannot change.
      expect(triangles(regionBox(at, 4, 0, ax)), `scaleExp ${scaleExp}`).toBe(now)
      if (scaleExp <= 12) before.add(triangles(oldBox(scaleExp)))
    }
    // At 2^0 the old frame was this frame; above it, it wandered and emptied.
    expect(triangles(oldBox(0))).toBe(now)
    expect(before.size).toBeGreaterThan(2)
    expect(before.has(0)).toBe(true)
  })
})
