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
 * beside them. A starved shard is built again when budget comes back to its
 * pool (a build replaced, failed or gone gives back what it held) and at every
 * WALK. A share is drawn on as a shard places and reads, never taken before
 * (meter), so any number of shards resolve at once. When your own
 * shards and those you follow need more than the reserved share, the nearest
 * are built and the farthest are walkable until budget comes back.
 *
 * The distinct objects WALK reads are bounded the same way, by trust: each
 * share carries its own reads (sno-core `models`), TRUSTED_READS for yours and
 * those you follow, STRANGER_READS for strangers, no stranger's share more
 * than STRANGER_SHARD_READS, and every resolve of one WALK shares one bound
 * over both, so many shards cannot read many times sno-core's MAX_MODELS. A
 * placement cut for reads (sno-core 'objects') is walkable; cut because the
 * pool ran dry, it is built again when reads come back, as a shard short of
 * placements is; cut at its own share's most, only at the next WALK. So is
 * what a stranger's object under your shard could not have from the
 * strangers' share, and a resolve that reached sno-core's MAX_NODES: built
 * again at the next WALK, with that WALK's budget, never spinning within one.
 */

import { MAX_MODELS, MAX_NODES, MAX_PLACED, type Placed } from 'sno-core/parts'
import type { ShardModel } from 'sno-core/shards'
import { you } from '../lib/carried'
import { chargeByTrust, onFollows, readFollows, resetFollows, setFollows, trustedPlacement } from '../lib/trust'
import { fetchSettled, resolvePartsShared } from '../lib/parts'
import { WALK_CUT_MARGIN, regionBox, type Box } from '../lib/clip'
import { placedPose } from '../lib/pose'
import type { AxisDirection, AxisName, Position, ViewAxes } from '../lib/space'
import { WORLD_DOWN, upOf } from '../lib/walkDown'
import { constrainOf, enclosed, firstHit, segmentHit, triangleClosest, triangleDistance, triangleNormal, trianglesNear, wallMesh, type WallMesh } from '../lib/walkConstrain'
import type { Bounce } from '../lib/walkBounce'
import { useShards, type WorldItem } from './useShards'
import { useCyberspace } from './useCyberspace'
import { openedByHand } from './useOpenedChests'
import { closedByMe } from './closedDoors'
import { doorHeightOf, drawnLook, lookOf } from '../lib/looks'
import { inRoom } from '../lib/doors'

/**
 * The frame the walls are measured in: screen right +X, up +Y, out of the
 * screen -Z, where viewPose is the identity (lib/pose.ts), so a shard's
 * render frame is cyberspace's with Z flipped (sno-core toRender). Any one
 * view frame would do, the whole scene turning rigidly with it; this one
 * keeps the arithmetic plain.
 */
export const WALL_AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }

/** One shard placed in the world, as the walls need it. */
export type WallItem = Pick<WorldItem, 'key' | 'at' | 'height' | 'plane'> & Partial<Pick<WorldItem, 'author' | 'mine'>> & {
  shard: ShardModel
  /**
   * Not cut at its region: a built-in look, drawn whole (scene/LookMark),
   * holds a walker wherever it is drawn, as a shard holds one where it is
   * drawn. A custom look is cut at its region, as a shard is.
   */
  uncut?: boolean
  /** A door's look, built in or written as tags: a walker it holds can always step out of it (wallItemsAt). */
  door?: boolean
  /**
   * A closed door's slab that holds the walker where they asked (wallItemsAt):
   * its faces let them go, so they can always step out, and only its middle,
   * across its thin axis, holds them, so they leave on the side they are on
   * and never pass through the door (review of the ceremony, #532).
   */
  inside?: boolean
  /**
   * A door this identity closed with CLOSE, and its room's height: it never
   * holds a walker inside its room or its slab, so a close never traps anyone
   * (wallItemsAt), and stops one coming in from outside, as any closed door.
   */
  closedRoom?: number
}

/** No cut at all, for an uncut wall: wider than anything a wall mesh can reach. */
const NO_CUT: Box = { min: [-1e12, -1e12, -1e12], max: [1e12, 1e12, 1e12] }

interface Entry {
  item: WallItem
  /** Cut short by its share: walkable where it was not built, and built again when its pool has budget back and at the next WALK. */
  starved: boolean
  /** The WALK it was built in (warmWalls), so a starved one is built again at the next. */
  walk: number
  /**
   * Cut short where budget coming back this WALK would not cure it (reads, a
   * stranger's object under it on the strangers' share, sno-core's MAX_NODES):
   * walkable there, and built again at the next WALK only.
   */
  nextWalk?: boolean
  /**
   * What the build standing now spent of this WALK's pools, which it holds
   * while it stands: given back when it is replaced, and handed on to the
   * share of a build of it that follows, so the pools count what is BUILT,
   * not every build ever made (review of #514).
   */
  spend?: Spend
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
 * What is left of each pool this WALK. Each resolve draws on it as it places
 * (meter), never before; a build holds what it drew while it stands
 * (Entry.spend), and gives it back when it is replaced, fails or goes.
 */
const pools = { trusted: TRUSTED_BUDGET, stranger: STRANGER_BUDGET }
type Pool = keyof typeof pools

/** The distinct objects (sno-core MAX_MODELS) your shards and those you follow may read in one WALK. */
export const TRUSTED_READS = 3 * MAX_MODELS
/** What strangers' shards may read between them in one WALK. */
export const STRANGER_READS = MAX_MODELS
/** The most of it any one stranger's share may read. */
export const STRANGER_SHARD_READS = MAX_MODELS / 5
/** What one build spent, of which WALK's pools: placements and reads of its own pool, and of the strangers' for a stranger's objects under it. */
interface Spend { walk: number; pool: Pool; placed: number; read: number; theirPlaced: number; theirRead: number }

/** Give back what a build no longer standing spent, if it was spent this WALK; the pools it went back to. */
function release(spend: Spend | undefined): Pool[] {
  if (!spend || spend.walk !== walkNo) return []
  pools[spend.pool] += spend.placed
  reads[spend.pool] += spend.read
  pools.stranger += spend.theirPlaced
  reads.stranger += spend.theirRead
  // And to the WALK's one bound over both, which sno-core charged as it read.
  walkReads.left += spend.read + spend.theirRead
  return spend.theirPlaced || spend.theirRead ? [spend.pool, 'stranger'] : [spend.pool]
}

/**
 * A share of one of this WALK's pools (`counts`: placements or reads), charged
 * as sno-core draws on it, never taken before it is drawn, so as many shards
 * resolve at once as the pools have budget for (as the scene's reads are,
 * lib/readPools.ts meter; review of #515). Its `left` is the lesser of what
 * the share may still take (`cap`) and what it holds already (`credit`: what
 * the build it replaces spent, still standing meanwhile) plus what the pool
 * has; drawing one takes it from the credit first, then from the pool.
 * sno-core charges only a budget whose `left` is a writable number, so it is
 * a Proxy that reports one. A share handed out in an earlier WALK charges
 * nothing of this one's pools (warmWalls starts them afresh).
 */
interface Meter {
  /** For sno-core: the budget (or its `models`). */
  box: { left: number }
  /** How much it drew in all, credit and pool. */
  used: () => number
  /** How much of that came from the pool. */
  fromPool: () => number
  /** Credit it did not draw. */
  creditLeft: () => number
  /** Whether it was refused because the pool (and its credit) ran dry while it still had room. */
  ranLow: () => boolean
}
function meter(counts: Record<Pool, number>, pool: Pool, cap: number, credit: number, also: Record<string, unknown> = {}): Meter {
  const handed = walkNo
  let room = cap, owed = Math.max(0, credit), used = 0, taken = 0, low = false
  const now = (): number => {
    if (walkNo !== handed) return Math.max(0, room)
    const n = Math.max(0, Math.min(room, owed + Math.max(0, counts[pool])))
    if (n < 1 && room >= 1) low = true
    return n
  }
  const box = new Proxy({ left: 0, ...also }, {
    get: (t, k) => (k === 'left' ? now() : Reflect.get(t, k)),
    set: (t, k, v) => {
      if (k !== 'left') return Reflect.set(t, k, v)
      // Never more than it may still take, whatever is written.
      const has = now()
      const d = Math.min(has, has - Number(v))
      if (!(d > 0)) return true
      room -= d
      used += d
      if (walkNo !== handed) return true
      const c = Math.min(owed, d)
      owed -= c
      counts[pool] -= d - c
      taken += d - c
      return true
    },
    getOwnPropertyDescriptor: (t, k) => (k === 'left' ? { value: now(), writable: true, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(t, k)),
  })
  return { box: box as { left: number }, used: () => used, fromPool: () => taken, creditLeft: () => owed, ranLow: () => low }
}

/** What is left of each pool's reads this WALK, drawn on and held as the placements are. */
const reads: Record<Pool, number> = { trusted: TRUSTED_READS, stranger: STRANGER_READS }
/** Every read of this WALK, whatever share pays: one bound over all its resolves (sno-core `models`). */
let walkReads = { left: TRUSTED_READS + STRANGER_READS }
/** A fresh WALK's budget, placements and reads. */
function freshPools(): void {
  pools.trusted = TRUSTED_BUDGET
  pools.stranger = STRANGER_BUDGET
  reads.trusted = TRUSTED_READS
  reads.stranger = STRANGER_READS
  walkReads = { left: TRUSTED_READS + STRANGER_READS }
}
/** Which WALK this is (warmWalls counts them). */
let walkNo = 0

/**
 * Whose share a shard draws from: the author of the object it DRAWS, never of
 * the bag it is in. A LIVE LINK in your own bag draws a stranger's object, which
 * they may grow at any time, so it is a stranger's; a copy you hid carries your
 * own (a bag's items are read under the bag's signer), and a shard with no
 * author at all was made here, by you. Yours and those you follow: trusted.
 */
function poolOf(w: WallItem): Pool {
  // Both whoever put it there and the author of what it draws (lib/trust.ts):
  // a stranger's bag of live links to your object is the stranger's.
  const container = w.author ?? you()
  return trustedPlacement(container, w.shard.author ?? container) ? 'trusted' : 'stranger'
}

/**
 * Say whom you follow (lib/contacts.ts followsOf does, at each WALK; tests
 * call it directly). A shard of an author you have just been found to follow,
 * starved as a stranger's, is built again from the trusted share.
 */
export function setWallFollows(list: Iterable<string>): void {
  setFollows(list)
}

/** On any change of follows (lib/trust.ts): a shard now trusted, starved as a stranger's, is built again from your share. */
onFollows(() => {
  for (const e of entries.values()) if (e.starved && !e.pending && poolOf(e.item) === 'trusted') resolveInto(e.item, e)
})

/**
 * Whether a walker at `from`, stepping `length` gibsons along `axis` (or not
 * stepping, with no axis), can be anywhere in `w`'s region, a gibson either
 * side included: a shard is drawn only inside its region, so only there can it
 * hold a walker. Exact, in bigint gibsons.
 */
export function regionReached(w: WallItem, from: Position, axis?: AxisName, dir: 1 | -1 = 1, length = 0n): boolean {
  // Drawn whole: its own reach (Entry `reach`) is the only bound.
  if (w.uncut) return true
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

/** What is left of a pool of WALK's reads, and of the WALK's reads over both: for tests. */
export function wallReadsLeft(pool?: Pool): number {
  return pool ? reads[pool] : walkReads.left
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

/** Whether a resolve was cut short anywhere by the placement budget (not by reads: 'objects'). */
function cutShort(placed: readonly Placed[]): boolean {
  return placed.some(function short(p): boolean { return p.missing === 'budget' || p.children.some(short) })
}

/** Whether a resolve was cut short anywhere for reads (sno-core 'objects'). */
function cutForReads(placed: readonly Placed[]): boolean {
  return placed.some(function short(p): boolean { return p.missing === 'objects' || p.children.some(short) })
}

/** Every node a resolve returned, placeholders too. */
function nodesOf(placed: readonly Placed[]): number {
  let n = 0
  const count = (ps: readonly Placed[]): void => { for (const p of ps) { n++; count(p.children) } }
  count(placed)
  return n
}

/**
 * Whether any wall built since the last clearWalls has a bounce on its own
 * faces or on an object it places (lib/walkBounce.ts): until one has, no
 * floor can bounce, so WALK asks floorPad nothing (store/useWalk.ts
 * padLaunch). Set as walls are built and kept until clearWalls, so a pad
 * walked away from still counts: that costs only a query, never a launch.
 */
let bounceBuilt = false

/** Whether any wall built since the last clearWalls bounces: off, a press asks no floor query. */
export function anyBounce(): boolean {
  return bounceBuilt
}

function build(w: WallItem, placed: readonly Placed[], starved = false, first = false): Entry {
  const pose = placedPose(WALL_AXES, w.shard.up && w.plane === 0 ? { at: w.at, spin: w.shard.spin } : undefined)
  const mesh = wallMesh(w.shard, placed, pose)
  if (!bounceBuilt && (!!mesh.ownBounce || mesh.placements.some((p) => !!p.bounce))) bounceBuilt = true
  const missingAt = placed.some(function gone(p): boolean { return p.missing === 'unreachable' || p.children.some(gone) }) ? Date.now() : null
  return { item: w, starved, first, walk: walkNo, shard: w.shard, missingAt, where: whereOf(w), mesh, clip: w.uncut ? NO_CUT : regionBox(w.at, w.height, w.shard.unit, WALL_AXES, WALK_CUT_MARGIN), reach: reachOf(mesh, w.shard.unit) }
}

/** The walls of one placed shard, built now or kept from before; its parts follow when they resolve. */
export function entryFor(w: WallItem): Entry {
  const held = entries.get(w.key)
  // A part a relay did not answer is asked for again after a while (lib/parts.ts does not keep a miss).
  if (held && held.shard === w.shard && held.where === whereOf(w)) {
    if (held.missingAt !== null && Date.now() - held.missingAt > RETRY_MS) { held.missingAt = null; resolveInto(w, held) }
    // Starved in an earlier WALK: built again with this WALK's budget.
    else if ((held.starved || held.nextWalk) && !held.pending && held.walk !== walkNo) { held.walk = walkNo; resolveInto(w, held) }
    return held
  }
  const e = build(w, [], false, !!w.shard.parts?.length)
  entries.set(w.key, e)
  // What the build it replaces held comes back: it stands no more.
  const back = release(held?.spend)
  resolveInto(w, e, true)
  for (const p of back) reviveStarved(p)
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
export const RETRY_MS = 30_000

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
  const cap = pool === 'trusted' ? MAX_PLACED : STRANGER_SHARD
  const readCap = pool === 'trusted' ? MAX_MODELS : STRANGER_SHARD_READS
  // What the build standing now holds of this WALK's pools is this build's
  // credit (it is replaced when this lands): building it again costs only
  // what it needs beyond what it holds, and the pools never count it twice.
  const held = e.spend && e.spend.walk === walkNo && e.spend.pool === pool ? e.spend : undefined
  const room = Math.min(cap, pools[pool] + (held?.placed ?? 0))
  const readRoom = Math.min(readCap, reads[pool] + (held?.read ?? 0))
  if (room <= 0 || readRoom <= 0) {
    // Its pool is out for now, of placements or of reads. While other first
    // builds in it are still out it waits for them (steps wait with it); with
    // nothing outstanding, it is walkable until budget comes back.
    if (e.first && poolBusy(pool)) { e.deferred = true; return }
    e.deferred = false
    if (entries.get(w.key) === e) entries.set(w.key, build(w, [], true))
    landed()
    return
  }
  e.deferred = false
  // The build standing keeps what it spent until this one lands (its credit
  // here), or keeps it after all if this one fails. Spent of another pool
  // (its trust changed), it is not this build's to draw on: all of it back.
  const old = held
  const back = held ? [] : release(e.spend)
  e.spend = undefined
  // The WALK's one bound over both: sno-core charges every read of this
  // build to it, credit or not, so the old build's reads leave it now.
  if (old) walkReads.left += old.read + old.theirRead
  e.pending = true
  e.quickPending = quick
  const reading = meter(reads, pool, readCap, old?.read ?? 0)
  const placing = meter(pools, pool, cap, old?.placed ?? 0, { models: reading.box })
  // A trusted shard placing a stranger's object charges that child, and all
  // under it, to the strangers' pool, at most STRANGER_SHARD of it, never to
  // your share (lib/trust.ts chargeByTrust; sno-core budgetFor). Asked for
  // only when a placement is charged to it.
  let theirReading: Meter | null = null
  let theirPlacing: Meter | null = null
  const strangerShare = (): { left: number } => {
    theirReading = meter(reads, 'stranger', STRANGER_SHARD_READS, old?.theirRead ?? 0)
    theirPlacing = meter(pools, 'stranger', STRANGER_SHARD, old?.theirPlaced ?? 0, { models: theirReading.box })
    return theirPlacing.box
  }
  const handed = walkNo
  const overall = walkReads
  /** What of the old build's credit was not drawn goes back to the pools. */
  const creditBack = (): void => {
    if (walkNo !== handed || !old) return
    pools[pool] += placing.creditLeft()
    reads[pool] += reading.creditLeft()
    const tp = theirPlacing as Meter | null, tr = theirReading as Meter | null
    pools.stranger += tp ? tp.creditLeft() : old.theirPlaced
    reads.stranger += tr ? tr.creditLeft() : old.theirRead
  }
  for (const p of back) reviveStarved(p)
  // First from what is in hand (carried, or fetched before), which lands in the
  // task; then, for what came back unreachable, from the relays.
  void resolvePartsShared(w.shard, quick ? fetchSettled : undefined, undefined, placing.box, pool === 'trusted' ? chargeByTrust(placing.box, strangerShare) : undefined, overall).then((placed) => {
    const tp = theirPlacing as Meter | null, tr = theirReading as Meter | null
    const spend: Spend = { walk: handed, pool, placed: placing.used(), read: reading.used(), theirPlaced: tp ? tp.used() : 0, theirRead: tr ? tr.used() : 0 }
    creditBack()
    // Starved, and built again when its pool has budget back, only when it
    // was refused because the pool ran dry while its share still had room:
    // more in the pool gives it more. Of placements or of reads.
    const short = cutShort(placed)
    const readsCut = cutForReads(placed)
    const starved = (short && placing.ranLow()) || (readsCut && reading.ranLow())
    // Built again at the next WALK, never sooner (budget coming back this
    // WALK would not cure it, and building it again now would only spin): a
    // whole share was not enough, of placements or of reads; a stranger's
    // object under it cut on the strangers' share; or a resolve that reached
    // sno-core's MAX_NODES.
    const nextWalk = !starved && (short || readsCut || nodesOf(placed) >= MAX_NODES)
    const next = build(w, placed, starved)
    if (nextWalk) next.nextWalk = true
    // It stands, and holds what it spent; or it was replaced meanwhile, and what it spent goes back.
    if (entries.get(w.key) === e) { next.spend = spend; entries.set(w.key, next) }
    else release(spend)
    landed()
    // Replaced or taken away meanwhile: what it gave back still goes to the
    // first builds waiting in its pool.
    if (entries.get(w.key) !== next) { reviveStarved(pool); return }
    // Trusted since it began (your follows arrived meanwhile): built again from your share.
    if (starved && poolOf(w) !== pool) resolveInto(w, next)
    else if (quick && next.missingAt !== null) resolveInto(w, next)
    reviveStarved(pool)
    // What it held of the strangers' pool came back too.
    if (tp || (old && old.theirPlaced)) reviveStarved('stranger')
  }, () => {
    e.pending = false
    e.quickPending = false
    e.first = false
    // Nothing was built: what it drew of the pools goes back, and its reads to
    // the WALK's bound; the build still standing keeps what it spent.
    const tp = theirPlacing as Meter | null, tr = theirReading as Meter | null
    if (walkNo === handed) {
      pools[pool] += placing.fromPool()
      reads[pool] += reading.fromPool()
      if (tp) pools.stranger += tp.fromPool()
      if (tr) reads.stranger += tr.fromPool()
      walkReads.left += reading.used() + (tr ? tr.used() : 0)
      if (old) {
        if (entries.get(w.key) === e) { e.spend = old; walkReads.left -= old.read + old.theirRead }
        // Replaced meanwhile: the old build stands no more either.
        else { pools[pool] += old.placed; reads[pool] += old.read; pools.stranger += old.theirPlaced; reads.stranger += old.theirRead }
      }
    }
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
    if (pools[pool] <= 0 || reads[pool] <= 0) break
    if (e.deferred && !e.pending && poolOf(e.item) === pool) resolveInto(e.item, e, e.first)
  }
  for (const e of entries.values()) {
    if (pools[pool] <= 0 || reads[pool] <= 0) break
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
  freshPools()
  walkNo++
  // Your follows, read once per identity; a read that failed is asked again at the next WALK.
  readFollows()
  const items = from ? wallItemsAt(plane, from) : wallItems(plane)
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
  restEntries.clear()
  restBytes = 0
  bounceBuilt = false
  waited = false
  landed()
  walkNo++
  freshPools()
  resetFollows()
}

/** What firstHit says of the face it found, reused by every step (stepLimit). */
const hitWho: { bounce: Bounce; springboard?: boolean; unseen?: boolean } = { bounce: 0, unseen: false }

/** Why a step stopped short: the shard it met, and how far it may go. */
export interface WallStop {
  /** Whole gibsons the step may take, from 0 (not at all) to its full length. */
  reach: bigint
  /** The shard whose face is in the way, or null when nothing is. */
  by: WallItem | null
  /**
   * Whether that face belongs to an object no one can see, the shard itself
   * or the part it places that the step met (lib/pointLook.ts unseenObject;
   * store/wallHint.ts). Absent when nothing is in the way, or for a door slab
   * held from inside.
   */
  unseen?: boolean
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
 * With `stand`, GRAVITY's question (what is under you), a face in the
 * walker's own plane is measured too: one within the shard's tolerance of the
 * walker's height, which a HOP, a VIEW, a BUILD or a floor deployed at your
 * own height can leave you on (a WALK stop never does), and a fall can come
 * to rest on (a mid-air press over a ledge at the height it is passing). It
 * holds you, so you stand on it instead of falling through it, only when the
 * space a hair above you is open: the top of a solid or a single-plane floor
 * holds you, and the underside of a solid does not, so under a block you fall
 * away from it as before (arkinox, 2026-10-25: floors only). The hair is the
 * shard's own tolerance, and the question only: nothing moves, nothing is
 * published, and every face further from your height is met exactly as
 * without it. Only where the measure can tell (a tolerance under HAIR_MAX):
 * on a monument the face you stand on lets you go, as below.
 *
 * `stand` is true for gravity down cyberspace -Y, or the walker's own down
 * (lib/walkDown.ts): it is asked only of a step that goes that way, and
 * "above" is the opposite way. Any other step is measured as without it.
 */
export function stepLimit(from: Position, axis: AxisName, dir: 1 | -1, length: bigint, items: readonly WallItem[], stand: boolean | AxisDirection = false): WallStop {
  const m = measureStep(from, axis, dir, length, items, stand)
  // The last whole gibson at least `tol` short of the face: one short at a
  // fine zoom, further at a coarse one, where the measure is coarser too.
  if (m.wait) { waited = true; return { reach: 0n, by: null } }
  let stop: WallStop = { reach: length, by: null }
  if (m.best !== null) {
    const k = Math.max(0, Math.ceil(m.best - m.bestTol) - 1)
    stop = { reach: BigInt(k) < length ? BigInt(k) : length, by: m.by, ...(m.by ? { unseen: m.bestUnseen } : {}) }
  }
  return m.middle && m.middle.reach < stop.reach ? m.middle : stop
}

/**
 * Fluid WALK (store/walkFluid.ts): how far, in gibsons, the first face that
 * holds a walker at `from` is along `axis` in direction `dir`, measured as
 * stepLimit measures it, within a step of `length`; null when none is that
 * near, when a door slab holds the walker, or when a wall is still on its
 * way. The smooth position stops FLUID_FACE_GAP short of it, so the eye
 * never goes into a face nearer than its gibson's edge. A question only: it
 * moves nothing and never makes a step wait.
 */
export function faceDistance(from: Position, axis: AxisName, dir: 1 | -1, items: readonly WallItem[], length = 1n): number | null {
  const m = measureStep(from, axis, dir, length, items, false)
  if (m.wait || m.middle) return null
  return m.best
}

/** What stepLimit measured: the nearest face's distance in gibsons and its tolerance, whose it is, a door slab's middle, and whether a wall is on its way. */
interface StepMeasure {
  best: number | null
  bestTol: number
  by: WallItem | null
  bestUnseen: boolean
  wait: boolean
  middle: WallStop | null
}

/** stepLimit's measure, before it is turned into whole gibsons. */
function measureStep(from: Position, axis: AxisName, dir: 1 | -1, length: bigint, items: readonly WallItem[], stand: boolean | AxisDirection): StepMeasure {
  const keep = new Set<string>()
  let best: number | null = null
  /** Whether the face that stops the step belongs to an object no one can see, the shard itself or a part it places. */
  let bestUnseen = false
  let bestTol = ON_FACE
  let by: WallItem | null = null
  let wait = false
  /** The nearest middle of a door slab holding the walker that this step would cross (WallItem `inside`). */
  let middle: WallStop | null = null
  /** The faces in the walker's own plane, held back until the space above it is known to be open. */
  const planes: Array<{ w: WallItem; tol: number; unseen: boolean }> = []
  const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const gravity = stand === true ? WORLD_DOWN : stand || null
  // GRAVITY's question: this step goes down.
  const down = gravity !== null && axis === gravity.axis && dir === gravity.dir
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
    if (w.inside) {
      const k = middleReach(e, w, from, i, dir, length)
      if (k !== null && (middle === null || k < middle.reach)) middle = { reach: k, by: w }
      continue
    }
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
    // A step that would end within `tol` of a face meets it (tolerance).
    const maxT = (Number(length) + tol) / g
    // The face you stand on lets you go. WALK always stops at least `tol`
    // short of a face, so a walker it brought here is never that near one. A
    // walker HOPped to within the measure's error of a face on a monument (a
    // shard past about 2^53 gibsons) may still cross it, which is accepted:
    // holding it there would hold it stepping away from the face too.
    const hair = down ? tolerance(e, g, 0n) : HAIR_MAX
    let t: number | null
    if (down && hair < HAIR_MAX) {
      // Asked to stand (above): a face within a hair of your height, either
      // side, is in your own plane. It is held back, and the step is measured
      // past it, as if it were not there, until the space above you is known.
      t = firstHit(e.mesh, o, i, s, maxT, -hair / g, e.clip, hitWho)
      if (t !== null && t * g <= hair) {
        planes.push({ w, tol, unseen: hitWho.unseen === true })
        t = firstHit(e.mesh, o, i, s, maxT, hair / g, e.clip, hitWho)
      }
    } else {
      t = firstHit(e.mesh, o, i, s, maxT, ON_FACE / g, e.clip, hitWho)
    }
    if (t === null) continue
    const gib = t * g
    if (best === null || gib < best) { best = gib; bestTol = tol; by = w; bestUnseen = hitWho.unseen === true }
  }
  // A face in your own plane holds you when the space a hair above you is open.
  if (planes.length > 0 && openAbove(from, items, { axis, dir: dir < 0 ? 1 : -1 })) { best = 0; bestTol = planes[0].tol; by = planes[0].w; bestUnseen = planes[0].unseen }
  // Shards no longer in the world: what their builds held of this WALK's pools comes back.
  const back = new Set<Pool>()
  for (const [k, gone] of entries) if (!keep.has(k)) { entries.delete(k); for (const p of release(gone.spend)) back.add(p) }
  for (const p of back) reviveStarved(p)
  return { best, bestTol, by, bestUnseen, wait, middle }
}

/** A face met no more squarely than this is pulled back from as if it were met at this angle, so a glancing wall still leaves the near plane room. */
const EYE_SQUARE_MIN = 0.2

/** The most times the eye steps back toward the walker to clear a face beside it: past that it is at the walker's point. */
const EYE_BACK_STEPS = 64

/**
 * How near level a face through the walker's point must be for the eye to
 * rise away from it: the cosine between its normal and up. A floor or a ramp
 * the walker walks along is; a wall through the walker's point is not, and
 * holds the eye at the walker.
 */
const EYE_FLOOR_MIN = 0.2

/** How far above the walker's point the eye's line starts, in gibsons (at least sixteen of a shard's measuring tolerance): a hair, so a floor in the walker's plane is below it. */
const EYE_LIFT = 1e-4

/** Whether `w`'s region (drawn only there, regionReached) meets the box `lo`..`hi`, in bigint gibsons. */
function regionMeets(w: WallItem, lo: Position, hi: Position): boolean {
  if (w.uncut) return true
  const h = BigInt(w.height)
  for (const a of ['x', 'y', 'z'] as const) {
    const rlo = ((w.at[a] >> h) << h) - 1n
    const rhi = ((w.at[a] >> h) << h) + (1n << h)
    if (hi[a] < rlo || lo[a] > rhi) return false
  }
  return true
}

/**
 * How much of the WALK eye's offset the camera may take: the share, 0 to 1,
 * of the line from the walker's point out to the eye (lib/avatarEye.ts) that
 * stays clear of the faces that stop a walker (DECK-0003 §1.12). The camera
 * is pulled back along that line, the way a third-person camera's arm
 * shortens, so it never looks from the far side of a wall or a ceiling its
 * walker is held by, whether the eye is a little above the walker or far
 * behind it (arkinox, 2026-11-16: the eye may sit anywhere within the
 * avatar size limit).
 *
 * The walker stands at `from` plus `lead` (the eased point between gibsons,
 * cyberspace gibsons from the centre of `from`'s gibson); the eye is `eye`
 * gibsons from there. `margin` gibsons is room for the camera's near plane,
 * which would otherwise cut a face it is nearly touching and show what is
 * behind it. Three rules:
 *
 * - The line starts a hair above the walker's point, against gravity
 *   (EYE_LIFT): walking along a floor keeps the walker's point in the
 *   floor's plane, and from just above it the floor is a face like any other,
 *   which an eye rising from it never crosses and an eye below the walker
 *   always does. So does a ramp. A wall whose plane the walker stands in
 *   (it walked into it along the wall) still passes through that start, and
 *   holds any eye at the walker, since one side of it or the other is behind
 *   the wall; the top edge of a block the walker stands on does not, so the
 *   eye rises from a rim. A start inside a closed solid (the walker against
 *   the underside of a block) holds the eye at the walker too.
 * - The walker's point as drawn (`lead`, a step under way, the zoom's cell
 *   centre) must be reachable from its gibson's centre without crossing a
 *   face, or the eye stays at the walker.
 * - The first face the line crosses (carried on by `margin` past the eye, so
 *   a face just beyond it counts) holds the eye at least `margin` short of
 *   it, measured square to the face.
 * - The eye is then stepped back toward the walker, half a margin at a time,
 *   until no face is within `margin` of it, or nearer to it than the face is
 *   to the walker: stepping back cannot clear a face the walker itself is
 *   near, so such a face only holds the eye from coming nearer than the
 *   walker is.
 *
 * A shard in reach whose walls are still on their way, or a closed door whose
 * slab holds the walker, holds the eye at the walker, and `out.pending` says
 * the first, so the answer is not kept. Nothing moves, nothing is published:
 * this is where the camera looks from.
 *
 * With `stand` (fluid WALK, and the step WALK at a gibson's zoom: the walker
 * drawn standing on the surface between gibsons, store/walkFluid.ts
 * groundFluid and stepFloor; a number is the most the ground
 * climbs, in gibsons, true is 2), the walker's point as drawn is reached the
 * way the ground was found (groundUnder): up from the gibson's centre to its
 * height, if it is higher, or a whole gibson or two, then level, then down
 * onto it. A
 * straight line from the centre down to feet past a rim, or up to feet on a
 * slope ahead, would cut through the surface they stand on and hold the eye
 * at the feet, which is the camera in the floor. Without it, the line is
 * straight, as it always was.
 */
export function eyeReach(from: Position, lead: readonly [number, number, number], eye: readonly [number, number, number], margin: number, items: readonly WallItem[], up: AxisDirection = UP_Y, out?: { pending: boolean }, stand: boolean | number = false): number {
  const core = eyeCore(from, lead, eye, margin, items, up, out, stand, 0)
  return typeof core === 'number' ? core : core.reach / core.len
}

/** One shard's faces near the eye's lines (eyeCore): its triangles, each one's distance from the walker, the walker's point in its render frame, its unit and tolerance. */
interface EyeNear { tris: Float64Array; walker: Float64Array; o: [number, number, number]; g: number; tol: number }

/** What eyeCore found: the faces near, and how far along the straight line to the eye (`len` gibsons) the eye may go, the step back included. */
interface EyeCore { near: EyeNear[]; reach: number; len: number }

/**
 * eyeReach's work, shared with eyePlace: a number when the answer is settled
 * before any line is asked (0 held at the walker, 1 nothing to ask), else the
 * faces near and the straight line's reach. `extra` widens the box the faces
 * are gathered in, in gibsons, for eyePlace's moves beside the line; what
 * eyeReach answers is the same with or without it. A shard still being
 * built is waited for only when it meets the line's own box: one only in the
 * wider band is left out until it is built, as it was before the band.
 */
function eyeCore(from: Position, lead: readonly [number, number, number], eye: readonly [number, number, number], margin: number, items: readonly WallItem[], up: AxisDirection, out: { pending: boolean } | undefined, stand: boolean | number, extra: number): number | EyeCore {
  if (out) out.pending = false
  const len = Math.hypot(eye[0], eye[1], eye[2])
  if (!(len > 0)) return 1
  const u = [eye[0] / len, eye[1] / len, eye[2] / len]
  const span = len + margin
  const ext = [u[0] * span, u[1] * span, u[2] * span]
  const upC = [0, 0, 0]
  upC[up.axis === 'x' ? 0 : up.axis === 'y' ? 1 : 2] = up.dir
  // In a shard's render frame Z flips (stepLimit): up and the line's way, as unit vectors there.
  const upM = [upC[0], upC[1], -upC[2]]
  const uM = [u[0], u[1], -u[2]]
  // The box the line reaches, widened by `by` gibsons.
  const box = (by: number): { lo: Position; hi: Position } => {
    const lo = { x: 0n, y: 0n, z: 0n }, hi = { x: 0n, y: 0n, z: 0n }
    ;(['x', 'y', 'z'] as const).forEach((a, q) => {
      lo[a] = from[a] + BigInt(Math.floor(Math.min(lead[q], lead[q] + ext[q]) - margin - by)) - 1n
      hi[a] = from[a] + BigInt(Math.ceil(Math.max(lead[q], lead[q] + ext[q]) + margin + by)) + 1n
    })
    return { lo, hi }
  }
  const wide = box(extra)
  const line = extra > 0 ? box(0) : wide
  const near: EyeNear[] = []
  const nrm = [0, 0, 0]
  let reach = len
  for (const w of items) {
    if (!regionMeets(w, wide.lo, wide.hi)) continue
    const e = entryFor(w)
    // Its first build is on its way: the eye waits at the walker, as a step waits (stepLimit), if it meets the line.
    if (e.first && !e.reach) {
      if (!regionMeets(w, line.lo, line.hi)) continue
      if (out) out.pending = true
      return 0
    }
    if (!e.reach) continue
    const g = 2 ** w.shard.unit
    const tol = tolerance(e, g, 0n)
    // The line's box against the walls' box, in gibsons from the shard's coordinate.
    const off = [Number(from.x - w.at.x) + lead[0], Number(from.y - w.at.y) + lead[1], Number(from.z - w.at.z) + lead[2]]
    const r = e.reach
    const wlo = [Number(r.lo.x), Number(r.lo.y), Number(r.lo.z)], whi = [Number(r.hi.x), Number(r.hi.y), Number(r.hi.z)]
    const apartBy = (by: number): boolean => {
      for (let q = 0; q < 3; q++) {
        const a = Math.min(off[q], off[q] + ext[q], off[q] - lead[q]) - margin - by - tol - 1, b = Math.max(off[q], off[q] + ext[q], off[q] - lead[q]) + margin + by + tol + 1
        if (b < wlo[q] || a > whi[q]) return true
      }
      return false
    }
    if (apartBy(extra)) continue
    if (e.first) {
      if (extra > 0 && apartBy(0)) continue
      if (out) out.pending = true
      return 0
    }
    // A closed door's slab that holds the walker (wallItemsAt): the walker is inside a wall.
    if (w.inside) return 0
    // The shard's render frame, in its own model units: Z flips, as stepLimit has it.
    // The line starts a hair above the walker's point (EYE_LIFT).
    const lift = Math.max(EYE_LIFT, 16 * tol) / g
    const o: [number, number, number] = [off[0] / g + upM[0] * lift, off[1] / g + upM[1] * lift, -off[2] / g + upM[2] * lift]
    const d: [number, number, number] = [ext[0] / g, ext[1] / g, -ext[2] / g]
    // The gibson's centre, lifted the same, and the way from it to the walker's point as drawn.
    const leadM: [number, number, number] = [lead[0] / g, lead[1] / g, -lead[2] / g]
    const o0: [number, number, number] = [o[0] - leadM[0], o[1] - leadM[1], o[2] - leadM[2]]
    const pad = (margin + extra + tol) / g
    const boxLo = [0, 1, 2].map((q) => Math.min(o[q], o[q] + d[q], o0[q]) - pad)
    const boxHi = [0, 1, 2].map((q) => Math.max(o[q], o[q] + d[q], o0[q]) + pad)
    const tris = trianglesNear(e.mesh, boxLo, boxHi, e.clip)
    if (tris.length === 0) continue
    const walker = new Float64Array(tris.length / 9)
    for (let n = 0; n < tris.length; n += 9) {
      const dist = triangleDistance(tris, n, o)
      walker[n / 9] = dist
      if (dist > tol / g || !triangleNormal(tris, n, nrm)) continue
      // Through the line's start: a wall whose plane the walker stands in holds any eye. A floor or a
      // ramp still through it (only on a monument, whose tolerance passes the lift) lets go only upward.
      const nu = nrm[0] * upM[0] + nrm[1] * upM[1] + nrm[2] * upM[2]
      const leaves = (nrm[0] * uM[0] + nrm[1] * uM[1] + nrm[2] * uM[2]) * Math.sign(nu)
      if (Math.abs(nu) < EYE_FLOOR_MIN || !(leaves > 1e-9)) return 0
    }
    // The start inside a closed solid: the walker is against its underside or in it.
    if (enclosed(e.mesh, o, e.clip)) return 0
    // The walker's point as drawn must be on the gibson's own side of every face.
    const leadLen = Math.hypot(leadM[0], leadM[1], leadM[2])
    if (leadLen * g > tol && (stand !== false && stand !== 0 ? standPathHit(tris, o0, leadM, upM, tol / g, (stand === true ? 2 : stand) / g, 1 / g) : segmentHit(tris, o0, leadM, tol / (leadLen * g)) !== null)) return 0
    near.push({ tris, walker, o, g, tol })
    const hit = segmentHit(tris, o, d, tol / span)
    if (hit !== null) reach = Math.min(reach, hit.s * span - margin / Math.max(hit.square, EYE_SQUARE_MIN))
  }
  reach = Math.max(0, reach)
  for (let n = 0; n < EYE_BACK_STEPS && reach > 0 && near.length > 0; n++) {
    const close = near.some(({ tris, walker, o, g }) => {
      const p = [o[0] + (uM[0] * reach) / g, o[1] + (uM[1] * reach) / g, o[2] + (uM[2] * reach) / g]
      const room = margin / g
      for (let t = 0; t < walker.length; t++) {
        if (triangleDistance(tris, t * 9, p) < Math.min(room, walker[t])) return true
      }
      return false
    })
    if (!close) break
    reach = n === EYE_BACK_STEPS - 1 ? 0 : Math.max(0, reach - margin / 2)
  }
  return { near, reach, len }
}

/** The most times eyePlace moves the eye off a face nearer it than the near plane's room. */
const EYE_PUSH_STEPS = 4

/**
 * Where the WALK camera sits (scene/walkEyeRig.ts), as a point: `out` (and
 * the return) is the eye's offset from the walker as drawn, cyberspace
 * gibsons, as `eye` is. The same faces and rules as eyeReach, which pulls the
 * eye back along the straight line from the walker; that line is where this
 * starts, and two things are added (arkinox, 2026-11-22: "walking up stairs,
 * i get these full-screen glitches where it looks like my avatar falls down
 * under the stairs or something for just a frame"; "when i look forward the
 * screen glitches out"):
 *
 * - Up, then over. An eye mostly above the walker (no farther out than it
 *   is up) and ahead of it (his operative's is 2.8 up and 0.27 forward) on a step just short of the next riser has a
 *   straight line that runs into the riser low down, and eyeReach pulls the
 *   eye all the way back to the feet: the camera on the step for that frame,
 *   or for as long as he faces the riser. The eye is also reached the way a
 *   body would reach it: straight up to its height, then level out to it,
 *   each leg held short of the first face it meets by `margin` (eyeReach's
 *   rule). Whichever way keeps the eye higher is taken (the eye height is the
 *   avatar's; arkinox, 2026-11-16), so the level part gives way first.
 * - Room in front. A face nearer the eye than `margin` moves the eye
 *   straight off it, on a clear line, until it has the room: back from a
 *   riser or a wall in front, up off the next step's top that a stair's
 *   trail (lib/walkEye.ts walkRise) would have lowered it onto. The near
 *   plane never cuts the riser in front of a walker stopped at its foot.
 *   eyeReach lets the eye be as near a face as the walker is, which on a
 *   stair is anywhere down to touching.
 *
 * A walker held (eyeReach's 0: a wall through it, inside a solid, a door's
 * slab, a shard still being built, which `out.pending` says) keeps the eye at
 * the walker, as eyeReach does.
 */
export function eyePlace(from: Position, lead: readonly [number, number, number], eye: readonly [number, number, number], margin: number, items: readonly WallItem[], up: AxisDirection = UP_Y, out?: { pending: boolean }, stand: boolean | number = false, place: [number, number, number] = [0, 0, 0]): [number, number, number] {
  let core = eyeCore(from, lead, eye, margin, items, up, out, stand, margin * (EYE_PUSH_STEPS + 1))
  // Feet standing in a crease, where a steep face meets the floor they are on
  // (a culvert's side, a cliff's toe; arkinox, 2026-11-23: "I am dipping under
  // the floor"): the face passes through the line's start and held the camera
  // at the feet, down on the ground. Asked again from EYE_CREASE higher; a wall
  // the walker really stands in, or a solid it is inside, still holds it there.
  let lift = 0
  if (core === 0 && stand !== false && stand !== 0 && !(out && out.pending)) {
    const raisedLead: [number, number, number] = [lead[0], lead[1], lead[2]]
    raisedLead[AXIS_INDEX[up.axis]] += up.dir * EYE_CREASE
    const again = eyeCore(from, raisedLead, eye, margin, items, up, out, stand, margin * (EYE_PUSH_STEPS + 1))
    // A shard still being built under the higher line keeps `out.pending` set: the rig asks again next frame.
    if (again !== 0 && !(out && out.pending)) { core = again; lead = raisedLead; lift = EYE_CREASE }
  }
  if (typeof core === 'number') {
    place[0] = eye[0] * core; place[1] = eye[1] * core; place[2] = eye[2] * core
    if (lift > 0) place[AXIS_INDEX[up.axis]] += up.dir * lift
    return place
  }
  const { near, len } = core
  const s = core.reach / len
  const upC = [0, 0, 0]
  upC[up.axis === 'x' ? 0 : up.axis === 'y' ? 1 : 2] = up.dir
  // A cyberspace offset from the walker (lifted, as eyeCore's lines start) in a shard's render frame: Z flips.
  const toM = (c: EyeNear, q: readonly number[]): [number, number, number] => [c.o[0] + q[0] / c.g, c.o[1] + q[1] / c.g, c.o[2] - q[2] / c.g]
  // The first face the segment from `q` along `d` crosses, over every shard near.
  const cross = (q: readonly number[], d: readonly number[]): { s: number; square: number } | null => {
    const l = Math.hypot(d[0], d[1], d[2])
    if (!(l > 0)) return null
    let best: { s: number; square: number } | null = null
    for (const c of near) {
      const hit = segmentHit(c.tris, toM(c, q), [d[0] / c.g, d[1] / c.g, -d[2] / c.g], c.tol / l)
      if (hit !== null && (best === null || hit.s < best.s)) best = hit
    }
    return best
  }
  // How far from `q` along the unit way `w` the eye may go, up to `length`, held `margin` short of the first face.
  const along = (q: readonly number[], w: readonly number[], length: number): number => {
    const span = length + margin
    const hit = cross(q, [w[0] * span, w[1] * span, w[2] * span])
    return hit === null ? length : Math.min(length, Math.max(0, hit.s * span - margin / Math.max(hit.square, EYE_SQUARE_MIN)))
  }
  let p = [eye[0] * s, eye[1] * s, eye[2] * s]
  const ev = eye[0] * upC[0] + eye[1] * upC[1] + eye[2] * upC[2]
  const flatLen = Math.hypot(eye[0] - upC[0] * ev, eye[1] - upC[1] * ev, eye[2] - upC[2] * ev)
  // Only an eye mostly above the walker (a head over the feet): a third-person eye far behind still slides down its line.
  if (s < 1 && ev > 0 && flatLen <= ev) {
    const rv = along([0, 0, 0], upC, ev)
    if (rv > s * ev + 1e-9) {
      const flat = [eye[0] - upC[0] * ev, eye[1] - upC[1] * ev, eye[2] - upC[2] * ev]
      const fl = Math.hypot(flat[0], flat[1], flat[2])
      const top = [upC[0] * rv, upC[1] * rv, upC[2] * rv]
      const w = fl > 0 ? [flat[0] / fl, flat[1] / fl, flat[2] / fl] : [0, 0, 0]
      const rl = fl > 0 ? along(top, w, fl) : 0
      p = [top[0] + w[0] * rl, top[1] + w[1] * rl, top[2] + w[2] * rl]
    }
  }
  // Room in front: straight off the nearest face, while one is nearer than the margin.
  const cm = [0, 0, 0]
  for (let n = 0; n < EYE_PUSH_STEPS; n++) {
    let dist = Infinity
    const away = [0, 0, 0]
    for (const c of near) {
      const pm = toM(c, p)
      for (let t = 0; t < c.walker.length; t++) {
        const dm = triangleClosest(c.tris, t * 9, pm, cm) * c.g
        if (dm >= dist) continue
        dist = dm
        // From the face's nearest point out to the eye, in cyberspace.
        away[0] = (pm[0] - cm[0]) * c.g; away[1] = (pm[1] - cm[1]) * c.g; away[2] = -(pm[2] - cm[2]) * c.g
      }
    }
    // Clear, or on the face itself, with no way off it to tell.
    if (!(dist < margin) || !(dist > 1e-9)) break
    const k = (margin - dist + margin / 64) / dist
    const d = [away[0] * k, away[1] * k, away[2] * k]
    if (cross(p, d) !== null) break
    p = [p[0] + d[0], p[1] + d[1], p[2] + d[2]]
  }
  place[0] = p[0] + 0; place[1] = p[1] + 0; place[2] = p[2] + 0
  if (lift > 0) place[AXIS_INDEX[up.axis]] += up.dir * lift
  return place
}

/** How much higher than the feet, in gibsons, eyePlace asks again when a face through the feet held the camera at them: a sixteenth, under a centimetre at the walker's scale. */
const EYE_CREASE = 1 / 16

/**
 * Fluid WALK's ground (store/walkFluid.ts groundFluid): how high the surface
 * under the drawn walker is, in gibsons along `up` (against `down`) from the
 * walker's gibson `from`, or null when no face that stops a walker (§1.12)
 * is under it within `drop` gibsons, or a shard in reach is still being
 * built (`out.pending`). The walker is drawn `lead` gibsons from `from`,
 * by cyberspace axis; its height along `up` is where the search starts.
 *
 * The surface is found the way a walker would reach it, never through a
 * face: from the walker's height over `from`, up by the smallest whole
 * lift, 0 to `rise` (the stair step-up's), whose rise is clear and from
 * whose height the level way over to the drawn point is clear; then
 * straight down from there. So a riser under the drawn point is stood on
 * (up, over, down onto its top), a floor below a lintel is found under the
 * lintel and never on top of it, and a walker drawn past a ledge's rim
 * finds the floor below the rim. Each line starts a hair above its own
 * height (EYE_LIFT, at least sixteen of a shard's tolerance), so the face
 * the walker stands on is under it, as the eye's line has it (eyeReach).
 *
 * A question about where to draw only: nothing moves and nothing is
 * published. The walker itself stays a point at the centre of its gibson,
 * and every step is still measured from there (stepLimit). `lookup` finds
 * each shard's walls: WALK's own (entryFor), or restEntryFor outside it.
 */
export function groundUnder(from: Position, lead: readonly [number, number, number], items: readonly WallItem[], down: AxisDirection, rise: number, drop: number, out?: { pending: boolean }, lookup: (w: WallItem) => Entry = entryFor): number | null {
  if (out) out.pending = false
  const up = upOf(down)
  const ui = AXIS_INDEX[up.axis]
  const h0 = lead[ui] * up.dir
  const flat: [number, number, number] = [lead[0], lead[1], lead[2]]
  flat[ui] = 0
  const level = Math.hypot(flat[0], flat[1], flat[2])
  // The box the search can reach, cyberspace gibsons from `from`.
  const lo = [0, 0, 0], hi = [0, 0, 0]
  for (let q = 0; q < 3; q++) {
    lo[q] = Math.min(0, flat[q]) - 1
    hi[q] = Math.max(0, flat[q]) + 1
  }
  lo[ui] = Math.min(lo[ui], up.dir > 0 ? h0 - drop - 1 : -(h0 + rise) - 1)
  hi[ui] = Math.max(hi[ui], up.dir > 0 ? h0 + rise + 1 : -(h0 - drop) + 1)
  const found = groundNear(from, lo, hi, items, out, lookup)
  if (found === null || found.near.length === 0) return null
  const { near } = found
  const hair = Math.max(EYE_LIFT, 16 * found.tol)
  // A point `h` gibsons up from `from`, `along` of the way out to the drawn point, in a shard's render frame (Z flips, as stepLimit has it).
  const at = (c: { g: number; off: [number, number, number] }, h: number, along: number): [number, number, number] => {
    const p = [c.off[0] + flat[0] * along, c.off[1] + flat[1] * along, c.off[2] + flat[2] * along]
    p[ui] += up.dir * h
    return [p[0] / c.g, p[1] / c.g, -p[2] / c.g]
  }
  const si = renderSign(up)
  const levelM = (c: { g: number }): [number, number, number] => [flat[0] / c.g, flat[1] / c.g, -flat[2] / c.g]
  for (let lift = 0; lift <= rise; lift++) {
    const h = h0 + lift + hair
    // The rise, straight up over `from`: a face over it holds this lift and every higher one.
    if (lift > 0 && near.some((c) => firstHit(c.e.mesh, at(c, h0 + hair, 0), ui, si, lift / c.g, 0, c.e.clip) !== null)) return null
    // The level way over to the drawn point, at that height.
    if (level > 0 && near.some((c) => {
      const o = at(c, h, 0)
      const d = levelM(c)
      const pad = hair / c.g
      const boxLo = [0, 1, 2].map((q) => Math.min(o[q], o[q] + d[q]) - pad)
      const boxHi = [0, 1, 2].map((q) => Math.max(o[q], o[q] + d[q]) + pad)
      const tris = trianglesNear(c.e.mesh, boxLo, boxHi, c.e.clip)
      return tris.length > 0 && segmentHit(tris, o, d, 0) !== null
    })) continue
    // Then straight down onto the first face.
    let best: number | null = null
    for (const c of near) {
      const t = firstHit(c.e.mesh, at(c, h, 1), ui, -si as 1 | -1, (lift + hair + drop) / c.g, 0, c.e.clip)
      if (t !== null && (best === null || t * c.g < best)) best = t * c.g
    }
    return best === null ? null : h - best
  }
  return null
}

/** One shard near a ground question (groundNear): its walls, its unit's size in gibsons, and the walker's gibson from its coordinate (cyberspace gibsons). */
interface GroundNear { e: Entry; g: number; off: [number, number, number] }

/**
 * The shards whose walls come within the box `lo`..`hi` (cyberspace gibsons
 * from the middle of `from`), and the largest of their measuring tolerances;
 * null when one in reach is still being built (`out.pending`). A closed
 * door's slab that holds the walker lets it go (WallItem `inside`).
 */
function groundNear(from: Position, lo: readonly number[], hi: readonly number[], items: readonly WallItem[], out: { pending: boolean } | undefined, lookup: (w: WallItem) => Entry): { near: GroundNear[]; tol: number } | null {
  const blo = { x: from.x + BigInt(Math.floor(lo[0])), y: from.y + BigInt(Math.floor(lo[1])), z: from.z + BigInt(Math.floor(lo[2])) }
  const bhi = { x: from.x + BigInt(Math.ceil(hi[0])), y: from.y + BigInt(Math.ceil(hi[1])), z: from.z + BigInt(Math.ceil(hi[2])) }
  const near: GroundNear[] = []
  let tol = 0
  for (const w of items) {
    if (w.inside || !regionMeets(w, blo, bhi)) continue
    const e = lookup(w)
    if (e.first) { if (out) out.pending = true; return null }
    if (!e.reach) continue
    const g = 2 ** w.shard.unit
    const off: [number, number, number] = [Number(from.x - w.at.x), Number(from.y - w.at.y), Number(from.z - w.at.z)]
    const r = e.reach
    const wlo = [Number(r.lo.x), Number(r.lo.y), Number(r.lo.z)], whi = [Number(r.hi.x), Number(r.hi.y), Number(r.hi.z)]
    let apart = false
    for (let q = 0; q < 3; q++) if (off[q] + hi[q] < wlo[q] - 1 || off[q] + lo[q] > whi[q] + 1) apart = true
    if (apart) continue
    near.push({ e, g, off })
    tol = Math.max(tol, tolerance(e, g, 0n))
  }
  return { near, tol }
}

/** A cyberspace point `p` (gibsons from the middle of the walker's gibson) in a near shard's render frame, model units, into `out`: Z flips, as stepLimit has it. */
function nearPoint(c: GroundNear, p: readonly number[], out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  out[0] = (c.off[0] + p[0]) / c.g; out[1] = (c.off[1] + p[1]) / c.g; out[2] = -(c.off[2] + p[2]) / c.g
  return out
}

/** A cyberspace way `d` (gibsons) in a near shard's render frame, model units, into `out`. */
function nearWay(c: GroundNear, d: readonly number[], out: [number, number, number]): [number, number, number] {
  out[0] = d[0] / c.g; out[1] = d[1] / c.g; out[2] = -d[2] / c.g
  return out
}

/** nearCross's point and way in a shard's frame, reused: the footprint asks thirty-odd times a frame. */
const crossAt: [number, number, number] = [0, 0, 0]
const crossWay: [number, number, number] = [0, 0, 0]

/** Each near shard's blocking triangles in the cyberspace box `lo`..`hi` (gibsons from the walker's middle), with the shard they belong to. */
function nearTriangles(near: readonly GroundNear[], lo: readonly number[], hi: readonly number[]): Array<{ c: GroundNear; tris: Float64Array }> {
  const out: Array<{ c: GroundNear; tris: Float64Array }> = []
  for (const c of near) {
    const a = nearPoint(c, lo), b = nearPoint(c, hi)
    const tris = trianglesNear(c.e.mesh, [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])], c.e.clip)
    if (tris.length > 0) out.push({ c, tris })
  }
  return out
}

/** The first face the segment from `p` along `d` (cyberspace gibsons from the walker's middle) crosses over every near shard's triangles: how far along, as a share of the way (0 to 1), and how squarely (segmentHit); null when it crosses none. */
function nearCross(sets: ReadonlyArray<{ c: GroundNear; tris: Float64Array }>, p: readonly number[], d: readonly number[]): { s: number; square: number } | null {
  let best: { s: number; square: number } | null = null
  for (const { c, tris } of sets) {
    const hit = segmentHit(tris, nearPoint(c, p, crossAt), nearWay(c, d, crossWay), 0)
    if (hit !== null && (best === null || hit.s < best.s)) best = hit
  }
  return best
}

/**
 * How wide the drawn walker's footprint is, in gibsons: one across, the
 * owner's "average over a gibson" (arkinox, 2026-11-23: "I am dipping under
 * the floor"). The feet stand on the highest ground under it (footGround).
 */
export const FOOT_RADIUS = 0.5

/**
 * The steepest ground the footprint stands on, as rise over run: the stair
 * step-up's own, STEP_UP_MAX (2) a gibson (store/walkStep.ts). A face under
 * the footprint steeper than this (a wall, a cliff, a culvert's side), or
 * ground rising faster than this from the middle (a riser's top), is one
 * only the walk itself climbs: it never lifts the feet. Engines call it the
 * walkable floor angle (Unreal's WalkableFloorAngle, Quake's MIN_WALK_NORMAL).
 */
export const FOOT_SLOPE = 2

/** How near FOOT_SLOPE's rise, in gibsons, counts as reaching it: a riser exactly as tall as the rim allows (a whole gibson at FOOT_RADIUS) never lifts the feet, whatever the float rounding. */
const FOOT_TIE = 1e-6

/** FOOT_SLOPE as the least a face's normal may point up (its cosine with up): 1 / sqrt(1 + 4), about 0.447. */
const FOOT_FLAT_MIN = 1 / Math.sqrt(1 + FOOT_SLOPE * FOOT_SLOPE)

/** Where the footprint is sampled, as shares of FOOT_RADIUS across the two axes level with the ground: a ring at the rim and one halfway, eight each. */
const FOOT_RING: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number]> = []
  for (const r of [1, 0.5]) for (let k = 0; k < 8; k++) out.push([r * Math.cos((k * Math.PI) / 4), r * Math.sin((k * Math.PI) / 4)])
  return out
})()

/**
 * Fluid WALK's feet, and the step WALK's eased walker point (store/walkFluid.ts
 * groundFluid, stepFloor): how high the ground under the walker's footprint
 * stands, in gibsons along `up` (against `down`) from the middle of `from`.
 * The drawn point is `lead` gibsons from that middle (its height is ignored),
 * standing on `ground`, the surface groundUnder found under it.
 *
 * Games stand a walker on the first hit of its collision shape swept down
 * (Unreal's capsule sweep in FindFloor, Quake's and Source's box trace, Unity's
 * and Godot's capsules), which is the highest ground under the shape within a
 * step: a single ray under the middle sinks the rest of the footprint into
 * every slope and ridge beside it. This is that sweep for a flat footprint
 * a gibson across (FOOT_RADIUS round the middle), sampled: the middle and
 * sixteen points round it. Each point is reached the way a foot would reach
 * it, never through a face: up from the drawn point by as much as the
 * footprint can rise (FOOT_SLOPE times FOOT_RADIUS, less under a ceiling),
 * level out to it, then down onto the first face. A face steeper than
 * FOOT_SLOPE, or ground rising faster than that from the middle, is left out,
 * so the feet never climb a wall or perch on a riser the walk itself has not
 * stepped up. Standing on the lowest point of the footprint's middle band
 * instead is what engines leave to foot IK, which bends a leg and never
 * moves the body: the body stood there sinks its middle into every slope.
 *
 * A question about where to draw only: nothing moves and nothing is
 * published. `ground` itself when nothing under the footprint is higher, or
 * when a shard in reach is still being built, which `out.pending` says.
 */
export function footGround(from: Position, lead: readonly [number, number, number], ground: number, items: readonly WallItem[], down: AxisDirection, out?: { pending: boolean }, lookup: (w: WallItem) => Entry = entryFor): number {
  const up = upOf(down)
  const ui = AXIS_INDEX[up.axis]
  const ja = ((ui + 1) % 3) as 0 | 1 | 2, ka = ((ui + 2) % 3) as 0 | 1 | 2
  const top = FOOT_SLOPE * FOOT_RADIUS
  // The drawn point on the ground, cyberspace gibsons from the middle of `from`.
  const p = [lead[0], lead[1], lead[2]]
  p[ui] = up.dir * ground
  const lo = [p[0] - FOOT_RADIUS, p[1] - FOOT_RADIUS, p[2] - FOOT_RADIUS], hi = [p[0] + FOOT_RADIUS, p[1] + FOOT_RADIUS, p[2] + FOOT_RADIUS]
  lo[ui] = Math.min(p[ui], p[ui] + up.dir * (top + 1)) - 1
  hi[ui] = Math.max(p[ui], p[ui] + up.dir * (top + 1)) + 1
  const found = groundNear(from, lo, hi, items, out, lookup)
  if (found === null || found.near.length === 0) return ground
  const hair = Math.max(EYE_LIFT, 16 * found.tol)
  const sets = nearTriangles(found.near, lo, hi)
  if (sets.length === 0) return ground
  // A hair above the feet, and how far up from there the footprint may reach: under a ceiling, less.
  const start = [p[0], p[1], p[2]]
  start[ui] += up.dir * hair
  const upWay = [0, 0, 0]
  upWay[ui] = up.dir * top
  const ceiling = nearCross(sets, start, upWay)
  const reach = ceiling === null ? top : ceiling.s * top - hair
  if (!(reach > hair)) return ground
  const top0 = [start[0], start[1], start[2]]
  top0[ui] += up.dir * reach
  const downWay = [0, 0, 0]
  downWay[ui] = -up.dir * reach
  const way = [0, 0, 0]
  const at = [0, 0, 0]
  let best = ground
  for (const [a, b] of FOOT_RING) {
    way[ja] = a * FOOT_RADIUS
    way[ka] = b * FOOT_RADIUS
    way[ui] = 0
    // Level out to the point: a face on the way is a wall between, and the point is not stood on.
    if (nearCross(sets, top0, way) !== null) continue
    at[0] = top0[0] + way[0]; at[1] = top0[1] + way[1]; at[2] = top0[2] + way[2]
    const hit = nearCross(sets, at, downWay)
    // Nothing above the feet's own height there, or a face too steep to stand on.
    if (hit === null || hit.square < FOOT_FLAT_MIN) continue
    const h = ground + hair + reach * (1 - hit.s)
    // Rising faster than FOOT_SLOPE from the middle: a riser's top, never stood on from here.
    if (h - ground >= FOOT_SLOPE * FOOT_RADIUS * Math.hypot(a, b) - FOOT_TIE) continue
    if (h > best) best = h
  }
  return best
}

/**
 * Whether the ground under the drawn point `lead` (cyberspace gibsons from the
 * middle of `from`, its height ignored), at `ground` gibsons up from that
 * middle (groundUnder's answer), is a face steeper than FOOT_SLOPE: the side
 * of a wall or a cliff the ground search climbed onto by its lifts, which
 * nobody stands on (store/walkFluid.ts groundFluid).
 */
export function steepGround(from: Position, lead: readonly [number, number, number], ground: number, items: readonly WallItem[], down: AxisDirection, lookup: (w: WallItem) => Entry = entryFor): boolean {
  const up = upOf(down)
  const ui = AXIS_INDEX[up.axis]
  const p = [lead[0], lead[1], lead[2]]
  p[ui] = up.dir * ground
  const lo = [p[0] - 1, p[1] - 1, p[2] - 1], hi = [p[0] + 1, p[1] + 1, p[2] + 1]
  const found = groundNear(from, lo, hi, items, undefined, lookup)
  if (found === null || found.near.length === 0) return false
  const hair = Math.max(EYE_LIFT, 16 * found.tol)
  p[ui] += up.dir * 2 * hair
  const way = [0, 0, 0]
  way[ui] = -up.dir * 4 * hair
  const hit = nearCross(nearTriangles(found.near, lo, hi), p, way)
  return hit !== null && hit.square < FOOT_FLAT_MIN
}

/**
 * How much of the way out to the drawn point `lead` (cyberspace gibsons from
 * the middle of `from`, level across `down`) is clear at the feet's height,
 * `height` gibsons up from that middle: 1 when the level line from the
 * column over the middle out to it crosses no face, else the share that
 * keeps it `margin` gibsons short of the first face it crosses (0 at least).
 * For a drawn point the ground search could not reach at all, which is
 * inside something (store/walkFluid.ts holdBack).
 */
export function clearShare(from: Position, lead: readonly [number, number, number], height: number, items: readonly WallItem[], down: AxisDirection, margin: number, lookup: (w: WallItem) => Entry = entryFor): number {
  const up = upOf(down)
  const ui = AXIS_INDEX[up.axis]
  const way = [lead[0], lead[1], lead[2]]
  way[ui] = 0
  const len = Math.hypot(way[0], way[1], way[2])
  if (!(len > 0)) return 1
  const o = [0, 0, 0]
  o[ui] = up.dir * height
  const lo = [Math.min(0, way[0]) - 1, Math.min(0, way[1]) - 1, Math.min(0, way[2]) - 1]
  const hi = [Math.max(0, way[0]) + 1, Math.max(0, way[1]) + 1, Math.max(0, way[2]) + 1]
  lo[ui] = o[ui] - 1
  hi[ui] = o[ui] + 1
  const found = groundNear(from, lo, hi, items, undefined, lookup)
  if (found === null || found.near.length === 0) return 1
  o[ui] += up.dir * Math.max(EYE_LIFT, 16 * found.tol)
  const hit = nearCross(nearTriangles(found.near, lo, hi), o, way)
  return hit === null ? 1 : Math.max(0, hit.s - margin / len)
}

/**
 * Where an avatar is drawn (arkinox, 2026-11-17: "an avatar shard's ORIGIN
 * is the point that touches the ground geometry"): how far, in gibsons, to
 * draw its origin below the centre of its gibson `at`. On the first face that
 * stops a walker (§1.12) within a gibson under that centre, a whole gibson
 * under it included; with none, on the floor of its own gibson, half a
 * gibson down (REST_FLOOR). So every avatar, the default icosahedron
 * included (its lowest point is its origin), stands on what is under it.
 * Below is along `down`. Display only: the avatar's coordinate, its
 * chain and every step are unchanged, and a walker is still measured from
 * its gibson's centre.
 */
export function restDrop(at: Position, plane: number, down: AxisDirection = WORLD_DOWN): { drop: number; pending: boolean } {
  const out = { pending: false }
  // The keys of every shard in this plane, closed doors included (wallItemsAt leaves out a door that lets this avatar go): read once, and only if a build is needed.
  let keys: Set<string> | null = null
  const inWorld = (): Set<string> => (keys ??= new Set(wallItems(plane).map((x) => x.key)))
  const s = groundUnder(at, [0, 0, 0], wallItemsAt(plane, at), down, 0, REST_REACH, out, (w) => restEntryFor(w, inWorld))
  return { drop: s === null || s < -REST_REACH ? REST_FLOOR : Math.min(1, Math.max(0, -s)), pending: out.pending }
}

/**
 * The walls restDrop stands avatars on, outside WALK's own builds: a shard's
 * walls WALK has already built whole, else its own faces alone, built here
 * and kept apart (restEntries). Nothing a placed object carries is fetched
 * and no WALK pool is charged, so standing other people's avatars never
 * spends what holds the walker (review of #800). A part not yet built by
 * WALK holds no avatar up until it is.
 */
function restEntryFor(w: WallItem, inWorld: () => ReadonlySet<string>): Entry {
  const held = entries.get(w.key)
  if (held && !held.first && held.shard === w.shard && held.where === whereOf(w)) return held
  const kept = restEntries.get(w.key)
  if (kept && kept.e.shard === w.shard && kept.e.where === whereOf(w)) {
    // The most recently asked goes last, so it is the last to go.
    restEntries.delete(w.key)
    restEntries.set(w.key, kept)
    return kept.e
  }
  if (kept) { restEntries.delete(w.key); restBytes -= kept.bytes }
  // A build is about to be made, which costs far more than this: the walls of
  // shards no longer in the world (moved, deleted, hidden again) go first.
  // Only this plane's: `inWorld` is the shards of the plane asked about.
  if (restEntries.size > 0) {
    const here = inWorld()
    for (const [k, v] of restEntries) if (v.e.item.plane === w.plane && !here.has(k)) { restEntries.delete(k); restBytes -= v.bytes }
  }
  const e = build(w, [], false, false)
  const bytes = wallBytes(e.mesh)
  restEntries.set(w.key, { e, bytes })
  restBytes += bytes
  // Least recently asked first out, past either bound; never the one just built.
  for (const [k, v] of restEntries) {
    if (restEntries.size <= restBounds.count && restBytes <= restBounds.bytes) break
    if (k === w.key) continue
    restEntries.delete(k)
    restBytes -= v.bytes
  }
  return e
}

/**
 * restEntryFor's own builds, by shard key, least recently asked first, with
 * what each holds in bytes. A shard moved or hidden again is a new key, so
 * the walls of where it was stood here until 512 had gathered (2026-11-18:
 * a session of BUILD moves among large imported pieces grew it with every move,
 * each entry its triangles and the old placement's whole model). Now the
 * walls of a shard no longer in the world go before the next build, and what
 * stays is bounded by count and by bytes, the least recently asked let go first.
 */
const restEntries = new Map<string, { e: Entry; bytes: number }>()
let restBytes = 0

/**
 * The most restEntryFor keeps, and the most bytes of triangles and placements:
 * a backstop on memory, never on correctness (one let go is built again when
 * asked). Shards that left the world go first anyway, so these bind only on a
 * world holding more than this near avatars at once, where a smaller bound
 * would build the same walls again at every ask (review).
 */
export const restBounds = { count: 512, bytes: 256 * 1024 * 1024 }

/** About what one build holds of its own: its triangles and each placement's matrix and bounds (a model's walls are shared). */
function wallBytes(mesh: WallMesh): number {
  return mesh.tris.byteLength + mesh.placements.length * 256 + 256
}

/** What restEntryFor keeps now, least recently asked first: for tests, and the memory soak. */
export function restWallsKept(): { count: number; bytes: number; keys: string[] } {
  return { count: restEntries.size, bytes: restBytes, keys: [...restEntries.keys()] }
}

/** The floor of a gibson, in gibsons under its centre: where an avatar with nothing under it stands. */
export const REST_FLOOR = 0.5

/** How far under a gibson's centre restDrop looks, in gibsons: a whole gibson, and a hair for the float. */
const REST_REACH = 1 + 1e-6

/**
 * Whether every way from `o0` (the gibson's centre, lifted, in a shard's
 * render frame) to `o0 + lead` crosses a face of `tris` (eyeReach `stand`),
 * each the way groundUnder reaches the ground: up along `upM` to a climb,
 * level to over the point, then down onto it. The climbs tried are the
 * point's own height when that is higher, then each whole gibson
 * (`gibsonM` model units) up to `riseM`, as the ground's lifts are. A hit within `tolM` model
 * units of a leg's start does not count, as eyeReach's straight line has it.
 */
function standPathHit(tris: Float64Array, o0: readonly [number, number, number], lead: readonly [number, number, number], upM: readonly number[], tolM: number, riseM: number, gibsonM: number): boolean {
  const h = lead[0] * upM[0] + lead[1] * upM[1] + lead[2] * upM[2]
  const flat: [number, number, number] = [lead[0] - upM[0] * h, lead[1] - upM[1] * h, lead[2] - upM[2] * h]
  const climbs = [Math.max(0, h)]
  for (let k = 1; k * gibsonM <= riseM * (1 + 1e-12); k++) if (k * gibsonM > climbs[0]) climbs.push(k * gibsonM)
  const p: [number, number, number] = [0, 0, 0]
  const hit = (d: readonly number[]): boolean => {
    const len = Math.hypot(d[0], d[1], d[2])
    const crossed = len > tolM && segmentHit(tris, p, d as [number, number, number], tolM / len) !== null
    p[0] += d[0]; p[1] += d[1]; p[2] += d[2]
    return crossed
  }
  return climbs.every((c) => {
    p[0] = o0[0]; p[1] = o0[1]; p[2] = o0[2]
    return hit([upM[0] * c, upM[1] * c, upM[2] * c]) || hit(flat) || hit([upM[0] * (h - c), upM[1] * (h - c), upM[2] * (h - c)])
  })
}

/** How many times floorPad has been asked: for the test that a world with no bounce asks it nothing. */
let padQueryCount = 0
export function padQueries(): number {
  return padQueryCount
}

/** The floor under a walker, as a bounce reads it (floorPad). */
export interface Pad {
  bounce: Bounce
  springboard: boolean
}

/**
 * BOUNCE, EXPERIMENTAL (lib/walkBounce.ts): the `bounce` of the floor a
 * walker at `at` stands on (a launch height, `"reflect"`, or 0 for none) and
 * its `springboard`. The floor is the one GRAVITY stands on (stepLimit with `stand`: a blocking face less than a gibson below, or
 * one in the walker's own plane with open space above), so it is always met
 * from above: a side face is parallel to the ray and a bottom face is never
 * under a walker standing, so neither ever bounces. The face right under the
 * walker decides, by the payload that owns it, among every shard: of two at
 * exactly the same height (a pad flush with a floor), the one that bounces.
 * Under the walker is along its gravity, `down` (lib/walkDown.ts).
 */
export function floorPad(at: Position, items: readonly WallItem[], down: AxisDirection = WORLD_DOWN): Pad {
  padQueryCount++
  const none: Pad = { bounce: 0, springboard: false }
  const under = stepLimit(at, down.axis, down.dir, 1n, items, down)
  if (under.reach !== 0n || !under.by) return none
  // A face in your own plane is under you only where stepLimit would stand you on it: open space above.
  const plane = openAbove(at, items, upOf(down))
  const i = AXIS_INDEX[down.axis]
  const s = renderSign(down)
  let best: number | null = null
  let pad = none
  for (const w of items) {
    if (w.inside || !regionReached(w, at, down.axis, down.dir, 1n)) continue
    const e = entries.get(w.key)
    if (!e || e.first || !e.reach) continue
    const g = 2 ** w.shard.unit
    const tol = tolerance(e, g, 1n)
    const hair = tolerance(e, g, 0n)
    const o: [number, number, number] = [Number(at.x - w.at.x) / g, Number(at.y - w.at.y) / g, -Number(at.z - w.at.z) / g]
    const who: { bounce: Bounce; springboard?: boolean } = { bounce: 0 }
    const t = firstHit(e.mesh, o, i, s, (1 + tol) / g, (plane && hair < HAIR_MAX ? -hair : ON_FACE) / g, e.clip, who)
    if (t === null) continue
    const gib = t * g
    // Nearest wins; only a pad flush with a floor beside or under it (a tie within float rounding) wins over the floor.
    const split = (who.bounce !== 0) !== (pad.bounce !== 0) && best !== null && Math.abs(gib - best) <= TIE
    if (best === null || (split ? who.bounce !== 0 : gib < best)) { best = gib; pad = { bounce: who.bounce, springboard: !!who.springboard } }
  }
  return pad
}

/** Two floors this close, in gibsons, are flush: float error only. */
const TIE = 1e-9

/** A cyberspace axis's index in the walls' frame. */
const AXIS_INDEX: Record<AxisName, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }

/** A cyberspace direction's sign in the walls' frame: render Z is cyberspace -Z. */
function renderSign(d: AxisDirection): 1 | -1 {
  return (d.axis === 'z' ? -d.dir : d.dir) as 1 | -1
}

/**
 * A door slab's thin axis in the walls' frame (0, 1, 2 for X, Y, Z) and its
 * middle along it, in model units: where a walker inside the slab is held
 * (WallItem `inside`). Null for a slab with no bounds.
 */
function slabMiddle(mesh: WallMesh): { axis: 0 | 1 | 2; at: number } | null {
  if (!mesh.min || !mesh.max) return null
  const size = [0, 1, 2].map((k) => mesh.max![k] - mesh.min![k])
  const axis = (size[0] <= size[1] && size[0] <= size[2] ? 0 : size[1] <= size[2] ? 1 : 2) as 0 | 1 | 2
  return { axis, at: (mesh.min[axis] + mesh.max[axis]) / 2 }
}

/**
 * How many whole gibsons a walker at `from`, inside the door slab `w`, may
 * step along walls axis `i` before reaching its middle: never onto it, never
 * across it. Null when the step does not go toward the middle (another axis,
 * away from it) or starts beside the slab, where walking round a door with
 * no frame is no way through it. On the middle itself, neither way.
 */
function middleReach(e: Entry, w: WallItem, from: Position, i: 0 | 1 | 2, dir: 1 | -1, length: bigint): bigint | null {
  const m = slabMiddle(e.mesh)
  if (!m || m.axis !== i) return null
  const g = 2 ** w.shard.unit
  const p = [Number(from.x - w.at.x) / g, Number(from.y - w.at.y) / g, -Number(from.z - w.at.z) / g]
  for (const k of [0, 1, 2]) if (k !== i && (p[k] < e.mesh.min![k] || p[k] > e.mesh.max![k])) return null
  const off = p[i] - m.at
  if (off === 0) return 0n
  // Render Z is cyberspace -Z.
  const s = i === 2 ? -dir : dir
  if (Math.sign(off) === s) return null
  const k = BigInt(Math.max(0, Math.ceil(Math.abs(off) * g) - 1))
  return k < length ? k : length
}

/**
 * The largest tolerance, in gibsons, at which a face is still told to be in
 * the walker's own plane: past it the measure cannot say which side of a face
 * a whole gibson is on (a monument), and the face you stand on lets you go.
 */
const HAIR_MAX = 0.5

/**
 * The shard whose face is in the walker's own plane (within its tolerance of
 * `from`'s height, either side) while the space a hair above `from` is
 * inside a closed solid: you are right under a solid's underside, and nothing
 * of yours goes up into it, a jump nor a stair's lift (arkinox, 2026-10-25:
 * floors only; review of #497). Null when there is no such face, or the space
 * above is open. The upward step itself lets the face you are on go, as every
 * step does (stepLimit), so this is asked beside it. Only a closed solid
 * refuses: an open shell, such as a Maze Kit room's lintel or ceiling (its
 * doorway rims are open edges), encloses nothing, so it refuses no jump and
 * no lift (arkinox, 2026-10-26: accepted). Above is against the walker's
 * gravity, `down` (lib/walkDown.ts).
 */
export function underSolid(from: Position, items: readonly WallItem[], down: AxisDirection = WORLD_DOWN): WallItem | null {
  const up = upOf(down)
  const i = AXIS_INDEX[up.axis]
  const s = renderSign(up)
  let face: WallItem | null = null
  for (const w of items) {
    // As stepLimit: only a shard whose region you are in, and one whose first
    // build is on its way is waited for (takeWallWait) rather than passed.
    // A door slab holding the walker: its faces let them go (WallItem `inside`).
    if (w.inside || !regionReached(w, from)) continue
    const e = entryFor(w)
    if (e.first) { waited = true; continue }
    if (!e.reach) continue
    const g = 2 ** w.shard.unit
    const hair = tolerance(e, g, 0n)
    if (hair >= HAIR_MAX) continue
    const off = { x: from.x - w.at.x, y: from.y - w.at.y, z: from.z - w.at.z }
    const lo = e.reach.lo, hi = e.reach.hi
    if ((['x', 'y', 'z'] as const).some((a) => off[a] < lo[a] || off[a] > hi[a])) continue
    const o: [number, number, number] = [Number(off.x) / g, Number(off.y) / g, -Number(off.z) / g]
    if (firstHit(e.mesh, o, i, s, hair / g, -hair / g, e.clip) !== null) { face = w; break }
  }
  return face && !openAbove(from, items, up) ? face : null
}

/**
 * Whether the space a hair above `from` is open: inside no closed solid of
 * any of `items` (lib/walkConstrain.ts enclosed), each shard measured with
 * its own tolerance as the hair. A shard whose measure cannot tell a hair
 * (HAIR_MAX) encloses nothing here. Above is along `up`.
 */
function openAbove(from: Position, items: readonly WallItem[], up: AxisDirection = UP_Y): boolean {
  const i = AXIS_INDEX[up.axis]
  const s = renderSign(up)
  for (const w of items) {
    // A door slab holding the walker: its faces let them go (WallItem `inside`).
    if (w.inside || !regionReached(w, from)) continue
    const e = entryFor(w)
    if (e.first) { waited = true; continue }
    if (!e.reach) continue
    const g = 2 ** w.shard.unit
    const hair = tolerance(e, g, 0n)
    if (hair >= HAIR_MAX) continue
    const off = { x: from.x - w.at.x, y: from.y - w.at.y, z: from.z - w.at.z }
    const lo = e.reach.lo, hi = e.reach.hi
    if ((['x', 'y', 'z'] as const).some((a) => off[a] < lo[a] || off[a] > hi[a])) continue
    // A hair along `up`, in the walls' frame, before the unit: for -Y gravity exactly as it always was.
    const n = [Number(off.x), Number(off.y), -Number(off.z)]
    n[i] += s * hair
    if (enclosed(e.mesh, [n[0] / g, n[1] / g, n[2] / g], e.clip)) return false
  }
  return true
}

const UP_Y: AxisDirection = { axis: 'y', dir: 1 }

/** A chest's or a door's look as a wall: its own key, so it is never confused with a shard's entry. */
export const doorWallKey = (doorId: string): string => `door:${doorId}`

/**
 * Whether the walker at `from` stands inside a door's slab: shut, or
 * written, around where they stand. Its faces then let them go, or they
 * could never step out of it (review of #532: all six ways read 0), and its
 * middle holds them instead (WallItem `inside`). Inside means strictly within
 * the slab's own bounds, the doorway's volume: a slab has no side faces of
 * its own (the doorway's reveal is its edge, chest-door/models/README.md), so
 * it encloses nothing a ray test could find. On its bounds is outside, and
 * its faces stand.
 */
export function enclosesWalker(w: WallItem, from: Position): boolean {
  if (!regionReached(w, from)) return false
  const { mesh } = entryFor(w)
  if (!mesh.min || !mesh.max) return false
  const g = 2 ** w.shard.unit
  // The walls' frame: render Z is cyberspace -Z.
  const p = [Number(from.x - w.at.x) / g, Number(from.y - w.at.y) / g, -Number(from.z - w.at.z) / g]
  return p.every((v, k) => v > mesh.min![k] && v < mesh.max![k])
}

/**
 * The shards a walker in `plane` can meet: every shard placed in the world
 * there, as the scene draws them, and every chest and door as the look it
 * is drawn as, by that look's own WALK setting (DECK-0004 §3.6 Walkers): a
 * chest's look always, a door's closed look until this identity opens it
 * (chest and door design, R11: "a locked door blocks per its model's
 * collision until opened"), and its open look after. OPEN swaps the look at
 * once, before any picture of it opening has finished, so a walker is never
 * held by an animation. The built-in slabs' open looks carry no setting,
 * which is OFF, so an opened built-in door holds nobody.
 */
export function wallItems(plane: number): WallItem[] {
  const all = useShards.getState().drawnItems()
  // The shards and chests of this plane, picked out once per world (drawnItems
  // keeps its list until the world changes): every WALK step, fall and stand
  // asks for the walls, many times a frame. What a chest is drawn as is asked
  // again each time below, as it changes with OPEN, CLOSE and a look arriving.
  let picked = wallPicks
  if (!picked || picked.all !== all || picked.plane !== plane) {
    const shards = all.filter((w): w is WorldItem & { shard: ShardModel } => w.type === 'shard' && !!w.shard && w.plane === plane)
    const chests = all.filter((w) => w.type === 'chest' && !!w.chest && w.plane === plane)
    picked = wallPicks = { all, plane, shards, chests, looks: [], out: shards }
  }
  const { shards, chests } = picked
  const me = useCyberspace.getState().identity.pubkey
  const looks: WallItem[] = []
  for (const w of chests) {
    if (w.type !== 'chest' || !w.chest || w.plane !== plane) continue
    const look = lookOf(w)
    if (!look) continue
    // Opened by hand, this session or before, under the lock it has now (R10).
    const model = drawnLook(look, openedByHand(me, w.key, w.chest.lockPubkey))
    if (!model || constrainOf(model) === 'off') continue
    const roomHeight = look.kind === 'door' ? doorHeightOf(w.event?.tags) : undefined
    const closedRoom = typeof roomHeight === 'number' && closedByMe(me, w.key, w.chest.lockPubkey) ? roomHeight : undefined
    looks.push({ key: doorWallKey(w.key), at: w.at, height: w.height, plane: w.plane, author: w.author, mine: w.mine, shard: model, uncut: look.name !== 'custom', door: look.kind === 'door', ...(closedRoom !== undefined ? { closedRoom } : {}) })
  }
  if (looks.length === 0) return shards
  // The same looks as last time: the same list, so a caller holding it holds one that is still right.
  if (sameLooks(picked.looks, looks)) return picked.out
  picked.looks = looks
  picked.out = [...shards, ...looks]
  return picked.out
}

/**
 * wallItems' picks from the world it last read (drawnItems' list), for one
 * plane: its shards, its chests, and the looks and the list it last gave.
 */
let wallPicks: { all: WorldItem[]; plane: number; shards: WallItem[]; chests: WorldItem[]; looks: WallItem[]; out: WallItem[] } | null = null

/** Whether two lists of chest looks stand for the same walls: each the same chest, as the same model, the same way. */
function sameLooks(a: readonly WallItem[], b: readonly WallItem[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.key !== y.key || x.shard !== y.shard || x.at !== y.at || x.height !== y.height || x.plane !== y.plane || x.author !== y.author || x.mine !== y.mine || x.uncut !== y.uncut || x.door !== y.door || x.closedRoom !== y.closedRoom) return false
  }
  return true
}

/**
 * The walls of a walker at `from`: wallItems, where a door opened by hand
 * before on this device is open after a reload too, whether a key or a
 * signer opened it (store/useOpenedChests openedByHand), a door closed with
 * CLOSE lets a walker inside its room go (closedDoorLets), and a closed door
 * whose slab already holds them is marked `inside`: they can step out of it
 * (review of #532), on their own side only (review of the ceremony). What
 * every WALK step, fall and jump asks.
 */
export function wallItemsAt(plane: number, from: Position): WallItem[] {
  const all = wallItems(plane)
  // Only a door closed with CLOSE, a built-in look or a door depends on where
  // the walker stands; where none of them lets the walker go or holds them,
  // the walls are wallItems' own list, with nothing copied.
  if (!all.some((w) => closedDoorLets(w, from) || ((w.uncut || w.door) && enclosesWalker(w, from)))) return all
  return all
    .filter((w) => !closedDoorLets(w, from))
    .map((w) => ((w.uncut || w.door) && enclosesWalker(w, from) ? { ...w, inside: true } : w))
}

/**
 * The boxes the walls of `items` have resolved, in whole gibsons, absolute
 * (each wall's mesh reach from its shard's coordinate, as nearness reads it):
 * what WALK's rescue check measures against (store/useWalk.ts, walkGravity
 * canStillLand). Asks nothing to be built. `pending` when a wall whose region
 * a walker at `at` is in (regionReached) has not been built yet, so it cannot
 * yet be said there is nothing there; a wall in a region you are not in is
 * never waited for.
 */
export function wallBoxes(items: readonly WallItem[], at: Position): { boxes: Array<{ lo: Position; hi: Position }>; pending: boolean } {
  const boxes: Array<{ lo: Position; hi: Position }> = []
  let pending = false
  for (const w of items) {
    const e = entries.get(w.key)
    if (!e || !e.reach) {
      if ((!e || e.first) && !pending && regionReached(w, at)) pending = true
      continue
    }
    const r = e.reach
    boxes.push({ lo: { x: w.at.x + r.lo.x, y: w.at.y + r.lo.y, z: w.at.z + r.lo.z }, hi: { x: w.at.x + r.hi.x, y: w.at.y + r.hi.y, z: w.at.z + r.hi.z } })
  }
  return { boxes, pending }
}

/**
 * Nobody is trapped by CLOSE (arkinox, 2026-11-01: "you can't get trapped"). A
 * door closed with CLOSE is no wall at all to a walker who stands inside its room
 * (the aligned cube of its height that holds it, DECK-0004 §3.7.1) or inside its
 * slab: they walk out through the doorway. From outside the room it stops them,
 * as any closed door does, until OPEN.
 */
export function closedDoorLets(w: WallItem, from: Position): boolean {
  if (w.closedRoom === undefined) return false
  return inRoom(w.at, w.closedRoom, from) || enclosesWalker(w, from)
}
