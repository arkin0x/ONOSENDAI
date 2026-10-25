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
 * What WALK resolves is bounded, and ordered BY TRUST (arkinox, 2026-10-25:
 * "ok A sounds good"). Your own shards, and shards by authors you follow
 * (your kind 3 contact list, lib/contacts.ts followsOf), draw from a reserved
 * share, TRUSTED_BUDGET, which no stranger can spend; each may take up to
 * sno-core's MAX_PLACED, and they are resolved first, nearest to the walker
 * first by the box of what they have resolved so far (their own faces before
 * anything is fetched). Strangers share the rest, STRANGER_BUDGET, no shard
 * more than STRANGER_SHARD of it. Only shards whose region the walker can be
 * in are resolved at all, since a shard is drawn, and holds a walker, only
 * inside its region (DECK-0003 §1.12).
 *
 * A shard its share could not build whole is STARVED, and walkable where it
 * could not be built: the placeholders of what was cut short stop nothing.
 * That costs nothing that matters: strangers cannot spend your share, so your
 * walls and the walls of those you follow stand whatever a stranger hides
 * beside them. A starved shard is built again when a share comes back to its
 * pool (a shard's unused share is returned) and at every WALK. When your own
 * shards and those you follow need more than the reserved share, the nearest
 * are built and the farthest are walkable until budget comes back.
 */

import { MAX_PLACED, type Placed } from 'sno-core/parts'
import type { ShardModel } from 'sno-core/shards'
import { you } from '../lib/carried'
import { followsOf } from '../lib/contacts'
import { fetchSettled, resolvePartsShared } from '../lib/parts'
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
export type WallItem = Pick<WorldItem, 'key' | 'at' | 'height' | 'plane'> & Partial<Pick<WorldItem, 'author' | 'mine'>> & { shard: ShardModel }

interface Entry {
  item: WallItem
  /** Cut short by its share: walkable where it was not built, and built again when its pool has budget back and at the next WALK. */
  starved: boolean
  /** The WALK it was built in (warmWalls), so a starved one is built again at the next. */
  walk: number
  /** A resolve for it is running: it stands as it is until that lands. */
  pending?: boolean
  /**
   * Its first build has not landed: a step that could enter it waits
   * (stepLimit), so nobody walks through walls that are on their way. That
   * build is of what it carries and what is already fetched, so it lands
   * within the task; what still needs a relay comes after, while its own
   * faces stand.
   */
  first: boolean
  /** Its pool was empty while first builds in it were still resolving: it waits for their shares to come back (still `first`). */
  deferred?: boolean
  /** The resolve running for it is a first build (from what is in hand), which lands within the task. */
  quickPending?: boolean
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

/** The share reserved for your own shards and those of authors you follow: no stranger can spend it. */
export const TRUSTED_BUDGET = 60_000
/** What strangers' shards share between them. */
export const STRANGER_BUDGET = 20_000
/** The most of it any one stranger's shard may take, so no one shard spends it all. */
export const STRANGER_SHARD = 4_000
/**
 * What is left of each pool this WALK. Each resolve is handed a fresh sno-core
 * budget object of its own share (never one refilled while a resolve draws
 * from it); what a shard does not use comes back to its pool when it lands.
 */
const pools = { trusted: TRUSTED_BUDGET, stranger: STRANGER_BUDGET }
type Pool = keyof typeof pools
/** Which WALK this is (warmWalls counts them). */
let walkNo = 0
/** The authors you follow (your kind 3), as last read; empty until it is. */
let follows: ReadonlySet<string> = new Set()
/** Whose follows those are, so a new identity reads its own. */
let followsOfWho: string | null = null

/**
 * Whose share a shard draws from: the author of the object it DRAWS, never of
 * the bag it is in. A LIVE LINK in your own bag draws a stranger's object, which
 * they may grow at any time, so it is a stranger's; a copy you hid carries your
 * own (a bag's items are read under the bag's signer), and a shard with no
 * author at all was made here, by you. Yours and those you follow: trusted.
 */
function poolOf(w: WallItem): Pool {
  const me = you()
  const author = w.shard.author ?? w.author ?? me
  return author !== null && (author === me || follows.has(author)) ? 'trusted' : 'stranger'
}

/**
 * Say whom you follow (lib/contacts.ts followsOf does, at each WALK; tests
 * call it directly). A shard of an author you have just been found to follow,
 * starved as a stranger's, is built again from the trusted share.
 */
export function setWallFollows(list: Iterable<string>): void {
  follows = new Set(list)
  for (const e of entries.values()) if (e.starved && !e.pending && poolOf(e.item) === 'trusted') resolveInto(e.item, e)
}

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

/** What is left of a pool of WALK's placement budget: for tests. */
export function wallBudgetLeft(pool: Pool = 'stranger'): number {
  return pools[pool]
}

/**
 * How far `from` is from what `w` has resolved so far (its walls' box, kept
 * from its last build), the larger axis gap, 0 inside it; its anchor before
 * anything of it is built. The walker's true distance to built geometry, not a
 * box a hider declares.
 */
function nearness(w: WallItem, from: Position): bigint {
  const box = entries.get(w.key)?.reach
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

/** Whether a resolve was cut short anywhere by the budget. */
function cutShort(placed: readonly Placed[]): boolean {
  return placed.some(function short(p): boolean { return p.missing === 'budget' || p.children.some(short) })
}

function build(w: WallItem, placed: readonly Placed[], starved = false, first = false): Entry {
  const pose = placedPose(WALL_AXES, w.shard.up && w.plane === 0 ? { at: w.at, spin: w.shard.spin } : undefined)
  const mesh = wallMesh(w.shard, placed, pose)
  const missingAt = placed.some(function gone(p): boolean { return p.missing === 'unreachable' || p.children.some(gone) }) ? Date.now() : null
  return { item: w, starved, first, walk: walkNo, shard: w.shard, missingAt, where: whereOf(w), mesh, clip: regionBox(w.at, w.height, w.shard.unit, WALL_AXES), reach: reachOf(mesh, w.shard.unit) }
}

/** The walls of one placed shard, built now or kept from before; its parts follow when they resolve. */
export function entryFor(w: WallItem): Entry {
  const held = entries.get(w.key)
  // A part a relay did not answer is asked for again after a while (lib/parts.ts does not keep a miss).
  if (held && held.shard === w.shard && held.where === whereOf(w)) {
    if (held.missingAt !== null && Date.now() - held.missingAt > RETRY_MS) { held.missingAt = null; resolveInto(w, held) }
    // Starved in an earlier WALK: built again with this WALK's budget.
    else if (held.starved && !held.pending && held.walk !== walkNo) { held.walk = walkNo; resolveInto(w, held) }
    return held
  }
  const e = build(w, [], false, !!w.shard.parts?.length)
  entries.set(w.key, e)
  resolveInto(w, e, true)
  return e
}

/** Waiting for first builds to land. */
let built: Array<() => void> = []
/** Whether a step since the last takeWallWait had to wait for a first build. */
let waited = false

/** Tell whoever waits once no entry is still waiting for its first build. */
function landed(): void {
  for (const e of entries.values()) if (e.first) return
  const now = built
  built = []
  for (const go of now) go()
}

/** The longest a press waits for walls on their way: past it, the wait is let go, so input never hangs. */
export const WALL_WAIT_MS = 250

/**
 * When every shard a step has met so far is built for the first time, or
 * WALL_WAIT_MS has passed, whichever is first: what useWalk waits on to press
 * again. A first build lands within the task, so the deadline is only ever met
 * by something gone wrong; then the press goes on, and a step that can still
 * enter an unbuilt shard waits again.
 */
export function wallsBuilt(): Promise<void> {
  for (const e of entries.values()) {
    if (!e.first) continue
    return new Promise((resolve) => {
      let done = false
      const go = (): void => { if (!done) { done = true; resolve() } }
      built.push(go)
      setTimeout(() => { built = built.filter((f) => f !== go); go() }, WALL_WAIT_MS)
    })
  }
  return Promise.resolve()
}

/** Whether a step since the last call had to wait for a first build (and forget it). */
export function takeWallWait(): boolean {
  const was = waited
  waited = false
  return was
}

/** How long a part no relay answered stays a placeholder before it is asked for again. */
const RETRY_MS = 30_000

/**
 * Resolve the objects `w` places and rebuild its walls with them, unless the
 * entry has been replaced meanwhile. Its parts can stop a walk whatever its
 * own setting says (each object keeps its own, §1.10), so they are resolved
 * for every shard that has any.
 */
function resolveInto(w: WallItem, e: Entry, quick = false): void {
  if (!w.shard.parts?.length) return
  const pool = poolOf(w)
  // A stranger's shard takes no more than STRANGER_SHARD; yours and those you
  // follow up to sno-core's own MAX_PLACED, from the share reserved for them.
  const share = Math.min(pool === 'trusted' ? MAX_PLACED : STRANGER_SHARD, pools[pool])
  if (share <= 0) {
    // Its pool is out for now. Others in it still resolving will give back
    // what they do not use, so it waits for that (steps wait with it); with
    // nothing outstanding, it is walkable until budget comes back.
    if (e.first && poolBusy(pool)) { e.deferred = true; return }
    e.deferred = false
    if (entries.get(w.key) === e) entries.set(w.key, build(w, [], true))
    landed()
    return
  }
  e.deferred = false
  pools[pool] -= share
  e.pending = true
  e.quickPending = quick
  // A fresh budget object for this resolve alone, and the WALK it was handed out
  // in: what it does not use goes back to that WALK's pool only, never into a
  // fresh one (warmWalls, clearWalls), which would then hold more than its cap.
  const mine = { left: share }
  const handed = walkNo
  const refund = (): void => { if (walkNo === handed) pools[pool] += Math.max(0, mine.left) }
  // First from what is in hand (carried, or fetched before), which lands in the
  // task; then, for what came back unreachable, from the relays.
  void resolvePartsShared(w.shard, quick ? fetchSettled : undefined, undefined, mine).then((placed) => {
    refund()
    const starved = cutShort(placed)
    const next = build(w, placed, starved)
    if (entries.get(w.key) === e) entries.set(w.key, next)
    landed()
    // Replaced or taken away meanwhile: what it gave back still goes to the
    // first builds waiting in its pool.
    if (entries.get(w.key) !== next) { reviveStarved(pool); return }
    // Trusted since it began (your follows arrived meanwhile): built again from your share.
    if (starved && poolOf(w) !== pool) resolveInto(w, next)
    else if (quick && next.missingAt !== null) resolveInto(w, next)
    reviveStarved(pool)
  }, () => {
    e.pending = false
    e.quickPending = false
    e.first = false
    refund()
    reviveStarved(pool)
    landed()
  })
}

/**
 * Whether a first build of this pool is still out: those land within the task,
 * so a first build that found the pool empty may wait for what they return. A
 * fetch from a relay holding a share is not waited on: what it holds comes
 * back when it lands, and starved shards are built again then.
 */
function poolBusy(pool: Pool): boolean {
  for (const e of entries.values()) if (e.pending && e.quickPending && poolOf(e.item) === pool) return true
  return false
}

/**
 * Build the shards of a pool that wait for budget (deferred first builds,
 * then starved ones), while it has budget for them; each stands as it is
 * until its new resolve lands. With nothing of the pool left outstanding, a
 * deferred first build that still gets nothing is built walkable, so no step
 * waits on budget that will not come.
 */
function reviveStarved(pool: Pool): void {
  for (const e of entries.values()) {
    if (pools[pool] <= 0) break
    if (e.deferred && !e.pending && poolOf(e.item) === pool) resolveInto(e.item, e, e.first)
  }
  for (const e of entries.values()) {
    if (pools[pool] <= 0) break
    if (e.starved && !e.pending && poolOf(e.item) === pool) resolveInto(e.item, e)
  }
  if (!poolBusy(pool)) for (const e of [...entries.values()]) if (e.deferred && poolOf(e.item) === pool) resolveInto(e.item, e, e.first)
}

/**
 * Build the walls of the shards a walker at `from` in `plane` stands among, so
 * the parts they place are resolving before the first press rather than after
 * it, and start WALK's budget afresh: every shard resolved until the next WALK
 * shares it. Yours and those you follow first, nearest first by what they have
 * resolved, then strangers', nearest first. WALK calls it on the way in; your
 * follows are read again then. Shards further off are built when a step can
 * reach their region (stepLimit).
 */
export function warmWalls(plane: number, from?: Position): void {
  // This WALK's budget, whole; a resolve still running from before keeps the
  // share it was handed, and returns what it did not use.
  pools.trusted = TRUSTED_BUDGET
  pools.stranger = STRANGER_BUDGET
  walkNo++
  const me = you()
  if (me && me !== followsOfWho) {
    followsOfWho = me
    // A read that failed is asked again at the next WALK.
    void followsOf(me).then((list) => { if (followsOfWho === me) setWallFollows(list) }, () => { if (followsOfWho === me) followsOfWho = null })
  }
  const items = wallItems(plane)
  const near = from ? items.filter((w) => regionReached(w, from)) : items
  const order = (pool: Pool): WallItem[] => near.filter((w) => poolOf(w) === pool)
    .sort((a, b) => { if (!from) return 0; const x = nearness(a, from), y = nearness(b, from); return x < y ? -1 : x > y ? 1 : 0 })
  const queue = [...order('trusted'), ...order('stranger')]
  // The nearest now; the rest one to a task, so a full share of carried tables
  // (which resolve with no fetch to wait on) never holds up WALK's first frame.
  // A step that comes near one first builds it then (stepLimit).
  const walk = walkNo
  const next = (idle?: IdleDeadline): void => {
    if (walkNo !== walk) return
    // As many as the idle time allows, and at least one.
    do {
      const w = queue.shift()
      if (!w) return
      entryFor(w)
    } while (idle && idle.timeRemaining() > 4)
    if (queue.length) later(next)
  }
  next()
}

/** An idle callback's deadline (requestIdleCallback), where there is one. */
interface IdleDeadline { timeRemaining: () => number }

/** Run `fn` when the page is idle, or on the next task where it cannot say. */
function later(fn: (idle?: IdleDeadline) => void): void {
  const idle = (globalThis as { requestIdleCallback?: (cb: (d: IdleDeadline) => void, opts?: { timeout: number }) => number }).requestIdleCallback
  if (idle) idle(fn, { timeout: 50 })
  else setTimeout(() => fn(), 0)
}

/** Forget every shard's walls: for tests, and an identity switch has no need of them either. */
export function clearWalls(): void {
  entries.clear()
  waited = false
  landed()
  walkNo++
  pools.trusted = TRUSTED_BUDGET
  pools.stranger = STRANGER_BUDGET
  follows = new Set()
  followsOfWho = null
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
  let wait = false
  const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  for (const w of items) {
    keep.add(w.key)
    // A shard whose region this step cannot enter cannot hold it: not built,
    // and nothing it places resolved, until a step can.
    if (!regionReached(w, from, axis, dir, length)) continue
    const e = entryFor(w)
    // Its first build is on its way (within the task): the step waits for it,
    // rather than pass walls that are about to stand. Every shard it could
    // enter is started first, so one wait covers them all.
    if (e.first) { wait = true; continue }
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
  if (wait) { waited = true; return { reach: 0n, by: null } }
  if (best === null) return { reach: length, by: null }
  const k = Math.max(0, Math.ceil(best - bestTol) - 1)
  const reach = BigInt(k) < length ? BigInt(k) : length
  return { reach, by }
}

/** The shards a walker in `plane` can meet: every shard placed in the world there, as the scene draws them. */
export function wallItems(plane: number): WallItem[] {
  return useShards.getState().worldItems().filter((w): w is WorldItem & { shard: ShardModel } => w.type === 'shard' && !!w.shard && w.plane === plane)
}
