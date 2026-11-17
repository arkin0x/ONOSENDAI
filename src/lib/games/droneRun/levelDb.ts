/**
 * levelDb.ts - DRONE RUN levels imported on this device, kept in IndexedDB.
 *
 * One database, one store, one row per imported level, keyed by the level's
 * own id (level.json `id`): importing a level with the same id again replaces
 * it. A row holds the level as read (level/level.ts) and each piece's payload
 * as parsed from the zip, checked once at import (level/package.ts) and read
 * again when the level is played. The same promise wrapper as every database
 * here (lib/idb.ts).
 *
 * Device-only: nothing here is published, synced to another device, or put
 * in the hidden list. A level removed from here can be imported again from its
 * zip. The store/useDroneRunLevels.ts store owns the list the GAMES panel shows.
 */

import { openDatabase, putMany, request } from '../../idb'
import type { Level } from './level/level'

export const DRONE_RUN_LEVELS_DB = 'onosendai:droneRunLevels'
export const DB_VERSION = 1
export const LEVELS_STORE = 'levels'

/** How long opening may take before import says this device cannot keep a level. */
export const OPEN_TIMEOUT_MS = 8000

/** One imported level, as kept. */
export interface StoredLevel {
  /** The level's own id: the row's key. */
  id: string
  /** Its name, as the level gives it: what the field choice shows. */
  name: string
  /** When it was imported here, ms since the epoch. */
  importedAt: number
  /** Bytes read from the zip, inflated, and faces drawn. */
  bytes: number
  faces: number
  level: Level
  payloads: Record<string, unknown>
}

/** What the field choice needs of a level, without its payloads. */
export type LevelSummary = Pick<StoredLevel, 'id' | 'name' | 'importedAt' | 'bytes' | 'faces'>

export function openLevelsDb(timeoutMs: number = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  const opening = openDatabase(DRONE_RUN_LEVELS_DB, DB_VERSION, [[LEVELS_STORE, 'id']])
  // As the other databases do: a browser that never answers must not hold the panel,
  // and a connection that arrives late is closed so it does not block the next open.
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error('IndexedDB did not open in time')) }, timeoutMs)
  })
  opening.then((db) => { if (timedOut) db.close() }, () => { /* the race reports it */ })
  return Promise.race([opening, timeout]).finally(() => clearTimeout(timer))
}

/** Whether a stored value is a level row this app can use. */
export function isStoredLevel(v: unknown): v is StoredLevel {
  const r = v as StoredLevel | null
  return !!r && typeof r === 'object' && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.importedAt === 'number'
    && !!r.level && typeof r.level === 'object' && !!r.payloads && typeof r.payloads === 'object'
}

const summary = (r: StoredLevel): LevelSummary => ({ id: r.id, name: r.name, importedAt: r.importedAt, bytes: r.bytes, faces: r.faces })

/** Every imported level, oldest first, without payloads. */
export async function listLevels(db: IDBDatabase): Promise<LevelSummary[]> {
  const rows = await request(db.transaction(LEVELS_STORE, 'readonly').objectStore(LEVELS_STORE).getAll()) as unknown[]
  return rows.filter(isStoredLevel).map(summary).sort((a, b) => a.importedAt - b.importedAt || (a.id < b.id ? -1 : 1))
}

/** One imported level, payloads and all, or null. */
export async function getLevel(db: IDBDatabase, id: string): Promise<StoredLevel | null> {
  const row = await request(db.transaction(LEVELS_STORE, 'readonly').objectStore(LEVELS_STORE).get(id)) as unknown
  return isStoredLevel(row) ? row : null
}

/** Keep a level; a level with the same id is replaced. Resolves once the write has committed. */
export function putLevel(db: IDBDatabase, row: StoredLevel): Promise<void> {
  return putMany(db, LEVELS_STORE, [row])
}

/** Remove one level: gone once the transaction has committed. */
export function deleteLevel(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEVELS_STORE, 'readwrite')
    tx.objectStore(LEVELS_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
