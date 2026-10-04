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

/** An index on a store: its name, the key path it reads, and whether an array key indexes each element. */
export interface IndexSpec { name: string; keyPath: string | string[]; multiEntry?: boolean }

/**
 * Open a database with a fixed set of stores, each [name, keyPath, indexes],
 * creating any that are missing with their indexes. A schema change is a new
 * version and a new store, so the upgrade only ever adds.
 */
export function openDatabase(name: string, version: number, stores: Array<[string, string, IndexSpec[]?]>): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const [store, keyPath, indexes = []] of stores) {
        if (db.objectStoreNames.contains(store)) continue
        const os = db.createObjectStore(store, { keyPath })
        for (const ix of indexes) os.createIndex(ix.name, ix.keyPath, { multiEntry: ix.multiEntry ?? false })
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
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    const os = tx.objectStore(store)
    for (const row of rows) os.put(row)
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
