/**
 * deployFit.ts: the smallest hiding height whose region holds a whole model
 * (arkinox, 2026-10-01: "default the hide height so its always large enough
 * to show the whole model").
 *
 * A bag is sealed to the aligned cube of side 2^height that holds its point
 * (spec §7.6), and a shard is clipped to that cube, so a model hidden at too
 * low a height is drawn cut off. The model's reach is the distance from its
 * origin to its farthest vertex, in gibsons at the deploy scale: a sphere of
 * that radius covers the model in every orientation, so a quarter turn or
 * standing it on Earth can never push it out of the region. The deploy point
 * depends on the height (space.ts deployPoint centres it in the cursor's cell
 * at that height, and in the build STEP's cell), so each height is tried in
 * turn.
 *
 * Placed objects (parts) are counted at their anchor points only: their own
 * geometry is another event, not at hand here.
 *
 * A chest asks the same question of several things at once (arkinox,
 * 2026-10-10: a shard aimed into a chest must come out where it was aimed).
 * Its contents stand at their own points only inside the chest's region
 * (chests.ts revealedIn), so the chest's height is the smallest whose region
 * holds its own point and every aimed point, each with its model's reach. The
 * single-shard fit is that same question with no extra points.
 */

import { TICKS_PER_UNIT, ticksOf, type ShardModel } from 'sno-core/shards'
import { deployPoint, type Position } from './space'

/** The model's reach from its origin, in ticks of its own grid (rounded up). */
export function reachTicks(shard: Pick<ShardModel, 'vertices' | 'parts'>): number {
  let r2 = 0
  for (const v of shard.vertices) {
    const [x, y, z] = ticksOf(v)
    r2 = Math.max(r2, x * x + y * y + z * z)
  }
  for (const part of shard.parts ?? []) {
    const [x, y, z] = part.at
    r2 = Math.max(r2, x * x + y * y + z * z)
  }
  return Math.ceil(Math.sqrt(r2))
}

/** The reach in gibsons when one model unit is 2^unit gibsons (rounded up). */
export function reachGibsons(shard: Pick<ShardModel, 'vertices' | 'parts'>, unit: number): bigint {
  const ticks = BigInt(reachTicks(shard))
  const per = BigInt(TICKS_PER_UNIT)
  const scale = 1n << BigInt(Math.max(0, unit))
  return (ticks * scale + per - 1n) / per
}

/** Whether a sphere of radius `r` gibsons around `p` lies in the aligned 2^h cube holding `p`. */
export function fitsAt(p: Position, r: bigint, h: number): boolean {
  const H = BigInt(h)
  for (const v of [p.x, p.y, p.z]) {
    const lo = v - r
    const hi = v + r
    if (lo < 0n) return false
    if ((lo >> H) !== (v >> H) || (hi >> H) !== (v >> H)) return false
  }
  return true
}

/**
 * The height the model's size alone asks for: the smallest whose region holds
 * it with the model at the region's center, the best place there is. A
 * centered sphere of radius r fits a 2^h cube when r < 2^(h - 1); at height 0
 * only a point does. Wherever it really sits, fitHeight is at least this.
 */
export function sizeHeight(shard: Pick<ShardModel, 'vertices' | 'parts'>, unit: number): number {
  const r = reachGibsons(shard, unit)
  if (r === 0n) return 0
  let h = 1
  while ((1n << BigInt(h - 1)) <= r) h++
  return h
}

/**
 * Why the fitted height is what it is: 'size' when the model's size sets it
 * (or no region up to the ceiling is big enough), 'edge' when its place does:
 * it sits across the edge of a region big enough for it, so the next one up
 * is needed, or none fits at all, next to coordinate 0 say. A model about
 * 2^10 across one gibson past a 2^30 boundary needs height 31, and saying it
 * is too large would blame the wrong thing (found in review, 2026-10-08).
 */
export function fitCause(shard: Pick<ShardModel, 'vertices' | 'parts'>, unit: number, fitted: number | null, max: number): 'size' | 'edge' {
  const needs = sizeHeight(shard, unit)
  return fitted === null ? (needs <= max ? 'edge' : 'size') : (fitted > needs ? 'edge' : 'size')
}

/** A thing the region must hold: a point and the reach of what stands there (0 for a point alone). */
export interface FitPoint {
  at: Position
  reach: bigint
}

/** The aligned 2^h cube a point lies in, as the three cube indices. */
function cubeOf(p: Position, h: number): [bigint, bigint, bigint] {
  const H = BigInt(h)
  return [p.x >> H, p.y >> H, p.z >> H]
}

/**
 * Whether the aligned 2^h cube holding `center` holds every point too, each
 * with its reach inside the cube: the same cube, not merely a cube each.
 */
export function fitsAllAt(center: Position, h: number, points: FitPoint[]): boolean {
  const [cx, cy, cz] = cubeOf(center, h)
  for (const p of points) {
    const [x, y, z] = cubeOf(p.at, h)
    if (x !== cx || y !== cy || z !== cz) return false
    if (!fitsAt(p.at, p.reach, h)) return false
  }
  return true
}

/** How many of the points fall outside the aligned 2^h cube holding `center` (their reach not counted). */
export function outsideAt(center: Position, h: number, points: FitPoint[]): number {
  const [cx, cy, cz] = cubeOf(center, h)
  let n = 0
  for (const p of points) {
    const [x, y, z] = cubeOf(p.at, h)
    if (x !== cx || y !== cy || z !== cz) n++
  }
  return n
}

/**
 * The smallest height from `min` to `max` at which a sphere of `reach` around
 * the deploy point fits its region, and that region holds every one of
 * `points` too; `null` when none does. The deploy point depends on the height,
 * so each is tried in turn.
 */
export function fitHeightAll(reach: bigint, points: FitPoint[], cursor: Position, step: number, min: number, max: number): number | null {
  for (let h = Math.max(0, min); h <= max; h++) {
    const at = deployPoint(cursor, step, h)
    if (fitsAt(at, reach, h) && fitsAllAt(at, h, points)) return h
  }
  return null
}

/**
 * The smallest height from `min` to `max` at which the whole model fits in the
 * region around where it would be hidden; `null` when none does.
 */
export function fitHeight(shard: Pick<ShardModel, 'vertices' | 'parts'>, unit: number, cursor: Position, step: number, min: number, max: number): number | null {
  return fitHeightAll(reachGibsons(shard, unit), [], cursor, step, min, max)
}
