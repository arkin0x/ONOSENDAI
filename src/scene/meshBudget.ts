/**
 * meshBudget.ts - how many placed objects the world's scene draws, all told.
 *
 * A shard that places others draws each placement with its object's whole
 * resolved tree (ShardMesh Placements). sno-core bounds what one resolve
 * holds, but the drawing multiplies it: a shard of a few kilobytes placing an
 * object of 21 parts a thousand times draws 21,000 objects, each a mesh and a
 * cloud of points, two draw calls apiece (measured: 300 such placements, 6,300
 * objects, 12,632 draw calls a frame and 205 MB, against 134 calls for the
 * whole Maze Kit hidden around you). So the scene has a budget of placed
 * objects, spent by trust as WALK's walls are (lib/trust.ts): your own and
 * those of authors you follow from a reserved share no stranger can spend,
 * strangers' from the rest under a per-shard ceiling, nearest first. What a
 * shard cannot draw within its allowance is one outline round the placements
 * it cut, one draw call; it never stops a walker, since WALK has its own
 * budget (store/walkWalls.ts).
 *
 * Each world shard says what its tree would draw (setDemand), split by which
 * share pays for each object (a stranger's object placed by a shard of yours
 * is the strangers' to pay for, as in WALK), and reads back what it may
 * (useAllowance). Only the world's shards take part: the bench,
 * pictures and item models draw what they are given.
 */

import { useSyncExternalStore } from 'react'

/**
 * Placed objects drawn for your own shards and those of authors you follow,
 * together: about two draw calls each, so 2,000 is about 4,000 calls a frame,
 * which a phone still carries, and some twenty-five times the largest of the
 * owner's real views. Instancing repeated objects would let it grow.
 */
export const SCENE_TRUSTED = 2_000
/** Placed objects drawn for strangers' shards, together. */
export const SCENE_STRANGER = 1_000
/** The most of it any one stranger's shard may draw. */
export const SCENE_STRANGER_SHARD = 250
/**
 * How much nearer a shard must be than one already drawing to take its place:
 * a fifth, at every distance. Distances are said in doublings (log2), so a
 * shard that holds an allowance counts as HYSTERESIS_DOUBLINGS nearer, a flat
 * 1.25 times, and two shards at about the same distance do not trade hundreds
 * of objects on every step.
 */
export const HYSTERESIS = 0.2
export const HYSTERESIS_DOUBLINGS = Math.log2(1 / (1 - HYSTERESIS))

/**
 * What one world shard would draw: its placed objects at every depth, split
 * by whose share pays for each (lib/trust.ts chargeByTrust, the rule WALK's
 * walls charge by): `trusted`, objects by you or those you follow placed
 * through nothing but such objects, from a shard whose placer and author are
 * both trusted; `stranger`, every other. A stranger's shard has only
 * `stranger`; a shard of yours placing a stranger's object has some of each.
 */
export interface Demand {
  trusted: number
  stranger: number
  /** How far from the anchor (where the camera looks), in doublings: log2(1 + render units). Nearest first. */
  distance: number
}

/** How many of a shard's placed objects each pool lets it draw. */
export interface Allowance {
  trusted: number
  stranger: number
}

const NONE: Allowance = Object.freeze({ trusted: 0, stranger: 0 })

const demands = new Map<string, Demand>()
let allowances = new Map<string, Allowance>()
/** What each pool has given out, at the last allocation, and provisionally since: for provisional, at once. */
let usedTrusted = 0
let usedStranger = 0
const listeners = new Set<() => void>()
/** A reallocation is due: every demand said in this task is counted in one. */
let dirty = false

/**
 * Say what a world shard would draw. The allowances follow once, after every
 * shard of this commit has said (a microtask): an anchor step moves every
 * shard's centre, and reallocating at each report made a step cost the square
 * of the shards in view.
 */
export function setDemand(key: string, d: Demand): void {
  const was = demands.get(key)
  if (was && was.trusted === d.trusted && was.stranger === d.stranger && was.distance === d.distance) return
  demands.set(key, d)
  schedule()
}

/** A world shard no longer drawn. */
export function dropDemand(key: string): void {
  if (!demands.delete(key)) return
  schedule()
}

function schedule(): void {
  if (dirty) return
  dirty = true
  queueMicrotask(flushMeshBudget)
}

/** Reallocate now, if anything has changed since the last time (the microtask does it; tests call it). */
export function flushMeshBudget(): void {
  if (!dirty) return
  dirty = false
  const next = allocate(demands, allowances)
  let changed = next.size !== allowances.size
  // A shard whose allowance did not change keeps the same object, so its draw does not redo anything.
  for (const [k, v] of next) {
    const was = allowances.get(k)
    if (was && was.trusted === v.trusted && was.stranger === v.stranger) next.set(k, was)
    else changed = true
  }
  allowances = next
  usedTrusted = 0
  usedStranger = 0
  for (const v of next.values()) { usedTrusted += v.trusted; usedStranger += v.stranger }
  if (changed) for (const l of listeners) l()
}

/**
 * The allowances, from the demands. The trusted pool: each shard's trusted
 * part, nearest first, while SCENE_TRUSTED lasts. The strangers' pool: each
 * shard's stranger part, nearest first, at most SCENE_STRANGER_SHARD a shard,
 * while SCENE_STRANGER lasts. A part of nothing takes no part; where every
 * part of a pool fits in it, nothing is sorted. `held`, the allowances before,
 * gives HYSTERESIS, pool by pool: a shard drawing from a pool counts as that
 * much nearer in it.
 */
export function allocate(all: ReadonlyMap<string, Demand>, held: ReadonlyMap<string, Allowance> = new Map()): Map<string, Allowance> {
  const own = new Map<string, number>()
  const theirs = new Map<string, number>()
  const pool = (part: 'trusted' | 'stranger', size: number, cap: number, out: Map<string, number>): void => {
    const asking: Array<[string, Demand]> = []
    let ask = 0, over = false
    for (const entry of all) {
      const n = entry[1][part]
      if (n <= 0) continue
      asking.push(entry)
      ask += n
      if (n > cap) over = true
    }
    if (!over && ask <= size) { for (const [key, d] of asking) out.set(key, d[part]); return }
    const near = (e: [string, Demand]): number => e[1].distance - ((held.get(e[0])?.[part] ?? 0) > 0 ? HYSTERESIS_DOUBLINGS : 0)
    let left = size
    for (const [key, d] of asking.sort((a, b) => near(a) - near(b))) { const give = Math.min(d[part], cap, left); left -= give; out.set(key, give) }
  }
  pool('trusted', SCENE_TRUSTED, Infinity, own)
  pool('stranger', SCENE_STRANGER, SCENE_STRANGER_SHARD, theirs)
  const out = new Map<string, Allowance>()
  for (const key of new Set([...own.keys(), ...theirs.keys()])) out.set(key, { trusted: own.get(key) ?? 0, stranger: theirs.get(key) ?? 0 })
  return out
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** What the world shard `key` may draw from each pool; undefined for a shard that takes no part, or none yet. */
export function allowanceOf(key: string | undefined): Allowance | undefined {
  return key === undefined ? undefined : allowances.get(key)
}

/**
 * What a shard not yet allocated may draw for its first frame, so it does not
 * show an outline for one: what is left of each pool, no more than it asks
 * (and, of the strangers', the per-shard ceiling), counted against the pools
 * until the next allocation recounts them, so many such grants never pass a
 * pool.
 */
export function provisional(d: Demand): Allowance {
  if (d.trusted <= 0 && d.stranger <= 0) return NONE
  const trusted = Math.min(d.trusted, Math.max(0, SCENE_TRUSTED - usedTrusted))
  const stranger = Math.min(d.stranger, SCENE_STRANGER_SHARD, Math.max(0, SCENE_STRANGER - usedStranger))
  usedTrusted += trusted
  usedStranger += stranger
  return { trusted, stranger }
}

/** allowanceOf, for a component: it draws again when its own allowance changes. */
export function useAllowance(key: string | undefined): Allowance | undefined {
  return useSyncExternalStore(subscribe, () => allowanceOf(key))
}

/** Forget every demand: tests. */
export function clearMeshBudget(): void {
  demands.clear()
  dirty = false
  allowances = new Map()
  usedTrusted = 0
  usedStranger = 0
  for (const l of listeners) l()
}
