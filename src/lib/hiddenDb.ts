/**
 * hiddenDb.ts: the record of what each identity hid, and its door secrets, in
 * IndexedDB. Separate from `onosendai:events` and from the chain.
 *
 * One record per row, so a save never rewrites the whole list. A row keeps the
 * JSON it was stored as, so one that does not parse is one row kept and not
 * listed, never the list.
 *
 *   rows        { bucket, key, seq, json }   bucket: a pubkey, or `unclaimed`
 *   tombstones  { bucket, key, at }          taken off this list here, so a later
 *                                            merge from localStorage leaves it off
 *   secrets     { owner, doorId, secret, onlySaid }
 *   meta        { key, value }
 *
 * Nothing here knows about zustand; store/hiddenStorage.ts decides when to read
 * and write.
 */

import { META_STORE, openDatabase, request } from './idb'

export const HIDDEN_DB = 'onosendai:hidden'
const DB_VERSION = 1
const ROWS = 'rows'
const TOMBSTONES = 'tombstones'
const SECRETS = 'secrets'
const OPEN_TIMEOUT_MS = 8000
/** Committed means on disk, not in a cache: a door's secret waits on this before the door goes out. */
const STRICT = { durability: 'strict' } as IDBTransactionOptions

export interface RowRecord { bucket: string; key: string; seq: number; json: string }
export interface SecretRecord { owner: string; doorId: string; secret: string; onlySaid?: true }
export type Change =
  | { put: RowRecord }
  | { del: { bucket: string; key: string } }
  | { secret: SecretRecord }

export function openHiddenDb(timeoutMs: number = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  const opening = openDatabase(HIDDEN_DB, DB_VERSION, [[ROWS, ['bucket', 'key']], [TOMBSTONES, ['bucket', 'key']], [SECRETS, ['owner', 'doorId']], [META_STORE, 'key']])
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error('IndexedDB did not open in time')) }, timeoutMs)
  })
  opening.then((db) => { if (timedOut) db.close() }, () => { /* the race reports it */ })
  return Promise.race([opening, timeout]).finally(() => clearTimeout(timer))
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write was aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
  })
}

/** A small write, read back and removed: private modes that open a database and then refuse to keep anything fail here. */
export async function probe(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(META_STORE, 'readwrite')
  const finished = done(tx)
  const os = tx.objectStore(META_STORE)
  os.put({ key: 'probe', value: 1 })
  const back = await request(os.get('probe')) as { value?: number } | undefined
  if (back?.value !== 1) throw new Error('IndexedDB did not keep a small write')
  os.delete('probe')
  await finished
}

/** Everything, for the read before the first draw. */
export async function readEverything(db: IDBDatabase): Promise<{ rows: RowRecord[]; secrets: SecretRecord[] }> {
  const tx = db.transaction([ROWS, SECRETS], 'readonly')
  const [rows, secrets] = await Promise.all([request(tx.objectStore(ROWS).getAll()), request(tx.objectStore(SECRETS).getAll())])
  return { rows: rows as RowRecord[], secrets: secrets as SecretRecord[] }
}

/**
 * Add what localStorage holds and this database does not, by id, in one
 * transaction: a crash leaves all of it or none, and running it again, from
 * another tab too, changes nothing. A row here is never overwritten, and a row
 * taken off here does not come back. `alsoGoneFrom` is the list a row deleted since
 * was on, and `gone` what local mode took off. Resolves with what it added.
 */
export async function addMissing(db: IDBDatabase, rows: Array<{ record: RowRecord; alsoGoneFrom?: string }>, secrets: SecretRecord[], gone: Array<{ bucket: string; key: string }>): Promise<{ rows: RowRecord[]; secrets: SecretRecord[] }> {
  const added: { rows: RowRecord[]; secrets: SecretRecord[] } = { rows: [], secrets: [] }
  const tx = db.transaction([ROWS, TOMBSTONES, SECRETS], 'readwrite', STRICT)
  const finished = done(tx)
  const r = tx.objectStore(ROWS)
  const t = tx.objectStore(TOMBSTONES)
  const s = tx.objectStore(SECRETS)
  for (const g of gone) { t.put({ ...g, at: Date.now() }); r.delete([g.bucket, g.key]) }
  await Promise.all([
    ...rows.map(async ({ record, alsoGoneFrom }) => {
      const key = [record.bucket, record.key]
      const [here, off, offThere] = await Promise.all([
        request(r.get(key)), request(t.get(key)),
        alsoGoneFrom ? request(t.get([alsoGoneFrom, record.key])) : Promise.resolve(undefined),
      ])
      if (here === undefined && off === undefined && offThere === undefined) { r.put(record); added.rows.push(record) }
    }),
    ...secrets.map(async (rec) => {
      if (await request(s.get([rec.owner, rec.doorId])) === undefined) { s.put(rec); added.secrets.push(rec) }
    }),
  ])
  await finished
  return added
}

/** One queue's worth of changes, all or none. */
export async function commit(db: IDBDatabase, changes: readonly Change[]): Promise<void> {
  const tx = db.transaction([ROWS, TOMBSTONES, SECRETS], 'readwrite', STRICT)
  const finished = done(tx)
  for (const c of changes) {
    if ('put' in c) { tx.objectStore(ROWS).put(c.put); tx.objectStore(TOMBSTONES).delete([c.put.bucket, c.put.key]) }
    else if ('del' in c) { tx.objectStore(ROWS).delete([c.del.bucket, c.del.key]); tx.objectStore(TOMBSTONES).put({ ...c.del, at: Date.now() }) }
    else tx.objectStore(SECRETS).put(c.secret)
  }
  await finished
}

/** What another tab named, as it now stands. */
export async function readSome(db: IDBDatabase, rows: Array<[string, string]>, secrets: Array<[string, string]>): Promise<{ rows: Array<RowRecord | undefined>; secrets: Array<SecretRecord | undefined> }> {
  const tx = db.transaction([ROWS, SECRETS], 'readonly')
  const [a, b] = await Promise.all([
    Promise.all(rows.map((k) => request(tx.objectStore(ROWS).get(k)) as Promise<RowRecord | undefined>)),
    Promise.all(secrets.map((k) => request(tx.objectStore(SECRETS).get(k)) as Promise<SecretRecord | undefined>)),
  ])
  return { rows: a, secrets: b }
}
