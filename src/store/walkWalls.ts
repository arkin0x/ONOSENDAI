/**
 * walkWalls.ts - how far a WALK step may go before a shard's wall
 * (lib/walkConstrain.ts; arkinox, 2026-10-23).
 *
 * Asked once per press, by useWalk only: HOP, VIEW, BUILD and everything
 * that plans a route never ask, so the constraint is the walker's own and
 * nothing else's. It is a courtesy this client pays its walker, not a rule of
 * the space: the chain does not know about it, and another client walks
 * through (DECK-0003 §1.12).
 *
 * What it reads is what the scene draws: the shards placed in the world in
 * your plane (useShards worldItems), each at its own place, size, pose and
 * region clip, with the objects it places. Each one's triangles are built
 * once and kept until its model changes; the objects a shard places are
 * resolved through the same fetch cache the scene draws them from
 * (lib/parts.ts), so nothing is fetched twice, and until they arrive only
 * the shard's own faces count. A box test in exact bigint gibsons skips every
 * shard the step cannot reach before any float is made.
 */

import { resolveParts, type Placed } from 'sno-core/parts'
import type { ShardModel } from 'sno-core/shards'
import { fetchRef } from '../lib/parts'
import { regionBox, type Box } from '../lib/clip'
import { placedPose } from '../lib/pose'
import type { AxisName, Position, ViewAxes } from '../lib/space'
import { firstHit, wallMesh, type WallMesh } from '../lib/walkConstrain'
import { useShards, type WorldItem } from './useShards'

/**
 * The frame the walls are measured in: screen right +X, up +Y, out of the
 * screen -Z, where viewPose is the identity (lib/pose.ts), so a shard's
 * render frame is cyberspace's with Z flipped (sno-core toRender). Any one
 * view frame would do, the whole scene turning rigidly with it; this one
 * keeps the arithmetic plain.
 */
export const WALL_AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }

/** One shard placed in the world, as the walls need it. */
export type WallItem = Pick<WorldItem, 'key' | 'at' | 'height' | 'plane'> & { shard: ShardModel }

interface Entry {
  shard: ShardModel
  /** Where it was built for: a pose standing on the Earth depends on the place. */
  where: string
  mesh: WallMesh
  clip: Box
  /** The mesh's reach from the shard's coordinate, in whole gibsons, per cyberspace axis, or null for nothing. */
  reach: { lo: Position; hi: Position } | null
}

const entries = new Map<string, Entry>()

function whereOf(w: WallItem): string {
  return `${w.at.x}:${w.at.y}:${w.at.z}:${w.plane}:${w.height}`
}

/** The mesh's bounds in gibsons from the shard's coordinate, widened to whole gibsons and one more. */
function reachOf(mesh: WallMesh, unit: number): Entry['reach'] {
  if (!mesh.min || !mesh.max) return null
  const g = 2 ** unit
  const lo = (v: number): bigint => BigInt(Math.floor(v * g)) - 1n
  const hi = (v: number): bigint => BigInt(Math.ceil(v * g)) + 1n
  // Render Z is cyberspace -Z.
  return {
    lo: { x: lo(mesh.min[0]), y: lo(mesh.min[1]), z: lo(-mesh.max[2]) },
    hi: { x: hi(mesh.max[0]), y: hi(mesh.max[1]), z: hi(-mesh.min[2]) },
  }
}

function build(w: WallItem, placed: readonly Placed[]): Entry {
  const pose = placedPose(WALL_AXES, w.shard.up && w.plane === 0 ? { at: w.at, spin: w.shard.spin } : undefined)
  const mesh = wallMesh(w.shard, placed, pose)
  return { shard: w.shard, where: whereOf(w), mesh, clip: regionBox(w.at, w.height, w.shard.unit, WALL_AXES), reach: reachOf(mesh, w.shard.unit) }
}

/** The walls of one placed shard, built now or kept from before; its parts follow when they resolve. */
export function entryFor(w: WallItem): Entry {
  const held = entries.get(w.key)
  if (held && held.shard === w.shard && held.where === whereOf(w)) return held
  const e = build(w, [])
  entries.set(w.key, e)
  // Its parts can stop a walk whatever its own setting says (each object
  // keeps its own, §1.10), so they are resolved for every shard that has any.
  if (w.shard.parts?.length) {
    void resolveParts(w.shard, fetchRef).then((placed) => {
      if (entries.get(w.key) === e) entries.set(w.key, build(w, placed))
    }, () => { /* unreachable parts stop nothing */ })
  }
  return e
}

/**
 * Build the walls of every shard a walker in `plane` can meet, so the parts
 * they place are resolving before the first press rather than after it.
 * WALK calls it on the way in.
 */
export function warmWalls(plane: number): void {
  for (const w of wallItems(plane)) entryFor(w)
}

/** Forget every shard's walls: for tests, and an identity switch has no need of them either. */
export function clearWalls(): void {
  entries.clear()
}

/** Why a step stopped short: the shard it met, and how far it may go. */
export interface WallStop {
  /** Whole gibsons the step may take, from 0 (not at all) to its full length. */
  reach: bigint
  /** The shard whose face is in the way, or null when nothing is. */
  by: WallItem | null
}

/** A distance short of a gibson, in gibsons: a face this near the start is the one you stand on. */
const ON_FACE = 1e-6

/**
 * How far a WALK step from `from`, `length` gibsons along `axis` in direction
 * `dir`, may go among `items` before it would cross a blocking face. Stopped,
 * it lands on the last whole gibson short of the face, never on it; a face
 * within a gibson ahead leaves no room, and the step is refused (reach 0).
 */
export function stepLimit(from: Position, axis: AxisName, dir: 1 | -1, length: bigint, items: readonly WallItem[]): WallStop {
  const keep = new Set<string>()
  let best: number | null = null
  let by: WallItem | null = null
  const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  for (const w of items) {
    keep.add(w.key)
    const e = entryFor(w)
    if (!e.reach) continue
    // Exact first: the step against the walls' box, in bigint gibsons.
    const off = { x: from.x - w.at.x, y: from.y - w.at.y, z: from.z - w.at.z }
    const others = (['x', 'y', 'z'] as const).filter((a) => a !== axis)
    if (others.some((a) => off[a] < e.reach!.lo[a] || off[a] > e.reach!.hi[a])) continue
    const a0 = off[axis], a1 = off[axis] + BigInt(dir) * length
    if ((a0 < e.reach.lo[axis] && a1 < e.reach.lo[axis]) || (a0 > e.reach.hi[axis] && a1 > e.reach.hi[axis])) continue
    // Then the triangles, in the shard's own model units from its origin.
    const g = 2 ** w.shard.unit
    const o: [number, number, number] = [Number(off.x) / g, Number(off.y) / g, -Number(off.z) / g]
    const s = (i === 2 ? -dir : dir) as 1 | -1
    const minT = ON_FACE / g
    const t = firstHit(e.mesh, o, i, s, Number(length) / g + minT, minT, e.clip)
    if (t === null) continue
    const gib = t * g
    if (best === null || gib < best) { best = gib; by = w }
  }
  for (const k of entries.keys()) if (!keep.has(k)) entries.delete(k)
  if (best === null) return { reach: length, by: null }
  // The last whole gibson strictly short of the face.
  const k = Math.max(0, Math.ceil(best - ON_FACE) - 1)
  const reach = BigInt(k) < length ? BigInt(k) : length
  return { reach, by }
}

/** The shards a walker in `plane` can meet: every shard placed in the world there, as the scene draws them. */
export function wallItems(plane: number): WallItem[] {
  return useShards.getState().worldItems().filter((w): w is WorldItem & { shard: ShardModel } => w.type === 'shard' && !!w.shard && w.plane === plane)
}
