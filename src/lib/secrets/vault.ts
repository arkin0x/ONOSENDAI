/**
 * vault.ts: where region keys and places are being kept right now, and the
 * connection to it.
 *
 * Three states. `none` before the first load settles: places go to memory
 * and move into IndexedDB once it opens. `idb`, the usual case. `local` when
 * IndexedDB cannot be had: held keys go to localStorage as they did before
 * the database, and places stay in memory for the session.
 *
 * A write that fails is not the end of it (arkinox's review, 2026-10-04):
 * another tab upgrading the database closes this tab's connection, WebKit
 * drops connections it has held a while, and a full disk refuses a write.
 * `run` opens the database again and tries once more. A bought key is also
 * in the localStorage backstop whatever happens here (backstop.ts).
 */

import {
  countPlaceKeysAmong, getPlace, getPlaceKeys, openSecretsDb, pagePlaces as pageFromDb, placeKeyPage,
} from './db'
import { MemoryPlaces } from './memoryPlaces'
import type { Place, PlaceCursor, PlaceKey } from './places'

export type Backend = 'none' | 'idb' | 'local'

/** After an open fails, how long before a write may try again rather than fail at once. */
const REOPEN_GAP_MS = 10_000

let backend: Backend = 'none'
let db: IDBDatabase | null = null
let reopening: Promise<IDBDatabase> | null = null
let lastFailure: { at: number; error: unknown } | null = null

/** Places kept in memory: before the database opens, and for a fallback session. */
export const memory = new MemoryPlaces()

export function backendNow(): Backend {
  return backend
}

/** IndexedDB is open: from here on, writes go to it. */
export function attach(opened: IDBDatabase): void {
  // A newer version of this database opened in another tab waits on every
  // older connection; this one steps aside instead of blocking it. The next
  // write here opens it again, or fails into the panel when this build is
  // older than the database now is.
  opened.onversionchange = () => {
    opened.close()
    if (db === opened) db = null
  }
  db = opened
  backend = 'idb'
}

/** IndexedDB is out for this session. */
export function fallBack(): void {
  backend = 'local'
}

function connection(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db)
  if (reopening) return reopening
  if (lastFailure && Date.now() - lastFailure.at < REOPEN_GAP_MS) return Promise.reject(lastFailure.error)
  reopening = openSecretsDb().then(
    (opened) => { attach(opened); lastFailure = null; return opened },
    (error: unknown) => { lastFailure = { at: Date.now(), error }; throw error },
  ).finally(() => { reopening = null })
  return reopening
}

/**
 * Run an operation against the database. If it fails, close the connection,
 * open a new one and run it once more; a second failure is the caller's.
 */
export async function run<T>(op: (db: IDBDatabase) => Promise<T>): Promise<T> {
  try {
    return await op(await connection())
  } catch {
    if (db) { try { db.close() } catch { /* already closed */ } db = null }
    return await op(await connection())
  }
}

/** One page of places, newest first, from wherever they are kept. */
export function pagePlaces(after: PlaceCursor | null, limit: number): Promise<Place[]> {
  return backend === 'idb' ? run((d) => pageFromDb(d, after, limit)) : Promise.resolve(memory.page(after, limit))
}

export function placeById(id: string): Promise<Place | null> {
  return backend === 'idb' ? run((d) => getPlace(d, id)) : Promise.resolve(memory.get(id))
}

export function placeKeysOf(ids: string[]): Promise<PlaceKey[]> {
  return backend === 'idb' ? run((d) => getPlaceKeys(d, ids)) : Promise.resolve(memory.keysOf(ids))
}

/**
 * Every place key, `size` at a time, without holding them all at once. Each
 * page is its own read through `run`, so a connection dropped halfway through
 * RESCAN ALL is opened again rather than ending the rescan.
 */
export async function* placeKeyPages(size: number): AsyncGenerator<PlaceKey[]> {
  if (backend !== 'idb') { yield* memory.keyPages(size); return }
  let after: string | null = null
  for (;;) {
    const from: string | null = after
    const rows: PlaceKey[] = await run((d) => placeKeyPage(d, from, size))
    if (rows.length === 0) return
    yield rows
    if (rows.length < size) return
    after = rows[rows.length - 1].lookupId
  }
}

/** How many of these lookup ids are also place keys. */
export function placeKeysAmong(ids: string[]): Promise<number> {
  if (ids.length === 0) return Promise.resolve(0)
  return backend === 'idb' ? run((d) => countPlaceKeysAmong(d, ids)) : Promise.resolve(memory.keysOf(ids).length)
}
