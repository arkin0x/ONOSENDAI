/**
 * stats.ts: the numbers on Cyberspace TV's ticker, as of the moment on tape.
 *
 * "a marquee that had stuff like the currently shown sector, user count,
 * shard count, this user's chain length, this user's hidden bags, and other
 * stats" (arkinox, 2026-10-18). Every one of them is as of the tape's time,
 * not today's: the ticker under a shot from September says what September
 * looked like.
 *
 * v2 is small enough to hold whole (census 2026-10-18: 648 spawns, 82 bags,
 * 73 objects, the longest chain 703 actions), so the counts are kept as lists
 * of times and counted by binary search: three questions when TV starts, and
 * one per avatar the first time it is on screen, for its chain.
 *
 * Bags and objects are addressable: relays keep only each one's newest
 * version, so a bag counts from when it was last changed, not from when it
 * was first hidden. The ticker says BAGS for exactly what the relays still
 * hold.
 */

import { ACTION_KIND, type NostrEvent } from '../events'
import { HIDDEN_KIND, OBJECT_KIND } from '../hidden'
import type { Ask } from './tape'

/** Times in ascending order, and how many are at or before `t`. */
export function countTo(times: number[], t: number): number {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

const sorted = (xs: number[]): number[] => xs.sort((a, b) => a - b)

export interface Census {
  /** When each identity first spawned. */
  arrivals: number[]
  /** When each bag on the relays was last sealed, all and by author. */
  bags: number[]
  bagsBy: Map<string, number[]>
  /** When each public object was last published. */
  objects: number[]
}

function isV2Spawn(e: NostrEvent): boolean {
  return e.kind === ACTION_KIND && !e.tags.some((t) => t[0] === 'version') && e.tags.some((t) => t[0] === 'A' && t[1] === 'spawn')
}

export async function loadCensus(ask: Ask): Promise<Census> {
  const [spawns, bags, objects] = await Promise.all([
    ask({ kinds: [ACTION_KIND], '#A': ['spawn'], limit: 10000 }),
    ask({ kinds: [HIDDEN_KIND], limit: 10000 }),
    ask({ kinds: [OBJECT_KIND], limit: 10000 }),
  ])
  const first = new Map<string, number>()
  for (const e of spawns) if (isV2Spawn(e)) first.set(e.pubkey, Math.min(first.get(e.pubkey) ?? Infinity, e.created_at))
  const bagsBy = new Map<string, number[]>()
  for (const b of bags) bagsBy.set(b.pubkey, [...(bagsBy.get(b.pubkey) ?? []), b.created_at])
  for (const l of bagsBy.values()) sorted(l)
  return {
    arrivals: sorted([...first.values()]),
    bags: sorted(bags.map((b) => b.created_at)),
    bagsBy,
    // A public object carries its payload in content; a hidden one is sealed.
    objects: sorted(objects.filter((o) => !o.tags.some((t) => t[0] === 'encrypted')).map((o) => o.created_at)),
  }
}

/**
 * When each of an identity's actions was signed, in its current chain: the
 * actions from its latest spawn at or before `t` up to `t` are its chain
 * length then. Kept as spawns and actions so one fetch answers for any `t`.
 */
export interface ChainTimes {
  spawns: number[]
  actions: number[]
}

export async function loadChainTimes(pubkey: string, ask: Ask): Promise<ChainTimes> {
  const events = await ask({ kinds: [ACTION_KIND], authors: [pubkey], limit: 10000 })
  const v2 = events.filter((e) => !e.tags.some((t) => t[0] === 'version'))
  return {
    spawns: sorted(v2.filter(isV2Spawn).map((e) => e.created_at)),
    actions: sorted(v2.map((e) => e.created_at)),
  }
}

/** Actions in the chain standing at `t`: from the latest spawn at or before it, that spawn included. */
export function chainLengthAt(c: ChainTimes, t: number): number {
  const s = countTo(c.spawns, t)
  if (s === 0) return 0
  const spawnAt = c.spawns[s - 1]
  // Everything signed at or after the spawn's second, up to t. A second
  // shared with the action before the spawn is counted to the new chain: a
  // respawn and a hop in the same second does not happen in practice.
  return countTo(c.actions, t) - countTo(c.actions, spawnAt - 1)
}
