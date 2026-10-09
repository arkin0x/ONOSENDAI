/**
 * inventoryDb.ts: where held items are kept, in IndexedDB.
 *
 * One database, one store, one row per item per identity (lib/inventory.ts
 * HeldItem), keyed by `rowKey` and indexed by `owner` so one identity's
 * items are read in one request. The same promise wrapper as the region keys
 * (lib/idb.ts); nothing here knows about zustand, which store/useInventory.ts
 * owns. A key is small, a taken shard may be a few kilobytes, and an identity
 * holds dozens of either, so there is no budget and no paging.
 */

import { openDatabase, putMany, request } from './idb'
import type { HeldItem } from './inventory'

export const INVENTORY_DB = 'onosendai:inventory'
export const DB_VERSION = 1
export const ITEMS_STORE = 'items'
/** Items by the identity that holds them. */
export const BY_OWNER = 'byOwner'

/** How long opening may take before the store gives up and keeps items in memory for the session. */
export const OPEN_TIMEOUT_MS = 8000

export function openInventoryDb(timeoutMs: number = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  const opening = openDatabase(INVENTORY_DB, DB_VERSION, [[ITEMS_STORE, 'rowKey', [{ name: BY_OWNER, keyPath: 'owner' }]]])
  // As the region keys do: a blocked upgrade or a browser that never answers
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

/** Whether a stored value is a held item this app can show. */
export function isHeldItem(v: unknown): v is HeldItem {
  const it = v as HeldItem | null
  return !!it && typeof it === 'object' && typeof it.rowKey === 'string' && typeof it.owner === 'string' && typeof it.id === 'string' && typeof it.type === 'string' && !!it.event && typeof it.at === 'number'
}

/** Every item one identity holds, in one read. */
export async function readHeld(db: IDBDatabase, owner: string): Promise<HeldItem[]> {
  const index = db.transaction(ITEMS_STORE, 'readonly').objectStore(ITEMS_STORE).index(BY_OWNER)
  const rows = await request(index.getAll(owner)) as unknown[]
  return rows.filter(isHeldItem)
}

/** Hold these items; one transaction. A row already there is replaced by the same row. */
export function writeHeld(db: IDBDatabase, rows: HeldItem[]): Promise<void> {
  return rows.length === 0 ? Promise.resolve() : putMany(db, ITEMS_STORE, rows)
}
