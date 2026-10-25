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
 * Each world shard says what its tree would draw (setDemand) and reads back
 * what it may (useAllowance). Only the world's shards take part: the bench,
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
 * a shard that holds an allowance counts as this much nearer, so two shards
 * at about the same distance do not trade hundreds of objects on every step.
 */
export const HYSTERESIS = 0.2

/** What one world shard would draw: its placed objects at every depth, whose they are, and how far off. */
export interface Demand {
  demand: number
  trusted: boolean
  /** From the anchor (where the camera looks), in render units: nearest first. */
  distance: number
}

const demands = new Map<string, Demand>()
let allowances = new Map<string, number>()
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
  if (was && was.demand === d.demand && was.trusted === d.trusted && was.distance === d.distance) return
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
  if (!changed) for (const [k, v] of next) if (allowances.get(k) !== v) { changed = true; break }
  allowances = next
  if (changed) for (const l of listeners) l()
}

/**
 * The allowances, from the demands: trusted shards first, nearest first, each
 * as much as it asks while the reserved share lasts; then strangers', nearest
 * first, each at most SCENE_STRANGER_SHARD while theirs lasts. A shard that
 * asks for nothing takes no part. Where every demand of a pool fits in it,
 * nothing is sorted. `held`, the allowances before, gives HYSTERESIS: a shard
 * drawing counts as nearer by that much.
 */
export function allocate(all: ReadonlyMap<string, Demand>, held: ReadonlyMap<string, number> = new Map()): Map<string, number> {
  const out = new Map<string, number>()
  const trusted: Array<[string, Demand]> = []
  const strangers: Array<[string, Demand]> = []
  let trustedAsk = 0, strangerAsk = 0, strangerOver = false
  for (const entry of all) {
    const d = entry[1]
    if (d.demand <= 0) continue
    if (d.trusted) { trusted.push(entry); trustedAsk += d.demand }
    else { strangers.push(entry); strangerAsk += d.demand; if (d.demand > SCENE_STRANGER_SHARD) strangerOver = true }
  }
  const near = (e: [string, Demand]): number => e[1].distance * ((held.get(e[0]) ?? 0) > 0 ? 1 - HYSTERESIS : 1)
  const byNear = (a: [string, Demand], b: [string, Demand]): number => near(a) - near(b)
  if (trustedAsk <= SCENE_TRUSTED) for (const [key, d] of trusted) out.set(key, d.demand)
  else {
    let left = SCENE_TRUSTED
    for (const [key, d] of trusted.sort(byNear)) { const give = Math.min(d.demand, left); left -= give; out.set(key, give) }
  }
  if (!strangerOver && strangerAsk <= SCENE_STRANGER) for (const [key, d] of strangers) out.set(key, d.demand)
  else {
    let left = SCENE_STRANGER
    for (const [key, d] of strangers.sort(byNear)) { const give = Math.min(d.demand, SCENE_STRANGER_SHARD, left); left -= give; out.set(key, give) }
  }
  return out
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** How many placed objects the world shard `key` may draw; undefined for a shard that takes no part, or none yet. */
export function allowanceOf(key: string | undefined): number | undefined {
  return key === undefined ? undefined : allowances.get(key)
}

/**
 * What a shard not yet allocated may draw for its first frame, so it does not
 * show an outline for one: what is left of its pool at the last allocation, no
 * more than it asks (and, for a stranger, the per-shard ceiling). The next
 * allocation, in the same task, corrects it.
 */
export function provisional(d: Demand): number {
  let used = 0
  for (const [k, v] of allowances) if (demands.get(k)?.trusted === d.trusted) used += v
  const left = Math.max(0, (d.trusted ? SCENE_TRUSTED : SCENE_STRANGER) - used)
  return Math.min(d.demand, left, d.trusted ? Infinity : SCENE_STRANGER_SHARD)
}

/** allowanceOf, for a component: it draws again when its own allowance changes. */
export function useAllowance(key: string | undefined): number | undefined {
  return useSyncExternalStore(subscribe, () => allowanceOf(key))
}

/** Forget every demand: tests. */
export function clearMeshBudget(): void {
  demands.clear()
  dirty = false
  allowances = new Map()
  for (const l of listeners) l()
}
