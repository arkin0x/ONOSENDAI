/**
 * idb.ts: the one IndexedDB database hyperspace uses.
 *
 * Why IndexedDB and not localStorage: the stop cache approaches a million
 * rows, and localStorage is synchronous, string-only and capped in megabytes.
 * The helpers themselves (paged reads, bulk writes, meta records) are shared
 * with the region keys and live in lib/idb; this file only names the database
 * and its stores. Nothing in here knows what a stop is; anchors.ts owns the
 * row shapes.
 */

import { META_STORE, openDatabase } from '../idb'

export { META_STORE, deleteRange, getAllPaged, getMeta, getRangePaged, putMany, putMeta } from '../idb'

export const DB_NAME = 'onosendai:hyperspace'
const DB_VERSION = 1
export const STOPS_STORE = 'stops'

export function openDb(): Promise<IDBDatabase> {
  return openDatabase(DB_NAME, DB_VERSION, [[STOPS_STORE, 'height'], [META_STORE, 'key']])
}
