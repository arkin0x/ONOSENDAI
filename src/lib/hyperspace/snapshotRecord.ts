/**
 * snapshotRecord.ts: the shape of the stop index's stored snapshot, shared by
 * snapshotStore and its worker. Apart from snapshotStore, because a worker that
 * imported the module that makes it would be a circular worker import.
 */

import type { IndexSnapshot } from './compactIndex'

/** The meta record holding the snapshot. */
export const SNAPSHOT_KEY = 'indexSnapshot'

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
