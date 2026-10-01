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
import type { Position, ViewAxes } from './space'

/**
 * The region cube of side 2^height that contains `at`, in the frame of a
 * shard placed at `at` with model units of 2^unit gibsons.
 *
 * The shard's group sits where itemCentre draws it, at `at` plus half a
 * gibson, at every zoom, so that world point is the frame's origin and the
 * zoom does not enter into it. Which part of a shard lies inside its bag's
 * region is a fact about the data, and now it is drawn as one: the same box,
 * the same cut, the same shape at every zoom. It used to be measured from the
 * frame of the zoom's cell, where the shard was snapped, and once a cell was
 * larger than the region the snap carried the shard out of its own region
 * and the clipper cut it away. A 16-gibson shard hidden off centre in a 2^4
 * region drew 7, 7, 10, 14, 6, 10, 0 and 0 triangles from 2^0 to 2^7, and
 * nothing from 2^6 while it was still about 8 px across (arkinox,
 * 2026-10-01).
 *
 * Each render axis is one world axis with a direction, as itemCentre maps
 * them, so a box edge on a world axis lands on its render axis at (edge minus
 * origin) over 2^unit, flipped when the axis points the other way. In render
 * space the walls fall where the region cages draw them: the item's place
 * plus (edge minus at minus half a gibson) is the edge's own place.
 */
export function regionBox(at: Position, height: number, unit: number, axes: ViewAxes): Box {
  const h = BigInt(height)
  const perUnit = 2 ** unit
  const min: [number, number, number] = [0, 0, 0]
  const max: [number, number, number] = [0, 0, 0]
  ;[axes.right, axes.up, axes.out].forEach((a, i) => {
    const v = at[a.axis]
    const base = (v >> h) << h
    const lo = (Number(base - v) - 0.5) / perUnit
    const hi = (Number(base + (1n << h) - v) - 0.5) / perUnit
    if (a.dir >= 0) { min[i] = lo; max[i] = hi } else { min[i] = -hi; max[i] = -lo }
  })
  return { min, max }
}
