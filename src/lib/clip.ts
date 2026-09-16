/**
 * clip.ts - where a cyberspace region lands in a shard's own frame.
 *
 * The clipping itself is the format's, and lives in sno-core/clip: a shard
 * hidden at height h is sealed to one aligned cube of side 2^h, and the part
 * of the shape outside that cube is simply not drawn, because the region is
 * the thing the key opens and what the key opens ends at the region's walls.
 * That is plane clipping against six faces and it knows nothing about
 * cyberspace.
 *
 * What is left here is the one thing that does: turning an aligned cube of
 * cyberspace coordinates into the box the clipper wants, which needs a
 * position, a zoom and a view frame. Re-exported alongside it so a caller
 * still reaches the clipper and the box through one module.
 */

export { boxContains, clipMesh, clipPoints, type Box, type Mesh } from 'sno-core/clip'

import type { Box } from 'sno-core/clip'
import type { ViewAxes } from './space'
import { alignTo, stepFor, type Position } from './space'

/**
 * The region cube of side 2^height that contains `at`, in the render frame of
 * a shard placed at `at` with model units of 2^unit gibsons.
 *
 * The shard's group sits at the centre of the cell holding `at` at the
 * current zoom, so the frame's origin is that world point: the aligned
 * coordinate plus half a cell. Each render axis is one world axis with a
 * direction, as cellCentre maps them, so a box edge on a world axis lands on
 * its render axis at (edge minus origin) over 2^unit, flipped when the axis
 * points the other way.
 */
export function regionBox(at: Position, height: number, unit: number, scaleExp: number, axes: ViewAxes): Box {
  const h = BigInt(height)
  const half = Number(stepFor(scaleExp)) / 2
  const perUnit = 2 ** unit
  const min: [number, number, number] = [0, 0, 0]
  const max: [number, number, number] = [0, 0, 0]
  ;[axes.right, axes.up, axes.out].forEach((a, i) => {
    const v = at[a.axis]
    const base = (v >> h) << h
    const origin = alignTo(v, scaleExp)
    const lo = (Number(base - origin) - half) / perUnit
    const hi = (Number(base + (1n << h) - origin) - half) / perUnit
    if (a.dir >= 0) { min[i] = lo; max[i] = hi } else { min[i] = -hi; max[i] = -lo }
  })
  return { min, max }
}
