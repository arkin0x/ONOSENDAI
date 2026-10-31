/**
 * connection.ts - the one open connection to `onosendai:events`, in whichever
 * thread owns it (the event worker; the main thread where there is no worker).
 *
 * The same hygiene as lib/chainDb.ts. A connection the browser drops (Safari's
 * "Connection to Indexed Database server lost") is forgotten, and the call
 * that met it is tried once more on a fresh one. An open another tab blocks
 * fails at once instead of waiting. A newer build upgrading the database in
 * another tab gets the connection closed here, and the next call opens again.
 *
 * That next call, and a build taken back a version, ask for a lower version
 * than the database now has, which IndexedDB refuses with a VersionError. Then
 * the database is opened at the version it has: upgrades only add, so a newer
 * schema holds every store and index this build knows.
 */

import { openDatabase } from '../idb'
import { EVENT_DB, EVENT_DB_STORES, EVENT_DB_VERSION } from './schema'

let dbPromise: Promise<IDBDatabase> | null = null

/** The database at whatever version it has. Only asked when it exists at a newer one, so nothing is created or upgraded here. */
function openAtItsVersion(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(EVENT_DB)
    // Gone since the VersionError: this open would make an empty database at
    // version 1, and every call after it would find no stores, for good. It is
    // refused instead, so the next call opens it properly.
    req.onupgradeneeded = () => req.transaction?.abort()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const opening = openDatabase(EVENT_DB, EVENT_DB_VERSION, EVENT_DB_STORES, undefined, { failWhenBlocked: true }).catch((err: unknown) => {
      if ((err as { name?: unknown } | null)?.name === 'VersionError') return openAtItsVersion()
      throw err
    }).then((d) => {
      d.onversionchange = () => { d.close(); if (dbPromise === opening) dbPromise = null }
      d.onclose = () => { if (dbPromise === opening) dbPromise = null }
      return d
    })
    opening.catch(() => { if (dbPromise === opening) dbPromise = null })
    dbPromise = opening
  }
  return dbPromise
}

/** A full disk stays full: it is not worth a second connection, and the caller needs to hear it. */
export function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

/** `run` on the open database; on a failure other than a full disk, once more on a fresh connection, since the cached one may be dead. */
export async function withEventDb<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const first = open()
  try {
    return await run(await first)
  } catch (err) {
    if (isQuotaError(err)) throw err
    if (dbPromise === first) dbPromise = null
    return run(await open())
  }
}

/** For tests: forget the open connection, as a reload does. */
export function closeEventDb(): void {
  void dbPromise?.then((d) => d.close(), () => {})
  dbPromise = null
}
