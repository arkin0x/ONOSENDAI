/**
 * keyringLocks.ts: the locks of the keys you carry, by lock (DECK-0004 §3.8,
 * draft; conjunction seals design §5.8, §5.9 item 7).
 *
 * A chest or a door locked to a region or a room shows its lock in its `lock`
 * tag. A reader offers OPEN when a key it carries has that lock: one lookup
 * per chest, against a map from lock to key built here. Nothing is asked of
 * any relay.
 *
 * Deriving a lock is one point multiplication, about a millisecond, so a
 * keyring of thousands is not derived at once. Each key's lock is derived
 * once and kept in a LockCache by key; indexKeyring derives at most `budget`
 * new ones per call and says how many are still to do, so the caller can run
 * the rest in idle time (store/useKeyring). Keys come in priority order: rooms,
 * then held region keys newest first, then the cubes you stand in, then places
 * you stood on. At most `max` keys are indexed.
 *
 * Pure: no store, no relay, no timers.
 */

import { lockOfHex, type Lock } from './locks'
import type { OpeningKey } from './chests'

/** A key you carry, as the keyring knows it: a region's location key or a room key. */
export type CarriedKey =
  | {
    kind: 'region'
    /** The region's lookup id (spec §7.2). */
    lookupId: string
    keyHex: string
    height: number
    /** How you carry it: a held key (useSecrets keys), a cube you stand in now, or a place you stood on. */
    from: 'held' | 'here' | 'stood'
    /** When it was first held, seconds since the epoch, for a held key. */
    at?: number
  }
  | {
    kind: 'room'
    /** The room bag's `d`. */
    lookupId: string
    keyHex: string
    /** The door's name, when known. */
    name: string
    /** The door whose room it is. */
    doorId: string
  }

/** One entry of the index: a key you carry and its lock. */
export interface KeyringLock {
  lock: Lock
  key: CarriedKey
}

/** Locks derived so far, by key, so each key is derived once however often the keyring is indexed. */
export class LockCache {
  private readonly locks = new Map<string, Lock | null>()
  /** How many keys have been derived. */
  get size(): number { return this.locks.size }
  has(keyHex: string): boolean { return this.locks.has(keyHex.toLowerCase()) }
  /** The lock of a key, derived now if it is not cached. Null for a key with no lock. */
  derive(keyHex: string): Lock | null {
    const k = keyHex.toLowerCase()
    if (this.locks.has(k)) return this.locks.get(k) ?? null
    const lock = lockOfHex(k)
    this.locks.set(k, lock)
    return lock
  }
  /** The cached lock of a key; undefined when not derived yet. */
  peek(keyHex: string): Lock | null | undefined { return this.locks.get(keyHex.toLowerCase()) }
  clear(): void { this.locks.clear() }
}

/** What indexKeyring built: the map from lock to key, and how many keys still wait for their lock. */
export interface KeyringIndex {
  byLock: Map<string, KeyringLock>
  pending: number
}

/** Priority of a key in the index: lower first. */
function rank(k: CarriedKey): number {
  if (k.kind === 'room') return 0
  return k.from === 'held' ? 1 : k.from === 'here' ? 2 : 3
}

/** The keys in the order they are indexed: rooms, held (newest first), here, stood; one per key. */
export function keyringOrder(keys: readonly CarriedKey[]): CarriedKey[] {
  const seen = new Set<string>()
  const out: CarriedKey[] = []
  const sorted = [...keys].sort((a, b) => rank(a) - rank(b) || ((b.kind === 'region' ? b.at ?? 0 : 0) - (a.kind === 'region' ? a.at ?? 0 : 0)))
  for (const k of sorted) {
    const id = k.keyHex.toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    out.push(k)
  }
  return out
}

/**
 * Index the keys you carry by lock. Cached locks cost nothing; at most
 * `budget` new ones are derived; the rest count as pending. At most `max`
 * keys, in priority order.
 */
export function indexKeyring(keys: readonly CarriedKey[], cache: LockCache, budget: number, max = Infinity): KeyringIndex {
  const byLock = new Map<string, KeyringLock>()
  let left = budget
  let pending = 0
  for (const key of keyringOrder(keys).slice(0, max)) {
    let lock = cache.peek(key.keyHex)
    if (lock === undefined) {
      if (left <= 0) { pending++; continue }
      left--
      lock = cache.derive(key.keyHex)
    }
    if (lock && !byLock.has(lock.pubkey)) byLock.set(lock.pubkey, { lock, key })
  }
  return { byLock, pending }
}

/** A keyring entry as the opener takes a key (lib/chests.ts openerFor): its id says it is a lock, not an ITEMS row. */
export function openingKeyOf(entry: KeyringLock): OpeningKey {
  return { id: `lock:${entry.key.kind}:${entry.key.lookupId}`, itemPubkey: entry.lock.pubkey, secretHex: entry.lock.secretHex, carried: entry.key }
}

/** The line under OPEN: which key you carry fits, from your own keyring, in a few words. */
export function carriedLabel(key: CarriedKey): string {
  if (key.kind === 'room') return key.name ? `a room you opened, ${key.name}` : 'a room you opened'
  const size = `height ${key.height}`
  if (key.from === 'here') return `the region you stand in, ${size}`
  if (key.from === 'stood') return `a region you stood in, ${size}`
  const kept = key.at ? `, kept ${new Date(key.at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}` : ''
  return `a region, ${size}${kept}`
}
