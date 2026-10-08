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
 * The smallest height from `min` to `max` at which the whole model fits in the
 * region around where it would be hidden; `null` when none does.
 */
export function fitHeight(shard: Pick<ShardModel, 'vertices' | 'parts'>, unit: number, cursor: Position, step: number, min: number, max: number): number | null {
  const r = reachGibsons(shard, unit)
  for (let h = Math.max(0, min); h <= max; h++) {
    if (fitsAt(deployPoint(cursor, step, h), r, h)) return h
  }
  return null
}
