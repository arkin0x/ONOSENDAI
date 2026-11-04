/**
 * soundMuteDb.ts: which hidden audio tracks this device keeps silent, and
 * whether all of it is, in IndexedDB (arkinox, 2026-11-03: NOW PLAYING
 * mutes; per device, never published, never localStorage).
 *
 * Its own small database, as the shard folders and the hidden records have:
 * `onosendai:events` keeps nostr events, and this is a listener's setting,
 * not an event.
 *
 *   tracks  { id, at }        one row per muted track: the item's lineage id
 *                             (its first `d`, which an EDIT or a move keeps)
 *   meta    { key, value }    `master`: true while everything hidden is muted
 *
 * Nothing here knows about zustand; store/useSoundMutes.ts decides when to
 * read and write.
 */

import { META_STORE, openDatabase, request } from './idb'

export const SOUND_MUTE_DB = 'onosendai:sound-mutes'
const DB_VERSION = 1
const TRACKS = 'tracks'
const MASTER = 'master'
const OPEN_TIMEOUT_MS = 8000

export function openSoundMuteDb(timeoutMs: number = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  const opening = openDatabase(SOUND_MUTE_DB, DB_VERSION, [[TRACKS, 'id'], [META_STORE, 'key']])
  // As the held items do: a blocked upgrade or a browser that never answers
  // must not hold the app, and a connection that arrives late is closed.
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error('IndexedDB did not open in time')) }, timeoutMs)
  })
  opening.then((db) => { if (timedOut) db.close() }, () => { /* the race reports it */ })
  return Promise.race([opening, timeout]).finally(() => clearTimeout(timer))
}

/** Every muted track and the master switch, as stored. */
export async function readSoundMutes(db: IDBDatabase): Promise<{ tracks: string[]; master: boolean }> {
  const tx = db.transaction([TRACKS, META_STORE], 'readonly')
  const [rows, master] = await Promise.all([
    request(tx.objectStore(TRACKS).getAll()) as Promise<Array<{ id?: unknown }>>,
    request(tx.objectStore(META_STORE).get(MASTER)) as Promise<{ value?: unknown } | undefined>,
  ])
  return { tracks: rows.map((r) => r.id).filter((id): id is string => typeof id === 'string' && id !== ''), master: master?.value === true }
}

function write(db: IDBDatabase, store: string, run: (os: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    run(tx.objectStore(store))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/** Mute or unmute one track. */
export function putTrackMute(db: IDBDatabase, id: string, muted: boolean): Promise<void> {
  return write(db, TRACKS, (os) => { if (muted) os.put({ id, at: Date.now() }); else os.delete(id) })
}

/** Set the master switch. */
export function putMasterMute(db: IDBDatabase, muted: boolean): Promise<void> {
  return write(db, META_STORE, (os) => { os.put({ key: MASTER, value: muted }) })
}
