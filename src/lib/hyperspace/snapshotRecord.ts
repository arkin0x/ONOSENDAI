/**
 * snapshotRecord.ts: how the stop index's snapshot is stored, shared by
 * snapshotStore and its worker. Apart from snapshotStore, because a worker that
 * imported the module that makes it would be a circular worker import.
 *
 * One record per column, in one transaction. Chromium refuses a put past
 * MAX_PUT_BYTES, and at 137 bytes a row the whole snapshot stopped fitting in one
 * record at about 972,000 rows, which the line has now passed: the write failed,
 * quietly, and every boot rebuilt the index from the header blobs. A column is a
 * quarter of that at most, so this holds to about 4 million rows.
 *
 * A record from before this, whole under SNAPSHOT_KEY, is still read.
 */

import { META_STORE } from '../idb'
import type { IndexSnapshot } from './compactIndex'

/** The meta record holding the snapshot, or now its header. */
export const SNAPSHOT_KEY = 'indexSnapshot'

/** What Chromium allows in one put (its own error: "max=133169152 bytes"). */
export const MAX_PUT_BYTES = 133_169_152

/** The columns that are stored apart, each under SNAPSHOT_KEY:name. */
export const SNAPSHOT_COLUMNS = ['keys', 'coords', 'merkles', 'hashes', 'kinds', 'heights', 'perm'] as const

/** What is stored: the snapshot, and the heights it had covered. */
export interface SnapshotRecord {
  snapshot: IndexSnapshot
  coveredAtSnapshot: Array<[number, number]>
}

export type SnapshotRequest = { op: 'put'; record: SnapshotRecord } | { op: 'get' }
export type SnapshotReply = { ok: boolean; record?: unknown }

/** Every buffer in a stored record, to hand over rather than copy. Anything else is left for the validator to refuse. */
export function buffersOfRecord(record: unknown): ArrayBuffer[] {
  const s = (record as { snapshot?: Record<string, unknown> } | null | undefined)?.snapshot
  if (!s || typeof s !== 'object') return []
  return Object.values(s).filter((v): v is ArrayBuffer => v instanceof ArrayBuffer)
}

const columnKey = (name: string): string => `${SNAPSHOT_KEY}:${name}`

/** Store the record, whole or not at all: one transaction, so a crash cannot leave columns of two snapshots. */
export function writeSnapshotRecord(database: IDBDatabase, record: SnapshotRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(META_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('snapshot write aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('snapshot write failed'))
    const os = tx.objectStore(META_STORE)
    const { snapshot, coveredAtSnapshot } = record
    for (const name of SNAPSHOT_COLUMNS) os.put({ key: columnKey(name), value: snapshot[name] })
    os.put({ key: SNAPSHOT_KEY, value: { split: 1, version: snapshot.version, count: snapshot.count, maxHeight: snapshot.maxHeight, coveredAtSnapshot } })
  })
}

function got(os: IDBObjectStore, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const q = os.get(key)
    q.onsuccess = () => resolve((q.result as { value?: unknown } | undefined)?.value)
    q.onerror = () => reject(q.error)
  })
}

/** The record as stored, whichever way: the old whole one comes back as it was, and adoptSnapshot judges either. */
export async function readSnapshotRecord(database: IDBDatabase): Promise<unknown> {
  const os = database.transaction(META_STORE, 'readonly').objectStore(META_STORE)
  // Asked together, in one transaction, so all of them are one snapshot's.
  const [head, ...columns] = await Promise.all([got(os, SNAPSHOT_KEY), ...SNAPSHOT_COLUMNS.map((name) => got(os, columnKey(name)))])
  const h = head as { split?: number; version?: unknown; count?: unknown; maxHeight?: unknown; coveredAtSnapshot?: unknown } | undefined
  if (h?.split !== 1) return head
  const snapshot: Record<string, unknown> = { version: h.version, count: h.count, maxHeight: h.maxHeight }
  SNAPSHOT_COLUMNS.forEach((name, i) => { snapshot[name] = columns[i] })
  return { snapshot, coveredAtSnapshot: h.coveredAtSnapshot }
}
