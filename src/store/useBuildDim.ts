/**
 * useBuildDim.ts - the shards dimmed in build mode because they stand between
 * the camera and the build cursor (lib/occluders.ts, scene/BuildOccluders.tsx).
 *
 * Two halves. The registry is every shard that may block the view, by key,
 * with the group that holds what it draws: world shards and the chests and
 * doors drawn in the world. It is a plain map, not state, because nothing
 * re-renders when it changes; the picker only reads it. The store is the
 * answer, the keys dimmed now, written only when the set actually changes, so
 * each shard's own selector (`dimmed.has(key)`) re-renders it only when its
 * own membership flips.
 *
 * Never dimmed, because never registered: the ghost of what is being placed
 * (ShardGhost), the shard EDIT is moving (WorldShards `moving`) and the cursor.
 */

import { create } from 'zustand'
import type { Object3D } from 'three'
import type { OccluderTarget } from '../lib/occluders'
import { sameSet } from '../lib/occluders'

interface BuildDimState {
  dimmed: ReadonlySet<string>
}

const NONE: ReadonlySet<string> = new Set()

export const useBuildDim = create<BuildDimState>(() => ({ dimmed: NONE }))

/** The keys dimmed now; written only when the members change. */
export function setDimmed(next: ReadonlySet<string>): void {
  const was = useBuildDim.getState().dimmed
  if (sameSet(was, next)) return
  useBuildDim.setState({ dimmed: next.size === 0 ? NONE : next })
}

const registry = new Map<string, OccluderTarget>()
let version = 0

/** Every shard that may block the view, as the picker reads them. */
export function occluderTargets(): Iterable<OccluderTarget> {
  return registry.values()
}

/** Bumped whenever a shard joins or leaves the registry. */
export function occluderVersion(): number {
  return version
}

/** Registers a shard's drawn group under `key`; the returned function takes it out again. */
export function registerOccluder(key: string, object: Object3D): () => void {
  const entry = { key, object }
  registry.set(key, entry)
  version++
  return () => {
    // A remount under the same key may already have replaced it.
    if (registry.get(key) === entry) {
      registry.delete(key)
      version++
    }
  }
}
