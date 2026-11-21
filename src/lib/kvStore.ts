/**
 * kvStore.ts: the records that used to live in localStorage, kept in
 * IndexedDB instead, read synchronously from memory as they always were.
 *
 * arkinox, 2026-11-19: "we want to preserve local indexdb data (and
 * localstorage but that should be moved into indexdb) for all users. key the
 * user's data by npub so when they login it still exists". And 2026-11-21:
 * "we really need to ship that localstorage migration so it gets migrated
 * into indexeddb". His phone's localStorage was full (4.9 million characters
 * over 77 keys): every write that grew a record was refused, and the biggest
 * records were the frozen backups of stores that had already moved.
 *
 * WHICH RECORDS. Those named by `movesToKv` (MOVED_KEYS, MOVED_PREFIXES): the
 * frozen backups (the workshop's shard list, the old shared hide list, the
 * chains' localStorage copies) and the other bulky or personal records. Each
 * keeps its exact name and its exact text, so a record per identity stays
 * keyed by that identity's pubkey as it was (`onosendai:mutes:<pubkey>`,
 * `onosendai:chain:<pubkey>`), and every reader parses what it always parsed.
 * Small switches for the device stay in localStorage (DEVICE_PREFS lists
 * them).
 *
 * THE MOVE, once per record, on every load until it is done (hydrateKv,
 * before the app is imported: main.tsx). For each record still in
 * localStorage: its text is written to the database with a fingerprint of it
 * (`seen`), in one transaction; read back in another and compared, character
 * for character; and only then removed from localStorage. One record at a
 * time, so a full localStorage frees space as it goes and never needs any to
 * move. Interrupted anywhere, the next load finds one of three things: the
 * record not yet written (copied again), written and still in localStorage
 * with the fingerprint written beside it (only removed: it was already
 * verified), or gone from localStorage (done). A record whose copy does not
 * read back the same stays in localStorage and is read from there.
 *
 * NEVER LOST. This build never writes these records to localStorage. One
 * found there that does not match its fingerprint was written since by a
 * build from before this one (a tab left open through the deploy): it is
 * newer, so it is moved in, and the copy it replaces is kept in `superseded`,
 * never deleted. The same for a write made while the database had not opened
 * yet and that lands over a record written meanwhile.
 *
 * READS prefer the database and fall back to localStorage: a record not in
 * the database is read from localStorage, so during the move, and on a
 * device where it failed, every reader finds what it found before.
 *
 * WRITES go to memory at once and to the database a moment later, many
 * records in one transaction, at once when the page is hidden. Other tabs
 * hear of it on a BroadcastChannel, read the records again, and get the
 * `storage` event they listened for before, so their listeners need no change.
 *
 * Without IndexedDB (or before hydrateKv, as in unit tests), it is
 * localStorage, exactly as before.
 */

import { openDatabase, request } from './idb'

export const KV_DB = 'onosendai:kv'
const KV_VERSION = 1
const ENTRIES = 'entries'
const SUPERSEDED = 'superseded'
const CHANNEL = 'onosendai:kv'

/** Records moved by their exact name. */
export const MOVED_KEYS: readonly string[] = [
  // The frozen backups: workshop (store/workshopStorage.ts), the shared hide list and its companions (store/hiddenStorage.ts), the pre-identity chain.
  'onosendai:shards',
  'onosendai:deployments',
  'onosendai:deployments-deleted',
  'onosendai:deployments-unclaimed',
  'onosendai:chain',
  // Found things already seen (store/useShards.ts), what was published (lib/published.ts), HOSAKA's region keys (lib/cloud.ts).
  'onosendai:seen',
  'onosendai:published',
  'onosendai:cloudRegionKeys',
  // Region keys: the old list (lib/secrets/db.ts), and the backstops (lib/secrets/backstop.ts).
  'onosendai:secrets',
  'onosendai:secrets:bought',
  'onosendai:secrets:refused',
  'onosendai:secrets:fallback',
]

/** Records moved by the start of their name: one per identity, or per bucket of hides. */
export const MOVED_PREFIXES: readonly string[] = [
  'onosendai:chain:',
  'onosendai:mutes:',
  'onosendai:deployments:',
  'onosendai:deployments-gone:',
  // The tutorial's staged pieces per player (tutorial/stage.ts): whole shards, a few hundred thousand characters.
  'onosendai:tutorial:stage:',
]

/**
 * What stays in localStorage: a device's small switches and marks, read
 * before anything else or by a tab of an older build, a few characters each.
 * Listed so the line is drawn on purpose; not exhaustive (the PR that
 * made this lists every record left in localStorage).
 */
export const DEVICE_PREFS: readonly string[] = [
  'onosendai:nsec', 'onosendai:mintedKey', 'onosendai:signer', 'onosendai:live', 'onosendai:moveMode',
  'onosendai:showSecrets', 'onosendai:showTrail', 'onosendai:chain-mark:', 'onosendai:chain-rows:',
  'onosendai:chain-unsaved:', 'onosendai:shards:moved', 'onosendai:calibration', 'onosendai:menu-open',
]

/** Whether this record lives in the database (when there is one). */
export function movesToKv(key: string): boolean {
  return MOVED_KEYS.includes(key) || MOVED_PREFIXES.some((p) => key.startsWith(p))
}

type Mode = 'pending' | 'idb' | 'local' | 'late'
let mode: Mode = 'pending'
let db: IDBDatabase | null = null
/** The database's records, as this tab knows them. */
const mirror = new Map<string, string>()
/** Fingerprints of the localStorage text each record was moved from. */
const seen = new Map<string, string>()
/** Records changed here and not yet written: the text, or null to delete. */
const dirty = new Map<string, string | null>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing: Promise<boolean> = Promise.resolve(true)
let channel: BroadcastChannel | null = null
/** What the last write to the database did: false when it failed (the changes stay in memory and go with the next). */
let lastFlushOk = true

/** Which store records are read from now: for tests and the diagnostics. */
export function kvMode(): Mode { return mode }

function ls(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

/** A short fingerprint of a text: its length and a 32-bit FNV-1a, enough to tell a record changed. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `${text.length}:${(h >>> 0).toString(36)}`
}

/** The record, from the database when it has it, else from localStorage. */
export function kvGet(key: string): string | null {
  if (mode === 'idb' || mode === 'late') {
    if (dirty.has(key)) return dirty.get(key) ?? null
    const v = mirror.get(key)
    if (v !== undefined) return v
    // Not moved (yet, or its copy did not verify): where it was.
  }
  try { return ls()?.getItem(key) ?? null } catch { return null }
}

/**
 * Keep the record. In localStorage mode it is localStorage's setItem, which
 * may throw as it always did; otherwise it never throws, and the write lands
 * a moment later (kvFlush).
 */
export function kvSet(key: string, value: string): void {
  if (mode === 'pending' || mode === 'local' || !movesToKv(key)) { ls()?.setItem(key, value); return }
  dirty.set(key, String(value))
  scheduleFlush()
}

/** Take the record away, from both stores. */
export function kvRemove(key: string): void {
  if (mode === 'idb' || mode === 'late') {
    if (movesToKv(key)) { dirty.set(key, null); scheduleFlush() }
  }
  try { ls()?.removeItem(key) } catch { /* private mode */ }
}

/** The names of the records starting with `prefix`, in either store. */
export function kvKeys(prefix: string): string[] {
  const out = new Set<string>()
  if (mode === 'idb' || mode === 'late') {
    for (const k of mirror.keys()) if (k.startsWith(prefix) && dirty.get(k) !== null) out.add(k)
    for (const [k, v] of dirty) if (k.startsWith(prefix) && v !== null) out.add(k)
  }
  const s = ls()
  if (s) {
    try {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i)
        if (k && k.startsWith(prefix) && !(mode === 'idb' && dirty.get(k) === null)) out.add(k)
      }
    } catch { /* private mode */ }
  }
  return [...out]
}

/** localStorage's shape, over these records: for the modules that are handed a Storage. */
export const kvStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: kvGet,
  setItem: kvSet,
  removeItem: kvRemove,
}

function scheduleFlush(): void {
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => { flushTimer = null; void kvFlush() }, FLUSH_AFTER_MS)
}
/** How long writes gather before they go to the database together. */
export const FLUSH_AFTER_MS = 100

/** Write what changed here, now. Resolves true once it is committed (or there was nothing to write). */
export function kvFlush(): Promise<boolean> {
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null }
  flushing = flushing.then(async () => {
    if (!db || mode !== 'idb' || dirty.size === 0) return lastFlushOk = dirty.size === 0 || mode !== 'idb'
    const batch = new Map(dirty)
    try {
      await writeBatch(db, batch, false)
      for (const [k, v] of batch) {
        if (dirty.get(k) === v) dirty.delete(k)
        if (v === null) mirror.delete(k)
        else mirror.set(k, v)
      }
      channel?.postMessage({ keys: [...batch.keys()] })
      return lastFlushOk = true
    } catch (err) {
      console.warn(`[kv] could not save ${batch.size} record(s), kept in this tab and tried again with the next change: ${err instanceof Error ? err.message : String(err)}`)
      return lastFlushOk = false
    }
  })
  return flushing
}

/** Whether the last write to the database landed. */
export function kvSaved(): boolean { return lastFlushOk }

/** One transaction: put or delete each record; with `keepOld`, what a put replaces is kept in `superseded` first. */
function writeBatch(d: IDBDatabase, batch: ReadonlyMap<string, string | null>, keepOld: boolean, seenOf?: ReadonlyMap<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction([ENTRIES, SUPERSEDED], 'readwrite')
    const entries = tx.objectStore(ENTRIES)
    const superseded = tx.objectStore(SUPERSEDED)
    for (const [key, value] of batch) {
      if (value === null) { entries.delete(key); continue }
      const put = (): void => { entries.put({ key, value, at: Date.now(), ...(seenOf?.has(key) ? { seen: seenOf.get(key) } : seen.has(key) ? { seen: seen.get(key) } : {}) }) }
      if (!keepOld) { put(); continue }
      const was = entries.get(key)
      was.onsuccess = () => {
        const old = was.result as { value?: string } | undefined
        if (old && typeof old.value === 'string' && old.value !== value) superseded.add({ key, value: old.value, at: Date.now() })
        put()
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

async function readOne(d: IDBDatabase, key: string): Promise<{ value: string; seen?: string } | undefined> {
  return await request(d.transaction(ENTRIES, 'readonly').objectStore(ENTRIES).get(key)) as { value: string; seen?: string } | undefined
}

/** The copies a newer record replaced (NEVER LOST): for recovery by hand, oldest first. */
export async function kvSuperseded(): Promise<Array<{ key: string; value: string; at: number }>> {
  if (!db) return []
  return await request(db.transaction(SUPERSEDED, 'readonly').objectStore(SUPERSEDED).getAll()) as Array<{ key: string; value: string; at: number }>
}

/**
 * Move one record out of localStorage (THE MOVE). Resolves to what happened:
 * `moved` (copied, verified, removed), `removed` (already verified on an
 * earlier load), `kept` (the copy did not verify, or could not be written:
 * it stays in localStorage and is read from there).
 */
export async function moveOne(d: IDBDatabase, key: string, text: string): Promise<'moved' | 'removed' | 'kept'> {
  const s = ls()
  const print = fingerprint(text)
  if (seen.get(key) === print) {
    // Verified on an earlier load, and the removal did not happen.
    try { s?.removeItem(key) } catch { return 'kept' }
    return 'removed'
  }
  if (seen.has(key)) console.warn(`[kv] ${key} was written to localStorage after it moved (a tab of an older build): it is the newer copy, and the one it replaces is kept`)
  try {
    await writeBatch(d, new Map([[key, text]]), true, new Map([[key, print]]))
    const back = await readOne(d, key)
    if (!back || back.value !== text || back.seen !== print) return 'kept'
  } catch (err) {
    console.warn(`[kv] ${key} stays in localStorage for now: ${err instanceof Error ? err.message : String(err)}`)
    return 'kept'
  }
  seen.set(key, print)
  mirror.set(key, text)
  try { s?.removeItem(key) } catch { /* verified: removed next load */ }
  return 'moved'
}

/** Every moving record still in localStorage, biggest first, so a full one frees the most soonest. */
function waitingInLocalStorage(): Array<[string, string]> {
  const s = ls()
  if (!s) return []
  const out: Array<[string, string]> = []
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (!k || !movesToKv(k)) continue
      const v = s.getItem(k)
      if (v !== null) out.push([k, v])
    }
  } catch { /* private mode */ }
  return out.sort((a, b) => b[1].length - a[1].length)
}

function openKv(): Promise<IDBDatabase> {
  // `superseded` numbers its own rows: one per replaced copy, never overwritten.
  return openDatabase(KV_DB, KV_VERSION, [[ENTRIES, 'key']], (tx) => {
    if (!tx.db.objectStoreNames.contains(SUPERSEDED)) tx.db.createObjectStore(SUPERSEDED, { autoIncrement: true })
  })
}

/** Read every record into memory. */
async function readAll(d: IDBDatabase): Promise<void> {
  const rows = await request(d.transaction(ENTRIES, 'readonly').objectStore(ENTRIES).getAll()) as Array<{ key: string; value: string; seen?: string }>
  for (const r of rows) {
    if (typeof r?.key !== 'string' || typeof r.value !== 'string') continue
    mirror.set(r.key, r.value)
    if (typeof r.seen === 'string') seen.set(r.key, r.seen)
  }
}

let hydrating: Promise<Mode> | null = null

/**
 * Open the database, read it, and move what is still in localStorage. Before
 * the app is imported (main.tsx), so every module that reads a record at
 * load finds it. Waits at most `waitMs`: past that the app loads reading
 * localStorage (`late`), and what is written meanwhile lands once the
 * database opens, the copies it replaces kept.
 */
export function hydrateKv(waitMs = HYDRATE_WAIT_MS): Promise<Mode> {
  if (hydrating) return hydrating
  if (typeof indexedDB === 'undefined') { mode = 'local'; return hydrating = Promise.resolve(mode) }
  const work = (async (): Promise<Mode> => {
    try {
      const d = await openKv()
      db = d
      await readAll(d)
      if (mode === 'late') {
        // The app is already running on localStorage: what it wrote meanwhile goes in now, over what was there, which is kept.
        const batch = new Map(dirty)
        if (batch.size > 0) await writeBatch(d, batch, true)
        for (const [k, v] of batch) { if (dirty.get(k) === v) dirty.delete(k); if (v === null) mirror.delete(k); else mirror.set(k, v) }
        mode = 'idb'
        listen()
        return mode
      }
      for (const [key, text] of waitingInLocalStorage()) await moveOne(d, key, text)
      mode = 'idb'
      listen()
      return mode
    } catch (err) {
      console.warn(`[kv] IndexedDB unavailable, records stay in localStorage: ${err instanceof Error ? err.message : String(err)}`)
      if (mode === 'late') {
        // What was written while waiting goes where it always went.
        for (const [k, v] of dirty) { try { if (v === null) ls()?.removeItem(k); else ls()?.setItem(k, v) } catch { /* quota: as localStorage always refused */ } }
        dirty.clear()
      }
      mode = 'local'
      return mode
    }
  })()
  hydrating = Promise.race([work, new Promise<Mode>((resolve) => setTimeout(() => {
    if (mode === 'pending') { mode = 'late'; console.warn('[kv] IndexedDB slow to open: reading localStorage until it does') }
    resolve(mode)
  }, waitMs))])
  return hydrating
}
/** How long the app waits for the database before it loads without it. */
export const HYDRATE_WAIT_MS = 5_000

function listen(): void {
  if (typeof window === 'undefined') return
  const flushNow = (): void => { void kvFlush() }
  try {
    window.addEventListener('pagehide', flushNow)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow() })
  } catch { /* no document */ }
  if (typeof BroadcastChannel === 'undefined') return
  try {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (e: MessageEvent<{ keys?: unknown }>) => {
      const keys = Array.isArray(e.data?.keys) ? e.data.keys.filter((k): k is string => typeof k === 'string') : []
      void heard(keys)
    }
  } catch { /* no channel: other tabs read it at their next load */ }
}

/** Another tab wrote these records: read them again, and tell this tab's listeners as localStorage would have. */
async function heard(keys: string[]): Promise<void> {
  if (!db) return
  for (const key of keys) {
    if (dirty.has(key)) continue
    const oldValue = mirror.get(key) ?? null
    const row = await readOne(db, key).catch(() => undefined)
    const newValue = row?.value ?? null
    if (newValue === null) mirror.delete(key)
    else mirror.set(key, newValue)
    if (oldValue === newValue) continue
    try { window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue })) } catch { /* no StorageEvent */ }
  }
}

/** Tests only: forget everything, back to localStorage, and close the database. */
export function resetKvForTests(): void {
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = null
  mode = 'pending'
  db?.close()
  db = null
  mirror.clear()
  seen.clear()
  dirty.clear()
  hydrating = null
  flushing = Promise.resolve(true)
  lastFlushOk = true
  channel?.close()
  channel = null
}
