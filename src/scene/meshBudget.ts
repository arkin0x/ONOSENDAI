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

/** Placed objects drawn for your own shards and those of authors you follow, together. */
export const SCENE_TRUSTED = 4_000
/** Placed objects drawn for strangers' shards, together. */
export const SCENE_STRANGER = 1_000
/** The most of it any one stranger's shard may draw. */
export const SCENE_STRANGER_SHARD = 250

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

/** Say what a world shard would draw; the allowances follow at once. */
export function setDemand(key: string, d: Demand): void {
  const was = demands.get(key)
  if (was && was.demand === d.demand && was.trusted === d.trusted && was.distance === d.distance) return
  demands.set(key, d)
  reallocate()
}

/** A world shard no longer drawn. */
export function dropDemand(key: string): void {
  if (!demands.delete(key)) return
  reallocate()
}

/**
 * The allowances, from the demands: trusted shards first, nearest first, each
 * as much as it asks while the reserved share lasts; then strangers', nearest
 * first, each at most SCENE_STRANGER_SHARD while theirs lasts.
 */
export function allocate(all: ReadonlyMap<string, Demand>): Map<string, number> {
  const out = new Map<string, number>()
  const byNear = (a: [string, Demand], b: [string, Demand]): number => a[1].distance - b[1].distance
  let trusted = SCENE_TRUSTED
  let stranger = SCENE_STRANGER
  for (const [key, d] of [...all].filter(([, d]) => d.trusted).sort(byNear)) {
    const give = Math.min(d.demand, trusted)
    trusted -= give
    out.set(key, give)
  }
  for (const [key, d] of [...all].filter(([, d]) => !d.trusted).sort(byNear)) {
    const give = Math.min(d.demand, SCENE_STRANGER_SHARD, stranger)
    stranger -= give
    out.set(key, give)
  }
  return out
}

function reallocate(): void {
  const next = allocate(demands)
  let changed = next.size !== allowances.size
  if (!changed) for (const [k, v] of next) if (allowances.get(k) !== v) { changed = true; break }
  allowances = next
  if (changed) for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** How many placed objects the world shard `key` may draw; undefined for a shard that takes no part. */
export function allowanceOf(key: string | undefined): number | undefined {
  return key === undefined ? undefined : allowances.get(key)
}

/** allowanceOf, for a component: it draws again when its own allowance changes. */
export function useAllowance(key: string | undefined): number | undefined {
  return useSyncExternalStore(subscribe, () => allowanceOf(key))
}

/** Forget every demand: tests. */
export function clearMeshBudget(): void {
  demands.clear()
  allowances = new Map()
  for (const l of listeners) l()
}
