/**
 * shardFoldersDb.ts: where the shard folder trees are kept, in IndexedDB.
 *
 * One database, one store: { owner, tree }, the whole tree of
 * lib/shardFolders.ts. The tree is the device's (DEVICE_OWNER), the same for
 * every identity, as the workshop library is (owner ruling, 2026-11-19):
 * the folders, the filings, the folds and when each shard was last deployed,
 * which only sorts the lists. Builds before that kept one row per identity,
 * under its pubkey; those rows are merged into the device's row the first
 * time it is read or written (mergeTrees, in the same transaction), and are
 * left as they were, never deleted. A tree is small (names and ids, a few hundred
 * at most), so it is read and written whole. A change is never a tree written
 * over another: commit() reads the row, applies the ops and puts it back in
 * one readwrite transaction, and IndexedDB runs readwrite transactions on a
 * store one at a time, across tabs too, so a change from another tab is the
 * tree this one lands on. The same promise wrapper as the held items
 * (lib/idb.ts); nothing here knows about zustand.
 */

import { openDatabase, request } from './idb'
import { applyOps, mergeTrees, normalizeTree, type FolderOp, type FolderTree } from './shardFolders'

/**
 * Named for the format, not the app: snocrash keeps its folders in a database
 * of this same name, schema and row shape (its src/lib/shardFoldersDb.ts).
 * IndexedDB is per origin, so the two apps never share one; the shape is the
 * same so a later sync, or a module both import, moves a tree between them
 * with nothing to translate. Settle the name before folders ship: renaming it
 * after would leave every tree behind.
 *
 * One difference: here the tree also carries `used` (when each shard was last
 * deployed, lib/shardFolders.ts), which snocrash does not have, since it never
 * places a shard in cyberspace. Its reader drops the field and its IndexedDB
 * writer keeps what it does not read, so a stored tree it writes keeps it.
 */
export const SHARD_FOLDERS_DB = 'sno:shard-folders'
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

/**
 * The row of the device's one tree. Not a pubkey (those are 64 hex), so it
 * can never be an identity's old row.
 */
export const DEVICE_OWNER = 'device'

interface Row { owner?: unknown; tree?: unknown; mergedFrom?: unknown }

/**
 * The device's tree after `ops`, in one readwrite transaction. When the
 * device's row does not exist yet it is made first from every identity's
 * old row (mergeTrees) and written even with no ops, so the merge runs once;
 * the old rows are only read. Otherwise it is written only when an op
 * changed it.
 */
function inTransaction(db: IDBDatabase, ops: readonly FolderOp[]): Promise<FolderTree> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TREES_STORE, 'readwrite')
    const os = tx.objectStore(TREES_STORE)
    let next: FolderTree | null = null
    const write = (row: Row, tree: FolderTree, made: boolean): void => {
      next = applyOps(tree, ops)
      if (!made && next === tree) return
      // Whatever a later build keeps beside the tree is kept as it was.
      const keptTree = row.tree && typeof row.tree === 'object' ? row.tree : {}
      os.put({ ...row, owner: DEVICE_OWNER, tree: { ...keptTree, ...next } })
    }
    const got = os.get(DEVICE_OWNER)
    got.onsuccess = () => {
      const row = got.result as Row | undefined
      if (row) { write(row, normalizeTree(row.tree), false); return }
      const all = os.getAll()
      all.onsuccess = () => {
        const old = (all.result as Row[]).filter((r) => r && typeof r.owner === 'string' && r.owner !== DEVICE_OWNER)
        write({ owner: DEVICE_OWNER, mergedFrom: old.map((r) => r.owner) }, mergeTrees(old.map((r) => normalizeTree(r.tree))), true)
      }
    }
    tx.oncomplete = () => resolve(next ?? normalizeTree(null))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/** The device's tree; on the first read, made from the trees each identity kept before (and written). */
export function readTree(db: IDBDatabase): Promise<FolderTree> {
  return inTransaction(db, [])
}

/** Apply ops to the device's stored tree in one transaction; resolves with the tree as committed. */
export function commitOps(db: IDBDatabase, ops: readonly FolderOp[]): Promise<FolderTree> {
  return inTransaction(db, ops)
}

/**
 * The device's tree, read only: its row, or the merge of the identities'
 * rows when it has none yet, with nothing written. For when readTree failed
 * (a full disk refuses the first write that keeps the merge): the folders are
 * still shown, for the session, rather than none (review of #822).
 */
export async function peekTree(db: IDBDatabase): Promise<FolderTree> {
  const rows = await request(db.transaction(TREES_STORE, 'readonly').objectStore(TREES_STORE).getAll()) as Row[]
  const device = rows.find((r) => r?.owner === DEVICE_OWNER)
  if (device) return normalizeTree(device.tree)
  return mergeTrees(rows.filter((r) => r && typeof r.owner === 'string').map((r) => normalizeTree(r.tree)))
}

/** One identity's tree as a build before 2026-11-19 kept it; for tests and diagnosis. */
export async function readIdentityTree(db: IDBDatabase, owner: string): Promise<FolderTree> {
  const row = await request(db.transaction(TREES_STORE, 'readonly').objectStore(TREES_STORE).get(owner)) as Row | undefined
  return normalizeTree(row?.tree)
}
