/**
 * personalDb.ts: the things that are one identity's own, kept on this device
 * in IndexedDB under that identity's pubkey, so a new or different identity
 * starts with its own empty set and each identity finds its set again when it
 * logs back in here (owner ruling, 2026-11-19: "key the user's data by npub
 * so when they login it still exists"; "my starred places ... should be
 * cleared out if i roll a new npub, but be restored if i login with arkinox
 * again").
 *
 * One database, one store of rows { key, owner, name, value, at }, the key
 * being `${owner}/${name}`: a name is one list (STARRED_LIST, RECENT_VIEWS_LIST,
 * TARGETS_LIST), read and written whole, as each is small. Nothing here knows
 * what a list holds; the store that owns a name owns its shape and cleans
 * what it reads back.
 *
 * Moving a device-wide list in (adopt): builds before this kept these lists
 * once per device in localStorage. The first time a name is read here, in
 * one readwrite transaction, the old list goes to the identity signed in at
 * that moment (unless that identity already has its own), and a marker in
 * the meta store says it has been adopted, so no later identity gets a copy.
 * The localStorage original is left exactly as it was, never deleted: it is
 * what an older build still reads, and nothing new writes it again.
 */

import { META_STORE, openDatabase, request } from './idb'

export const PERSONAL_DB = 'onosendai:personal'
export const DB_VERSION = 1
export const LISTS_STORE = 'lists'

/** How long opening may take before the lists last the session in memory. */
export const OPEN_TIMEOUT_MS = 8000

/** Whether `owner` can own rows here: a pubkey, 64 hex. */
export function isOwner(owner: string): boolean {
  return /^[0-9a-f]{64}$/.test(owner)
}

const rowKey = (owner: string, name: string): string => `${owner}/${name}`
const adoptedKey = (name: string): string => `adopted:${name}`

interface Row { key: string; owner: string; name: string; value: unknown; at: number }

export function openPersonalDb(timeoutMs: number = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  const opening = openDatabase(PERSONAL_DB, DB_VERSION, [[LISTS_STORE, 'key'], [META_STORE, 'key']])
  // As the folders do: a blocked upgrade or a browser that never answers must
  // not hold the app, and a connection that arrives late is closed.
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error('IndexedDB did not open in time')) }, timeoutMs)
  })
  opening.then((db) => { if (timedOut) db.close() }, () => { /* the race reports it */ })
  return Promise.race([opening, timeout]).finally(() => clearTimeout(timer))
}

/** One identity's list, or undefined when it has none. */
export async function readList(db: IDBDatabase, owner: string, name: string): Promise<unknown> {
  const row = await request(db.transaction(LISTS_STORE, 'readonly').objectStore(LISTS_STORE).get(rowKey(owner, name))) as Row | undefined
  return row?.value
}

/** Write one identity's list whole. */
export function writeList(db: IDBDatabase, owner: string, name: string, value: unknown): Promise<void> {
  if (!isOwner(owner)) return Promise.reject(new Error('not an identity'))
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LISTS_STORE, 'readwrite')
    tx.objectStore(LISTS_STORE).put({ key: rowKey(owner, name), owner, name, value, at: Date.now() } satisfies Row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/**
 * One identity's list, adopting the device-wide list builds before kept
 * (`legacy`, read by the caller from localStorage; undefined when there is
 * none) the first time `name` is read on this device, in one transaction:
 * it becomes `owner`'s list unless `owner` already has one, and the marker
 * is written either way, so it is adopted once, by one identity. Resolves
 * with `owner`'s list as it stands after, or undefined.
 */
export function adopt(db: IDBDatabase, owner: string, name: string, legacy: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([LISTS_STORE, META_STORE], 'readwrite')
    const lists = tx.objectStore(LISTS_STORE)
    const meta = tx.objectStore(META_STORE)
    let value: unknown
    const mine = lists.get(rowKey(owner, name))
    mine.onsuccess = () => {
      value = (mine.result as Row | undefined)?.value
      const mark = meta.get(adoptedKey(name))
      mark.onsuccess = () => {
        if (mark.result) return
        if (value === undefined && legacy !== undefined && isOwner(owner)) {
          value = legacy
          lists.put({ key: rowKey(owner, name), owner, name, value, at: Date.now() } satisfies Row)
        }
        meta.put({ key: adoptedKey(name), owner: isOwner(owner) ? owner : null, at: Date.now() })
      }
    }
    tx.oncomplete = () => resolve(value)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/**
 * Where IndexedDB cannot be opened at all (some private windows), each
 * identity's list is kept in localStorage under its own key instead, with
 * the same adoption rule (a marker key). The next time IndexedDB opens, such
 * a list is merged into the identity's row and its key removed only after
 * that write is confirmed (store/personalLists.ts).
 */
export const fallbackKey = (owner: string, name: string): string => `onosendai:personal:${owner}:${name}`
const fallbackAdopted = (name: string): string => `onosendai:personal:adopted:${name}`

/** An identity's fallback list, or undefined. Throws when localStorage cannot be read. */
export function readFallback(owner: string, name: string): unknown {
  const raw = localStorage.getItem(fallbackKey(owner, name))
  if (raw === null) return undefined
  try { return JSON.parse(raw) as unknown } catch { return undefined }
}

/** Keep an identity's fallback list. Throws when localStorage refuses (full, private mode). */
export function writeFallback(owner: string, name: string, value: unknown): void {
  if (!isOwner(owner)) throw new Error('not an identity')
  localStorage.setItem(fallbackKey(owner, name), JSON.stringify(value))
}

/** adopt, in localStorage: the device-wide list goes to `owner` once, unless it has its own. */
export function adoptFallback(owner: string, name: string, legacy: unknown): unknown {
  let value = readFallback(owner, name)
  if (localStorage.getItem(fallbackAdopted(name)) !== null) return value
  if (value === undefined && legacy !== undefined && isOwner(owner)) {
    writeFallback(owner, name, legacy)
    value = legacy
  }
  localStorage.setItem(fallbackAdopted(name), isOwner(owner) ? owner : '')
  return value
}

/** Drop an identity's fallback list, once IndexedDB holds it. */
export function clearFallback(owner: string, name: string): void {
  try { localStorage.removeItem(fallbackKey(owner, name)) } catch { /* it stays, and is merged again: a union, so nothing is lost */ }
}
