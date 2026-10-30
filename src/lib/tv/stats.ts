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
 * one per avatar the first time it is on screen, for its chain, each paged
 * back in time while a relay's answer may have been capped (tape.ts askAll).
 *
 * Bags and objects are addressable: relays keep only each one's newest
 * version, so a bag counts from when it was last changed, not from when it
 * was first hidden. The ticker says BAGS for exactly what the relays still
 * hold.
 */

import { ACTION_KIND, type NostrEvent } from '../events'
import { HIDDEN_KIND, OBJECT_KIND } from '../hidden'
import { DELETION_KIND, arrivalTimes, bagRecord, bagsHidden, chainLength, deletionOf, isV2Action, objectRecord, type BagRecord, type Deletion, type ObjectRecord } from '../countingRules'
import { askAll, type Ask } from './tape'

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
  /** When each bag on the relays was last sealed. */
  bags: number[]
  /** When each public object was last published. */
  objects: number[]
  /**
   * The bags and objects as the shared counting rules read them (lib/countingRules
   * bagsHidden, objectsPublished), for the CYBERSPACE STATS break: who, which
   * `d`, when, sealed or open, an object's vertex count and shape hash. Never
   * a place.
   */
  bagRecords: BagRecord[]
  objectRecords: ObjectRecord[]
  /** The bag and object deletions (kind 5, scoped by `k`), which those rules apply. */
  deletions: Deletion[]
  /** Each key's first v2 spawn (lib/countingRules arrivalTimes). */
  firstSpawn: Map<string, number>
}

export async function loadCensus(ask: Ask): Promise<Census> {
  const [spawns, bags, objects, deletions] = await Promise.all([
    askAll(ask, { kinds: [ACTION_KIND], '#A': ['spawn'] }),
    askAll(ask, { kinds: [HIDDEN_KIND] }),
    askAll(ask, { kinds: [OBJECT_KIND] }),
    // Scoped by `k`: a bare kind 5 read pages through all of nostr (tv-leaderboards-design 1.1).
    askAll(ask, { kinds: [DELETION_KIND], '#k': [String(HIDDEN_KIND), String(OBJECT_KIND)] }),
  ])
  const first = arrivalTimes(spawns)
  return {
    arrivals: sorted([...first.values()]),
    bags: sorted(bags.map((b) => b.created_at)),
    // A public object carries its payload in content; a hidden one is sealed.
    objects: sorted(objects.filter((o) => !o.tags.some((t) => t[0] === 'encrypted')).map((o) => o.created_at)),
    bagRecords: bags.map(bagRecord).filter((b): b is BagRecord => b !== null),
    objectRecords: objects.map(objectRecord).filter((o): o is ObjectRecord => o !== null),
    deletions: deletions.map(deletionOf).filter((d): d is Deletion => d !== null),
    firstSpawn: first,
  }
}

/** The last count per census, for the marquee, which asks again each time round at the same moment on tape. */
const lastBags = new WeakMap<Census, { t: number; by: Map<string, number> }>()

/**
 * A key's bags hidden as of `t`: MOST BAGS HIDDEN's rule (lib/countingRules
 * bagsHidden, the STASH badge's number), so the ticker's "n BAGS HIDDEN" for
 * the avatar on screen and the CYBERSPACE STATS board never disagree. Until
 * 2026-10-30 it counted every bag event the relays held, uncapped.
 */
export function bagsHiddenAt(c: Census, pubkey: string, t: number): number {
  let last = lastBags.get(c)
  if (!last || last.t !== t) {
    last = { t, by: bagsHidden(c.bagRecords, c.deletions, t) }
    lastBags.set(c, last)
  }
  return last.by.get(pubkey) ?? 0
}

/**
 * An identity's v2 actions, as the ticker's CHAIN OF n ACTIONS counts them:
 * every one it signed, read once the first time it is on screen, so its
 * chain length at any moment on tape is one rule away (chainLengthAt).
 */
export interface ChainHistory {
  pubkey: string
  events: NostrEvent[]
}

export async function loadChainHistory(pubkey: string, ask: Ask): Promise<ChainHistory> {
  const events = await askAll(ask, { kinds: [ACTION_KIND], authors: [pubkey] })
  return { pubkey, events: events.filter((e) => e.pubkey === pubkey && isV2Action(e)) }
}

/** The last answer per history, for the marquee, which asks again each time round at the same moment on tape. */
const lastLength = new WeakMap<ChainHistory, { t: number; n: number }>()

/**
 * The valid actions on the chain standing at `t`: LONGEST CHAIN's rule
 * (lib/countingRules chainLength), so the ticker and the CYBERSPACE STATS
 * board never disagree. The chain is followed by its `previous` links, not
 * counted by time: a fork counts nothing and a gap ends it (until
 * 2026-10-30 this counted every action signed since the latest spawn).
 */
export function chainLengthAt(c: ChainHistory, t: number): number {
  const last = lastLength.get(c)
  if (last && last.t === t) return last.n
  const n = chainLength(c.events, c.pubkey, t)
  lastLength.set(c, { t, n })
  return n
}
