/**
 * readPools.ts - the distinct objects the scene's shards may read, by trust
 * (sno-core MAX_MODELS, `models`), as WALK bounds its own (store/walkWalls.ts):
 * many shards in view cannot each read sno-core's MAX_MODELS.
 *
 * A shard drawn in the scene takes its share when it resolves (lib/parts.ts
 * useResolved) and holds what it read while it is drawn: what it did not use
 * comes back when it lands, the rest when it is drawn no more or resolves
 * again. A shard of yours, or of someone you follow, reads from the trusted
 * pool, and a stranger's object under it from the strangers' (lib/trust.ts
 * chargeByTrust); a stranger's shard reads from the strangers', no more than
 * SCENE_STRANGER_SHARD_READS. Whoever is cut short because a pool ran low is
 * resolved again when reads come back to it; a share cut by its own ceiling is
 * not, since more reads in the pool would not cure it.
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

/** A share of `pool`'s reads, as much as it has up to readCap: a sno-core `models`. */
export function takeReads(pool: ReadPool): { left: number } {
  const n = Math.max(0, Math.min(readCap(pool), left[pool]))
  left[pool] -= n
  return { left: n }
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
