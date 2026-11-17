/**
 * deviceCache.ts - small caches kept on this device in IndexedDB, one record
 * per cache, for the lists that used to sit in localStorage.
 *
 * localStorage is a few megabytes for the whole origin, shared by every
 * identity on the device, and a full one refuses every write after it,
 * silently (arkinox, 2026-11-17: "i dont want to use local storage if we can
 * avoid it, it fills up too fast"). The lists here are list-sized and
 * refetchable: the profiles (up to PROFILES_KEPT kind 0s), the chat lines,
 * the loot list. Each is still capped by its owner; this module only keeps
 * the record. Tiny settings flags stay in localStorage.
 *
 * One record per cache, written whole, like rosterCache: the lists are small
 * enough that a write is one put, and there are no rows to delete when an
 * entry drops off the end. Every call is best effort: private mode, a blocked
 * upgrade or a full disk leaves the app working from the relays alone.
 *
 * Moving off localStorage, once per cache (takeLocal): the old key is read
 * synchronously when the store is made, so the first frame after the upgrade
 * still has it; it is written here, read back, and only then removed from
 * localStorage. A write that fails leaves the old key in place for next time.
 */

import { META_STORE, getMeta, openDatabase, putMeta } from './idb'

export const DEVICE_CACHE_DB = 'onosendai:cache'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= openDatabase(DEVICE_CACHE_DB, DB_VERSION, [[META_STORE, 'key']]).catch((err) => {
    dbPromise = null
    throw err
  })
  return dbPromise
}

/** The record kept under `key`, or undefined when there is none or it cannot be read. */
export async function readCached(key: string): Promise<unknown> {
  try {
    if (typeof indexedDB === 'undefined') return undefined
    return await getMeta(await db(), key)
  } catch {
    return undefined
  }
}

/** Keep `value` under `key` in place of the last one. Resolves false when it could not be written. */
export async function writeCached(key: string, value: unknown): Promise<boolean> {
  try {
    if (typeof indexedDB === 'undefined') return false
    await putMeta(await db(), key, value)
    return true
  } catch {
    return false
  }
}

/** Writes waiting to go, by key: only the last value for a key is written. */
const queued = new Map<string, unknown>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
/** How long writes wait to be made together. */
export const WRITE_DELAY_MS = 500

/** Keep `value` under `key` shortly, after any other writes queued meanwhile. */
export function writeCachedSoon(key: string, value: unknown): void {
  queued.set(key, value)
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    const batch = [...queued]
    queued.clear()
    for (const [k, v] of batch) void writeCached(k, v)
  }, WRITE_DELAY_MS)
}

/**
 * The value an older build kept in localStorage under `localKey`, parsed, or
 * undefined. When there is one, it is moved: written under `key` here unless
 * a newer record is already kept, read back, and then removed from
 * localStorage. Synchronous for the caller, so a store made at module load
 * still starts with it; the move itself finishes a moment later.
 */
export function takeLocal(localKey: string, key: string): unknown {
  let raw: string | null = null
  try { raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(localKey) } catch { raw = null }
  if (raw === null) return undefined
  let value: unknown
  try { value = JSON.parse(raw) } catch { value = undefined }
  void moveLocal(localKey, key, value)
  return value
}

/** Tests: the last move takeLocal started, to await it. */
export let lastMove: Promise<void> = Promise.resolve()

function moveLocal(localKey: string, key: string, value: unknown): Promise<void> {
  lastMove = (async () => {
    if (typeof indexedDB === 'undefined') return
    // A record already kept is this build's own, newer than the old key: it stands.
    const have = await readCached(key)
    if (have === undefined && value !== undefined) {
      if (!(await writeCached(key, value))) return
      if ((await readCached(key)) === undefined) return
    }
    try { localStorage.removeItem(localKey) } catch { /* removed next time */ }
  })().catch(() => undefined)
  return lastMove
}

/** For tests: forget the open connection, as a reload does. */
export function closeDeviceCache(): void {
  void dbPromise?.then((d) => d.close(), () => {})
  dbPromise = null
  queued.clear()
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null }
}
