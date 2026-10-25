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
 *
 * What WALK resolves is bounded as a whole, not shard by shard: one budget of
 * placements (WALL_BUDGET) for every shard's parts between one WALK and the
 * next, no shard more than SHARD_BUDGET of it, nearest shards first by the
 * box of what they hold, and only for shards whose region the walker can be
 * in, since a shard is drawn, and holds a walker, only inside its region
 * (DECK-0003 §1.12). Sixty hostile shards each under sno-core's own cap used
 * to cost 3.2 s of main thread and 544 MB on the way into WALK.
 *
 * A shard the budget could not build whole is STARVED, and it fails closed:
 * the box of everything known about it (its own faces, every part that did
 * resolve and every placeholder, and a unit cube at every placement it makes,
 * within its region) is solid to a walker coming from outside, who stops a
 * gibson short of it, so nobody walks into geometry that was never built. A
 * walker already inside the box is not held by it and walks out freely: a
 * box nobody could build must not be a cell either, or any shard over the
 * budget would shut in whoever stood in it. Open would be worse than closed:
 * a hostile shard placed nearer could spend the budget and take down the
 * walls of a maze beside it.
 * A shard starved because the total ran out, not by its own size, is built
 * again when budget comes back (a shard's unused share is returned) and at
 * every WALK.
 */

import { placedBounds, type Placed } from 'sno-core/parts'
import { TICKS_PER_UNIT, ticksOf, toRender, type ShardModel } from 'sno-core/shards'
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
  item: WallItem
  /**
   * Why it was not built whole, or null: 'total', the walls' budget ran out
   * before its turn (built again when budget comes back, and at the next
   * WALK); 'ceiling', it alone needs more than SHARD_BUDGET (kept closed).
   */
  starved: 'total' | 'ceiling' | null
  /** The WALK it was built in (warmWalls), so a starved one is built again at the next. */
  walk: number
  /** A resolve for it is running: it stands as it is until that lands. */
  pending?: boolean
  /**
   * For a starved shard, the box it fails closed to, in whole gibsons from its
   * coordinate on cyberspace's axes, both ends included, within its region.
   */
  closed: { lo: Position; hi: Position } | null
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

/** The most placements WALK resolves for all the shards around a walker together, from one WALK to the next. */
export const WALL_BUDGET = 20_000
/** The most of it any one shard may take: no single shard can spend it all. */
export const SHARD_BUDGET = 4_000
/**
 * What is left of WALL_BUDGET this WALK. Each resolve is handed a fresh
 * sno-core budget object of its own share (never one refilled while a
 * resolve draws from it); what a shard does not use comes back here when its
 * resolve is done.
 */
let wallLeft = WALL_BUDGET
/** Which WALK this is (warmWalls counts them). */
let walkNo = 0

/**
 * Whether a walker at `from`, stepping `length` gibsons along `axis` (or not
 * stepping, with no axis), can be anywhere in `w`'s region, a gibson either
 * side included: a shard is drawn only inside its region, so only there can it
 * hold a walker. Exact, in bigint gibsons.
 */
export function regionReached(w: WallItem, from: Position, axis?: AxisName, dir: 1 | -1 = 1, length = 0n): boolean {
  const h = BigInt(w.height)
  for (const a of ['x', 'y', 'z'] as const) {
    const lo = ((w.at[a] >> h) << h) - 1n
    const hi = ((w.at[a] >> h) << h) + (1n << h)
    const p0 = from[a]
    const p1 = a === axis ? p0 + BigInt(dir) * length : p0
    const min = p0 < p1 ? p0 : p1, max = p0 < p1 ? p1 : p0
    if (max < lo || min > hi) return false
  }
  return true
}

/** What is left of WALK's placement budget: for tests. */
export function wallBudgetLeft(): number {
  return wallLeft
}

/**
 * The box of what a shard is known to hold before anything it places is
 * fetched, in whole gibsons from its coordinate: its own vertices and the
 * origin of every placement it makes. Where "nearest" is measured to, rather
 * than its anchor point, which a hider places where they like.
 */
function knownBox(s: ShardModel): { lo: Position; hi: Position } | null {
  const pts = [...s.vertices.map((v) => ticksOf(v)), ...(s.parts ?? []).map((p) => p.at)]
  if (!pts.length) return null
  const g = 2 ** s.unit
  const lo = [0, 1, 2].map((k) => BigInt(Math.floor((Math.min(...pts.map((p) => p[k])) / TICKS_PER_UNIT - 1) * g)))
  const hi = [0, 1, 2].map((k) => BigInt(Math.ceil((Math.max(...pts.map((p) => p[k])) / TICKS_PER_UNIT + 1) * g)))
  return { lo: { x: lo[0], y: lo[1], z: lo[2] }, hi: { x: hi[0], y: hi[1], z: hi[2] } }
}

/** How far `from` is from the box of what `w` holds, the larger axis gap, 0 inside it. */
function distanceTo(w: WallItem, from: Position): bigint {
  const box = knownBox(w.shard)
  if (!box) return farness(w.at, from)
  let far = 0n
  for (const a of ['x', 'y', 'z'] as const) {
    const p = from[a] - w.at[a]
    const gap = p < box.lo[a] ? box.lo[a] - p : p > box.hi[a] ? p - box.hi[a] : 0n
    if (gap > far) far = gap
  }
  return far
}

/** The larger of the three axis distances between two places, in gibsons: nearest first. */
function farness(a: Position, b: Position): bigint {
  const d = (x: bigint): bigint => (x < 0n ? -x : x)
  const xs = [d(a.x - b.x), d(a.y - b.y), d(a.z - b.z)]
  return xs.reduce((m, x) => (x > m ? x : m), 0n)
}

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

/**
 * The box a starved shard fails closed to: everything known about it (its own
 * vertices, every part that resolved and every placeholder, through sno-core
 * placedBounds, and a unit cube at every placement it makes), in whole
 * gibsons from its coordinate, cut to its region, since nothing of it holds a
 * walker outside that. A shard standing on the Earth (posed) is turned in a
 * way this box does not follow, so it takes the cube that holds the box at
 * any turn. Null for nothing known.
 */
function closedBox(w: WallItem, placed: readonly Placed[]): Entry['closed'] {
  const s = w.shard
  const known = placedBounds(s, [...placed])
  const min = known ? [...known.min] : [Infinity, Infinity, Infinity]
  const max = known ? [...known.max] : [-Infinity, -Infinity, -Infinity]
  for (const p of s.parts ?? []) {
    const c = toRender(p.at)
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], c[k] - 0.5); max[k] = Math.max(max[k], c[k] + 0.5) }
  }
  if (min[0] === Infinity) return null
  const g = 2 ** s.unit
  // Render to cyberspace: Z negated.
  let lo = [min[0], min[1], -max[2]].map((v) => BigInt(Math.floor(v * g)))
  let hi = [max[0], max[1], -min[2]].map((v) => BigInt(Math.ceil(v * g)))
  if (s.up && w.plane === 0) {
    const r = BigInt(Math.ceil(Math.max(...[...min, ...max].map(Math.abs)) * g * Math.sqrt(3)))
    lo = [-r, -r, -r]
    hi = [r, r, r]
  }
  const h = BigInt(w.height)
  const axes = ['x', 'y', 'z'] as const
  const out = { lo: { x: 0n, y: 0n, z: 0n }, hi: { x: 0n, y: 0n, z: 0n } }
  for (let k = 0; k < 3; k++) {
    const a = axes[k]
    const base = (w.at[a] >> h) << h
    const rlo = base - w.at[a], rhi = base + (1n << h) - 1n - w.at[a]
    out.lo[a] = lo[k] > rlo ? lo[k] : rlo
    out.hi[a] = hi[k] < rhi ? hi[k] : rhi
    if (out.lo[a] > out.hi[a]) return null
  }
  return out
}

/**
 * How far a step from `off` (from the shard's coordinate) may go before it
 * would enter the closed box, one gibson short; null when it never enters it,
 * and null when it starts inside it, which lets it walk out.
 */
function boxReach(box: NonNullable<Entry['closed']>, off: Position, axis: AxisName, dir: 1 | -1, length: bigint): bigint | null {
  const inside = (['x', 'y', 'z'] as const).every((a) => off[a] >= box.lo[a] && off[a] <= box.hi[a])
  if (inside) return null
  if ((['x', 'y', 'z'] as const).some((a) => a !== axis && (off[a] < box.lo[a] || off[a] > box.hi[a]))) return null
  const d = dir > 0 ? box.lo[axis] - off[axis] : off[axis] - box.hi[axis]
  if (d <= 0n || d > length) return null
  return d - 1n
}

/** Whether a resolve was cut short anywhere by the budget. */
function cutShort(placed: readonly Placed[]): boolean {
  return placed.some(function short(p): boolean { return p.missing === 'budget' || p.children.some(short) })
}

function build(w: WallItem, placed: readonly Placed[], starved: Entry['starved'] = null): Entry {
  const pose = placedPose(WALL_AXES, w.shard.up && w.plane === 0 ? { at: w.at, spin: w.shard.spin } : undefined)
  const mesh = wallMesh(w.shard, placed, pose)
  const missingAt = placed.some(function gone(p): boolean { return p.missing === 'unreachable' || p.children.some(gone) }) ? Date.now() : null
  return { item: w, starved, walk: walkNo, closed: starved ? closedBox(w, placed) : null, shard: w.shard, missingAt, where: whereOf(w), mesh, clip: regionBox(w.at, w.height, w.shard.unit, WALL_AXES), reach: reachOf(mesh, w.shard.unit) }
}

/** The walls of one placed shard, built now or kept from before; its parts follow when they resolve. */
export function entryFor(w: WallItem): Entry {
  const held = entries.get(w.key)
  // A part a relay did not answer is asked for again after a while (lib/parts.ts does not keep a miss).
  if (held && held.shard === w.shard && held.where === whereOf(w)) {
    if (held.missingAt !== null && Date.now() - held.missingAt > RETRY_MS) { held.missingAt = null; resolveInto(w, held) }
    // Starved in an earlier WALK: built again with this WALK's budget.
    else if (held.starved && held.walk !== walkNo) { held.walk = walkNo; resolveInto(w, held) }
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
  const share = Math.min(SHARD_BUDGET, wallLeft)
  if (share <= 0) {
    // Nothing left this WALK: closed until budget comes back.
    if (entries.get(w.key) === e) entries.set(w.key, build(w, [], 'total'))
    return
  }
  wallLeft -= share
  e.pending = true
  // A fresh budget object for this resolve alone.
  const mine = { left: share }
  void resolvePartsShared(w.shard, undefined, undefined, mine).then((placed) => {
    wallLeft += Math.max(0, mine.left)
    const starved = cutShort(placed) ? (share >= SHARD_BUDGET ? 'ceiling' : 'total') : null
    if (entries.get(w.key) === e) entries.set(w.key, build(w, placed, starved))
    reviveStarved()
  }, () => { e.pending = false; wallLeft += Math.max(0, mine.left) /* unreachable parts stop nothing */ })
}

/** Build again, nearest first, the shards starved only because the total ran out, while there is budget for them. */
function reviveStarved(): void {
  for (const e of entries.values()) {
    if (wallLeft <= 0) return
    // It stays closed as it is until the new resolve lands.
    if (e.starved === 'total' && !e.pending) resolveInto(e.item, e)
  }
}

/**
 * Build the walls of the shards a walker at `from` in `plane` stands among,
 * nearest first, so the parts they place are resolving before the first press
 * rather than after it, and start WALK's placement budget afresh: every shard
 * resolved until the next WALK shares it. WALK calls it on the way in. Shards
 * further off are built when a step can reach their region (stepLimit).
 */
export function warmWalls(plane: number, from?: Position): void {
  // This WALK's budget, whole; a resolve still running from before keeps the
  // share it was handed, and returns what it did not use.
  wallLeft = WALL_BUDGET
  walkNo++
  const items = wallItems(plane)
  const near = from ? items.filter((w) => regionReached(w, from)).sort((a, b) => { const x = distanceTo(a, from), y = distanceTo(b, from); return x < y ? -1 : x > y ? 1 : 0 }) : items
  for (const w of near) entryFor(w)
}

/** Forget every shard's walls: for tests, and an identity switch has no need of them either. */
export function clearWalls(): void {
  entries.clear()
  wallLeft = WALL_BUDGET
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
 */
export function stepLimit(from: Position, axis: AxisName, dir: 1 | -1, length: bigint, items: readonly WallItem[]): WallStop {
  const keep = new Set<string>()
  let best: number | null = null
  let bestTol = ON_FACE
  let by: WallItem | null = null
  let boxBest: bigint | null = null
  let boxBy: WallItem | null = null
  const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  for (const w of items) {
    keep.add(w.key)
    // A shard whose region this step cannot enter cannot hold it: not built,
    // and nothing it places resolved, until a step can.
    if (!regionReached(w, from, axis, dir, length)) continue
    const e = entryFor(w)
    // A starved shard's closed box, exact in gibsons (it fails closed).
    if (e.closed) {
      const r = boxReach(e.closed, { x: from.x - w.at.x, y: from.y - w.at.y, z: from.z - w.at.z }, axis, dir, length)
      if (r !== null && (boxBest === null || r < boxBest)) { boxBest = r; boxBy = w }
    }
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
    const minT = ON_FACE / g
    // A step that would end within `tol` of a face meets it (tolerance).
    const t = firstHit(e.mesh, o, i, s, (Number(length) + tol) / g, minT, e.clip)
    if (t === null) continue
    const gib = t * g
    if (best === null || gib < best) { best = gib; bestTol = tol; by = w }
  }
  for (const k of entries.keys()) if (!keep.has(k)) entries.delete(k)
  // The last whole gibson at least `tol` short of the face: one short at a
  // fine zoom, further at a coarse one, where the measure is coarser too.
  const k = best === null ? null : Math.max(0, Math.ceil(best - bestTol) - 1)
  const reach = k === null || BigInt(k) >= length ? length : BigInt(k)
  if (boxBest !== null && boxBest < reach) return { reach: boxBest, by: boxBy }
  return best === null ? { reach: length, by: null } : { reach, by }
}

/** The shards a walker in `plane` can meet: every shard placed in the world there, as the scene draws them. */
export function wallItems(plane: number): WallItem[] {
  return useShards.getState().worldItems().filter((w): w is WorldItem & { shard: ShardModel } => w.type === 'shard' && !!w.shard && w.plane === plane)
}
