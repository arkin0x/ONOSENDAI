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
 * and one waiting, never one per save. A write starts a pause (writePauseMs,
 * 400 ms) after the first save that asks for it, so the two saves of every
 * action (signed, then acknowledged by a relay, usually 50 to 250 ms later)
 * are one write: the whole
 * record is copied on the main thread when it is written (structured clone),
 * about 55 ms for a 1,300-action chain, and twice per action was a stutter in
 * WALK (arkinox, 2026-10-30). Until the store of every event moves to its own
 * layer, which writes one row per event, this only halves it and moves it
 * off the move itself. A read, the page being hidden or left, or a test
 * waiting for the writes ends the pause at once. Another tab cannot end it:
 * it sees the mark of this save before the chain behind it, and waits for
 * the chain (store/useCyberspace.ts readForMark). A branch set aside is
 * written without the pause, so it is never on disk after the record that
 * replaced it there. When the page is hidden or
 * left, the one waiting is sent at once rather than behind the one in flight. Every
 * write carries a generation, and one that a newer write of the same
 * identity has overtaken is not sent (or sent again after a failure), so an
 * older chain never lands after a newer one.
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
/** How long a write waits for the saves after it to join it (see above). */
let writePauseMs = 400

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
    // This tab's own last save first, now rather than after its pause.
    queues.get(pubkey)?.wake?.()
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

/** Per identity: the write in flight, the newest chain waiting behind it, with its generation, and, during the pause before the first write, what ends it. */
interface WriteQueue { running: Promise<void>; next: { chain: StoredChain; gen: number } | null; wake: (() => void) | null }
const queues = new Map<string, WriteQueue>()
/** Per identity, the generation of the newest write asked for. */
const newestGen = new Map<string, number>()
let generations = 0

/** Write `c` under `key`, unless a newer write of the same key was asked for meanwhile: checked before each try, so a retry on a fresh connection never lands an older chain after a newer one. */
async function putUnlessOvertaken(key: string, c: StoredChain, gen: number): Promise<void> {
  await withDb((d) => (newestGen.get(key) ?? 0) > gen ? Promise.resolve() : putMeta(d, key, recordOf(c)))
}

/** One record, as written. */
function recordOf(c: StoredChain): unknown {
  return { v: RECORD_VERSION, events: c.events, published: c.published, stats: c.stats, held: c.held, savedAt: c.savedAt ?? Date.now() }
}

/**
 * Keep `chain` as `pubkey`'s, in place of what was kept. Returns at once; the
 * write follows, after any already in flight, and only the newest chain
 * waiting is written. A chain that does not say when it was saved is stamped now.
 * With `pause` false the write is not held for the saves after it.
 */
export function writeStoredChain(pubkey: string, chain: StoredChain, pause = true): void {
  if (!chainDbAvailable()) return
  const stamped = { ...chain, savedAt: chain.savedAt ?? Date.now() }
  const gen = ++generations
  newestGen.set(pubkey, gen)
  const q = queues.get(pubkey)
  if (q) { q.next = { chain: stamped, gen }; return }
  const entry: WriteQueue = { running: Promise.resolve(), next: { chain: stamped, gen }, wake: null }
  queues.set(pubkey, entry)
  entry.running = (async () => {
    if (pause) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => entry.wake?.(), writePauseMs)
        entry.wake = () => { clearTimeout(timer); entry.wake = null; resolve() }
      })
    }
    while (entry.next) {
      const w = entry.next
      entry.next = null
      try {
        await putUnlessOvertaken(pubkey, w.chain, w.gen)
      } catch { /* full disk or blocked: localStorage still has the last copy that fit */ }
    }
    queues.delete(pubkey)
  })()
}

/**
 * Keep `chain` beside `pubkey`'s record, under a key of its own that no
 * later save touches: a branch of this device's that parted ways with the
 * chain in hand, kept so that neither side is ever written over
 * (store/useCyberspace.ts takeParted).
 */
export function setAsideStoredChain(pubkey: string, chain: StoredChain): void {
  // At once: the record that replaces it is written after it, never before (review of #536, F2).
  writeStoredChain(`parted:${pubkey}:${Date.now()}`, chain, false)
}

/** The branches set aside for `pubkey` (setAsideStoredChain), oldest first. */
export async function setAsideChains(pubkey: string): Promise<StoredChain[]> {
  const out: StoredChain[] = []
  // A branch set aside a moment ago, its write still on its way, is listed too.
  const prefix = `parted:${pubkey}:`
  const waiting = [...queues].filter(([key]) => key.startsWith(prefix)).map(([, q]) => { q.wake?.(); return q.running })
  await Promise.all(waiting)
  const keys = await withDb((d) => new Promise<IDBValidKey[]>((resolve, reject) => {
    const req = d.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAllKeys(IDBKeyRange.bound(`parted:${pubkey}:`, `parted:${pubkey};`))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
  for (const key of keys) {
    const r = await readNow(String(key))
    if (r && r !== 'unreadable') out.push(r)
  }
  return out
}

/**
 * The page is being hidden or left: send each waiting chain now, in its own
 * transaction, rather than behind the write in flight. Read-write
 * transactions on one store commit in the order they were made, so the
 * newest still lands last.
 */
export function flushChainWrites(): void {
  for (const [pubkey, q] of queues) {
    // Still in its pause: the write is sent now, by its own queue.
    if (q.wake) { q.wake(); continue }
    const w = q.next
    if (!w) continue
    q.next = null
    void putUnlessOvertaken(pubkey, w.chain, w.gen).catch(() => { /* as above */ })
  }
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('pagehide', flushChainWrites)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushChainWrites() })
}

/** Resolves once every write asked for `pubkey` so far has been tried. A read waits for it, so it sees this tab's own last save. */
function settled(pubkey: string): Promise<void> {
  return queues.get(pubkey)?.running ?? Promise.resolve()
}

/** For tests: wait for every queued write, without the pause. */
export async function chainWritesSettled(): Promise<void> {
  while (queues.size > 0) {
    for (const q of queues.values()) q.wake?.()
    await Promise.all([...queues.values()].map((q) => q.running))
  }
}

/** How long a write waits for the saves after it (ms): what another tab allows before reading again. */
export function chainWritePause(): number {
  return writePauseMs
}

/** For tests: how long a write waits for the saves after it. */
export function setChainWritePause(ms: number): void {
  writePauseMs = ms
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
