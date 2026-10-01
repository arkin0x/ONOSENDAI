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
import { alignTo, markerContinuous, stepFor, type Position } from './space'

/**
 * The region cube of side 2^height that contains `at`, in the render frame of
 * a shard placed at `at` with model units of 2^unit gibsons.
 *
 * The shard's group sits where markerCentre draws it, and the frame's origin
 * is the world point that is drawn there. At and below OCCUPANCY_SCALE_MAX
 * that is the centre of the cell holding `at` at the current zoom: the
 * aligned coordinate plus half a cell. Above it, markerCentre places the
 * shard at its true position, so the frame's origin is `at` itself and there
 * is no half cell. Which of the two applies is markerContinuous's answer,
 * the same one markerCentre acts on, so the walls cannot follow a different
 * rule from the shard they seal: when this measured from the cell centre at
 * every zoom, from 2^34 to 2^79 the box sat up to half a cell off the shard
 * it was drawn on (arkinox, 2026-10-01).
 *
 * Each render axis is one world axis with a direction, as markerCentre maps
 * them, so a box edge on a world axis lands on its render axis at (edge
 * minus origin) over 2^unit, flipped when the axis points the other way.
 */
export function regionBox(at: Position, height: number, unit: number, scaleExp: number, axes: ViewAxes): Box {
  const h = BigInt(height)
  const continuous = markerContinuous(scaleExp)
  const half = continuous ? 0 : Number(stepFor(scaleExp)) / 2
  const perUnit = 2 ** unit
  const min: [number, number, number] = [0, 0, 0]
  const max: [number, number, number] = [0, 0, 0]
  ;[axes.right, axes.up, axes.out].forEach((a, i) => {
    const v = at[a.axis]
    const base = (v >> h) << h
    const origin = continuous ? v : alignTo(v, scaleExp)
    const lo = (Number(base - origin) - half) / perUnit
    const hi = (Number(base + (1n << h) - origin) - half) / perUnit
    if (a.dir >= 0) { min[i] = lo; max[i] = hi } else { min[i] = -hi; max[i] = -lo }
  })
  return { min, max }
}
