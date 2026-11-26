/**
 * raycast.ts - which block a look or a tap points at, and which face.
 *
 * A voxel walk along the ray (Amanatides and Woo, 1987): cell to cell, never
 * missing a corner, up to `max` blocks. In the TERRAIN view's frame, a block
 * at integer cell (i, j, k) spanning [i - 0.5, i + 0.5]. The face is the one
 * the ray came in through, as the cell beside it that a placed block fills.
 */

export interface RayHit {
  /** The block hit. */
  cell: [number, number, number]
  /** The face's outward direction, one axis: where a placed block goes is cell + normal. */
  normal: [number, number, number]
  distance: number
}

/**
 * The first cell along the ray for which `solid` is true, within `max` blocks, or null.
 *
 * `fromInside` is what a ray that starts inside a block does: 'hit' (the
 * default, the cursor's) takes that block at distance 0; 'skip' (the blocks
 * that hide a shard, scene/TerrainLayer.tsx blockOcclusion) walks on out of
 * it and takes the first block after open space, since a block's faces are
 * drawn on the outside only and from within a mass of them nothing is seen.
 */
export function raycast(
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  max: number,
  solid: (i: number, j: number, k: number) => boolean,
  fromInside: 'hit' | 'skip' = 'hit',
): RayHit | null {
  const len = Math.hypot(dir[0], dir[1], dir[2])
  if (!(len > 0)) return null
  const d = [dir[0] / len, dir[1] / len, dir[2] / len]
  // Shifted half a block, so a cell is [n, n + 1) and its index is a floor.
  const p = [origin[0] + 0.5, origin[1] + 0.5, origin[2] + 0.5]
  const c = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])]
  const step = [0, 0, 0], tMax = [Infinity, Infinity, Infinity], tDelta = [Infinity, Infinity, Infinity]
  for (let a = 0; a < 3; a++) {
    if (d[a] > 0) { step[a] = 1; tMax[a] = (c[a] + 1 - p[a]) / d[a]; tDelta[a] = 1 / d[a] }
    else if (d[a] < 0) { step[a] = -1; tMax[a] = (p[a] - c[a]) / -d[a]; tDelta[a] = 1 / -d[a] }
  }
  let normal: [number, number, number] = [0, 0, 0]
  let t = 0
  // Starting inside a block: that block, with no face to place on (or, skipping, every block until open space).
  let inside = solid(c[0], c[1], c[2])
  if (inside && fromInside === 'hit') return { cell: [c[0], c[1], c[2]], normal, distance: 0 }
  // Enough steps to cross `max` blocks on the longest diagonal, and never fewer than the cursor's 64.
  const steps = Math.max(64, Math.ceil(3 * max) + 3)
  for (let n = 0; n < steps; n++) {
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2)
    t = tMax[a]
    if (t > max) return null
    c[a] += step[a]
    tMax[a] += tDelta[a]
    normal = [0, 0, 0]
    normal[a] = -step[a]
    const here = solid(c[0], c[1], c[2])
    if (here && !inside) return { cell: [c[0], c[1], c[2]], normal, distance: t }
    if (!here) inside = false
  }
  return null
}
