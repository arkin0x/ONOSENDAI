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
 * still has it. It is written here only where no record is kept yet, in one
 * transaction (a newer write of this build is never overwritten), and the old
 * key is removed only once a write of that record has gone through: the move's
 * own, or the store's merged list after it read the kept one in. A write that
 * fails leaves the old key in place for next time.
 *
 * Writes wait WRITE_DELAY_MS to go together, and go at once when the page is
 * hidden or closed (pagehide, visibilitychange), as localStorage's did.
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

/** Old localStorage keys to remove once their record has been written, by record key. */
const moving = new Map<string, string>()

function moved(key: string): void {
  const localKey = moving.get(key)
  if (localKey === undefined) return
  moving.delete(key)
  try { localStorage.removeItem(localKey) } catch { /* removed next time */ }
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
    moved(key)
    return true
  } catch {
    return false
  }
}

/** Write `value` under `key` only where nothing is kept yet, in one transaction: 'wrote', 'kept' (a record was there), or 'failed'. */
async function writeIfAbsent(key: string, value: unknown): Promise<'wrote' | 'kept' | 'failed'> {
  try {
    if (typeof indexedDB === 'undefined') return 'failed'
    const d = await db()
    return await new Promise((resolve) => {
      const tx = d.transaction(META_STORE, 'readwrite')
      const os = tx.objectStore(META_STORE)
      let outcome: 'wrote' | 'kept' = 'kept'
      // In the get's own callback, so the put is in the same transaction.
      const get = os.get(key)
      get.onsuccess = () => { if (get.result === undefined) { outcome = 'wrote'; os.put({ key, value }) } }
      tx.oncomplete = () => resolve(outcome)
      tx.onerror = () => resolve('failed')
      tx.onabort = () => resolve('failed')
    })
  } catch {
    return 'failed'
  }
}

/** A value, or a function giving it when the write goes (so a long list is built once per write, not once per change). */
type Later = unknown | (() => unknown)

/** Writes waiting to go, by key: only the last value for a key is written. */
const queued = new Map<string, Later>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
/** How long writes wait to be made together. */
export const WRITE_DELAY_MS = 500

/** Keep `value` (or what `value()` gives when the write goes) under `key` shortly, after any other writes queued meanwhile. */
export function writeCachedSoon(key: string, value: Later): void {
  queued.set(key, value)
  if (flushTimer !== null) return
  flushTimer = setTimeout(flushCachedNow, WRITE_DELAY_MS)
}

/** Every queued write, now (the page is being hidden or closed). */
export function flushCachedNow(): void {
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null }
  const batch = [...queued]
  queued.clear()
  for (const [k, v] of batch) void writeCached(k, typeof v === 'function' ? (v as () => unknown)() : v)
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', flushCachedNow)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushCachedNow() })
}

/**
 * The value an older build kept in localStorage under `localKey`, parsed, or
 * undefined (also for a value that is not JSON). When there is one, it is
 * moved: written under `key` where nothing is kept yet, and the old key is
 * removed once a write of `key` has gone through. Where a record is kept
 * already, the store merges the two and writes the merged list, which removes
 * it. Synchronous for the caller, so a store made at module load still starts
 * with it; the move itself finishes a moment later.
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
    moving.set(key, localKey)
    // Not JSON: nothing to keep, and nothing worth keeping the key for.
    if (value === undefined) { moved(key); return }
    const outcome = await writeIfAbsent(key, value)
    if (outcome === 'wrote') moved(key)
    // 'kept': removed when the store writes its merged list. 'failed': left for next time.
    if (outcome === 'failed') moving.delete(key)
  })().catch(() => undefined)
  return lastMove
}
