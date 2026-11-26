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
 * move. Precisely: written as `pending` (never taken for the record), read
 * back and compared, then made the record with its fingerprint and read back
 * again, and only then removed from localStorage. Any row not `pending` is
 * the record, whether it was moved or written here since. Interrupted anywhere, the next load finds one of three things: the
 * record not yet written (copied again), written and still in localStorage
 * with the fingerprint written beside it (only removed: it was already
 * verified), or gone from localStorage (done). A record whose copy does not
 * read back the same stays in localStorage and is read from there.
 *
 * NEVER LOST, NEVER WRITTEN OVER. This build never writes a moved record to
 * localStorage. One found there beside the database's copy and not matching
 * its fingerprint was written since by a build from before this one (a tab
 * left open through the deploy), which read localStorage empty and wrote
 * what it had: the database's copy stays, and that text is kept in
 * `superseded`, never deleted. A record whose copy did not verify stays in
 * localStorage and is read and written there (`stayed`), so its two copies
 * never part.
 *
 * A DATABASE THAT DOES NOT OPEN. Before anything moved (no MOVED_MARK), the
 * page runs on localStorage as before, and the move waits for the next load.
 * After (the mark is set before the first record is written), some records
 * are only in the database, so a session without it must not start from
 * nothing and save that over them: it runs `blind`, on localStorage, and
 * what it writes there is found by the next load beside the stored copy and
 * kept aside (NEVER LOST), never written over it.
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
 * localStorage, exactly as before. The region key backstops
 * (lib/secrets/backstop.ts) stay in localStorage on purpose: they are the
 * copy kept for when IndexedDB fails.
 */

import { openDatabase, request } from './idb'

export const KV_DB = 'onosendai:kv'
const KV_VERSION = 1
const ENTRIES = 'entries'
const SUPERSEDED = 'superseded'
const CHANNEL = 'onosendai:kv'
/** Set in localStorage before the first record leaves it: from then on some records are only in the database. */
export const MOVED_MARK = 'onosendai:kv:moved'

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
  // The old region key list, only ever read since the keys moved to their own database (lib/secrets/db.ts).
  'onosendai:secrets',
]

/** Records moved by the start of their name: one per identity, or per bucket of hides. */
export const MOVED_PREFIXES: readonly string[] = [
  'onosendai:chain:',
  'onosendai:mutes:',
  'onosendai:deployments:',
  'onosendai:deployments-gone:',
  // The tutorial's staged pieces per player (tutorial/stage.ts): whole shards, a few hundred thousand characters.
  'onosendai:tutorial:stage:',
  // The tutorial's progress per player (tutorial/gate.ts): the step, how it ended, the routes checked off.
  'onosendai:tutorial:progress:',
  // The tutorial's TERRAIN route per player (tutorial/terrainRoute.ts): the build step done this route.
  'onosendai:tutorial:terrain-built:',
  // The newcomer view's record per player (newcomer/useNewcomer.ts): stage, steps seen, Settings choice.
  'onosendai:newcomer:',
  // Settings > Effects > Sound effects per player (store/sfxSwitch.ts): on or off.
  'onosendai:sfx:',
  // The MODES list per player (store/modeOrder.ts): the pad's modes in order, and the ones switched off.
  'onosendai:modes:',
  // The top-left chips put away or on show per player (store/chipsFold.ts).
  'onosendai:chips-folded:',
  // The finds NEARBY counts new (the orange +N) per player (store/nearbyNew.ts).
  'onosendai:nearby-new:',
]

/**
 * What stays in localStorage on purpose: the region key backstops (the copy
 * for when IndexedDB fails), and a device's small switches and marks, read
 * before anything else or by a tab of an older build, a few characters each.
 * Not exhaustive: the PR that made this lists every record left there.
 */
export const STAYS_IN_LOCAL_STORAGE: readonly string[] = [
  'onosendai:secrets:bought', 'onosendai:secrets:refused', 'onosendai:secrets:fallback',
  'onosendai:nsec', 'onosendai:mintedKey', 'onosendai:signer', 'onosendai:live', 'onosendai:live:', 'onosendai:live-moved', 'onosendai:outbound:', 'onosendai:moveMode',
  'onosendai:showSecrets', 'onosendai:showTrail', 'onosendai:chain-mark:', 'onosendai:chain-rows:',
  'onosendai:chain-unsaved:', 'onosendai:shards:moved', 'onosendai:calibration', 'onosendai:menu-open', MOVED_MARK,
]

/** Whether this record lives in the database (when there is one). */
export function movesToKv(key: string): boolean {
  return MOVED_KEYS.includes(key) || MOVED_PREFIXES.some((p) => key.startsWith(p))
}

type Mode = 'pending' | 'idb' | 'local' | 'blind'
let mode: Mode = 'pending'
let db: IDBDatabase | null = null
/** The database's records, as this tab knows them. */
const mirror = new Map<string, string>()
/** Fingerprints of the localStorage text each record was moved from. */
const seen = new Map<string, string>()
/** Records whose copy did not verify: they stay in localStorage, read and written there. */
const stayed = new Set<string>()
/** Records changed here and not yet written: the text, or null to delete. */
const dirty = new Map<string, string | null>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing: Promise<boolean> = Promise.resolve(true)
let channel: BroadcastChannel | null = null
/** What the last write to the database did: false when it failed (the changes stay in memory and are tried again). */
let lastFlushOk = true
let retryMs = 0

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

/** Whether this record is kept by this module now, rather than in localStorage. */
function heldHere(key: string): boolean {
  return mode === 'idb' && movesToKv(key) && !stayed.has(key)
}

/** The record, from the database when it has it, else from localStorage. */
export function kvGet(key: string): string | null {
  if (heldHere(key)) {
    if (dirty.has(key)) return dirty.get(key) ?? null
    const v = mirror.get(key)
    if (v !== undefined) return v
    // Not in the database: where it was, if anywhere.
  }
  try { return ls()?.getItem(key) ?? null } catch { return null }
}

/**
 * Keep the record. Where localStorage keeps it (before the move, without a
 * database, a record whose copy did not verify) it is localStorage's
 * setItem, which may throw as it always did; otherwise it never throws, and
 * the write lands a moment later (kvFlush).
 */
export function kvSet(key: string, value: string): void {
  if (!heldHere(key)) { ls()?.setItem(key, value); return }
  dirty.set(key, String(value))
  scheduleFlush()
}

/** Take the record away, from both stores. */
export function kvRemove(key: string): void {
  if (heldHere(key)) { dirty.set(key, null); scheduleFlush() }
  try { ls()?.removeItem(key) } catch { /* private mode */ }
}

/** The names of the records starting with `prefix`, in either store. */
export function kvKeys(prefix: string): string[] {
  const out = new Set<string>()
  if (mode === 'idb' || mode === 'blind') {
    for (const k of mirror.keys()) if (k.startsWith(prefix) && dirty.get(k) !== null) out.add(k)
    for (const [k, v] of dirty) if (k.startsWith(prefix) && v !== null) out.add(k)
  }
  const s = ls()
  if (s) {
    try {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i)
        if (k && k.startsWith(prefix) && !(heldHere(k) && dirty.get(k) === null)) out.add(k)
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

function scheduleFlush(delay = FLUSH_AFTER_MS): void {
  if (mode !== 'idb' || flushTimer !== null) return
  flushTimer = setTimeout(() => { flushTimer = null; void kvFlush() }, delay)
}
/** How long writes gather before they go to the database together. */
export const FLUSH_AFTER_MS = 100
/** The longest a failed write waits before it is tried again. */
export const RETRY_MAX_MS = 30_000

/**
 * Write what changed here, now. Resolves true once it is committed (or there
 * was nothing to write). A failure keeps the changes and tries again, with a
 * fresh connection when the old one was closed under it, waiting longer each
 * time up to RETRY_MAX_MS.
 */
export function kvFlush(): Promise<boolean> {
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null }
  flushing = flushing.then(async () => {
    if (mode !== 'idb') return lastFlushOk = mode !== 'blind' || dirty.size === 0
    if (dirty.size === 0) return lastFlushOk = true
    const batch = new Map(dirty)
    try {
      const d = db ?? (db = watch(await withTimeout(openKv(), REOPEN_WAIT_MS)))
      await writeBatch(d, batch)
      for (const [k, v] of batch) {
        if (dirty.get(k) === v) dirty.delete(k)
        seen.delete(k)
        if (v === null) mirror.delete(k)
        else mirror.set(k, v)
      }
      channel?.postMessage({ keys: [...batch.keys()] })
      retryMs = 0
      return lastFlushOk = true
    } catch (err) {
      console.warn(`[kv] could not save ${batch.size} record(s); kept in this tab and tried again: ${err instanceof Error ? err.message : String(err)}`)
      try { db?.close() } catch { /* already closed */ }
      db = null
      retryMs = Math.min(RETRY_MAX_MS, retryMs ? retryMs * 2 : 1000)
      scheduleFlush(retryMs)
      return lastFlushOk = false
    }
  })
  return flushing
}

/** How long a fresh connection for a retried write may take before the write counts as failed (and is retried later). */
export const REOPEN_WAIT_MS = 5_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('IndexedDB did not open in time')), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e: unknown) => { clearTimeout(t); reject(e) })
  })
}

/** Whether the last write to the database landed. */
export function kvSaved(): boolean { return lastFlushOk }

/** A connection that forgets itself when the browser closes it or another tab upgrades the database. */
function watch(d: IDBDatabase): IDBDatabase {
  d.onclose = () => { if (db === d) db = null }
  d.onversionchange = () => { d.close(); if (db === d) db = null }
  return d
}

/** One transaction: put or delete each record. `seenOf` gives the fingerprint to keep beside a put; otherwise the one already known. */
function writeBatch(d: IDBDatabase, batch: ReadonlyMap<string, string | null>, seenOf?: ReadonlyMap<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction([ENTRIES], 'readwrite')
    const entries = tx.objectStore(ENTRIES)
    for (const [key, value] of batch) {
      if (value === null) { entries.delete(key); continue }
      // Without the fingerprint: it names the text a record was moved from, and this is another.
      const print = seenOf?.get(key)
      entries.put({ key, value, at: Date.now(), ...(print !== undefined ? { seen: print } : {}) })
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/** Keep a text set aside (NEVER LOST): one row per copy, never overwritten. Resolves once committed. */
function keepAside(d: IDBDatabase, key: string, value: string, why: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction([SUPERSEDED], 'readwrite')
    tx.objectStore(SUPERSEDED).add({ key, value, at: Date.now(), why })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

async function readOne(d: IDBDatabase, key: string): Promise<{ value: string; seen?: string; pending?: boolean } | undefined> {
  return await request(d.transaction(ENTRIES, 'readonly').objectStore(ENTRIES).get(key)) as { value: string; seen?: string; pending?: boolean } | undefined
}

/** The copies set aside (NEVER LOST): for recovery by hand, oldest first. */
export async function kvSuperseded(): Promise<Array<{ key: string; value: string; at: number; why: string }>> {
  if (!db) return []
  return await request(db.transaction(SUPERSEDED, 'readonly').objectStore(SUPERSEDED).getAll()) as Array<{ key: string; value: string; at: number; why: string }>
}

/**
 * Every copy of a record this database holds, for recovery by hand (the
 * workshop's RECOVER SHARDS, store/workshopStorage.ts recoverShards): the
 * record, a copy still `pending` its check, and each copy set aside, in that
 * order. Read straight from the database, whatever mode this page is in, so
 * a page that started blind still finds them. Rejects when the database does
 * not open or answer within `waitMs`.
 */
export async function kvCopiesOf(key: string, waitMs = REOPEN_WAIT_MS): Promise<string[]> {
  if (typeof indexedDB === 'undefined') return []
  const own = db === null
  let d: IDBDatabase
  if (db) d = db
  else {
    const opening = openKv()
    try { d = await withTimeout(opening, waitMs) } catch (e) {
      // A connection that opens after the wait is closed, never left to block an upgrade.
      opening.then((late) => late.close(), () => undefined)
      throw e
    }
  }
  try {
    const read = async (): Promise<string[]> => {
      const tx = d.transaction([ENTRIES, SUPERSEDED], 'readonly')
      const row = await request(tx.objectStore(ENTRIES).get(key)) as { value?: unknown } | undefined
      const aside = await request(tx.objectStore(SUPERSEDED).getAll()) as Array<{ key?: unknown; value?: unknown }>
      const out: string[] = []
      if (typeof row?.value === 'string') out.push(row.value)
      for (const r of aside) if (r?.key === key && typeof r.value === 'string') out.push(r.value)
      return out
    }
    return await withTimeout(read(), waitMs)
  } finally {
    if (own) { try { d.close() } catch { /* closed */ } }
  }
}

/** Mark that records have left localStorage (MOVED_MARK). True once it is there. */
function markMoved(): boolean {
  const s = ls()
  try { if (s?.getItem(MOVED_MARK)) return true } catch { return false }
  try { s?.setItem(MOVED_MARK, '1'); return true } catch { return false }
}

/**
 * Move one record out of localStorage (THE MOVE). Resolves to what happened:
 * `moved` (copied, verified, removed), `removed` (the database already holds
 * it: verified on an earlier load, or newer than an older build's text,
 * which is set aside first), `kept` (the copy did not verify or could not be
 * written: it stays in localStorage, read and written there).
 */
export async function moveOne(d: IDBDatabase, key: string, text: string): Promise<'moved' | 'removed' | 'kept'> {
  const s = ls()
  const print = fingerprint(text)
  const remove = (): void => {
    // The mark is set before any record is written (hydrateKv); again here, in case that write found no room. Full: the removal makes it.
    const marked = markMoved()
    try { s?.removeItem(key) } catch { /* verified: removed next load */ }
    if (!marked) markMoved()
  }
  // The database's record (any row not `pending`): moved and verified, or written there since.
  let replacing: string | undefined
  if (mirror.has(key)) {
    const stored = mirror.get(key)!
    if (seen.get(key) === print && stored !== text) {
      // Fingerprinted from this very text, yet holding another: a copy damaged after it was checked (a later write drops the fingerprint). The text is the record; the damaged copy is set aside.
      try { await keepAside(d, key, stored, 'did not match the text it was moved from') } catch { return 'kept' }
      replacing = stored
      mirror.delete(key)
      seen.delete(key)
    } else {
      if (seen.get(key) !== print) {
        // Not the text it was moved from: written to localStorage after the move, by a build or a visit that read it empty. The stored record stays, and this text is set aside.
        console.warn(`[kv] ${key} was written to localStorage after it moved: the stored copy stays, and that text is kept aside`)
        // Not set aside now: both copies stay and the stored one is read; the next load tries again.
        try { await keepAside(d, key, text, 'written to localStorage after the move') } catch { return 'kept' }
      }
      remove()
      return 'removed'
    }
  }
  try {
    // 1. Written as `pending`, never taken for the record, unless another tab moved it since this one read the database.
    const outcome = await putPending(d, key, text, replacing)
    if (outcome === 'taken') {
      const row = await readOne(d, key)
      if (row && !row.pending) { mirror.set(key, row.value); if (typeof row.seen === 'string') seen.set(key, row.seen); return moveOne(d, key, text) }
      stayed.add(key)
      return 'kept'
    }
    // 2. Read back and compared.
    const back = await readOne(d, key)
    if (!back || back.value !== text || !back.pending) {
      await dropIf(d, key, (r) => r.pending === true)
      stayed.add(key)
      return 'kept'
    }
    // 3. Made the record, with its fingerprint, and read back again before localStorage lets go of it.
    await finalize(d, key, text, print)
    const done = await readOne(d, key)
    if (!done || done.value !== text || done.seen !== print || done.pending) {
      await dropIf(d, key, (r) => r.seen === print && r.value !== text)
      stayed.add(key)
      return 'kept'
    }
  } catch (err) {
    console.warn(`[kv] ${key} stays in localStorage for now: ${err instanceof Error ? err.message : String(err)}`)
    await dropIf(d, key, (r) => r.pending === true).catch(() => undefined)
    stayed.add(key)
    return 'kept'
  }
  seen.set(key, print)
  mirror.set(key, text)
  remove()
  return 'moved'
}

type Row = { key: string; value: string; seen?: string; pending?: boolean }

/** One transaction: run `body` on the row as it is now. */
function withRow<T>(d: IDBDatabase, key: string, body: (row: Row | undefined, entries: IDBObjectStore) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction([ENTRIES], 'readwrite')
    const entries = tx.objectStore(ENTRIES)
    let out: T
    const was = entries.get(key)
    was.onsuccess = () => { out = body(was.result as Row | undefined, entries) }
    tx.oncomplete = () => resolve(out)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/** Write a record being moved as `pending`; `taken` when a record (a row not pending) is there already, other than the damaged copy being replaced. */
function putPending(d: IDBDatabase, key: string, text: string, replacing?: string): Promise<'written' | 'taken'> {
  return withRow(d, key, (row, entries) => {
    // A damaged copy being replaced (moveOne) is written over only if it is still that copy.
    if (row && !row.pending && !(replacing !== undefined && row.value === replacing)) return 'taken'
    entries.put({ key, value: text, pending: true, at: Date.now() })
    return 'written'
  })
}

/** The pending row, verified, becomes the record with its fingerprint: only if it is still that pending row. */
function finalize(d: IDBDatabase, key: string, text: string, print: string): Promise<void> {
  return withRow(d, key, (row, entries) => {
    if (!row || !row.pending || row.value !== text) throw new Error('the copy changed before it was verified')
    entries.put({ key, value: text, seen: print, at: Date.now() })
  })
}

/** Delete the row only if it is still the one `which` names: never another tab's record. */
function dropIf(d: IDBDatabase, key: string, which: (row: Row) => boolean): Promise<void> {
  return withRow(d, key, (row, entries) => { if (row && which(row)) entries.delete(key) })
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
  // `superseded` numbers its own rows: one per copy set aside, never overwritten.
  return openDatabase(KV_DB, KV_VERSION, [[ENTRIES, 'key']], (tx) => {
    if (!tx.db.objectStoreNames.contains(SUPERSEDED)) tx.db.createObjectStore(SUPERSEDED, { autoIncrement: true })
  })
}

/** Read every record into memory. */
async function readAll(d: IDBDatabase): Promise<void> {
  const rows = await request(d.transaction(ENTRIES, 'readonly').objectStore(ENTRIES).getAll()) as Array<{ key: string; value: string; seen?: string; pending?: boolean }>
  for (const r of rows) {
    // A move not yet verified is not the record: localStorage still holds it, and it is moved again.
    if (typeof r?.key !== 'string' || typeof r.value !== 'string' || r.pending) continue
    mirror.set(r.key, r.value)
    if (typeof r.seen === 'string') seen.set(r.key, r.seen)
  }
}

function hasMoved(): boolean {
  try { return !!ls()?.getItem(MOVED_MARK) } catch { return false }
}

/** The mode a page takes when the database is missing, failed or slow: localStorage before anything moved, `blind` after. */
function withoutDatabase(why: string): Mode {
  if (hasMoved()) {
    console.warn(`[kv] ${why}: records already moved there are not read this session, and nothing is saved over them; reload to try again`)
    return 'blind'
  }
  return 'local'
}

let hydrating: Promise<Mode> | null = null

/**
 * Open the database, read it, and move what is still in localStorage. Before
 * the app is imported (main.tsx), so every module that reads a record at
 * load finds it. The open waits at most `waitMs`; past that the page goes on
 * without it (withoutDatabase), and a database that opens later is closed and
 * left for the next load. Once open, the reading and the move run to the end
 * before the app loads: a page must never start on half of one store.
 */
export function hydrateKv(waitMs = HYDRATE_WAIT_MS): Promise<Mode> {
  if (hydrating) return hydrating
  if (typeof indexedDB === 'undefined') { mode = withoutDatabase('IndexedDB is missing'); return hydrating = Promise.resolve(mode) }
  hydrating = new Promise<Mode>((resolve) => {
    let gaveUp = false
    const timer = setTimeout(() => {
      gaveUp = true
      mode = withoutDatabase('IndexedDB is slow to open')
      resolve(mode)
    }, waitMs)
    void openKv().then(async (d) => {
      if (gaveUp) { d.close(); return }
      clearTimeout(timer)
      try {
        await readAll(d)
      } catch (err) {
        // Unread, the database cannot be the store: nothing may start from an empty copy of it.
        d.close()
        mode = withoutDatabase(`IndexedDB could not be read (${err instanceof Error ? err.message : String(err)})`)
        resolve(mode)
        return
      }
      try {
        const waiting = waitingInLocalStorage()
        // Before the first write: a load that finds the database slow must know a record may be only there now.
        if (waiting.length > 0) markMoved()
        for (const [key, text] of waiting) await moveOne(d, key, text)
      } catch (err) {
        console.warn(`[kv] the move stopped and resumes next load: ${err instanceof Error ? err.message : String(err)}`)
      }
      db = watch(d)
      mode = 'idb'
      listen()
      resolve(mode)
    }, (err: unknown) => {
      if (gaveUp) return
      clearTimeout(timer)
      mode = withoutDatabase(`IndexedDB did not open (${err instanceof Error ? err.message : String(err)})`)
      resolve(mode)
    })
  })
  return hydrating
}
/** How long the app waits for the database before it loads without it. */
export const HYDRATE_WAIT_MS = 8_000

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
      // Not while hidden: a hidden tab may be frozen mid-read, and its open
      // read would hold the records from the tab writing them. Read once shown.
      if (hiddenTab()) { for (const k of keys) heardWhileHidden.add(k); return }
      void heard(keys)
    }
    document.addEventListener('visibilitychange', () => {
      if (hiddenTab() || heardWhileHidden.size === 0) return
      const keys = [...heardWhileHidden]
      heardWhileHidden.clear()
      void heard(keys)
    })
  } catch { /* no channel: other tabs read it at their next load */ }
}

/** Records other tabs wrote while this one was hidden. */
const heardWhileHidden = new Set<string>()
function hiddenTab(): boolean {
  try { return typeof document !== 'undefined' && document.visibilityState === 'hidden' } catch { return false }
}

/** Another tab wrote these records: read them again, and tell this tab's listeners as localStorage would have. */
async function heard(keys: string[]): Promise<void> {
  if (!db) return
  for (const key of keys) {
    if (dirty.has(key)) continue
    const oldValue = mirror.get(key) ?? null
    const row = await readOne(db, key).catch(() => undefined)
    const newValue = row && !row.pending ? row.value : null
    if (row?.pending) continue
    if (newValue === null) mirror.delete(key)
    else mirror.set(key, newValue)
    if (typeof row?.seen === 'string') seen.set(key, row.seen)
    else seen.delete(key)
    if (oldValue === newValue) continue
    try { window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue })) } catch { /* no StorageEvent */ }
  }
}

/** Tests only: forget everything, back to localStorage, and close the database. */
export function resetKvForTests(): void {
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = null
  mode = 'pending'
  try { db?.close() } catch { /* closed */ }
  db = null
  mirror.clear()
  seen.clear()
  stayed.clear()
  dirty.clear()
  hydrating = null
  flushing = Promise.resolve(true)
  lastFlushOk = true
  retryMs = 0
  channel?.close()
  channel = null
}
