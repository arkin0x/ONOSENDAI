/**
 * workshopDb.ts: where the workshop's shards are kept, in IndexedDB.
 *
 * Why not localStorage any more: the workshop kept every shard as one JSON
 * array under one key, and localStorage holds about 5 MB per origin. A maze
 * kit is 191 pieces, some of them 93 KB, so a library of kit size no longer
 * fits, and once the list is over the cap EVERY later save fails, not only
 * the one that crossed it (arkinox, 2026-10-23: "Workshop storage is full").
 * IndexedDB's quota is a share of the disk.
 *
 * One record per shard, keyed by its id: a save writes only the shards that
 * changed. Each record holds the shard as the same JSON string localStorage
 * held, so what is read back is byte for byte what was written (migration
 * verifies exactly that) and a record that does not parse is one shard
 * skipped, never the library.
 *
 *   shards      { id, seq, updatedAt, json }   seq keeps the list's order
 *   tombstones  { id, at }                     when a shard was deleted here
 *   meta        { key, value }                 'migrated': when, how many, and
 *                                              a fingerprint of the localStorage
 *                                              copy it came from
 *
 * A tombstone is what lets a later merge from localStorage (lib comments at
 * mergeLocal) tell a shard deleted here from one this database never had.
 *
 * Nothing here knows about zustand; store/workshopStorage.ts owns when to
 * read and write. Nothing here ever deletes a record except commit(), which
 * deletes exactly the ids it is handed.
 */

import { getMeta, openDatabase, request, META_STORE } from './idb'

export const WORKSHOP_DB = 'onosendai:workshop'
export const DB_VERSION = 1
export const SHARDS_STORE = 'shards'
export const TOMBSTONES_STORE = 'tombstones'
export const MIGRATED_KEY = 'migrated'

/** How long opening may take before the workshop decides without it. */
export const OPEN_TIMEOUT_MS = 8000

/** One shard as stored. */
export interface ShardRecord {
  id: string
  /** Position in the list: the order shards were made in, which is the order localStorage kept. */
  seq: number
  /** The shard's own updatedAt (0 when it has none), beside the JSON so a merge can compare without parsing. */
  updatedAt: number
  /** The shard, exactly as localStorage held it: JSON.stringify of the model. */
  json: string
}

export interface MigratedMeta {
  at: number
  count: number
  /** Length and FNV-1a of the localStorage list this database was last reconciled with. */
  lsLength: number
  lsHash: number
}

/** Readwrite transactions for shards ask for strict durability: committed means on disk, not in a cache. */
const STRICT = { durability: 'strict' } as IDBTransactionOptions

export function openWorkshopDb(timeoutMs: number = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  const opening = openDatabase(WORKSHOP_DB, DB_VERSION, [[SHARDS_STORE, 'id'], [TOMBSTONES_STORE, 'id'], [META_STORE, 'key']])
  // As the folders and the held items do: a blocked upgrade or a browser that
  // never answers must not hold the app, and a connection that arrives late
  // is closed so it does not block the next open.
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error('IndexedDB did not open in time')) }, timeoutMs)
  })
  opening.then((db) => { if (timedOut) db.close() }, () => { /* the race reports it */ })
  return Promise.race([opening, timeout]).finally(() => clearTimeout(timer))
}

/** FNV-1a over UTF-16 code units: a fingerprint of the localStorage list, to notice it changed. Not a security hash. */
export function fingerprint(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export async function readMigrated(db: IDBDatabase): Promise<MigratedMeta | null> {
  const v = await getMeta(db, MIGRATED_KEY) as MigratedMeta | undefined
  return v && typeof v === 'object' && typeof v.at === 'number' ? v : null
}

/** Every record, in seq order (ties by id). A record without an id string or a json string is left out here and counted. */
export async function readAll(db: IDBDatabase): Promise<{ records: ShardRecord[]; malformed: number }> {
  const os = db.transaction(SHARDS_STORE, 'readonly').objectStore(SHARDS_STORE)
  const rows = await request(os.getAll()) as unknown[]
  const records: ShardRecord[] = []
  let malformed = 0
  for (const r of rows) {
    if (isRecord(r)) records.push(r)
    else malformed++
  }
  records.sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { records, malformed }
}

/** The records for these ids that exist and are well formed. */
export async function readSome(db: IDBDatabase, ids: readonly string[]): Promise<Map<string, ShardRecord>> {
  const os = db.transaction(SHARDS_STORE, 'readonly').objectStore(SHARDS_STORE)
  const out = new Map<string, ShardRecord>()
  await Promise.all(ids.map(async (id) => {
    const r = await request(os.get(id)) as unknown
    if (isRecord(r)) out.set(id, r)
  }))
  return out
}

function isRecord(r: unknown): r is ShardRecord {
  const x = r as ShardRecord | null
  return !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.json === 'string'
    && typeof x.seq === 'number' && Number.isFinite(x.seq) && typeof x.updatedAt === 'number'
}

/**
 * Write these records and delete these ids, in ONE transaction: all of it
 * lands or none of it does. A delete leaves a tombstone; a put clears one.
 * Rejects with the transaction's error (QuotaExceededError when the disk
 * share is used up), never swallows it.
 */
export function commit(db: IDBDatabase, puts: readonly ShardRecord[], deletes: readonly string[], now: number = Date.now()): Promise<void> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    try { tx = db.transaction([SHARDS_STORE, TOMBSTONES_STORE], 'readwrite', STRICT) } catch (e) { reject(e); return }
    const shards = tx.objectStore(SHARDS_STORE)
    const tombs = tx.objectStore(TOMBSTONES_STORE)
    try {
      for (const r of puts) { shards.put(r); tombs.delete(r.id) }
      for (const id of deletes) { shards.delete(id); tombs.put({ id, at: now }) }
    } catch (e) { try { tx.abort() } catch { /* already over */ } reject(e); return }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/** One shard as localStorage held it, ready to merge. */
export interface LocalEntry { id: string; updatedAt: number; json: string; index: number }

/**
 * The entries of the localStorage list worth carrying: everything with an id
 * string, each as the JSON it is. Where an id appears twice (no build should
 * write that, but the list is not ours to judge) the newer by updatedAt is
 * carried, the later on a tie; the other stays in the localStorage copy,
 * which is never touched. Null when the text is not a JSON array.
 */
export function localEntries(raw: string): LocalEntry[] | null {
  let list: unknown
  try { list = JSON.parse(raw) } catch { return null }
  if (!Array.isArray(list)) return null
  const byId = new Map<string, LocalEntry>()
  list.forEach((s: unknown, index) => {
    const x = s as { id?: unknown; updatedAt?: unknown } | null
    if (!x || typeof x !== 'object' || typeof x.id !== 'string') return
    const updatedAt = typeof x.updatedAt === 'number' && Number.isFinite(x.updatedAt) ? x.updatedAt : 0
    const had = byId.get(x.id)
    if (had && had.updatedAt > updatedAt) return
    byId.set(x.id, { id: x.id, updatedAt, json: JSON.stringify(s), index })
  })
  return [...byId.values()]
}

/**
 * Carry localStorage's shards into the database, in ONE readwrite
 * transaction, and say what each id should now read back as.
 *
 * The rule, per id, is the newer by updatedAt. Before the move is marked
 * (`moved` false) a tie goes to localStorage, which is the library of record
 * until then; anything already here is a copy an earlier attempt left. Once
 * moved, the database is the library and a tie stays as it is: this is then
 * the rescue of a shard an older build, still open in another tab, wrote to
 * localStorage after the move. An entry no newer than this database's
 * tombstone for it was deleted here since, and is not brought back. Nothing
 * is ever deleted.
 *
 * Returns the JSON each carried id is expected to hold afterwards (the
 * winner, whichever side it was), and which ids were written.
 */
export function mergeLocal(db: IDBDatabase, entries: readonly LocalEntry[], moved: boolean): Promise<{ expected: Map<string, string>; written: string[] }> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    try { tx = db.transaction([SHARDS_STORE, TOMBSTONES_STORE, META_STORE], 'readwrite', STRICT) } catch (e) { reject(e); return }
    const shards = tx.objectStore(SHARDS_STORE)
    const tombs = tx.objectStore(TOMBSTONES_STORE)
    const expected = new Map<string, string>()
    const written: string[] = []
    const allShards = shards.getAll()
    const allTombs = tombs.getAll()
    // Requests in one transaction answer in the order they were made: both reads are in when the second answers.
    allTombs.onsuccess = () => {
      const have = new Map<string, ShardRecord>()
      // seq for a shard new to the database: after everything already here, in the localStorage order.
      let base = 0
      for (const r of allShards.result as unknown[]) if (isRecord(r)) { have.set(r.id, r); base = Math.max(base, r.seq + 1) }
      const deletedAt = new Map<string, number>()
      for (const t of allTombs.result as Array<{ id?: unknown; at?: unknown }>) {
        if (t && typeof t.id === 'string' && typeof t.at === 'number') deletedAt.set(t.id, t.at)
      }
      for (const e of entries) {
        const h = have.get(e.id)
        if (h) {
          const takeLocal = e.updatedAt > h.updatedAt || (!moved && e.updatedAt === h.updatedAt && e.json !== h.json)
          if (!takeLocal) { expected.set(e.id, h.json); continue }
          shards.put({ id: e.id, seq: h.seq, updatedAt: e.updatedAt, json: e.json } satisfies ShardRecord)
        } else {
          const at = deletedAt.get(e.id)
          // Deleted here after this version was written: the delete stands.
          if (moved && at !== undefined && e.updatedAt <= at) continue
          shards.put({ id: e.id, seq: base + e.index, updatedAt: e.updatedAt, json: e.json } satisfies ShardRecord)
          if (at !== undefined) tombs.delete(e.id)
        }
        written.push(e.id)
        expected.set(e.id, e.json)
      }
    }
    tx.oncomplete = () => resolve({ expected, written })
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/**
 * Read every expected id back, in a readwrite transaction so nothing else can
 * write in between, and mark the move done only when every one is there and
 * holds exactly the expected JSON. 'already' when another tab marked it
 * first (the library is then this database, whatever this tab carried);
 * 'mismatch' with what differed when any id is missing or different, and
 * then nothing is marked.
 */
export function verifyAndMark(db: IDBDatabase, expected: ReadonlyMap<string, string>, meta: MigratedMeta): Promise<{ result: 'marked' | 'already' } | { result: 'mismatch'; bad: string[] }> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    try { tx = db.transaction([SHARDS_STORE, META_STORE], 'readwrite', STRICT) } catch (e) { reject(e); return }
    const shards = tx.objectStore(SHARDS_STORE)
    const metas = tx.objectStore(META_STORE)
    let out: { result: 'marked' | 'already' } | { result: 'mismatch'; bad: string[] } = { result: 'mismatch', bad: [] }
    const mark = metas.get(MIGRATED_KEY)
    mark.onsuccess = () => {
      const had = mark.result as { value?: MigratedMeta } | undefined
      if (had?.value && typeof had.value.at === 'number') { out = { result: 'already' }; return }
      const all = shards.getAll()
      all.onsuccess = () => {
        const got = new Map<string, string>()
        for (const r of all.result as unknown[]) if (isRecord(r)) got.set(r.id, r.json)
        const bad = [...expected].filter(([id, json]) => got.get(id) !== json).map(([id]) => id)
        if (bad.length) { out = { result: 'mismatch', bad }; return }
        metas.put({ key: MIGRATED_KEY, value: meta })
        out = { result: 'marked' }
      }
    }
    tx.oncomplete = () => resolve(out)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB verify failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB verify aborted'))
  })
}

/** Record that the database now agrees with this localStorage text (after a rescue). */
export function noteReconciled(db: IDBDatabase, meta: MigratedMeta): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite')
    tx.objectStore(META_STORE).put({ key: MIGRATED_KEY, value: meta })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}
