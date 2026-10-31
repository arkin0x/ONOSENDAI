/**
 * countingRules.ts: the counting rules Cyberspace's numbers share, in one
 * place, so a number means the same wherever it is shown: the TV ticker, the
 * CYBERSPACE STATS break (lib/tv/cyberspaceStats), and the badges, which are
 * these numbers with a threshold (onosendai/badges/ACHIEVEMENTS-PLAN.md; a
 * board is a badge's number ranked, tv-leaderboards-design.md 2.2).
 *
 * Pure: no relay, no store, no clock. Every rule takes the public events it
 * counts and the moment `t` (unix seconds) it counts as of; an event signed
 * after `t` does not exist for it.
 *
 * | Rule | Counts | Badge |
 * |---|---|---|
 * | chainLength | valid actions on the current chain, the spawn included | the LONGEST CHAIN board and the ticker (not a badge) |
 * | bestChainLength | valid actions on the best (longest) of all the key's chains, the spawn included | CHAIN |
 * | respawnCount | spawns after the first whose chain went on to a valid hop | PHOENIX |
 * | activeKeys | keys with a valid action in a window | REGULAR's "valid action" |
 * | bagsHidden | live sealed bags, distinct d, at most 5 a UTC day | STASH |
 * | objectsPublished | live public objects, distinct shape, 8+ vertices, at most 10 a UTC day | BUILDER |
 * | arrivalTimes | each key's first v2 spawn | the ticker's AVATARS, NEW ARRIVALS |
 *
 * Two owner rulings (arkinox, 2026-10-31), both raised in the review of
 * #537: the LONGEST CHAIN board counts the current chain (chainLength), and
 * the CHAIN badge counts the best chain the key ever reached
 * (bestChainLength), two separate rules; and a respawn counts for PHOENIX
 * and MOST RESPAWNS only when its chain goes on to a valid hop, as the badge
 * catalog says, not to any valid action (respawnCount).
 *
 * What these rules never read or return: a place. No coordinate, sector,
 * height, hint or lookup id is part of any answer here, only keys and counts
 * (design 3.3 L1, L2; the standing rule never to infer bag locations).
 */

import { canonicalGeometryText } from 'sno-core/fingerprint'
import { fromPayload } from 'sno-core/shards'
import { ACTION_KIND, buildChain, firstBreak, type ActionEvent, type NostrEvent } from './events'
import { HIDDEN_KIND, OBJECT_KIND } from './hidden'

/** One UTC day, seconds. */
export const DAY_S = 24 * 60 * 60
/** One week, seconds: a rolling seven days. */
export const WEEK_S = 7 * DAY_S
/** STASH: at most this many bags a UTC day count. */
export const BAGS_PER_DAY = 5
/** BUILDER: at most this many objects a UTC day count, each with at least this many vertices. */
export const OBJECTS_PER_DAY = 10
export const OBJECT_MIN_VERTICES = 8
/** The deletion kind (NIP-09). */
export const DELETION_KIND = 5

const hasTag = (e: { tags: string[][] }, name: string): boolean => e.tags.some((t) => t[0] === name)
const tagOf = (e: { tags: string[][] }, name: string): string | undefined => e.tags.find((t) => t[0] === name)?.[1]
const utcDay = (t: number): number => Math.floor(t / DAY_S)

/** A v2 movement event: kind 3333 with no `version` tag (v1 carried one; the ticker's own test, lib/tv/stats). */
export function isV2Action(e: NostrEvent): boolean {
  return e.kind === ACTION_KIND && !hasTag(e, 'version')
}

/** A v2 spawn: a v2 action carrying `["A", "spawn"]`. */
export function isV2Spawn(e: NostrEvent): boolean {
  return isV2Action(e) && e.tags.some((t) => t[0] === 'A' && t[1] === 'spawn')
}

/** Every v2 action, by its author: what each key's chains are built from. */
export function actionsByAuthor(events: Iterable<NostrEvent>): Map<string, NostrEvent[]> {
  const out = new Map<string, NostrEvent[]>()
  for (const e of events) {
    if (!isV2Action(e)) continue
    const list = out.get(e.pubkey)
    if (list) list.push(e)
    else out.set(e.pubkey, [e])
  }
  return out
}

/**
 * How many entries of a built chain are valid, the spawn included: none when
 * the chain forked (a fork ends the whole chain, ruling 2026-10-08) or its
 * spawn is broken, else every entry before the first that breaks a rule
 * (lib/events firstBreak). A gap needs no rule of its own: buildChain's walk
 * cannot cross an event it does not have, so the chain ends at the event
 * before the gap.
 */
export function validPrefixLength(chain: ActionEvent[]): number {
  if (chain.length === 0 || chain[0].fork) return 0
  const broken = firstBreak(chain)
  return broken ? broken.index : chain.length
}

/** The events signed at or before `t`. */
function asOf(events: NostrEvent[], t: number): NostrEvent[] {
  return t === Infinity ? events : events.filter((e) => e.created_at <= t)
}

/**
 * LONGEST CHAIN, the board: the valid actions on `pubkey`'s CURRENT chain as
 * of `t` (ruling 2026-10-31: the board is the current chain; the CHAIN
 * badge's best chain is bestChainLength). The current chain is the newest
 * spawn by the key itself, followed forward by `previous` links through
 * every event whose genesis names it, whatever its `A` (spec 8.7.3,
 * lib/events buildChain). The ticker's CHAIN OF n ACTIONS and the board are
 * this one function. A respawn starts it again from 1.
 */
export function chainLength(events: NostrEvent[], pubkey: string, t: number = Infinity): number {
  return validPrefixLength(buildChain(asOf(events, t).filter(isV2Action), pubkey))
}

/** A key's v2 spawns as of `t`, oldest first (ties by id, the larger later, as NIP-01 orders them newest first). */
export function spawnsOf(events: NostrEvent[], pubkey: string, t: number = Infinity): NostrEvent[] {
  return asOf(events, t)
    .filter((e) => e.pubkey === pubkey && isV2Spawn(e))
    .sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** The genesis an event's `e` tag marks, if any. */
function genesisOf(e: NostrEvent): string | undefined {
  return e.tags.find((t) => t[0] === 'e' && t[3] === 'genesis')?.[1]
}

/**
 * The chain one spawn starts, as of `t`, whether or not it is the key's
 * newest: built from that spawn and the events naming it as their genesis
 * alone, so buildChain's newest spawn is this one.
 */
export function chainFrom(events: NostrEvent[], spawn: NostrEvent, t: number = Infinity): ActionEvent[] {
  const own = asOf(events, t).filter((e) => e.pubkey === spawn.pubkey && isV2Action(e) && (e.id === spawn.id || genesisOf(e) === spawn.id))
  return buildChain(own, spawn.pubkey)
}

/**
 * The CHAIN badge's number: the valid actions on the BEST chain `pubkey`
 * ever reached as of `t`, the longest valid prefix of any of its chains, the
 * spawn included (badge catalog: "any one chain of the identity"; ruling
 * 2026-10-31). Unlike chainLength (the board's current chain), a respawn
 * never lowers it: a chain left behind keeps the length it reached. Each
 * chain is counted as chainLength counts one: a fork ends it, a gap stops
 * it, only its valid prefix counts.
 */
export function bestChainLength(events: NostrEvent[], pubkey: string, t: number = Infinity): number {
  let best = 0
  for (const s of spawnsOf(events, pubkey, t)) best = Math.max(best, validPrefixLength(chainFrom(events, s, t)))
  return best
}

/**
 * Whether a chain goes on, within its first `valid` entries (its valid
 * prefix), to a valid hop after its spawn: what PHOENIX asks of a respawn. On
 * the valid prefix a hop is always a base action (a hop inside a bracket
 * breaks the chain), so a hop there is a valid hop.
 */
export function goesOnToHop(chain: ActionEvent[], valid: number): boolean {
  for (let i = 1; i < valid; i++) if (chain[i].type === 'hop' && chain[i].role === 'base') return true
  return false
}

/**
 * MOST RESPAWNS and PHOENIX, "respawned and kept going": the key's spawns
 * after its first, as of `t`, counting a spawn only when its own chain's
 * valid prefix goes on to a valid HOP (ruling 2026-10-31, as the badge
 * catalog says: "a valid hop after the newest one"). A spawn with nothing
 * after it, or with only other actions after it (an enter-hyperspace, a
 * sidestep), counts for nothing.
 */
export function respawnCount(events: NostrEvent[], pubkey: string, t: number = Infinity): number {
  const spawns = spawnsOf(events, pubkey, t)
  let n = 0
  for (const s of spawns.slice(1)) {
    const chain = chainFrom(events, s, t)
    if (goesOnToHop(chain, validPrefixLength(chain))) n++
  }
  return n
}

/**
 * Whether `pubkey` made a valid action in the window (`from`, `to`]: an
 * action on the valid prefix of any of its chains, those chains as they
 * stood at `to`. A spawn is an action; a broken one is not valid.
 */
export function activeIn(events: NostrEvent[], pubkey: string, from: number, to: number): boolean {
  for (const s of spawnsOf(events, pubkey, to)) {
    // A chain whose events all predate the window cannot be active in it.
    const chain = chainFrom(events, s, to)
    const valid = validPrefixLength(chain)
    for (let i = 0; i < valid; i++) if (chain[i].createdAt > from && chain[i].createdAt <= to) return true
  }
  return false
}

/**
 * A key's chains, each walked once (review of #537: the marquee rebuilt a
 * 1,315-event chain inside a paint frame, 80 to 200 ms each time): for every
 * spawn, when each entry of its walk was signed (as the latest so far, so a
 * binary search finds how far the walk reaches by any moment), and how many
 * of them are valid. chainLengthIndexed answers chainLength from it.
 */
export interface ChainIndex {
  pubkey: string
  spawns: Array<{ id: string; at: number; reach: number[]; valid: number; forked: boolean }>
}

/** Index a key's chains (chainLengthIndexed). Every spawn's chain built once, as of every event in hand. */
export function chainIndex(events: NostrEvent[], pubkey: string): ChainIndex {
  const mine = events.filter((e) => e.pubkey === pubkey && isV2Action(e))
  const spawns = mine.filter(isV2Spawn).sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const under = new Map<string, NostrEvent[]>()
  for (const e of mine) {
    const g = genesisOf(e)
    if (!g || isV2Spawn(e)) continue
    const list = under.get(g)
    if (list) list.push(e)
    else under.set(g, [e])
  }
  return {
    pubkey,
    spawns: spawns.map((s) => {
      const chain = buildChain([s, ...(under.get(s.id) ?? [])], pubkey)
      let latest = -Infinity
      const reach = chain.map((a) => (latest = Math.max(latest, a.createdAt)))
      // A fork's other branch is not on the walk: as of a moment before both branches were signed, the chain went on through one; so it is answered the long way.
      return { id: s.id, at: s.created_at, reach, valid: chain[0]?.fork ? 0 : validPrefixLength(chain), forked: chain[0]?.fork !== undefined }
    }),
  }
}

/**
 * chainLength from an index, in a binary search: the newest spawn signed by
 * `t`, its walk as far as every entry so far was signed by `t` (the walk
 * cannot reach past an event not yet signed), at most its valid entries. A
 * chain that forked is counted the long way (chainLength), as of `t`.
 */
export function chainLengthIndexed(index: ChainIndex, events: NostrEvent[], t: number): number {
  let s = -1
  for (let i = index.spawns.length - 1; i >= 0; i--) if (index.spawns[i].at <= t) { s = i; break }
  if (s < 0) return 0
  const spawn = index.spawns[s]
  if (spawn.forked) return chainLength(events, index.pubkey, t)
  let lo = 0
  let hi = spawn.reach.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (spawn.reach[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return Math.min(lo, spawn.valid)
}

/** Every key with a valid action in the window (`from`, `to`] (activeIn), from every v2 action by author. */
export function activeKeys(byAuthor: Map<string, NostrEvent[]>, from: number, to: number): string[] {
  const out: string[] = []
  for (const [pk, evs] of byAuthor) {
    // Cheap first: nothing signed in the window, nothing to check.
    if (!evs.some((e) => e.created_at > from && e.created_at <= to)) continue
    if (activeIn(evs, pk, from, to)) out.push(pk)
  }
  return out
}

/**
 * Everything the chain rules say of one key as of `t`, each of its chains
 * built once: chainLength, respawnCount, and whether it was active in the
 * week before `t` (activeIn). The same answers as the three functions,
 * which the tests hold it to; this is the one a whole board's worth of keys
 * goes through.
 */
export interface KeyChains {
  /** The CURRENT chain's valid actions (chainLength, the LONGEST CHAIN board); never the best chain (bestChainLength). */
  chainLength: number
  /** Respawns whose chain went on to a valid hop (respawnCount). */
  respawns: number
  /** A valid action in (`t` - WEEK_S, `t`]. */
  activeWeek: boolean
}

export function keyChains(events: NostrEvent[], pubkey: string, t: number = Infinity): KeyChains {
  const mine = asOf(events, t).filter((e) => e.pubkey === pubkey && isV2Action(e))
  const spawns = mine.filter(isV2Spawn).sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  // Each event under the spawn it names, once.
  const under = new Map<string, NostrEvent[]>()
  for (const e of mine) {
    const g = genesisOf(e)
    if (!g || isV2Spawn(e)) continue
    const list = under.get(g)
    if (list) list.push(e)
    else under.set(g, [e])
  }
  let respawns = 0
  let activeWeek = false
  let current = 0
  spawns.forEach((s, i) => {
    const chain = buildChain([s, ...(under.get(s.id) ?? [])], pubkey)
    const valid = validPrefixLength(chain)
    if (i > 0 && goesOnToHop(chain, valid)) respawns++
    // The newest spawn, in NIP-01's order (lib/events newestSpawn), is the last of the oldest-first list.
    if (i === spawns.length - 1) current = valid
    if (!activeWeek) for (let k = 0; k < valid; k++) if (chain[k].createdAt > t - WEEK_S && chain[k].createdAt <= t) { activeWeek = true; break }
  })
  return { chainLength: current, respawns, activeWeek }
}

/** Each key's first v2 spawn time (the ticker's AVATARS IN CYBERSPACE and NEW ARRIVAL). */
export function arrivalTimes(events: Iterable<NostrEvent>): Map<string, number> {
  const first = new Map<string, number>()
  for (const e of events) if (isV2Spawn(e)) first.set(e.pubkey, Math.min(first.get(e.pubkey) ?? Infinity, e.created_at))
  return first
}

/** How many keys first spawned in the window (`from`, `to`]. */
export function arrivalsIn(arrivals: Map<string, number>, from: number, to: number): number {
  let n = 0
  for (const at of arrivals.values()) if (at > from && at <= to) n++
  return n
}

/** What a deletion (NIP-09 kind 5) names: its author, when, and the ids and addresses it deletes. */
export interface Deletion {
  id: string
  pubkey: string
  createdAt: number
  ids: string[]
  addresses: string[]
}

/** A kind 5 as a Deletion, or null for any other kind. */
export function deletionOf(e: NostrEvent): Deletion | null {
  if (e.kind !== DELETION_KIND) return null
  return {
    id: e.id,
    pubkey: e.pubkey,
    createdAt: e.created_at,
    ids: e.tags.filter((t) => t[0] === 'e' && t[1]).map((t) => t[1]),
    addresses: e.tags.filter((t) => t[0] === 'a' && t[1]).map((t) => t[1]),
  }
}

/** An addressable event as the rules need it: whose, which `d`, when, and its id. */
export interface Addressed {
  id: string
  kind: number
  pubkey: string
  d: string
  createdAt: number
}

/**
 * Whether one of the author's own deletions, signed at or before `t`, takes
 * `e` away: by its id, or by its address when the deletion is no older than
 * it (NIP-09: an address deletes every version up to the deletion's time).
 */
export function deleted(e: Addressed, deletions: Deletion[], t: number = Infinity): boolean {
  const address = `${e.kind}:${e.pubkey}:${e.d}`
  return deletions.some((x) => x.pubkey === e.pubkey && x.createdAt <= t && (x.ids.includes(e.id) || (x.addresses.includes(address) && x.createdAt >= e.createdAt)))
}

/** The newest of each (pubkey, d) as of `t`, ties to the larger id: what a relay keeps of an addressable event. */
export function newestPerAddress<T extends Addressed>(list: Iterable<T>, t: number = Infinity): T[] {
  const best = new Map<string, T>()
  for (const e of list) {
    if (e.createdAt > t) continue
    const k = `${e.pubkey}:${e.d}`
    const have = best.get(k)
    if (!have || e.createdAt > have.createdAt || (e.createdAt === have.createdAt && e.id > have.id)) best.set(k, e)
  }
  return [...best.values()]
}

/** How many of `times` count when at most `cap` a UTC day do. */
export function cappedPerDay(times: number[], cap: number): number {
  const perDay = new Map<number, number>()
  for (const t of times) perDay.set(utcDay(t), (perDay.get(utcDay(t)) ?? 0) + 1)
  let n = 0
  for (const k of perDay.values()) n += Math.min(cap, k)
  return n
}

/** A bag (kind 33330) as STASH reads it: no place, no hint, no height, only that it is sealed. */
export interface BagRecord extends Addressed {
  /** It carries an `encrypted` tag: a sealed bag. */
  sealed: boolean
}

/** A kind 33330 as a BagRecord, or null. */
export function bagRecord(e: NostrEvent): BagRecord | null {
  if (e.kind !== HIDDEN_KIND) return null
  return { id: e.id, kind: e.kind, pubkey: e.pubkey, d: tagOf(e, 'd') ?? '', createdAt: e.created_at, sealed: hasTag(e, 'encrypted') }
}

/**
 * MOST BAGS HIDDEN, the STASH badge's number, per author: live sealed bags
 * (the newest version of each `d`, not deleted, carrying `encrypted`), so
 * distinct `d`, and at most BAGS_PER_DAY a UTC day count.
 */
export function bagsHidden(bags: Iterable<BagRecord>, deletions: Deletion[], t: number = Infinity): Map<string, number> {
  const times = new Map<string, number[]>()
  for (const b of newestPerAddress(bags, t)) {
    if (!b.sealed || deleted(b, deletions, t)) continue
    times.set(b.pubkey, [...(times.get(b.pubkey) ?? []), b.createdAt])
  }
  return new Map([...times].map(([pk, ts]) => [pk, cappedPerDay(ts, BAGS_PER_DAY)]))
}

/** An object (kind 33331) as BUILDER reads it: public or not, how many vertices, and its shape's canonical hash. */
export interface ObjectRecord extends Addressed {
  /** No `encrypted` tag: published in the open. */
  open: boolean
  /** Its vertex count, or 0 when its payload does not read. */
  vertices: number
  /** A hash of sno-core's canonical geometry text, or null when it does not read. */
  shape: string | null
}

/** A 53-bit hash of a string (cyrb53), hex: enough to tell shapes apart without keeping their text. */
export function shapeHash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/** A kind 33331 as an ObjectRecord, or null. Its payload is read once, here, and not kept. */
export function objectRecord(e: NostrEvent): ObjectRecord | null {
  if (e.kind !== OBJECT_KIND) return null
  const d = tagOf(e, 'd') ?? ''
  const base = { id: e.id, kind: e.kind, pubkey: e.pubkey, d, createdAt: e.created_at, open: !hasTag(e, 'encrypted') }
  if (!base.open) return { ...base, vertices: 0, shape: null }
  try {
    const model = fromPayload(JSON.parse(e.content), `${e.pubkey}:${d}`)
    if (!model) return { ...base, vertices: 0, shape: null }
    return { ...base, vertices: model.vertices.length, shape: shapeHash(canonicalGeometryText(model)) }
  } catch {
    return { ...base, vertices: 0, shape: null }
  }
}

/**
 * MOST OBJECTS PUBLISHED, the BUILDER badge's number, per author: live public
 * objects (the newest version of each `d`, not deleted, no `encrypted`, not
 * the old `avatar` slot), each a new shape (distinct canonical geometry, the
 * earliest of a shape counting) with at least OBJECT_MIN_VERTICES vertices,
 * and at most OBJECTS_PER_DAY a UTC day.
 */
export function objectsPublished(objects: Iterable<ObjectRecord>, deletions: Deletion[], t: number = Infinity): Map<string, number> {
  const kept = newestPerAddress(objects, t)
    .filter((o) => o.open && o.d !== 'avatar' && o.shape !== null && o.vertices >= OBJECT_MIN_VERTICES && !deleted(o, deletions, t))
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
  const shapes = new Map<string, Set<string>>()
  const times = new Map<string, number[]>()
  for (const o of kept) {
    const seen = shapes.get(o.pubkey) ?? new Set<string>()
    if (seen.has(o.shape!)) continue
    seen.add(o.shape!)
    shapes.set(o.pubkey, seen)
    times.set(o.pubkey, [...(times.get(o.pubkey) ?? []), o.createdAt])
  }
  return new Map([...times].map(([pk, ts]) => [pk, cappedPerDay(ts, OBJECTS_PER_DAY)]))
}
