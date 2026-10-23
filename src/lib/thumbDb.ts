/**
 * thumbDb.ts: the shard pictures kept on this device, in IndexedDB
 * (2026-10-23).
 *
 * A picture costs the hidden canvas a few frames to draw; kept here it costs a
 * read the next time the list is opened, after a reload too. One row per
 * picture, keyed by its shape (lib/thumbKey), with when it was drawn and
 * whether the object places others. A plain shape's picture is good for as
 * long as the key is: the key is the shape. An object that places others
 * (§1.10) is drawn with whatever its parts were when it was drawn, and a part
 * that follows its author's newest version can change under it, so that
 * picture is drawn again after COMPOSITE_TTL_MS.
 *
 * At most MAX_STORED rows are kept, the oldest let go first. A PNG of 160 by
 * 160 is about ten to twenty kilobytes, so that is a few megabytes at most.
 *
 * Nothing here may stop a list from showing: a browser without IndexedDB, a
 * private window that refuses it, or an open that never answers, and every
 * read is a miss and every write is dropped.
 */

import { openDatabase, putMany, request } from './idb'

export const THUMB_DB = 'onosendai:thumbs'
export const DB_VERSION = 1
export const THUMBS_STORE = 'thumbs'
/** Rows by when they were drawn, for letting the oldest go. */
export const BY_AT = 'byAt'

/** How many pictures are kept on the device. */
export const MAX_STORED = 600
/** How long the picture of an object that places others is shown before it is drawn again. */
export const COMPOSITE_TTL_MS = 6 * 60 * 60 * 1000
/** How long opening may take before pictures are kept in memory only, for the session. */
export const OPEN_TIMEOUT_MS = 4000
/** How many writes between checks of the row count. */
const PRUNE_EVERY = 20

export interface ThumbRow {
  key: string
  url: string
  /** When it was drawn, ms since the epoch. */
  at: number
  composite: boolean
}

/** Whether a kept picture is still to be shown at `now`. */
export function fresh(row: ThumbRow, now: number): boolean {
  return !row.composite || now - row.at < COMPOSITE_TTL_MS
}

let opening: Promise<IDBDatabase | null> | null = null
let writes = 0

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = (async () => {
    if (typeof indexedDB === 'undefined') return null
    let timer: ReturnType<typeof setTimeout> | undefined
    let late = false
    try {
      const db = openDatabase(THUMB_DB, DB_VERSION, [[THUMBS_STORE, 'key', [{ name: BY_AT, keyPath: 'at' }]]])
      db.then((d) => { if (late) d.close() }, () => { /* the race says so */ })
      const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => { late = true; resolve(null) }, OPEN_TIMEOUT_MS) })
      return await Promise.race([db, timeout])
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  })()
  return opening
}

/** The kept picture under `key`, or null: not kept, too old, or no storage here. */
export async function readThumb(key: string, now: number = Date.now()): Promise<string | null> {
  try {
    const db = await open()
    if (!db) return null
    const row = await request(db.transaction(THUMBS_STORE, 'readonly').objectStore(THUMBS_STORE).get(key)) as ThumbRow | undefined
    return row && typeof row.url === 'string' && fresh(row, now) ? row.url : null
  } catch {
    return null
  }
}

/** Keep a picture; every so often, let the oldest go past MAX_STORED. */
export async function writeThumb(key: string, url: string, composite: boolean, now: number = Date.now()): Promise<void> {
  try {
    const db = await open()
    if (!db) return
    await putMany(db, THUMBS_STORE, [{ key, url, at: now, composite } satisfies ThumbRow])
    if (++writes % PRUNE_EVERY === 0) await prune(db)
  } catch { /* quota, or a closed database: the picture stays in memory */ }
}

/** Delete the oldest rows past `max`. */
export async function prune(db: IDBDatabase, max: number = MAX_STORED): Promise<void> {
  const os = db.transaction(THUMBS_STORE, 'readonly').objectStore(THUMBS_STORE)
  const count = await request(os.count())
  if (count <= max) return
  const old = await request(os.index(BY_AT).getAllKeys(null, count - max)) as unknown as IDBValidKey[]
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(THUMBS_STORE, 'readwrite')
    const w = tx.objectStore(THUMBS_STORE)
    for (const k of old) w.delete(k)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'))
  })
}

/** For tests: open again, as a new page would. */
export function resetThumbDbForTests(): void {
  opening = null
  writes = 0
}

/** For tests: the database, once open. */
export function thumbDbForTests(): Promise<IDBDatabase | null> {
  return open()
}
