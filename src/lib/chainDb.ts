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
 * the store saved it (events, published ids, stats, held), written whole and
 * never appended to: a fold that drops actions (a newer spawn, a cut, keeping
 * the relays' version of a branch) must drop them from storage too, or they
 * would come back on the next load as a second branch. localStorage keeps
 * its copy whenever it fits, because the page draws the chain from it
 * synchronously at load; IndexedDB is read right after and brings whatever
 * that copy is missing (store/useCyberspace.ts hydrateChain).
 *
 * Writes go through one queue per identity, latest wins: a burst of saves
 * (an AUTO route signs one action after another) costs one write in flight
 * and one waiting, never one per save. Every call is wrapped: private mode,
 * a blocked upgrade or a full disk leaves the chain where localStorage has it.
 */

import { META_STORE, getMeta, openDatabase, putMeta } from './idb'
import type { NostrEvent } from './events'

export const CHAIN_DB = 'onosendai:chains'
const DB_VERSION = 1
/** The record's own version: a record of another shape is not read. */
const RECORD_VERSION = 1

/** One identity's chain as stored: what the store saves, in the same words. */
export interface StoredChain {
  events: NostrEvent[]
  /** Ids the relays have acknowledged. */
  published: string[]
  stats: Record<string, unknown>
  held: boolean
}

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= openDatabase(CHAIN_DB, DB_VERSION, [[META_STORE, 'key']]).catch((err) => {
    dbPromise = null
    throw err
  })
  return dbPromise
}

/** Whether this browser has IndexedDB at all (node under the tests has none unless a test installs one). */
export function chainDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

/**
 * The chain kept for `pubkey`: null when none is kept, 'unreadable' when the
 * database would not answer (a caller must not take that for "none" and
 * write over a chain it could not see).
 */
export async function readStoredChain(pubkey: string): Promise<StoredChain | null | 'unreadable'> {
  try {
    if (!chainDbAvailable()) return 'unreadable'
    await settled(pubkey)
    const raw = (await getMeta(await db(), pubkey)) as { v?: number; events?: unknown; published?: unknown; stats?: unknown; held?: unknown } | undefined
    if (!raw || raw.v !== RECORD_VERSION || !Array.isArray(raw.events) || raw.events.length === 0) return null
    return {
      events: raw.events as NostrEvent[],
      published: Array.isArray(raw.published) ? raw.published.filter((id): id is string => typeof id === 'string') : [],
      stats: raw.stats && typeof raw.stats === 'object' ? raw.stats as Record<string, unknown> : {},
      held: raw.held === true,
    }
  } catch {
    return 'unreadable'
  }
}

/** Per identity: the write in flight, and the newest chain waiting behind it. */
const queues = new Map<string, { running: Promise<void>; next: StoredChain | null }>()

/**
 * Keep `chain` as `pubkey`'s, in place of what was kept. Returns at once; the
 * write follows, after any already in flight, and only the newest chain
 * waiting is written.
 */
export function writeStoredChain(pubkey: string, chain: StoredChain): void {
  if (!chainDbAvailable()) return
  const q = queues.get(pubkey)
  if (q) { q.next = chain; return }
  const entry: { running: Promise<void>; next: StoredChain | null } = { running: Promise.resolve(), next: chain }
  queues.set(pubkey, entry)
  entry.running = (async () => {
    while (entry.next) {
      const c = entry.next
      entry.next = null
      try {
        await putMeta(await db(), pubkey, { v: RECORD_VERSION, events: c.events, published: c.published, stats: c.stats, held: c.held })
      } catch { /* full disk or blocked: localStorage still has the last copy that fit */ }
    }
    queues.delete(pubkey)
  })()
}

/** Resolves once every write asked for `pubkey` so far has been tried. A read waits for it, so it sees this tab's own last save. */
function settled(pubkey: string): Promise<void> {
  return queues.get(pubkey)?.running ?? Promise.resolve()
}

/** For tests: wait for every queued write. */
export async function chainWritesSettled(): Promise<void> {
  while (queues.size > 0) await Promise.all([...queues.values()].map((q) => q.running))
}

/** For tests: forget the open connection, as a reload does. */
export function closeChainDb(): void {
  void dbPromise?.then((d) => d.close(), () => {})
  dbPromise = null
}
