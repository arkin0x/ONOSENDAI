/**
 * workshopStorage.ts: where the workshop's shard list is kept, and the one
 * place that decides it.
 *
 * The list in the store (useWorkshop's `shards`) stays the source the app
 * reads, synchronously, as it always has. This module keeps it durable:
 *
 *   pending      at load, until hydrateWorkshop() has looked at IndexedDB.
 *                Changes are remembered and written once it has decided.
 *   indexeddb    the library lives in lib/workshopDb.ts, one record per shard.
 *                A change writes only the shards that changed, through one
 *                queue, one transaction at a time.
 *   local        IndexedDB is missing, or the move from localStorage did not
 *                verify: the whole list in localStorage, exactly as before.
 *   unavailable  the library was moved, but IndexedDB will not open this
 *                session: the copy localStorage kept from before the move is
 *                shown, and nothing is saved (a reload tries again).
 *
 * THE MOVE (once per browser). The localStorage list is copied into the
 * database in one transaction, read back in another and compared shard by
 * shard, JSON for JSON, and only when every one matches is the move marked
 * done (in the database, and with a small flag in localStorage). Anything
 * short of that, and the workshop runs on localStorage as it did, with
 * nothing said. The localStorage list is NEVER deleted or written again once
 * the move is marked: it is the backup, frozen. A later release may remove
 * it, when the owner says so.
 *
 * After the move the database is the library. If the localStorage list ever
 * changes after that (only an older build, still open in another tab, would
 * write it), the shards it holds that are newer than the database's are
 * carried in, at the next load (lib/workshopDb.ts mergeLocal).
 *
 * TRUTH about saving. saveNow() resolves true only once everything in the
 * list at the time of the call has committed where the library lives; false
 * when a write failed (QuotaExceededError when the disk share is used up),
 * and the change is still in hand, retried with the next one. Bulk import
 * publishes nothing that has not been saved (store/useShardImport.ts).
 *
 * TABS. Writes are per shard, so two tabs only ever overwrite each other on
 * the same shard. After each commit a BroadcastChannel names what changed and
 * every other tab reads those records back into its list.
 */

import { GRID_HALF, neededExtent, normalizeStored, type ShardModel } from 'sno-core/shards'
import {
  commit, fingerprint, localEntries, mergeLocal, noteReconciled, openWorkshopDb, readAll, readMigrated, readSome, verifyAndMark,
  type MigratedMeta, type ShardRecord,
} from '../lib/workshopDb'

/** The list as every build before this one kept it, and the backup from now on. */
export const LOCAL_KEY = 'onosendai:shards'
/** Set once the move has verified: at load, the backup is not read as the library. */
export const MOVED_KEY = 'onosendai:shards:moved'
export const CHANNEL = 'onosendai:shards'

export type ShardStorage = 'pending' | 'indexeddb' | 'local' | 'unavailable'

/** What the store gives this module: its list, a way to replace it, and where to say a save failed. */
export interface StorageHost {
  shards: () => ShardModel[]
  replace: (list: ShardModel[]) => void
  /** A save failed (a line to show), or saving works again (null). */
  report: (message: string | null) => void
  /** The shard on the bench, which another tab's delete does not take from under you. */
  protect: () => string | null
}

const FULL = 'Workshop storage is full. Your latest changes are only in this tab until there is room.'
const UNAVAILABLE = 'Your shards could not be opened from this browser\'s storage, so this is the copy kept before they moved, and changes are not saved. Reload to try again.'

let host: StorageHost | null = null
let mode: ShardStorage = 'pending'
let db: IDBDatabase | null = null
/** What the list held when it was last handed over, by id: the reference tells a changed shard from one left alone. */
let handed = new Map<string, ShardModel>()
/** Changes not yet committed: the model to write, or null to delete. */
const pending = new Map<string, ShardModel | null>()
/** Each shard's place in the list, as stored. */
const seqs = new Map<string, number>()
let nextSeq = 0
/** The short reason the last save failed, for bulk import's row; null when the last one worked. */
let failure: string | null = null
let skipped = 0
let persistAsked = false
let channel: BroadcastChannel | null = null
let hydrating: Promise<ShardStorage> | null = null
let decided: () => void = () => {}
const ready = new Promise<void>((resolve) => { decided = resolve })

/** Which storage the library is in now. */
export function storageMode(): ShardStorage { return mode }
/** Records in the database that could not be read at load, and were left as they are. */
export function skippedRecords(): number { return skipped }
/** Why the last save failed, short, for a list row; null when it worked. */
export function saveFailure(): string | null { return failure }

/** One stored shard, as the workshop has always read one; null when it is not one. */
export function normalizeOne(s: unknown): ShardModel | null {
  try {
    const x = s as ShardModel | null
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !Array.isArray(x.vertices)) return null
    const n = normalizeStored(x)
    return { ...n, extent: Number.isInteger(n.extent) ? n.extent : Math.max(GRID_HALF, neededExtent(n)) }
  } catch { return null }
}

function readLocalRaw(): string | null {
  try { return localStorage.getItem(LOCAL_KEY) } catch { return null }
}

/** The localStorage list, each shard on its own: one that cannot be read is one shard left out, not all of them. */
export function loadLocal(): ShardModel[] {
  const raw = readLocalRaw()
  if (!raw) return []
  let list: unknown
  try { list = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(list)) return []
  return list.map(normalizeOne).filter((s): s is ShardModel => s !== null)
}

function movedFlag(): boolean {
  try { return !!localStorage.getItem(MOVED_KEY) } catch { return false }
}

/**
 * The list the store starts with, and the storage it starts in. Without
 * IndexedDB at all, localStorage, decided now. Otherwise pending: the
 * localStorage list if it has not moved (what the move will carry), and
 * nothing if it has (the backup is not the library; the database is read
 * before the app draws, main.tsx).
 */
export function initialShards(): ShardModel[] {
  if (typeof indexedDB === 'undefined') {
    mode = 'local'
    decided()
    return loadLocal()
  }
  mode = 'pending'
  return movedFlag() ? [] : loadLocal()
}

/** Hand the store over; called once, right after it is made. */
export function attach(h: StorageHost): void {
  host = h
  handed = new Map(h.shards().map((s) => [s.id, s]))
}

/** Note what changed since the list was last handed over. */
function diff(list: readonly ShardModel[]): void {
  const next = new Map<string, ShardModel>()
  for (const s of list) {
    next.set(s.id, s)
    if (mode !== 'local' && handed.get(s.id) !== s) pending.set(s.id, s)
  }
  if (mode !== 'local') for (const id of handed.keys()) if (!next.has(id)) pending.set(id, null)
  handed = next
}

function report(message: string | null, reason: string | null): void {
  failure = reason
  host?.report(message)
}

function writeLocal(list: readonly ShardModel[]): boolean {
  // Only ever while localStorage is the library: once the move is marked, the
  // list there is the backup, and nothing writes it again.
  if (mode !== 'local') return false
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list))
    if (failure) report(null, null)
    return true
  } catch {
    report(FULL, 'Workshop storage is full')
    return false
  }
}

/**
 * The store's list changed: keep it. Returns at once; in IndexedDB the write
 * follows through the queue, and a failure is reported to the store.
 */
export function persist(list: readonly ShardModel[]): void {
  diff(list)
  if (mode === 'local') { writeLocal(list); return }
  if (mode === 'indexeddb') { void flush(); return }
  if (mode === 'unavailable') report(UNAVAILABLE, 'Workshop storage could not be opened')
}

/** Resolves true once the list as it is now has committed; false when it could not be. */
export async function saveNow(): Promise<boolean> {
  if (mode === 'pending') await ready
  if (!host) return false
  if (mode === 'local') return writeLocal(host.shards())
  diff(host.shards())
  if (mode === 'unavailable') { report(UNAVAILABLE, 'Workshop storage could not be opened'); return false }
  return flush()
}

/** The write queue: one commit at a time; a flush asked for while one waits to start rides with it. */
let chain: Promise<unknown> = Promise.resolve()
let queued: Promise<boolean> | null = null

function flush(): Promise<boolean> {
  if (queued) return queued
  const step = chain.then(() => { queued = null; return commitPending() })
  queued = step
  chain = step.catch(() => false)
  return step
}

function seqFor(id: string): number {
  let s = seqs.get(id)
  if (s === undefined) { s = nextSeq++; seqs.set(id, s) }
  return s
}

function describe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}

function isQuota(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

async function database(): Promise<IDBDatabase> {
  if (db) return db
  const d = await openWorkshopDb()
  watch(d)
  db = d
  return d
}

function watch(d: IDBDatabase): void {
  // A newer build upgrading the database in another tab: step aside, and
  // open again on the next write. A connection the browser closed: the same.
  d.onversionchange = () => { d.close(); if (db === d) db = null }
  d.onclose = () => { if (db === d) db = null }
}

async function commitPending(): Promise<boolean> {
  if (mode !== 'indexeddb') return false
  if (pending.size === 0) return true
  const batch = new Map(pending)
  const puts: ShardRecord[] = []
  const deletes: string[] = []
  try {
    for (const [id, m] of batch) {
      if (m) puts.push({ id, seq: seqFor(id), updatedAt: typeof m.updatedAt === 'number' && Number.isFinite(m.updatedAt) ? m.updatedAt : 0, json: JSON.stringify(m) })
      else deletes.push(id)
    }
    await commit(await database(), puts, deletes)
  } catch (e) {
    console.warn(`[workshop] could not save ${batch.size} shard change(s), kept to retry: ${describe(e)}`)
    if (isQuota(e)) report(FULL, 'Workshop storage is full')
    else report(`Your latest changes could not be saved (${describe(e)}). They are only in this tab for now.`, 'Workshop storage refused it')
    return false
  }
  // What changed again while this was writing stays for the next one.
  for (const [id, m] of batch) if (pending.get(id) === m) pending.delete(id)
  if (failure) report(null, null)
  askToPersist()
  announce(puts.map((r) => r.id), deletes)
  return true
}

/**
 * Ask the browser to keep this storage, once: a library of kit size is worth
 * not being evicted under disk pressure. A refusal changes nothing here, and
 * is not said: the workshop works the same either way.
 */
function askToPersist(): void {
  if (persistAsked) return
  persistAsked = true
  try {
    const sm = typeof navigator !== 'undefined' ? navigator.storage : undefined
    if (!sm || typeof sm.persist !== 'function') return
    void (async () => {
      try { if (!(await sm.persisted?.())) await sm.persist() } catch { /* refused: best effort only */ }
    })()
  } catch { /* no storage manager */ }
}

function announce(put: string[], del: string[]): void {
  if (!put.length && !del.length) return
  try { channel?.postMessage({ put, del }) } catch { /* closed */ }
}

function listen(): void {
  if (channel || typeof BroadcastChannel === 'undefined') return
  try {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { put?: unknown; del?: unknown } | null
      const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
      void refresh(ids(data?.put), ids(data?.del))
    }
  } catch { channel = null }
}

/** Another tab committed these: read them back into this tab's list, unless this tab has its own change to them in hand. */
async function refresh(put: string[], del: string[]): Promise<void> {
  if (mode !== 'indexeddb' || !host) return
  let records: Map<string, ShardRecord>
  try { records = await readSome(await database(), put) } catch (e) {
    console.warn(`[workshop] could not read another tab's change: ${describe(e)}`)
    return
  }
  if (mode !== 'indexeddb' || !host) return
  let list = host.shards().slice()
  let changed = false
  for (const id of put) {
    if (pending.has(id)) continue
    const r = records.get(id)
    if (!r) continue
    const m = parseRecord(r)
    if (!m) continue
    seqs.set(id, r.seq)
    nextSeq = Math.max(nextSeq, r.seq + 1)
    const at = list.findIndex((s) => s.id === id)
    if (at >= 0) list[at] = m
    else list.push(m)
    handed.set(id, m)
    changed = true
  }
  const keep = host.protect()
  for (const id of del) {
    if (pending.has(id) || id === keep || !list.some((s) => s.id === id)) continue
    list = list.filter((s) => s.id !== id)
    handed.delete(id)
    changed = true
  }
  if (changed) host.replace(list)
}

function parseRecord(r: ShardRecord): ShardModel | null {
  let raw: unknown
  try { raw = JSON.parse(r.json) } catch { return null }
  const m = normalizeOne(raw)
  return m && m.id === r.id ? m : null
}

/** The list now: what was stored, with this session's own changes made before the load answered on top. */
function withPending(stored: ShardModel[]): ShardModel[] {
  let list = stored.slice()
  for (const [id, m] of pending) {
    if (m === null) { list = list.filter((s) => s.id !== id); continue }
    const at = list.findIndex((s) => s.id === id)
    if (at >= 0) list[at] = m
    else list.push(m)
  }
  return list
}

function become(next: ShardStorage, list: ShardModel[]): void {
  mode = next
  handed = new Map(list.map((s) => [s.id, s]))
  host?.replace(list)
  decided()
}

/** No database this session. */
function withoutDatabase(why: unknown, moved: boolean): ShardStorage {
  if (moved) {
    // The library is in the database and the database is out of reach: show
    // the copy from before the move rather than an empty workshop, and save
    // nothing over anything.
    console.warn(`[workshop] IndexedDB unavailable after the move, saving is off this session: ${describe(why)}`)
    become('unavailable', withPending(loadLocal()))
    report(UNAVAILABLE, 'Workshop storage could not be opened')
    return mode
  }
  console.warn(`[workshop] staying on localStorage: ${describe(why)}`)
  const list = host?.shards() ?? []
  const changed = pending.size > 0
  pending.clear()
  become('local', list)
  // Whatever changed before this answered is written now, as it would have
  // been; with nothing changed, the list there is left exactly as it is.
  if (host && changed) writeLocal(list)
  return mode
}

function metaFor(raw: string | null, count: number): MigratedMeta {
  return { at: Date.now(), count, lsLength: raw?.length ?? 0, lsHash: raw === null ? 0 : fingerprint(raw) }
}

function flagMoved(): void {
  // A flag of a few bytes: it may not fit beside a full backup, and then the
  // next load reads the database's own mark instead (only slower).
  try { localStorage.setItem(MOVED_KEY, new Date().toISOString()) } catch { /* the database's mark is the record */ }
}

/** Carry the localStorage list in, verify it, mark it. True when the database is the library now. */
async function move(d: IDBDatabase, raw: string | null): Promise<boolean> {
  const entries = raw === null ? [] : localEntries(raw)
  // A list that does not parse is carried as nothing, and left in
  // localStorage exactly as it is: no build writes over it again.
  const { expected } = await mergeLocal(d, entries ?? [], false)
  const res = await verifyAndMark(d, expected, metaFor(raw, expected.size))
  if (res.result === 'mismatch') {
    console.warn(`[workshop] the move did not verify (${res.bad.length} of ${expected.size} differ: ${res.bad.slice(0, 5).join(', ')}); staying on localStorage`)
    return false
  }
  flagMoved()
  return true
}

/** After the move: shards an older build wrote to localStorage since, newer than the database's, carried in. */
async function rescue(d: IDBDatabase, raw: string, meta: MigratedMeta): Promise<void> {
  if (raw.length === meta.lsLength && fingerprint(raw) === meta.lsHash) return
  const entries = localEntries(raw)
  const { written } = entries ? await mergeLocal(d, entries, true) : { written: [] as string[] }
  if (written.length) console.warn(`[workshop] carried in ${written.length} shard(s) written to localStorage after the move`)
  await noteReconciled(d, { ...meta, lsLength: raw.length, lsHash: fingerprint(raw) })
  announce(written, [])
}

/**
 * Decide where the library is, and load it. Called once at startup, before
 * the app draws (main.tsx); a second call returns the first one's answer.
 */
export function hydrateWorkshop(): Promise<ShardStorage> {
  if (!hydrating) hydrating = mode === 'pending' ? decide() : Promise.resolve(mode)
  return hydrating
}

async function decide(): Promise<ShardStorage> {
  let d: IDBDatabase
  try { d = await database() } catch (e) { return withoutDatabase(e, movedFlag()) }
  let moved = false
  try {
    let meta = await readMigrated(d)
    moved = !!meta
    const raw = readLocalRaw()
    if (!meta) {
      let ok = false
      try { ok = await move(d, raw) } catch (e) { console.warn(`[workshop] the move failed: ${describe(e)}`) }
      // Another tab may have marked it while this one was carrying.
      meta = await readMigrated(d)
      if (!meta) return withoutDatabase(new Error(ok ? 'no mark after the move' : 'the move did not complete'), false)
      moved = true
    } else if (raw !== null) {
      try { await rescue(d, raw, meta) } catch (e) { console.warn(`[workshop] could not check localStorage for later shards: ${describe(e)}`) }
    }
    if (!movedFlag()) flagMoved()
    const { records, malformed } = await readAll(d)
    const stored: ShardModel[] = []
    skipped = malformed
    seqs.clear()
    nextSeq = 0
    for (const r of records) {
      nextSeq = Math.max(nextSeq, r.seq + 1)
      const m = parseRecord(r)
      // One record that does not read is one shard skipped, and left in the database as it is.
      if (!m) { skipped++; continue }
      seqs.set(r.id, r.seq)
      stored.push(m)
    }
    if (skipped) console.warn(`[workshop] ${skipped} stored shard(s) could not be read and were left as they are`)
    listen()
    become('indexeddb', withPending(stored))
    if (pending.size) void flush()
    return mode
  } catch (e) {
    return withoutDatabase(e, moved || movedFlag())
  }
}
