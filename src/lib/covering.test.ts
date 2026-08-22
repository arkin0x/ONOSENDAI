/**
 * covering.test.ts - the covering box must contain what it is a box around.
 *
 * That sounds too obvious to assert, and it is exactly the kind of thing that
 * fails silently. The box is the region a move's proof would cover, and its
 * extent grows by powers of two, so a ruinous crossing covers a region wider
 * than anything you can see and the geometry still has to be finite. The clamp
 * that made it finite used to keep the true base and truncate from there, which
 * left the drawn box tens of thousands of cells from both the avatar and the
 * cursor: measured at 100 gibsons out, it spanned [-65440, -65368] with the
 * avatar at 0. On screen that reads as the box vanishing, not as a wrong box.
 *
 * So the property asserted here is containment, on every axis, for every
 * separation, in every view, clipped or not.
 */

import { describe, it, expect } from 'vitest'
import { GRID_RADIUS, cellCentre, rotateView, topDownQuaternion, viewAxes, type Position, type ViewAxes } from './space'
import { coveringBox } from './covering'
import { alignedOrigin } from '../store/useCyberspace'

/** What CoveringBox passes, so the regression is tested at the real limit. */
const MAX_CELLS = GRID_RADIUS * 3

/** Enough views that every axis is exercised with both dir = 1 and dir = -1. */
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

/**
 * Assert the box brackets both endpoints on all three screen axes.
 *
 * Endpoints are placed with cellCentre, the same helper the avatar and the
 * cursor are drawn with, so this asks the question the eye asks: is the marker
 * inside the box on screen. The half-cell slack is real, not a tolerance: a box
 * of n cells spans n/2 either side of its centre while the outermost cell
 * CENTRE sits (n - 1) / 2 out.
 */
function expectBrackets(
  from: Position, to: Position, scaleExp: number, axes: ViewAxes, maxCells = MAX_CELLS,
): void {
  const origin = alignedOrigin(from, scaleExp)
  const box = coveringBox(from, to, origin, scaleExp, axes, maxCells)
  for (const p of [from, to]) {
    const at = cellCentre(p, origin, scaleExp, axes)
    for (let s = 0; s < 3; s++) {
      expect(Math.abs(at[s] - box.centre[s])).toBeLessThanOrEqual(box.size[s] / 2)
    }
  }
}

/** Deep in the 85-bit axis, which is where the bigint path has to hold. */
const AVATAR: Position = { x: (1n << 70n) + 12345n, y: (1n << 45n) + 777n, z: 9_000_000n }

describe('covering box containment', () => {
  it('contains both endpoints at every separation, scale and view', () => {
    // Past 72 cells the box becomes a stand-in, so the list straddles that in
    // both directions rather than only testing far out.
    const separations = [0n, 1n, 2n, 3n, 5n, 20n, 50n, 71n, 72n, 73n, 100n, 200n, 1000n, 1n << 17n, 1n << 20n, 1n << 30n]
    for (const d of separations) {
      // Different offsets per axis, because the three heights are independent
      // and a box that is right on one axis can be wrong on another.
      const to: Position = { x: AVATAR.x + d, y: AVATAR.y - d, z: AVATAR.z + d * 2n }
      for (const scaleExp of [0, 1, 5, 10, 20, 40]) {
        for (const axes of VIEWS) expectBrackets(AVATAR, to, scaleExp, axes)
      }
    }
  })

  it('contains the avatar in the case that was reported broken', () => {
    // A hundred gibsons that happen to straddle a height-17 boundary cover
    // 131072 cells, against a drawn limit of 72. This is the exact shape that
    // put the box sixty-five thousand cells from both endpoints.
    const from: Position = { x: (1n << 16n) - 1n, y: (1n << 16n) - 1n, z: (1n << 16n) - 1n }
    const to: Position = { x: from.x + 100n, y: from.y + 100n, z: from.z + 100n }
    const origin = alignedOrigin(from, 0)
    const box = coveringBox(from, to, origin, 0, VIEWS[0], MAX_CELLS)

    expect(box.heights).toEqual([17, 17, 17])
    expect(box.clipped).toBe(true)
    // Never clamped: the label still quotes the price of the real region.
    expect(box.peak).toBe(17)
    for (const axes of VIEWS) expectBrackets(from, to, 0, axes)
  })

  it('contains both endpoints across a range of drawn limits', () => {
    // maxCells is a rendering budget, not a property of the space, so the box
    // must not stop containing its endpoints because the budget changed.
    const to: Position = { x: AVATAR.x + 300n, y: AVATAR.y + 9n, z: AVATAR.z - 40n }
    for (const maxCells of [1, 2, 8, 72, 1000, 100_000]) {
      for (const scaleExp of [0, 4, 16]) {
        for (const axes of VIEWS) expectBrackets(AVATAR, to, scaleExp, axes, maxCells)
      }
    }
  })

  it('contains the one cell it is drawn around when nothing is crossed', () => {
    // Cursor on the avatar: degenerate, so CoveringBox draws nothing, but the
    // box it hands back still has to be honest about where it is.
    for (const scaleExp of [0, 10, 84]) {
      for (const axes of VIEWS) {
        const box = coveringBox(AVATAR, AVATAR, alignedOrigin(AVATAR, scaleExp), scaleExp, axes, MAX_CELLS)
        expect(box.degenerate).toBe(true)
        expect(box.size).toEqual([1, 1, 1])
        expectBrackets(AVATAR, AVATAR, scaleExp, axes)
      }
    }
  })

  it('contains both endpoints when the move crosses the axis midpoint', () => {
    // The most expensive crossing the space has: every bit flips, so the true
    // covering region is the whole axis and clipping is guaranteed.
    const from: Position = { x: (1n << 84n) - 1n, y: (1n << 84n) - 1n, z: (1n << 84n) - 1n }
    const to: Position = { x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }
    for (const scaleExp of [0, 20, 60]) {
      for (const axes of VIEWS) expectBrackets(from, to, scaleExp, axes)
    }
  })

  it('never reports a sub-cell box', () => {
    // A zero or negative extent would draw an inverted box, which reads as a
    // box around somewhere neither endpoint is.
    const to: Position = { x: AVATAR.x + 1n, y: AVATAR.y, z: AVATAR.z + 5000n }
    for (const scaleExp of [0, 3, 30]) {
      for (const axes of VIEWS) {
        const box = coveringBox(AVATAR, to, alignedOrigin(AVATAR, scaleExp), scaleExp, axes, MAX_CELLS)
        for (const n of box.size) expect(n).toBeGreaterThanOrEqual(1)
      }
    }
  })
})
