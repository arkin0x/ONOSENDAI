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
 * (lib/parts.ts), so nothing is fetched twice, and read from their payloads
 * once for every shard (resolvePartsShared), so a room placed by a hundred
 * shards is one model; until they arrive only the shard's own faces count.
 * A placed object's triangles are its model's, shared, and worked out where
 * it stands only when a step comes near it (lib/walkConstrain.ts). A box test in exact bigint gibsons skips every
 * shard the step cannot reach before any float is made.
 */

import type { Placed } from 'sno-core/parts'
import type { ShardModel } from 'sno-core/shards'
import { resolvePartsShared } from '../lib/parts'
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
  /** When its parts were resolved with one unreachable: tried again after RETRY_MS. */
  missingAt: number | null
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
  const missingAt = placed.some(function gone(p): boolean { return p.missing === 'unreachable' || p.children.some(gone) }) ? Date.now() : null
  return { shard: w.shard, missingAt, where: whereOf(w), mesh, clip: regionBox(w.at, w.height, w.shard.unit, WALL_AXES), reach: reachOf(mesh, w.shard.unit) }
}

/** The walls of one placed shard, built now or kept from before; its parts follow when they resolve. */
export function entryFor(w: WallItem): Entry {
  const held = entries.get(w.key)
  // A part a relay did not answer is asked for again after a while (lib/parts.ts does not keep a miss).
  if (held && held.shard === w.shard && held.where === whereOf(w)) {
    if (held.missingAt !== null && Date.now() - held.missingAt > RETRY_MS) { held.missingAt = null; resolveInto(w, held) }
    return held
  }
  const e = build(w, [])
  entries.set(w.key, e)
  resolveInto(w, e)
  return e
}

/** How long a part no relay answered stays a placeholder before it is asked for again. */
const RETRY_MS = 30_000

/**
 * Resolve the objects `w` places and rebuild its walls with them, unless the
 * entry has been replaced meanwhile. Its parts can stop a walk whatever its
 * own setting says (each object keeps its own, §1.10), so they are resolved
 * for every shard that has any.
 */
function resolveInto(w: WallItem, e: Entry): void {
  if (!w.shard.parts?.length) return
  void resolvePartsShared(w.shard).then((placed) => {
    if (entries.get(w.key) === e) entries.set(w.key, build(w, placed))
  }, () => { /* unreachable parts stop nothing */ })
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
 * How far off, in gibsons, a measured distance to a face may be. A double
 * holds 53 bits, so once a shard's reach passes 2^53 gibsons (a monument at a
 * coarse unit) the measure is out by a gibson or more. Any step that gets past
 * the box test is within the shard's reach plus the step's length of its
 * origin, so 2^-48 of that sum leaves more than ten times the error (review
 * of #461). The box is widened by it, a step stops at least this far short of
 * a face, and a step that would end within it of a face meets the face, so no
 * press ever starts too near a face to tell which side of it the walker is on.
 */
function tolerance(e: Entry, g: number, length: bigint): number {
  const m = e.mesh
  const reach = m.min && m.max ? Math.max(...m.min.map(Math.abs), ...m.max.map(Math.abs)) * g : 0
  return Math.max(ON_FACE, (reach + Number(length)) * 2 ** -48)
}

/**
 * How far a WALK step from `from`, `length` gibsons along `axis` in direction
 * `dir`, may go among `items` before it would cross a blocking face. Stopped,
 * it lands on the last whole gibson at least the measure's tolerance short of
 * the face (one gibson short at small units and steps), never on it; a face
 * with no room before it refuses the step (reach 0).
 *
 * With `stand`, GRAVITY's question (what is under you), a step down is
 * measured from a hair (ON_FACE) above the walker's point, so a face in the
 * walker's own plane is under it and holds it: you stand on the floor you are
 * exactly on instead of falling through it. WALK never stops there, but a HOP,
 * a VIEW, a BUILD or a floor deployed at your own height can put you there.
 * The hair is in this question only: nothing moves, nothing is published, and
 * every face a hair or more from the point is met exactly as without it.
 * Only where the measure can tell a hair (a tolerance of ON_FACE): on a
 * monument the face you stand on lets you go, as below.
 */
export function stepLimit(from: Position, axis: AxisName, dir: 1 | -1, length: bigint, items: readonly WallItem[], stand = false): WallStop {
  const keep = new Set<string>()
  let best: number | null = null
  let bestTol = ON_FACE
  let by: WallItem | null = null
  const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  for (const w of items) {
    keep.add(w.key)
    const e = entryFor(w)
    if (!e.reach) continue
    // Exact first: the step against the walls' box, in bigint gibsons,
    // widened by what the float test below may be off by.
    const g = 2 ** w.shard.unit
    const tol = tolerance(e, g, length)
    const pad = BigInt(Math.ceil(tol))
    const lo = e.reach.lo, hi = e.reach.hi
    const off = { x: from.x - w.at.x, y: from.y - w.at.y, z: from.z - w.at.z }
    const others = (['x', 'y', 'z'] as const).filter((a) => a !== axis)
    if (others.some((a) => off[a] < lo[a] - pad || off[a] > hi[a] + pad)) continue
    const a0 = off[axis], a1 = off[axis] + BigInt(dir) * (length + pad)
    if ((a0 < lo[axis] - pad && a1 < lo[axis] - pad) || (a0 > hi[axis] + pad && a1 > hi[axis] + pad)) continue
    // Then the triangles, in the shard's own model units from its origin.
    const o: [number, number, number] = [Number(off.x) / g, Number(off.y) / g, -Number(off.z) / g]
    const s = (i === 2 ? -dir : dir) as 1 | -1
    // The face you stand on lets you go. WALK always stops at least `tol`
    // short of a face, so a walker it brought here is never that near one. A
    // walker HOPped to within the measure's error of a face on a monument (a
    // shard past about 2^53 gibsons) may still cross it, which is accepted:
    // holding it there would hold it stepping away from the face too.
    // Asked to stand (above), a face in your own plane is under you instead.
    const under = stand && axis === 'y' && dir < 0 && tolerance(e, g, 0n) === ON_FACE
    const minT = (under ? -ON_FACE : ON_FACE) / g
    // A step that would end within `tol` of a face meets it (tolerance).
    const t = firstHit(e.mesh, o, i, s, (Number(length) + tol) / g, minT, e.clip)
    if (t === null) continue
    const gib = t * g
    if (best === null || gib < best) { best = gib; bestTol = tol; by = w }
  }
  for (const k of entries.keys()) if (!keep.has(k)) entries.delete(k)
  if (best === null) return { reach: length, by: null }
  // The last whole gibson at least `tol` short of the face: one short at a
  // fine zoom, further at a coarse one, where the measure is coarser too.
  const k = Math.max(0, Math.ceil(best - bestTol) - 1)
  const reach = BigInt(k) < length ? BigInt(k) : length
  return { reach, by }
}

/** The shards a walker in `plane` can meet: every shard placed in the world there, as the scene draws them. */
export function wallItems(plane: number): WallItem[] {
  return useShards.getState().worldItems().filter((w): w is WorldItem & { shard: ShardModel } => w.type === 'shard' && !!w.shard && w.plane === plane)
}
