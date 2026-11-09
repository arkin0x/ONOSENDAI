/**
 * How far the bench camera may pull back, and how deep it sees, for the shard
 * on it (arkinox, 2026-11-09: "im editing basilica garden court in the
 * workshop and i cant zoom out far enough to fit the whole shard in the
 * view"). The orbit's reach was a flat 60 units, which fits a shard about 25
 * units round at the bench's 50 degree lens; a Maze Kit court is 48 units
 * across. Now the reach is whatever fits the whole shard, its placed objects
 * as drawn included, with room to spare, and never less than the 60 it was,
 * so a small shard zooms exactly as before.
 *
 * Pure, so the numbers are tested without a canvas (benchReach.test.ts).
 */
import { refKey, placedBounds, type Placed } from 'sno-core/parts'
import type { ShardModel } from 'sno-core/shards'
import type { Resolved } from '../lib/parts'

/** The bench's reach before it knew the shard's size: a small shard keeps it. */
export const MIN_REACH = 60
/** How close the orbit may come to its target: a fifth-gibson step fills a good share of a phone. */
export const MIN_DISTANCE = 0.6
/** The camera's near and far planes as the bench opens. */
export const BASE_NEAR = 0.05
export const BASE_FAR = 200
/** Room round a fitted shard: it fills the narrower side of the view to about 87%. */
const FIT_MARGIN = 1.15
/** How much farther than a snug fit the wheel or a pinch may take you. */
const REACH_ROOM = 1.5

/** A sphere in render units round everything a shard draws. */
export interface Sphere { center: [number, number, number]; radius: number }

/**
 * The sphere round what the bench draws for `shard`: its vertices and every
 * placed object where its placement puts it, as ShardMesh draws them (a
 * placement still being fetched, or that resolved to nothing, as the unit
 * placeholder cube at its spot). Null for a shard that draws nothing.
 */
export function shardSphere(shard: ShardModel, byRef: ReadonlyMap<string, Resolved>): Sphere | null {
  const placed: Placed[] = []
  for (const part of shard.parts ?? []) {
    const ref = shard.refs?.[part.ref]
    if (!ref) continue
    const r = byRef.get(refKey(ref))
    placed.push({ part, ref, model: r?.model ?? null, children: r?.children ?? [] })
  }
  const b = placedBounds(shard, placed)
  if (!b) return null
  const center: [number, number, number] = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
  const radius = Math.hypot(b.max[0] - center[0], b.max[1] - center[1], b.max[2] - center[2])
  return { center, radius }
}

/**
 * The radius round the orbit's target that holds the whole sphere: the
 * camera turns about its target, not the shard's centre (a pan moves the
 * target, and it opens on the vertices' centroid), so the sphere grows by how
 * far that target stands off. Zero for a shard that draws nothing.
 */
export function reachRadius(sphere: Sphere | null, target: { x: number; y: number; z: number }): number {
  if (!sphere) return 0
  const [x, y, z] = sphere.center
  return sphere.radius + Math.hypot(target.x - x, target.y - y, target.z - z)
}

/**
 * The distance from a sphere's centre at which it just fits the view, with a
 * little room round it: in the narrower of the vertical field of view and the
 * horizontal one the aspect makes of it, so a phone held upright, whose width
 * is the narrow side, fits it across as a desktop fits it top to bottom.
 */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const v = (fovDeg * Math.PI) / 360
  const h = Math.atan(Math.tan(v) * aspect)
  const half = Math.min(v, h)
  return (Math.max(0, radius) / Math.sin(half)) * FIT_MARGIN
}

/** How far the orbit may pull back to see a sphere of `radius` whole, never less than the bench always allowed. */
export function reachFor(radius: number, fovDeg: number, aspect: number): number {
  return Math.max(MIN_REACH, fitDistance(radius, fovDeg, aspect) * REACH_ROOM)
}

/**
 * The orbit's max distance from what fits and where the camera stands now.
 * It grows with the shard at once; when the shard shrinks (or the screen
 * turns to a wider one) it never drops below the camera's own distance,
 * since the controls would clamp the camera in to it on their next update and
 * yank the view out from under you. It comes in the rest of the way as you do.
 */
export function nextMaxDistance(fit: number, distance: number): number {
  return Math.max(fit, distance)
}

/**
 * The near and far planes for a camera `distance` from its target with a
 * sphere `reach` round that target: far enough past the target to keep the
 * whole of the shard behind it, and the near plane pulled out with the
 * distance so the depth buffer keeps its precision there (the faces of a
 * court seen from 200 units must not fight). Never nearer or shallower than
 * the bench opened with, so a small shard draws as it did.
 */
export function clipPlanes(distance: number, reach: number): { near: number; far: number } {
  return {
    near: Math.max(BASE_NEAR, distance * 0.002),
    far: Math.max(BASE_FAR, (distance + reach) * 1.5),
  }
}
