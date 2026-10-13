/**
 * foundDb.ts: where the bags you have opened are kept, in IndexedDB.
 *
 * What a scan finds lived only in memory and came back only when a relay
 * answered again, so a relay that went quiet, or started asking to sign in,
 * took everything you had found off the screen (arkinox, 2026-10-13: "are we
 * caching decrypted bags yet so relays can't cut us off from what we've
 * found?"). The rows here are the bags themselves, SIGNED, with the region
 * key that opened them and the public objects their references resolved to,
 * never the plaintext: a row is verified and opened again on every load,
 * exactly as a fresh find is (lib/foundCache.ts), and a row that no longer
 * verifies is dropped rather than shown.
 *
 * One database, one store, one row per bag per identity, keyed by
 * `${owner}/${author}:${lookupId}` (the bag's address, so a newer version of
 * the same bag replaces the row) and indexed by `owner`. The same promise
 * wrapper as the inventory (lib/idb.ts); nothing here knows about zustand.
 */

import { openDatabase, putMany, request } from './idb'
import type { NostrEvent } from './events'

export const FOUND_DB = 'onosendai:found'
export const DB_VERSION = 1
export const BAGS_STORE = 'bags'
/** Bags by the identity that found them. */
export const BY_OWNER = 'byOwner'

/** How long opening may take before finds are kept in memory for the session. */
export const OPEN_TIMEOUT_MS = 8000

/** Where a bag was opened from: the region's aligned corner and plane, as unbag takes it, with decimal strings. */
export interface FoundOrigin {
  at: { x: string; y: string; z: string }
  plane: 0 | 1
}

export interface FoundBag {
  /** `${owner}/${author}:${lookupId}`. */
  rowKey: string
  /** The identity that found it. Another identity never sees this row. */
  owner: string
  /** The bag (kind 33330) as the relay sent it, signed. */
  outer: NostrEvent
  /** The region key that opened it, hex. */
  keyHex: string
  /** The region's height as the finder knew it, when it did (a bag may omit `h`). */
  height?: number
  /** Where references without their own point are drawn. */
  origin?: FoundOrigin
  /** The events its references resolved to, by entry key (lib/hidden.ts entryKey), signed. */
  refs: Record<string, NostrEvent>
  /** The items it opened to, by event id: what the budget asks about before evicting. */
  itemIds: string[]
  /** Unix seconds when this bag was last found or opened. Eviction takes the oldest first. */
  seenAt: number
}

export function openFoundDb(timeoutMs: number = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  const opening = openDatabase(FOUND_DB, DB_VERSION, [[BAGS_STORE, 'rowKey', [{ name: BY_OWNER, keyPath: 'owner' }]]])
  // As the inventory does: a blocked upgrade or a browser that never answers
  // must not hold the app, and a connection that arrives late is closed so it
  // does not block the next open.
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error('IndexedDB did not open in time')) }, timeoutMs)
  })
  opening.then((db) => { if (timedOut) db.close() }, () => { /* the race reports it */ })
  return Promise.race([opening, timeout]).finally(() => clearTimeout(timer))
}

/** Whether a stored value has the shape of a row. Its events are verified later, when it is opened. */
export function isFoundBag(v: unknown): v is FoundBag {
  const r = v as FoundBag | null
  return !!r && typeof r === 'object' && typeof r.rowKey === 'string' && typeof r.owner === 'string' && !!r.outer && typeof r.outer === 'object'
    && typeof r.keyHex === 'string' && !!r.refs && typeof r.refs === 'object' && Array.isArray(r.itemIds) && typeof r.seenAt === 'number'
}

/** Every bag one identity has found, in one read. */
export async function readFound(db: IDBDatabase, owner: string): Promise<FoundBag[]> {
  const index = db.transaction(BAGS_STORE, 'readonly').objectStore(BAGS_STORE).index(BY_OWNER)
  const rows = await request(index.getAll(owner)) as unknown[]
  return rows.filter(isFoundBag)
}

export function writeFound(db: IDBDatabase, rows: FoundBag[]): Promise<void> {
  return rows.length === 0 ? Promise.resolve() : putMany(db, BAGS_STORE, rows)
}

/** Remove rows by key; one transaction. */
export function deleteFound(db: IDBDatabase, rowKeys: string[]): Promise<void> {
  if (rowKeys.length === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BAGS_STORE, 'readwrite')
    const os = tx.objectStore(BAGS_STORE)
    for (const k of rowKeys) os.delete(k)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'))
  })
}
