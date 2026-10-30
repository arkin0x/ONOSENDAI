/**
 * chainDb.ts - each identity's chain, kept whole in IndexedDB.
 *
 * Why: the chain used to live only in localStorage, one key per identity,
 * written whole on every save. localStorage holds a few megabytes for the
 * whole app, a chain grows by about a kilobyte per hop (a hyperjump is tens
 * of kilobytes), and a write that does not fit throws QuotaExceededError,
 * which the save swallowed. From then on every save failed and the copy on
 * disk stayed at the last chain that fit, so each page load started from
 * that old head, the relays brought back everything after it, and the chip
 * called those actions "from another device", although this device had
 * signed them (arkinox, 2026-10-30: 1,308 actions, the copy stuck at 1,133,
 * the same 175 reported on every start).
 *
 * Here the chain has no such ceiling. One record per identity, the chain as
 * the store saved it (events, published ids, stats, held, and `savedAt`, when
 * its actions last changed), written whole and never appended to: a fold
 * that drops actions (a newer spawn, a cut, keeping the relays' version of a
 * branch) must drop them from storage too, or they would come back on the
 * next load as a second branch. localStorage keeps its copy whenever it
 * fits, because the page draws the chain from it synchronously at load;
 * IndexedDB is read right after and brings whatever that copy is missing
 * (store/useCyberspace.ts hydrateChain). Which of the two copies is further
 * on is the store's call; this module only keeps and fetches records.
 *
 * Writes go through one queue per identity, latest wins: a burst of saves
 * (an AUTO route signs one action after another) costs one write in flight
 * and one waiting, never one per save. When the page is hidden or left, the
 * one waiting is sent at once rather than behind the one in flight.
 *
 * A read never waits longer than READ_PATIENCE_MS (an open another tab
 * blocks, a database that never answers): it says 'timeout' then, and a
 * caller that asked for it is handed the real answer when it lands. A
 * connection the browser drops (Safari's "Connection to Indexed Database
 * server lost") is forgotten, and the read or write that met it is tried
 * once more on a fresh one. Every call is wrapped: private mode, a blocked
 * upgrade or a full disk leaves the chain where localStorage has it.
 */

import { META_STORE, getMeta, openDatabase, putMeta } from './idb'
import type { NostrEvent } from './events'

export const CHAIN_DB = 'onosendai:chains'
const DB_VERSION = 1
/** The record's own version: a record of another shape is not read. */
const RECORD_VERSION = 1
/** How long a read waits for the database before it says 'timeout'. */
let readPatienceMs = 3_000

/** One identity's chain as stored: what the store saves, in the same words. */
export interface StoredChain {
  events: NostrEvent[]
  /** Ids the relays have acknowledged. */
  published: string[]
  stats: Record<string, unknown>
  held: boolean
  /** When the chain's actions last changed (ms); 0 on a record that never said. */
  savedAt?: number
}

/**
 * What a read found: the chain; null when none is kept; 'unreadable' when
 * the database would not answer; 'timeout' when it did not answer in time.
 * A caller must never take either of the last two for "none" and write over
 * a chain it could not see.
 */
export type ChainRead = StoredChain | null | 'unreadable' | 'timeout'

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const opening = openDatabase(CHAIN_DB, DB_VERSION, [[META_STORE, 'key']], undefined, { failWhenBlocked: true }).then((d) => {
      // A newer build upgrading the database in another tab: step aside, and
      // open again on the next read or write.
      d.onversionchange = () => { d.close(); if (dbPromise === opening) dbPromise = null }
      // A connection the browser closed (a tab long in the background, a lost server): open again next time.
      d.onclose = () => { if (dbPromise === opening) dbPromise = null }
      return d
    })
    opening.catch(() => { if (dbPromise === opening) dbPromise = null })
    dbPromise = opening
  }
  return dbPromise
}

/** `run` on the open database; on a failure, once more on a fresh connection, since the cached one may be dead. */
async function withDb<T>(run: (d: IDBDatabase) => Promise<T>): Promise<T> {
  const first = db()
  try {
    return await run(await first)
  } catch {
    if (dbPromise === first) dbPromise = null
    return run(await db())
  }
}

/** Whether this browser has IndexedDB at all (node under the tests has none unless a test installs one). */
export function chainDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

/** The read itself, however long it takes. */
async function readNow(pubkey: string): Promise<StoredChain | null | 'unreadable'> {
  try {
    if (!chainDbAvailable()) return 'unreadable'
    await settled(pubkey)
    const raw = (await withDb((d) => getMeta(d, pubkey))) as { v?: number; events?: unknown; published?: unknown; stats?: unknown; held?: unknown; savedAt?: unknown } | undefined
    if (!raw || raw.v !== RECORD_VERSION || !Array.isArray(raw.events) || raw.events.length === 0) return null
    return {
      events: raw.events as NostrEvent[],
      published: Array.isArray(raw.published) ? raw.published.filter((id): id is string => typeof id === 'string') : [],
      stats: raw.stats && typeof raw.stats === 'object' ? raw.stats as Record<string, unknown> : {},
      held: raw.held === true,
      savedAt: typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : 0,
    }
  } catch {
    return 'unreadable'
  }
}

/**
 * The chain kept for `pubkey` (ChainRead), in at most READ_PATIENCE_MS.
 * When that ran out, `onLate` is handed the real answer once it lands.
 */
export function readStoredChain(pubkey: string, onLate?: (late: StoredChain | null | 'unreadable') => void): Promise<ChainRead> {
  const read = readNow(pubkey)
  return new Promise<ChainRead>((resolve) => {
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; resolve('timeout') }, readPatienceMs)
    void read.then((r) => {
      if (timedOut) { onLate?.(r); return }
      clearTimeout(timer)
      resolve(r)
    })
  })
}

/** Per identity: the write in flight, and the newest chain waiting behind it. */
const queues = new Map<string, { running: Promise<void>; next: StoredChain | null }>()

/** One record, as written. */
function recordOf(c: StoredChain): unknown {
  return { v: RECORD_VERSION, events: c.events, published: c.published, stats: c.stats, held: c.held, savedAt: c.savedAt ?? Date.now() }
}

/**
 * Keep `chain` as `pubkey`'s, in place of what was kept. Returns at once; the
 * write follows, after any already in flight, and only the newest chain
 * waiting is written. A chain that does not say when it was saved is stamped now.
 */
export function writeStoredChain(pubkey: string, chain: StoredChain): void {
  if (!chainDbAvailable()) return
  const stamped = { ...chain, savedAt: chain.savedAt ?? Date.now() }
  const q = queues.get(pubkey)
  if (q) { q.next = stamped; return }
  const entry: { running: Promise<void>; next: StoredChain | null } = { running: Promise.resolve(), next: stamped }
  queues.set(pubkey, entry)
  entry.running = (async () => {
    while (entry.next) {
      const c = entry.next
      entry.next = null
      try {
        await withDb((d) => putMeta(d, pubkey, recordOf(c)))
      } catch { /* full disk or blocked: localStorage still has the last copy that fit */ }
    }
    queues.delete(pubkey)
  })()
}

/**
 * The page is being hidden or left: send each waiting chain now, in its own
 * transaction, rather than behind the write in flight. Read-write
 * transactions on one store commit in the order they were made, so the
 * newest still lands last.
 */
function flushWaiting(): void {
  for (const [pubkey, q] of queues) {
    const c = q.next
    if (!c) continue
    q.next = null
    void withDb((d) => putMeta(d, pubkey, recordOf(c))).catch(() => { /* as above */ })
  }
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('pagehide', flushWaiting)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushWaiting() })
}

/** Resolves once every write asked for `pubkey` so far has been tried. A read waits for it, so it sees this tab's own last save. */
function settled(pubkey: string): Promise<void> {
  return queues.get(pubkey)?.running ?? Promise.resolve()
}

/** For tests: wait for every queued write. */
export async function chainWritesSettled(): Promise<void> {
  while (queues.size > 0) await Promise.all([...queues.values()].map((q) => q.running))
}

/** For tests: how long a read waits before it says 'timeout'. */
export function setChainReadPatience(ms: number): void {
  readPatienceMs = ms
}

/** For tests: forget the open connection, as a reload does. */
export function closeChainDb(): void {
  void dbPromise?.then((d) => d.close(), () => {})
  dbPromise = null
}
