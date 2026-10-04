/**
 * idb.ts: a promise wrapper over IndexedDB, for every database the app keeps.
 *
 * Why IndexedDB and not localStorage: the hyperspace stop cache approaches a
 * million rows and the region keys are budgeted in hundreds of megabytes, and
 * localStorage is synchronous, string-only and capped at a few megabytes. The
 * helpers stay tiny on purpose: open with a fixed schema, paged reads, writes
 * in one transaction, one meta record per key. Nothing in here knows what a
 * row is; the module that owns a database owns its shapes (hyperspace/anchors
 * for stops, secrets/db for region keys and places).
 *
 * getAllPaged pages with a lower-bound key range restarted after each chunk
 * rather than one giant getAll, because materialising ~950k rows in a single
 * request blocks the main thread and doubles peak memory. The caller's chunk
 * handler is awaited between pages, which is where it yields to the event
 * loop so the UI stays alive during a cold cache load.
 */

/** Every database here keeps its meta records in a store of this name, keyed by `key`. */
export const META_STORE = 'meta'

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

/**
 * Open a database with a fixed set of stores, each [name, keyPath], creating
 * any that are missing. A schema change is a new version and a new store, so
 * the upgrade only ever adds.
 */
export function openDatabase(name: string, version: number, stores: Array<[string, string]>): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const [store, keyPath] of stores) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

/**
 * Read every row of a store in key order, chunkSize rows at a time. keyOf
 * extracts the primary key from a row so the next page can start just past
 * the previous one; rows come back in key order, so the last row's key is
 * the high-water mark.
 */
export async function getAllPaged<T>(
  db: IDBDatabase,
  store: string,
  chunkSize: number,
  keyOf: (row: T) => IDBValidKey,
  onChunk: (rows: T[]) => void | Promise<void>,
): Promise<void> {
  let after: IDBValidKey | null = null
  for (;;) {
    const range = after === null ? null : IDBKeyRange.lowerBound(after, true)
    const os = db.transaction(store, 'readonly').objectStore(store)
    const rows = await request(os.getAll(range, chunkSize)) as T[]
    if (rows.length === 0) return
    await onChunk(rows)
    if (rows.length < chunkSize) return
    after = keyOf(rows[rows.length - 1])
  }
}

/**
 * Read rows with keys in [lower, upper] in key order, chunked like
 * getAllPaged. upper === null means unbounded above; the header-blob path
 * uses that to replay whatever tail the blobs did not cover without knowing
 * the tip yet.
 */
export async function getRangePaged<T>(
  db: IDBDatabase,
  store: string,
  lower: IDBValidKey,
  upper: IDBValidKey | null,
  chunkSize: number,
  keyOf: (row: T) => IDBValidKey,
  onChunk: (rows: T[]) => void | Promise<void>,
): Promise<void> {
  let from = lower
  let open = false
  for (;;) {
    const range = upper === null
      ? IDBKeyRange.lowerBound(from, open)
      : IDBKeyRange.bound(from, upper, open, false)
    const os = db.transaction(store, 'readonly').objectStore(store)
    const rows = await request(os.getAll(range, chunkSize)) as T[]
    if (rows.length === 0) return
    await onChunk(rows)
    if (rows.length < chunkSize) return
    from = keyOf(rows[rows.length - 1])
    open = true
  }
}

/** Every primary key in a store, without the rows. */
export function getAllKeys(db: IDBDatabase, store: string): Promise<IDBValidKey[]> {
  return request(db.transaction(store, 'readonly').objectStore(store).getAllKeys())
}

/** Delete every row with a key in [lower, upper]; one transaction. */
export function deleteRange(
  db: IDBDatabase,
  store: string,
  lower: IDBValidKey,
  upper: IDBValidKey,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(IDBKeyRange.bound(lower, upper))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'))
  })
}

/** Put every row in one transaction; resolves when the transaction commits. */
export function putMany(db: IDBDatabase, store: string, rows: unknown[]): Promise<void> {
  return writeBatch(db, rows.map((row) => ({ store, put: row })))
}

/** One write in a batch: a row to put, a key to delete, or a whole store to empty. */
export type WriteOp =
  | { store: string; put: unknown }
  | { store: string; delete: IDBValidKey }
  | { store: string; clear: true }

/**
 * Apply every op, in order, in one transaction across the stores they name:
 * all of them land or none do. Resolves when the transaction commits.
 *
 * The transaction is created before this returns, so batches started one
 * after another commit in that order, which is what lets a caller fire a
 * write and move on without waiting for the one before it.
 */
export function writeBatch(db: IDBDatabase, ops: WriteOp[]): Promise<void> {
  if (ops.length === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...new Set(ops.map((op) => op.store))], 'readwrite')
    for (const op of ops) {
      const os = tx.objectStore(op.store)
      if ('put' in op) os.put(op.put)
      else if ('delete' in op) os.delete(op.delete)
      else os.clear()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/** The stored value under a meta key, or undefined when it was never written. */
export async function getMeta(db: IDBDatabase, key: string): Promise<unknown> {
  const os = db.transaction(META_STORE, 'readonly').objectStore(META_STORE)
  const row = await request(os.get(key)) as { value?: unknown } | undefined
  return row?.value
}

export function putMeta(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return putMany(db, META_STORE, [{ key, value }])
}

/** A meta record as a batch op, so it can land in the same transaction as the rows it describes. */
export function metaOp(key: string, value: unknown): WriteOp {
  return { store: META_STORE, put: { key, value } }
}
