/**
 * idb.ts: a promise wrapper over the one IndexedDB database hyperspace uses.
 *
 * Why IndexedDB and not localStorage: the stop cache approaches a million
 * rows, and localStorage is synchronous, string-only and capped in megabytes.
 * The helpers stay tiny on purpose: open with a fixed schema, paged reads,
 * bulk writes, one meta record per key. Nothing in here knows what a stop is;
 * anchors.ts owns the row shapes.
 *
 * getAllPaged pages with a lower-bound key range restarted after each chunk
 * rather than one giant getAll, because materialising ~950k rows in a single
 * request blocks the main thread and doubles peak memory. The caller's chunk
 * handler is awaited between pages, which is where it yields to the event
 * loop so the UI stays alive during a cold cache load.
 */

export const DB_NAME = 'onosendai:hyperspace'
const DB_VERSION = 1
export const STOPS_STORE = 'stops'
export const META_STORE = 'meta'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STOPS_STORE)) db.createObjectStore(STOPS_STORE, { keyPath: 'height' })
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' })
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
