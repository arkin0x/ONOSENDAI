/**
 * keyringLocks.ts: the locks of the keys you carry, by lock (DECK-0004 §3.8.4;
 * conjunction seals design §5.8, §5.9 item 7).
 *
 * A chest or a door locked to a region or a room shows its lock in its `lock`
 * tag. A reader offers OPEN when a key it carries has that lock: one lookup
 * per chest, against a map from lock to key built here. Nothing is asked of
 * any relay.
 *
 * A lock costs one SHA-256 and one point multiplication; the multiplication is
 * the dear part (a third of a millisecond on a desktop, several on a phone).
 * So each key's lock is derived once and kept in a LockCache, and a lock
 * already stored beside its key in the vault (`lock`, §3.8.4 "SHOULD store it
 * with the key") is taken as it is, with only the hash to recompute its
 * secret. planKeyring indexes everything already known at once and lists the
 * keys still to derive; deriveSlice derives them until the caller's time is
 * up, so a large keyring never holds up a frame (store/useKeyring).
 *
 * Keys come in priority order (keyringOrder): rooms, then held region keys
 * newest first, then the cubes you stand in, then places you stood on, newest
 * first as the vault gives them. At most `max` keys are indexed.
 *
 * Pure: no store, no relay, no timers.
 */

import { axisDistance } from './nearby'
import { formatDistance } from 'sno-core/scale'
import { hexToBytes, bytesToHex } from './events'
import { lockOfHex, lockSecret, type Lock } from './locks'
import type { OpeningKey } from './chests'
import type { Position } from './space'

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
    /** A held key's own source (useSecrets HeldKey): a hop of yours, a scan that opened something, or HOSAKA. */
    source?: 'hop' | 'scan' | 'cloud'
    /** When it was first held, seconds since the epoch, for a held key. */
    at?: number
    /** The region's aligned corner, for "how far away" under OPEN. */
    base?: Position
    /** Its lock as stored beside it in the vault, when it was: no point multiplication needed. */
    lock?: string
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
    lock?: string
  }

/** One entry of the index: a key you carry and its lock. */
export interface KeyringLock {
  lock: Lock
  key: CarriedKey
}

/** Locks derived so far, by key, so each key is derived once however often the keyring is indexed. */
export class LockCache {
  private readonly locks = new Map<string, Lock | null>()
  /** How many keys are known. */
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
  /**
   * A lock stored beside its key: its secret recomputed (one hash, which also
   * applies the validity rule), its public key taken as stored, no point
   * multiplication. Only ever a value this device derived and wrote.
   */
  seed(keyHex: string, pubkey: string): Lock | null {
    const k = keyHex.toLowerCase()
    if (this.locks.has(k)) return this.locks.get(k) ?? null
    if (!/^[0-9a-f]{64}$/.test(pubkey) || !/^[0-9a-f]{64}$/.test(k)) return this.derive(k)
    const secret = lockSecret(hexToBytes(k))
    const lock = secret ? { secretHex: bytesToHex(secret), pubkey } : null
    this.locks.set(k, lock)
    return lock
  }
  /** The cached lock of a key; undefined when not known yet. */
  peek(keyHex: string): Lock | null | undefined { return this.locks.get(keyHex.toLowerCase()) }
  clear(): void { this.locks.clear() }
}

/** Priority of a key in the index: lower first. */
function rank(k: CarriedKey): number {
  if (k.kind === 'room') return 0
  return k.from === 'held' ? 1 : k.from === 'here' ? 2 : 3
}

/**
 * The keys in the order they are indexed: rooms, held (newest first), here,
 * stood (as given, which is newest first); one per key, the first met. Only
 * the held keys are sorted; the rest keep their order, so this is linear in
 * the keyring however large it is.
 */
export function keyringOrder(keys: readonly CarriedKey[]): CarriedKey[] {
  const buckets: CarriedKey[][] = [[], [], [], []]
  for (const k of keys) buckets[rank(k)].push(k)
  buckets[1].sort((a, b) => (b.kind === 'region' ? b.at ?? 0 : 0) - (a.kind === 'region' ? a.at ?? 0 : 0))
  const seen = new Set<string>()
  const out: CarriedKey[] = []
  for (const bucket of buckets) {
    for (const k of bucket) {
      const id = k.keyHex.toLowerCase()
      if (seen.has(id)) continue
      seen.add(id)
      out.push(k)
    }
  }
  return out
}

/** What planKeyring built: the map of everything already known, and the keys whose lock is still to derive. */
export interface KeyringPlan {
  byLock: Map<string, KeyringLock>
  todo: CarriedKey[]
}

/** Put one key in the map, unless a key earlier in the order already has its lock. */
function place(byLock: Map<string, KeyringLock>, lock: Lock | null, key: CarriedKey): void {
  if (lock && !byLock.has(lock.pubkey)) byLock.set(lock.pubkey, { lock, key })
}

/**
 * Index every key whose lock is cached or stored beside it, at once (no point
 * multiplication), and list the rest, in priority order, at most `max` keys.
 */
export function planKeyring(keys: readonly CarriedKey[], cache: LockCache, max = Infinity): KeyringPlan {
  const byLock = new Map<string, KeyringLock>()
  const todo: CarriedKey[] = []
  for (const key of keyringOrder(keys).slice(0, max)) {
    let lock = cache.peek(key.keyHex)
    if (lock === undefined && key.lock) lock = cache.seed(key.keyHex, key.lock)
    if (lock === undefined) todo.push(key)
    else place(byLock, lock, key)
  }
  return { byLock, todo }
}

/**
 * Derive the locks of `todo` from `start` until `outOfTime` says stop (asked
 * after each one, so at least one is always derived), adding each to
 * `byLock`. Returns where to resume and the keys derived, for the caller to
 * store beside their keys.
 */
export function deriveSlice(todo: readonly CarriedKey[], start: number, cache: LockCache, byLock: Map<string, KeyringLock>, outOfTime: () => boolean): { next: number; derived: Array<{ key: CarriedKey; lock: Lock | null }> } {
  const derived: Array<{ key: CarriedKey; lock: Lock | null }> = []
  let i = start
  while (i < todo.length) {
    const key = todo[i++]
    const lock = cache.derive(key.keyHex)
    place(byLock, lock, key)
    derived.push({ key, lock })
    if (outOfTime()) break
  }
  return { next: i, derived }
}

/** What indexKeyring built: the map from lock to key, and how many keys still wait for their lock. */
export interface KeyringIndex {
  byLock: Map<string, KeyringLock>
  pending: number
}

/** planKeyring and one deriveSlice of at most `budget` locks: the whole step, for a caller with a count, not a clock. */
export function indexKeyring(keys: readonly CarriedKey[], cache: LockCache, budget: number, max = Infinity): KeyringIndex {
  const { byLock, todo } = planKeyring(keys, cache, max)
  if (budget <= 0 || todo.length === 0) return { byLock, pending: todo.length }
  let n = 0
  const { next } = deriveSlice(todo, 0, cache, byLock, () => ++n >= budget)
  return { byLock, pending: todo.length - next }
}

/** A keyring entry as the opener takes a key (lib/chests.ts openerFor): its id says it is a lock, not an ITEMS row. */
export function openingKeyOf(entry: KeyringLock): OpeningKey {
  return { id: `lock:${entry.key.kind}:${entry.key.lookupId}`, itemPubkey: entry.lock.pubkey, secretHex: entry.lock.secretHex, carried: entry.key }
}

/** How far a region is from a point: to its centre, along the furthest axis. */
function distanceTo(key: { base: Position; height: number }, from: Position): string {
  const half = key.height > 0 ? 1n << BigInt(key.height - 1) : 0n
  const centre = { x: key.base.x + half, y: key.base.y + half, z: key.base.z + half }
  return formatDistance(axisDistance(centre, from))
}

/**
 * The line under OPEN: which key you carry fits, from your own keyring, in a
 * few words (§3.8.4 "with where it is and when it was kept"). `from`, where
 * you are, says how far the region is, when its corner is known.
 */
export function carriedLabel(key: CarriedKey, from?: Position): string {
  if (key.kind === 'room') return key.name ? `a room you opened, ${key.name}` : 'a room you opened'
  if (key.from === 'here') return `the region you stand in, height ${key.height}`
  const where = key.base && from ? `${distanceTo({ base: key.base, height: key.height }, from)} away` : `height ${key.height}`
  if (key.from === 'stood') return `a region you stood in, ${where}`
  const kept = key.at ? `, kept ${new Date(key.at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}` : ''
  return `${key.base && from ? `a region ${where}` : `a region, ${where}`}${kept}`
}
