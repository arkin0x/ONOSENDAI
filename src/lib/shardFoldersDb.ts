/**
 * shardFoldersDb.ts: where the shard folder trees are kept, in IndexedDB.
 *
 * One database, one store, one row per identity: { owner, tree }, the whole
 * tree of lib/shardFolders.ts. A tree is small (names and ids, a few hundred
 * at most), so it is read and written whole. A change is never a tree written
 * over another: commit() reads the row, applies the ops and puts it back in
 * one readwrite transaction, and IndexedDB runs readwrite transactions on a
 * store one at a time, across tabs too, so a change from another tab is the
 * tree this one lands on. The same promise wrapper as the held items
 * (lib/idb.ts); nothing here knows about zustand.
 */

import { openDatabase, request } from './idb'
import { applyOps, normalizeTree, type FolderOp, type FolderTree } from './shardFolders'

export const SHARD_FOLDERS_DB = 'onosendai:shard-folders'
export const DB_VERSION = 1
export const TREES_STORE = 'trees'

/** How long opening may take before the store keeps folders in memory for the session. */
export const OPEN_TIMEOUT_MS = 8000

export function openShardFoldersDb(timeoutMs: number = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  const opening = openDatabase(SHARD_FOLDERS_DB, DB_VERSION, [[TREES_STORE, 'owner']])
  // As the held items do: a blocked upgrade or a browser that never answers
  // must not hold the app, and a connection that arrives late is closed so it
  // does not block the next open.
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error('IndexedDB did not open in time')) }, timeoutMs)
  })
  opening.then((db) => { if (timedOut) db.close() }, () => { /* the race reports it */ })
  return Promise.race([opening, timeout]).finally(() => clearTimeout(timer))
}

/** One identity's tree; empty when it has none yet. */
export async function readTree(db: IDBDatabase, owner: string): Promise<FolderTree> {
  const row = await request(db.transaction(TREES_STORE, 'readonly').objectStore(TREES_STORE).get(owner)) as { tree?: unknown } | undefined
  return normalizeTree(row?.tree)
}

/** Apply ops to one identity's stored tree in one transaction; resolves with the tree as committed. */
export function commitOps(db: IDBDatabase, owner: string, ops: readonly FolderOp[]): Promise<FolderTree> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TREES_STORE, 'readwrite')
    const os = tx.objectStore(TREES_STORE)
    let next: FolderTree | null = null
    const got = os.get(owner)
    got.onsuccess = () => {
      const row = got.result as { tree?: unknown } | undefined
      next = applyOps(normalizeTree(row?.tree), ops)
      // Whatever a later build keeps beside the tree is kept as it was.
      const kept = row && typeof row === 'object' ? row : {}
      const keptTree = row?.tree && typeof row.tree === 'object' ? row.tree : {}
      os.put({ ...kept, owner, tree: { ...keptTree, ...next } })
    }
    tx.oncomplete = () => resolve(next ?? normalizeTree(null))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}
