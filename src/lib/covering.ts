/**
 * covering.ts — the smallest aligned box holding two positions, and its price.
 *
 * This is the single most load-bearing object in the protocol's cost model.
 * §4.5 gives it per axis as `h = lca(v1, v2)` and `base = (v1 >> h) << h`, and
 * §4.7 has each axis build its Cantor tree over its own covering subtree before
 * the three roots are paired into region_n. So this box IS region_n's extent,
 * and its size IS the work: 2^h leaves per axis.
 *
 * The heights are genuinely independent per axis, which is why this returns a
 * box and not a cube. A move that is ruinous on z and free on x and y covers a
 * slab, and drawing it as a cube would misreport two of the three prices.
 */

import { BufferGeometry, Float32BufferAttribute } from 'three'
import { findLcaHeight, subtreeCantorOps } from 'cyberspace-core'
import { alignTo, cellDelta, stepFor, type AxisName, type Position, type ViewAxes } from './space'

export interface Covering {
  /** Render-space centre, in cells. */
  centre: [number, number, number]
  /** Render-space extent per axis, in cells. */
  size: [number, number, number]
  /** Crossing height per screen axis. */
  heights: [number, number, number]
  /** The largest of them, which is what the move is really priced by. */
  peak: number
  /** Cantor pairings across the three spatial axis trees, per subtreeCantorOps. */
  ops: number
  /** True when the two positions are the same cell, so nothing is being crossed. */
  degenerate: boolean
  /** True when the real region is too large to draw and this is a stand-in. */
  clipped: boolean
  /**
   * Which world axes were too large to draw. `clipped` says the box understates
   * its extent somewhere; this says where, so the renderer can put the "bigger
   * than your view" motion on exactly the walls that understate it and leave
   * the honest ones still.
   */
  clippedAxes: AxisName[]
}

/**
 * @param maxCells the extent beyond which the box becomes a stand-in.
 *
 * A ruinous crossing covers a region wider than anything you can see: a hundred
 * gibsons that happen to straddle a height-17 boundary cover 131072 cells. The
 * clamp used to keep the true base and truncate, which put the box tens of
 * thousands of cells from both endpoints, so it read as having wandered off or
 * vanished. Now an oversized region is drawn as the bracket around the two
 * endpoints instead, which is the part of it you can actually see, and `clipped`
 * says so. The reported heights and ops are never clamped.
 */
export function coveringBox(
  from: Position, to: Position, origin: Position,
  scaleExp: number, axes: ViewAxes, maxCells: number,
): Covering {
  const step = stepFor(scaleExp)
  const screen = [axes.right, axes.up, axes.out]

  const centre: [number, number, number] = [0, 0, 0]
  const size: [number, number, number] = [1, 1, 1]
  const heights: [number, number, number] = [0, 0, 0]
  let peak = 0
  let ops = 0
  let clipped = false
  const clippedAxes: AxisName[] = []

  for (let s = 0; s < 3; s++) {
    const axis = screen[s].axis
    const height = findLcaHeight(from[axis], to[axis])
    heights[s] = height
    peak = Math.max(peak, height)
    // Same helper the cost estimate uses, so this can never quote a different
    // number from the proof panel.
    ops += subtreeCantorOps(height)

    // Below the current scale the covering subtree is finer than a cell, so it
    // is drawn as the one cell you are standing in.
    const h = BigInt(Math.max(height, scaleExp))
    const trueCells = Number((1n << h) / step)
    const base = (from[axis] >> h) << h
    const lo = cellDelta(alignTo(base, scaleExp), origin[axis], scaleExp)

    if (trueCells <= maxCells) {
      size[s] = trueCells
      centre[s] = (lo + (trueCells - 1) / 2) * screen[s].dir
      continue
    }

    // Too big to draw. Bracket the endpoints instead, which always contains both
    // however far apart they are, and never lands somewhere neither of them is.
    clipped = true
    clippedAxes.push(axis)
    const a = cellDelta(alignTo(from[axis], scaleExp), origin[axis], scaleExp)
    const b = cellDelta(alignTo(to[axis], scaleExp), origin[axis], scaleExp)
    size[s] = Math.max(1, Math.abs(b - a) + 1)
    centre[s] = ((a + b) / 2) * screen[s].dir
  }

  return { centre, size, heights, peak, ops, degenerate: peak === 0, clipped, clippedAxes }
}

/** Edges of an axis-aligned box given its centre and per-axis size, in cells. */
export function boxEdges(
  centre: [number, number, number], size: [number, number, number],
): BufferGeometry {
  const h: [number, number, number] = [size[0] / 2, size[1] / 2, size[2] / 2]
  const corner = (sx: number, sy: number, sz: number): number[] =>
    [centre[0] + sx * h[0], centre[1] + sy * h[1], centre[2] + sz * h[2]]

  const v: number[] = []
  for (const sz of [-1, 1]) {
    for (const sy of [-1, 1]) v.push(...corner(-1, sy, sz), ...corner(1, sy, sz))
    for (const sx of [-1, 1]) v.push(...corner(sx, -1, sz), ...corner(sx, 1, sz))
  }
  for (const sy of [-1, 1]) {
    for (const sx of [-1, 1]) v.push(...corner(sx, sy, -1), ...corner(sx, sy, 1))
  }

  const geom = new BufferGeometry()
  geom.setAttribute('position', new Float32BufferAttribute(v, 3))
  return geom
}
