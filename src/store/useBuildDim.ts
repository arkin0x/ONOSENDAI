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
 *
 * Avatars register too while the Builder is on (Avatar, OtherAvatar), as
 * movers: unlike a shard, an avatar glides and turns with nothing else in the
 * view changing, so the picker asks `occludersMoved` each frame whether any
 * mover's drawn group has moved since it last looked (arkinox, 2026-11-09).
 */

import { create } from 'zustand'
import { Matrix4, type Object3D } from 'three'
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

/** A registered target that moves on its own, and its world matrix when last looked at. */
interface Mover {
  entry: OccluderTarget
  seen: Matrix4
  /** Not looked at yet: its first look counts as a move. */
  fresh: boolean
}
/** Every mover, as a plain array: walked each frame, so no iterator is made. */
let movers: Mover[] = []

/**
 * How far an element of a mover's world matrix may drift, relative to its
 * size, before it counts as moved: an easing turn settles towards its end in
 * steps far too small to see, and must not keep the picker casting.
 */
const MOVED_EPSILON = 1e-6

function drifted(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > MOVED_EPSILON * (1 + Math.abs(b[i]))) return true
  return false
}

/**
 * Whether any mover's drawn group has moved since the last ask, its world
 * matrix as last drawn against the one seen then. Allocates nothing.
 */
export function occludersMoved(): boolean {
  let moved = false
  for (let i = 0; i < movers.length; i++) {
    const m = movers[i]
    const now = m.entry.object.matrixWorld
    if (!now) continue
    if (m.fresh || drifted(now.elements, m.seen.elements)) {
      m.fresh = false
      m.seen.copy(now)
      moved = true
    }
  }
  return moved
}

/** Every shard that may block the view, as the picker reads them. */
export function occluderTargets(): Iterable<OccluderTarget> {
  return registry.values()
}

/** Bumped whenever a shard joins or leaves the registry. */
export function occluderVersion(): number {
  return version
}

/**
 * Registers a shard's drawn group under `key`; the returned function takes it
 * out again. `moves`: it glides or turns on its own (an avatar), so the
 * picker watches its matrix (occludersMoved).
 */
export function registerOccluder(key: string, object: Object3D, moves = false): () => void {
  const entry = { key, object }
  registry.set(key, entry)
  const mover = moves ? { entry, seen: new Matrix4(), fresh: true } : null
  movers = movers.filter((m) => m.entry.key !== key)
  if (mover) movers.push(mover)
  version++
  return () => {
    // A remount under the same key may already have replaced it.
    if (registry.get(key) === entry) {
      registry.delete(key)
      version++
    }
    if (mover) movers = movers.filter((m) => m !== mover)
  }
}
