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
 *   closed      { owner, doorId, lock, room, shut, below }   doors closed with CLOSE
 *                                            (store/closedDoors.ts), one record each
 *   meta        { key, value }
 *
 * Nothing here knows about zustand; store/hiddenStorage.ts decides when to read
 * and write.
 */

import { META_STORE, openDatabase, request } from './idb'

export const HIDDEN_DB = 'onosendai:hidden'
/** 2 adds `closed` (CLOSE on a door, 2026-11); nothing else changed, so an upgrade only creates it. */
const DB_VERSION = 2
const ROWS = 'rows'
const TOMBSTONES = 'tombstones'
const SECRETS = 'secrets'
const CLOSED = 'closed'
const OPEN_TIMEOUT_MS = 8000
/** Committed means on disk, not in a cache: a door's secret waits on this before the door goes out. */
const STRICT = { durability: 'strict' } as IDBTransactionOptions

export interface RowRecord { bucket: string; key: string; seq: number; json: string }
export interface SecretRecord { owner: string; doorId: string; secret: string; onlySaid?: true }
/**
 * A door this identity closed with CLOSE, by id, under `lock`, standing in `room`
 * (store/rooms roomKeyOf; '' when not known). `shut`: closed now. `below`: the doors
 * inside its room still to be closed as they arrive, kept until its room comes back.
 */
export interface ClosedRecord { owner: string; doorId: string; lock: string; room: string; shut?: true; below?: true }
export type Change =
  | { put: RowRecord }
  | { del: { bucket: string; key: string } }
  | { secret: SecretRecord }
  | { closed: ClosedRecord }
  | { unclosed: { owner: string; doorId: string } }

export function openHiddenDb(timeoutMs: number = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  const opening = openDatabase(HIDDEN_DB, DB_VERSION, [[ROWS, ['bucket', 'key']], [TOMBSTONES, ['bucket', 'key']], [SECRETS, ['owner', 'doorId']], [CLOSED, ['owner', 'doorId']], [META_STORE, 'key']])
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
export async function readEverything(db: IDBDatabase): Promise<{ rows: RowRecord[]; secrets: SecretRecord[]; closed: ClosedRecord[] }> {
  const tx = db.transaction([ROWS, SECRETS, CLOSED], 'readonly')
  const [rows, secrets, closed] = await Promise.all([request(tx.objectStore(ROWS).getAll()), request(tx.objectStore(SECRETS).getAll()), request(tx.objectStore(CLOSED).getAll())])
  return { rows: rows as RowRecord[], secrets: secrets as SecretRecord[], closed: closed as ClosedRecord[] }
}

/** One identity's closed doors as they stand on disk now: read before deciding to open any door again. */
export async function readClosed(db: IDBDatabase, owner: string): Promise<ClosedRecord[]> {
  const tx = db.transaction(CLOSED, 'readonly')
  return ((await request(tx.objectStore(CLOSED).getAll())) as ClosedRecord[]).filter((r) => r.owner === owner)
}

/**
 * Add what localStorage holds and this database does not, by id, in one
 * transaction: a crash leaves all of it or none, and running it again, from
 * another tab too, changes nothing. A row here is never overwritten, and a row
 * taken off here does not come back. `alsoGoneFrom` is the list a row deleted since
 * was on, and `gone` what local mode took off. Resolves with what it added.
 */
export async function addMissing(db: IDBDatabase, rows: Array<{ record: RowRecord; alsoGoneFrom?: string }>, secrets: SecretRecord[], gone: Array<{ bucket: string; key: string }>, closed: ClosedRecord[] = []): Promise<{ rows: RowRecord[]; secrets: SecretRecord[]; closed: ClosedRecord[] }> {
  const added: { rows: RowRecord[]; secrets: SecretRecord[]; closed: ClosedRecord[] } = { rows: [], secrets: [], closed: [] }
  const tx = db.transaction([ROWS, TOMBSTONES, SECRETS, CLOSED], 'readwrite', STRICT)
  const finished = done(tx)
  const r = tx.objectStore(ROWS)
  const t = tx.objectStore(TOMBSTONES)
  const s = tx.objectStore(SECRETS)
  const c = tx.objectStore(CLOSED)
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
    ...closed.map(async (rec) => {
      if (await request(c.get([rec.owner, rec.doorId])) === undefined) { c.put(rec); added.closed.push(rec) }
    }),
  ])
  await finished
  return added
}

/** One queue's worth of changes, all or none. */
export async function commit(db: IDBDatabase, changes: readonly Change[]): Promise<void> {
  const tx = db.transaction([ROWS, TOMBSTONES, SECRETS, CLOSED], 'readwrite', STRICT)
  const finished = done(tx)
  for (const c of changes) {
    if ('put' in c) { tx.objectStore(ROWS).put(c.put); tx.objectStore(TOMBSTONES).delete([c.put.bucket, c.put.key]) }
    else if ('del' in c) { tx.objectStore(ROWS).delete([c.del.bucket, c.del.key]); tx.objectStore(TOMBSTONES).put({ ...c.del, at: Date.now() }) }
    else if ('closed' in c) tx.objectStore(CLOSED).put(c.closed)
    else if ('unclosed' in c) tx.objectStore(CLOSED).delete([c.unclosed.owner, c.unclosed.doorId])
    else tx.objectStore(SECRETS).put(c.secret)
  }
  await finished
}

/** What another tab named, as it now stands. */
export async function readSome(db: IDBDatabase, rows: Array<[string, string]>, secrets: Array<[string, string]>, closed: Array<[string, string]> = []): Promise<{ rows: Array<RowRecord | undefined>; secrets: Array<SecretRecord | undefined>; closed: Array<ClosedRecord | undefined> }> {
  const tx = db.transaction([ROWS, SECRETS, CLOSED], 'readonly')
  const [a, b, c] = await Promise.all([
    Promise.all(rows.map((k) => request(tx.objectStore(ROWS).get(k)) as Promise<RowRecord | undefined>)),
    Promise.all(secrets.map((k) => request(tx.objectStore(SECRETS).get(k)) as Promise<SecretRecord | undefined>)),
    Promise.all(closed.map((k) => request(tx.objectStore(CLOSED).get(k)) as Promise<ClosedRecord | undefined>)),
  ])
  return { rows: a, secrets: b, closed: c }
}
