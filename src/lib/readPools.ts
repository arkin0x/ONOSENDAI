/**
 * readPools.ts - the distinct objects the scene's shards may read, by trust
 * (sno-core MAX_MODELS, `models`), as WALK bounds its own (store/walkWalls.ts):
 * many shards in view cannot each read sno-core's MAX_MODELS.
 *
 * A shard drawn in the scene reads from its pool as it reads, one object at a
 * time (meter, lib/parts.ts useResolved): nothing is taken before it is read,
 * so as many shards resolve at once as the pool has reads for. It holds what
 * it read while it is drawn, and gives it back when it is drawn no more or
 * resolves again. A shard of yours, or of someone you follow, reads from the trusted
 * pool, and a stranger's object under it from the strangers' (lib/trust.ts
 * chargeByTrust); a stranger's shard reads from the strangers', no more than
 * SCENE_STRANGER_SHARD_READS. Whoever is cut short because a pool ran low is
 * resolved again when reads come back to it; a share cut by its own ceiling is
 * not, since more reads in the pool would not cure it.
 *
 * takeReads is gone: a share taken whole before anything was read let only a
 * few shards resolve at once (3 of yours, 5 strangers'), the rest drawn as
 * outlines until those landed (review of #515).
 */

import { MAX_MODELS } from 'sno-core/parts'

export type ReadPool = 'trusted' | 'stranger'

/** What your shards and those you follow may read between them in the scene. */
export const SCENE_TRUSTED_READS = 3 * MAX_MODELS
/** What strangers' shards may read between them. */
export const SCENE_STRANGER_READS = MAX_MODELS
/** The most any one stranger's share may read. */
export const SCENE_STRANGER_SHARD_READS = MAX_MODELS / 5

const left: Record<ReadPool, number> = { trusted: SCENE_TRUSTED_READS, stranger: SCENE_STRANGER_READS }
const listeners = new Set<(pool: ReadPool) => void>()
const grew = new Set<ReadPool>()
let scheduled = false

/** The most one share of `pool` may take. */
export function readCap(pool: ReadPool): number {
  return pool === 'trusted' ? MAX_MODELS : SCENE_STRANGER_SHARD_READS
}

/** A share of a pool's reads as a resolve spends it (meter). */
export interface Metered {
  /** For sno-core as a budget's `models`: `left` is what this share may still read now. */
  models: { left: number }
  /** How many it has read. */
  used: () => number
  /** Whether a read was refused because the pool ran dry while this share still had room. */
  poolRanLow: () => boolean
}

/**
 * A share of `pool`'s reads, charged as each object is read: its `left` is the
 * lesser of what the share has left (readCap) and what the pool has, and
 * taking one away (sno-core's `models.left--`) takes it from both. sno-core
 * charges only a budget whose `left` is a writable number (its `usable`), so
 * this is a Proxy that reports one rather than an accessor, which it would
 * pass over for a budget of its own.
 */
export function meter(pool: ReadPool): Metered {
  let room = readCap(pool)
  let used = 0
  let ranLow = false
  const now = (): number => {
    const n = Math.max(0, Math.min(room, left[pool]))
    if (n < 1 && room >= 1) ranLow = true
    return n
  }
  const models = new Proxy({ left: 0 }, {
    get: (t, k) => (k === 'left' ? now() : Reflect.get(t, k)),
    set: (t, k, v) => {
      if (k !== 'left') return Reflect.set(t, k, v)
      // Never more than the share may still read, whatever is written.
      const has = now()
      const d = Math.min(has, has - Number(v))
      if (d > 0) { room -= d; left[pool] -= d; used += d }
      return true
    },
    getOwnPropertyDescriptor: (t, k) => (k === 'left' ? { value: now(), writable: true, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(t, k)),
  })
  return { models, used: () => used, poolRanLow: () => ranLow }
}

/**
 * Give `n` reads back to `pool`. Those waiting on it hear once the task's
 * other changes are made (a shard resolving again gives back and takes in
 * the same commit), and only while it has reads.
 */
export function giveReads(pool: ReadPool, n: number): void {
  if (!(n > 0)) return
  left[pool] += n
  grew.add(pool)
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    const pools = [...grew]
    grew.clear()
    for (const p of pools) if (left[p] > 0) for (const l of [...listeners]) l(p)
  })
}

/** Hear when reads come back to a pool that has some; the return stops it. */
export function onReadsBack(listener: (pool: ReadPool) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** What is left of a pool: for tests. */
export function readsLeft(pool: ReadPool): number {
  return left[pool]
}

/** Every read back, as at the start: for tests. */
export function resetReads(): void {
  left.trusted = SCENE_TRUSTED_READS
  left.stranger = SCENE_STRANGER_READS
  grew.clear()
}
