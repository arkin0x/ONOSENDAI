/**
 * hiddenStorage.ts: where the record of what each identity hid is kept, and the
 * one place that decides it. Door secrets go through here too (doorSecrets.ts).
 *
 * Reads are synchronous, from memory, as they always were. hydrateHidden() runs
 * before the first draw (main.tsx), as the workshop's does.
 *
 *   indexeddb  lib/hiddenDb.ts, one record per row. A save writes only what changed.
 *   local      IndexedDB is missing, or failed a small probe (private mode), or the
 *              copy did not read back. The old list stays as it is, and each list
 *              keeps only what differs from it, under its own key.
 *
 * THE MOVE. The old list is onosendai:deployments, one list shared by every
 * identity, and onosendai:door-secrets. They are FROZEN: this build never writes
 * or deletes them. On every load, what they hold that the database does not is
 * added by id, in one transaction, and read back and compared before the database
 * is used. That one step is the first move, its resume after a crash, the same
 * move from a second tab, and the merge of what a stale tab of an older build
 * wrote since. A row here is never overwritten, and tombstones keep off what was
 * taken off here.
 *
 * TABS. Writes are per row, so nothing overwrites a whole list. After each commit a
 * BroadcastChannel names what changed and other tabs read those records back.
 */

import type { MyDeployment } from './useShards'
import { addMissing, commit, HIDDEN_DB, openHiddenDb, probe, readClosed, readEverything, readSome, type Change, type ClosedRecord, type RowRecord, type SecretRecord } from '../lib/hiddenDb'

export const BARE_KEY = 'onosendai:deployments'
const DELETED_KEY = 'onosendai:deployments-deleted'
export const SECRETS_KEY = 'onosendai:door-secrets'
export const ONLY_SAID_KEY = 'onosendai:door-secrets-only-said'
/**
 * The doors closed with CLOSE, in localStorage: the store in local mode, and a copy
 * otherwise (store/closedDoors.ts), so a session that falls back to local mode still
 * finds them closed. Added to the database on every load, never over a record there.
 */
export const CLOSED_KEY = 'onosendai:doors-closed'
/** Rows whose record does not prove who placed them, or that cannot be shown: kept, listed for nobody. */
export const UNCLAIMED = 'unclaimed'
const UNCLAIMED_KEY = 'onosendai:deployments-unclaimed'
const CHANNEL = 'onosendai:hidden'

export type HiddenStorage = 'pending' | 'indexeddb' | 'local'
export const localKey = (bucket: string): string => (bucket === UNCLAIMED ? UNCLAIMED_KEY : `${BARE_KEY}:${bucket}`)
const goneKey = (bucket: string): string => `onosendai:deployments-gone:${bucket}`

/** A sealed object counts as placed by its signer: a ruling, not a proof (hidden.ts fromReference allows another's). A LIVE LINK proves nothing. */
function isSealedRef(d: MyDeployment): boolean {
  return d.inner?.kind === 33331 && !!d.inner.tags?.some((t) => t[0] === 'encrypted') && d.eventId === d.inner.id
}

/** Who placed a row, as far as its record says: a whole inner event, or a sealed object. */
export function provenOwner(d: MyDeployment | null | undefined): string | null {
  const pubkey = d?.eventId && (!d.ref || isSealedRef(d)) ? d.inner?.pubkey : null
  return pubkey && /^[0-9a-f]{64}$/.test(pubkey) ? pubkey : null
}

/** What a list shows. */
export function isListed(d: MyDeployment | null | undefined): d is MyDeployment {
  return !!d && !!d.eventId && !!d.inner && !!(d.shard || d.text || d.key || d.chest || d.audio)
}

export const rowKey = (d: MyDeployment | null | undefined): string => d?.eventId ?? JSON.stringify(d)

interface Entry { key: string; seq: number; json: string; row: MyDeployment | null }

let mode: HiddenStorage = 'local'
let buckets: Map<string, Map<string, Entry>> | null = null
let secrets: Record<string, Record<string, SecretRecord>> = {}
let closed: Record<string, Record<string, ClosedRecord>> = {}
/** Bumped on every change heard or decided, for a component that reads synchronously (useSyncExternalStore). */
let version = 0
let dirty = new Map<string, Change>()
let chain: Promise<boolean> = Promise.resolve(true)
let db: IDBDatabase | null = null
let channel: BroadcastChannel | null = null
let ready: Promise<HiddenStorage> | null = null
/** The look at the database took too long, and this session went on without it. */
let expired = false
const DECIDE_TIMEOUT_MS = 15_000
const COMMIT_TIMEOUT_MS = 10_000
const listeners = new Set<() => void>()
/** The JSON each row object was stored as, so a save knows what did not change without serializing it. */
const storedAs = new WeakMap<object, string>()

export function storageMode(): HiddenStorage { return mode }
export function onHiddenChange(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn) }
export function hiddenVersion(): number { return version }
function changed(): void { version++; for (const fn of listeners) fn() }

function parsed(json: string): MyDeployment | null {
  try { return JSON.parse(json) as MyDeployment } catch { return null }
}

function readArray(key: string): MyDeployment[] {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

function deletedIds(): Set<unknown> {
  try { return new Set(JSON.parse(localStorage.getItem(DELETED_KEY) ?? '[]') as unknown[]) } catch { return new Set() }
}

/** Where a row of the old list belongs. */
function bareBucket(d: MyDeployment, deleted: Set<unknown>): string {
  const owner = isListed(d) && !deleted.has(d.eventId) ? provenOwner(d) : null
  return owner ?? UNCLAIMED
}

function localBuckets(): string[] {
  const out = new Set<string>()
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? ''
      if (k === UNCLAIMED_KEY) out.add(UNCLAIMED)
      else if (k.startsWith(`${BARE_KEY}:`)) out.add(k.slice(BARE_KEY.length + 1))
      else if (k.startsWith('onosendai:deployments-gone:')) out.add(k.slice('onosendai:deployments-gone:'.length))
    }
  } catch { /* a storage that cannot list holds nothing to overlay */ }
  return [...out]
}

function bucketOf(name: string): Map<string, Entry> {
  const all = (buckets ??= localView())
  let b = all.get(name)
  if (!b) all.set(name, b = new Map())
  return b
}

/** What localStorage says: the frozen list, each row where it belongs, with each list's own changes over it. */
function localView(): Map<string, Map<string, Entry>> {
  const view = new Map<string, Map<string, Entry>>()
  const at = (name: string): Map<string, Entry> => { let b = view.get(name); if (!b) view.set(name, b = new Map()); return b }
  const deleted = deletedIds()
  readArray(BARE_KEY).forEach((d, i) => {
    const key = rowKey(d)
    at(bareBucket(d, deleted)).set(key, { key, seq: i, json: JSON.stringify(d), row: d })
  })
  for (const name of localBuckets()) {
    const b = at(name)
    for (const k of readArray(goneKey(name)) as unknown as string[]) b.delete(k)
    let last = Math.max(0, ...[...b.values()].map((e) => e.seq))
    for (const d of readArray(localKey(name))) {
      const key = rowKey(d)
      b.set(key, { key, seq: b.get(key)?.seq ?? ++last, json: JSON.stringify(d), row: d })
    }
  }
  return view
}

/** A bucket's rows, in order, each as stored. A row that did not parse is null: kept, listed by nobody. */
export function entriesIn(name: string): Array<{ row: MyDeployment | null; json: string }> {
  return [...bucketOf(name).values()].sort((a, b) => a.seq - b.seq || (a.key < b.key ? -1 : 1))
}

/** Say this row object is what this JSON was read as, so saving it unchanged writes nothing. */
export function noteStored(row: MyDeployment, json: string): void { storedAs.set(row, json) }

function seqFor(rows: readonly MyDeployment[], i: number, b: Map<string, Entry>): number {
  const prev = i > 0 ? b.get(rowKey(rows[i - 1]))?.seq : undefined
  let next: number | undefined
  for (let j = i + 1; j < rows.length && next === undefined; j++) next = b.get(rowKey(rows[j]))?.seq
  if (prev !== undefined && next !== undefined && next > prev) return (prev + next) / 2
  if (prev !== undefined) return Math.max(prev, ...[...b.values()].map((e) => e.seq)) + 1
  return next !== undefined ? next - 1 : 1
}

/**
 * Make a list what `rows` says. Only what differs is written. Resolves true once
 * that is committed; false leaves the change in hand, tried again with the next
 * save. `keep` is what stays although the list leaves it out: rows never listed.
 */
export function saveRows(name: string, rows: readonly MyDeployment[], stored: (d: MyDeployment) => string, keep: (d: MyDeployment | null) => boolean): Promise<boolean> {
  const b = bucketOf(name)
  const present = new Set<string>()
  let any = false
  rows.forEach((row, i) => {
    const key = rowKey(row)
    present.add(key)
    let json = storedAs.get(row)
    if (json === undefined) { json = stored(row); storedAs.set(row, json) }
    const e = b.get(key)
    if (e?.json === json) { e.row = row; return }
    const seq = e?.seq ?? seqFor(rows, i, b)
    b.set(key, { key, seq, json, row })
    dirty.set(`r\0${name}\0${key}`, { put: { bucket: name, key, seq, json } })
    any = true
  })
  for (const e of [...b.values()]) {
    if (present.has(e.key) || keep(e.row)) continue
    b.delete(e.key)
    dirty.set(`r\0${name}\0${e.key}`, { del: { bucket: name, key: e.key } })
    any = true
  }
  if (!any && dirty.size === 0) return Promise.resolve(true)
  return afterDecided(() => (mode === 'indexeddb' ? flush() : Promise.resolve(writeLocal())))
}

/** The rows that differ from the frozen list, and the frozen rows taken off: enough to rebuild each list, and small. */
function writeLocal(): boolean {
  const names = new Set([...dirty.values()].map((c) => ('put' in c ? c.put.bucket : 'del' in c ? c.del.bucket : '')).filter(Boolean))
  dirty = new Map([...dirty].filter(([, c]) => 'secret' in c || 'closed' in c || 'unclosed' in c))
  const deleted = deletedIds()
  const bare = new Map<string, { name: string; json: string }>()
  for (const d of readArray(BARE_KEY)) bare.set(rowKey(d), { name: bareBucket(d, deleted), json: JSON.stringify(d) })
  let ok = true
  for (const name of names) {
    const b = bucketOf(name)
    const own = [...b.values()].sort((x, y) => x.seq - y.seq).filter((e) => bare.get(e.key)?.json !== e.json || bare.get(e.key)?.name !== name).map((e) => e.row)
    const gone = [...bare].filter(([k, v]) => v.name === name && !b.has(k)).map(([k]) => k)
    try {
      localStorage.setItem(localKey(name), JSON.stringify(own))
      localStorage.setItem(goneKey(name), JSON.stringify(gone))
    } catch { ok = false }
  }
  return ok
}

function afterDecided(then: () => Promise<boolean>): Promise<boolean> {
  return mode === 'pending' && ready ? ready.then(then, then) : then()
}

function flush(): Promise<boolean> {
  const run = (): Promise<boolean> => commitDirty()
  chain = chain.then(run, run)
  return chain
}

/** A database that never answers is a failed write: the batch stays in hand, and the save says so. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('IndexedDB did not answer in time')), ms) })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

async function commitDirty(): Promise<boolean> {
  if (dirty.size === 0) return true
  const batch = dirty
  dirty = new Map()
  try {
    const d = db ?? (db = await openHiddenDb())
    await withTimeout(commit(d, [...batch.values()]), COMMIT_TIMEOUT_MS)
    announce(batch)
    return true
  } catch {
    // Still in hand, unless something newer is, and tried again with the next save.
    db = null
    for (const [k, c] of batch) if (!dirty.has(k)) dirty.set(k, c)
    return false
  }
}

function announce(batch: Map<string, Change>): void {
  const rows: Array<[string, string]> = []
  const said: Array<[string, string]> = []
  const shut: Array<[string, string]> = []
  for (const c of batch.values()) {
    if ('put' in c) rows.push([c.put.bucket, c.put.key])
    else if ('del' in c) rows.push([c.del.bucket, c.del.key])
    else if ('closed' in c) shut.push([c.closed.owner, c.closed.doorId])
    else if ('unclosed' in c) shut.push([c.unclosed.owner, c.unclosed.doorId])
    else said.push([c.secret.owner, c.secret.doorId])
  }
  try { channel?.postMessage({ rows, secrets: said, closed: shut }) } catch { /* a closed channel: the next load reads it */ }
}

function listen(): void {
  if (channel || typeof BroadcastChannel === 'undefined') return
  try {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (e: MessageEvent<{ rows: Array<[string, string]>; secrets: Array<[string, string]>; closed?: Array<[string, string]> }>) => { void heard(e.data) }
  } catch { channel = null }
}

async function heard(m: { rows: Array<[string, string]>; secrets: Array<[string, string]>; closed?: Array<[string, string]> }): Promise<void> {
  try {
    const d = db ?? (db = await openHiddenDb())
    const got = await readSome(d, m.rows, m.secrets, m.closed ?? [])
    m.rows.forEach(([name, key], i) => {
      if (dirty.has(`r\0${name}\0${key}`)) return
      const rec = got.rows[i]
      if (rec) bucketOf(name).set(key, { key, seq: rec.seq, json: rec.json, row: parsed(rec.json) })
      else bucketOf(name).delete(key)
    })
    for (const rec of got.secrets) if (rec) (secrets[rec.owner] ??= {})[rec.doorId] = rec
    ;(m.closed ?? []).forEach(([owner, doorId], i) => {
      if (dirty.has(`c\0${owner}\0${doorId}`)) return
      const rec = got.closed[i]
      if (rec) (closed[owner] ??= {})[doorId] = rec
      else if (closed[owner]) delete closed[owner][doorId]
    })
    changed()
  } catch { /* the next load reads it */ }
}

// -- door secrets ------------------------------------------------------------

/** A secret known in the database, whichever mode this session is in; doorSecrets.ts keeps its own in local mode. */
export function secretRecord(owner: string, doorId: string): SecretRecord | undefined { return secrets[owner]?.[doorId] }

/** Keep a secret in the database. Resolves true once committed on disk. */
export function putSecret(rec: SecretRecord): Promise<boolean> {
  (secrets[rec.owner] ??= {})[rec.doorId] = rec
  dirty.set(`s\0${rec.owner}\0${rec.doorId}`, { secret: rec })
  return flush()
}

// -- doors closed with CLOSE (store/closedDoors.ts) -----------------------------

/** This identity's closed doors as the database holds them, by door id. */
export function closedOf(owner: string): Readonly<Record<string, ClosedRecord>> { return closed[owner] ?? {} }

/** Keep a closed door's record, one record, in the database. Resolves true once committed on disk. */
export function putClosed(rec: ClosedRecord): Promise<boolean> {
  (closed[rec.owner] ??= {})[rec.doorId] = rec
  dirty.set(`c\0${rec.owner}\0${rec.doorId}`, { closed: rec })
  return flush()
}

/** Take a closed door's record off, that one record. Resolves true once committed. */
export function dropClosed(owner: string, doorId: string): Promise<boolean> {
  if (closed[owner]) delete closed[owner][doorId]
  dirty.set(`c\0${owner}\0${doorId}`, { unclosed: { owner, doorId } })
  return flush()
}

/**
 * Read this identity's closed doors from the database again, as another tab may have
 * written them since: before deciding to open a door again (store/rooms reopenRoom).
 * What this session has not committed yet stays as it is here.
 */
export async function refreshClosed(owner: string): Promise<void> {
  if (mode !== 'indexeddb') return
  try {
    const d = db ?? (db = await openHiddenDb())
    const recs = await readClosed(d, owner)
    const mine: Record<string, ClosedRecord> = {}
    for (const r of recs) mine[r.doorId] = r
    for (const [k, c] of dirty) {
      if (!k.startsWith(`c\0${owner}\0`)) continue
      if ('closed' in c) mine[c.closed.doorId] = c.closed
      else if ('unclosed' in c) delete mine[c.unclosed.doorId]
    }
    closed[owner] = mine
  } catch { /* the database did not answer: what is in memory stands */ }
}

/** Until the database has been looked at, whether it will be used is not known. */
export function hiddenDecided(): Promise<HiddenStorage> { return ready ?? Promise.resolve(mode) }

// -- the decision ------------------------------------------------------------

function askToPersist(): void {
  try {
    const sm = (navigator as Navigator & { storage?: StorageManager }).storage
    if (!sm?.persist) return
    void (async () => { try { if (!(await sm.persisted?.())) await sm.persist() } catch { /* refused: best effort only */ } })()
  } catch { /* no navigator */ }
}

/** The frozen values and each list's own changes, as records to add. Read fresh on every load: a stale tab may have written since. */
/**
 * The closed doors kept in localStorage (CLOSED_KEY), as records: `{ owner: { door id:
 * { lock, room, shut, below } } }`, or an older `{ owner: ["<door id>:<lock>"] }`, each
 * entry closed with its doors below still to close. Unreadable is none.
 */
export function closedFromLocalStorage(): ClosedRecord[] {
  const out: ClosedRecord[] = []
  try {
    const raw = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '{}') as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
    for (const [owner, doors] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(doors)) {
        for (const e of doors) {
          if (typeof e !== 'string') continue
          const [doorId, lock] = e.split(':')
          if (doorId && lock) out.push({ owner, doorId, lock, room: '', shut: true, below: true })
        }
      } else if (doors && typeof doors === 'object') {
        for (const [doorId, v] of Object.entries(doors as Record<string, unknown>)) {
          const r = v as Partial<ClosedRecord> | null
          if (!r || typeof r.lock !== 'string') continue
          out.push({ owner, doorId, lock: r.lock, room: typeof r.room === 'string' ? r.room : '', ...(r.shut ? { shut: true as const } : {}), ...(r.below ? { below: true as const } : {}) })
        }
      }
    }
  } catch { /* unreadable: none */ }
  return out
}

function fromLocalStorage(): { rows: Array<{ record: RowRecord; alsoGoneFrom?: string }>; secrets: SecretRecord[]; gone: Array<{ bucket: string; key: string }> } {
  const rows: Array<{ record: RowRecord; alsoGoneFrom?: string }> = []
  const gone: Array<{ bucket: string; key: string }> = []
  const deleted = deletedIds()
  readArray(BARE_KEY).forEach((d, i) => {
    const bucket = bareBucket(d, deleted)
    const owner = provenOwner(d)
    rows.push({ record: { bucket, key: rowKey(d), seq: i, json: JSON.stringify(d) }, ...(owner && owner !== bucket ? { alsoGoneFrom: owner } : {}) })
  })
  let seq = readArray(BARE_KEY).length
  for (const name of localBuckets()) {
    for (const k of readArray(goneKey(name)) as unknown as string[]) gone.push({ bucket: name, key: k })
    for (const d of readArray(localKey(name))) rows.push({ record: { bucket: name, key: rowKey(d), seq: seq++, json: JSON.stringify(d) } })
  }
  const out: SecretRecord[] = []
  try {
    const all = JSON.parse(localStorage.getItem(SECRETS_KEY) ?? '{}') as Record<string, Record<string, string>>
    const said = JSON.parse(localStorage.getItem(ONLY_SAID_KEY) ?? '{}') as Record<string, Record<string, true>>
    for (const [owner, doors] of Object.entries(all ?? {})) {
      for (const [doorId, secret] of Object.entries(doors ?? {})) {
        if (typeof secret === 'string') out.push({ owner, doorId, secret, ...(said?.[owner]?.[doorId] ? { onlySaid: true as const } : {}) })
      }
    }
  } catch { /* unreadable stays frozen where it is */ }
  return { rows, secrets: out, gone }
}

async function decide(): Promise<HiddenStorage> {
  if (typeof indexedDB === 'undefined') return 'local'
  let d: IDBDatabase
  try {
    d = await openHiddenDb()
    await probe(d)
  } catch { return 'local' }
  try {
    askToPersist()
    const from = fromLocalStorage()
    const added = await addMissing(d, from.rows, from.secrets, from.gone, closedFromLocalStorage())
    const all = await readEverything(d)
    // Read back and compared, byte for byte, before anything is read from here.
    const held = new Map(all.rows.map((r) => [`${r.bucket}\0${r.key}`, r.json]))
    const heldSecrets = new Map(all.secrets.map((r) => [`${r.owner}\0${r.doorId}`, r.secret]))
    for (const r of added.rows) if (held.get(`${r.bucket}\0${r.key}`) !== r.json) throw new Error('a row did not read back')
    for (const r of added.secrets) if (heldSecrets.get(`${r.owner}\0${r.doorId}`) !== r.secret) throw new Error('a door secret did not read back')
    const heldClosed = new Set(all.closed.map((r) => `${r.owner}\0${r.doorId}`))
    for (const r of added.closed) if (!heldClosed.has(`${r.owner}\0${r.doorId}`)) throw new Error('a closed door did not read back')
    // Read back: what local mode took off is tombstoned now, so its list need not replay.
    for (const name of localBuckets()) { try { localStorage.removeItem(goneKey(name)) } catch { /* the next load tries again */ } }
    if (expired) { d.close(); return 'local' }
    const view = new Map<string, Map<string, Entry>>()
    for (const r of all.rows) {
      let b = view.get(r.bucket)
      if (!b) view.set(r.bucket, b = new Map())
      b.set(r.key, { key: r.key, seq: r.seq, json: r.json, row: parsed(r.json) })
    }
    secrets = {}
    for (const s of all.secrets) (secrets[s.owner] ??= {})[s.doorId] = s
    closed = {}
    for (const c of all.closed) (closed[c.owner] ??= {})[c.doorId] = c
    // What the session changed while this was deciding goes on top, and is written next.
    for (const c of dirty.values()) {
      if ('put' in c) { let b = view.get(c.put.bucket); if (!b) view.set(c.put.bucket, b = new Map()); b.set(c.put.key, { key: c.put.key, seq: c.put.seq, json: c.put.json, row: parsed(c.put.json) }) }
      else if ('del' in c) view.get(c.del.bucket)?.delete(c.del.key)
      else if ('closed' in c) (closed[c.closed.owner] ??= {})[c.closed.doorId] = c.closed
      else if ('unclosed' in c) delete closed[c.unclosed.owner]?.[c.unclosed.doorId]
      else (secrets[c.secret.owner] ??= {})[c.secret.doorId] = c.secret
    }
    buckets = view
    db = d
    listen()
    return 'indexeddb'
  } catch {
    d.close()
    return 'local'
  }
}

/** Before the first draw. Never rejects: anything short of a verified database leaves the session on localStorage. */
export function hydrateHidden(): Promise<HiddenStorage> {
  if (ready) return ready
  mode = 'pending'
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<HiddenStorage>((resolve) => { timer = setTimeout(() => { expired = true; resolve('local') }, DECIDE_TIMEOUT_MS) })
  ready = Promise.race([decide().catch((): HiddenStorage => 'local'), late]).then(async (m) => {
    clearTimeout(timer)
    mode = m
    changed()
    if (dirty.size > 0) { if (m === 'indexeddb') await flush(); else writeLocal() }
    return m
  })
  return ready
}

/** localStorage changed in another tab, in local mode: read it again. */
export function reloadLocalView(): void {
  if (mode !== 'local') return
  buckets = null
  changed()
}

export { HIDDEN_DB }

/** For tests: this page gone, as a reload leaves it. Nothing on disk is touched. */
export function resetHiddenForTests(): void {
  try { channel?.close() } catch { /* already closed */ }
  try { db?.close() } catch { /* already closed */ }
  channel = null; db = null; ready = null; expired = false; buckets = null; secrets = {}; closed = {}; dirty = new Map(); mode = 'local'; chain = Promise.resolve(true)
  listeners.clear()
}
