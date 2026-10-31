/**
 * snapshotStore.ts: reading and writing the stop index's snapshot without
 * stopping the main thread.
 *
 * The copy of the columns is made in slices between other work, the buffers are
 * handed to a worker that exists for the one call, and it does the structured
 * clone and the IndexedDB call. Where a worker cannot be made, the old way still
 * works: a cache write that blocks is better than none.
 */

import { getMeta, putMeta } from './idb'
import { SNAPSHOT_KEY, buffersOfRecord, type SnapshotRecord, type SnapshotReply, type SnapshotRequest } from './snapshotRecord'

/** The most copied at once, in bytes: about 2 ms of memcpy between chances for a frame. */
export const SLICE_BYTES = 8 * 1024 * 1024

/** Hands the thread back between slices. */
export type Pause = () => Promise<void>
const macrotask: Pause = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A copy of `column`'s first `bytes`, made a slice at a time. A slice ends on a row's boundary, so no row is torn. */
export async function copySliced(column: Uint8Array, bytes: number, rowBytes: number, pause: Pause = macrotask): Promise<ArrayBuffer> {
  const out = new Uint8Array(bytes)
  const step = Math.max(rowBytes, SLICE_BYTES - (SLICE_BYTES % rowBytes))
  for (let at = 0; at < bytes; at += step) {
    const end = Math.min(bytes, at + step)
    out.set(column.subarray(at, end), at)
    if (end < bytes) await pause()
  }
  return out.buffer
}

export type MakeWorker = () => Worker | null

/** A worker for one call, or null where the page cannot make one. */
export const snapshotWorker: MakeWorker = () => {
  if (typeof Worker === 'undefined') return null
  try {
    return new Worker(new URL('../../workers/indexSnapshot.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

/** One call to a worker of its own; null when it could not answer. */
function ask(request: SnapshotRequest, transfer: Transferable[], make: MakeWorker): Promise<SnapshotReply | null> {
  const worker = make()
  if (!worker) return Promise.resolve(null)
  return new Promise((resolve) => {
    const done = (reply: SnapshotReply | null): void => { worker.terminate(); resolve(reply) }
    worker.onmessage = (e: MessageEvent<SnapshotReply>) => done(e.data)
    worker.onerror = () => done(null)
    worker.postMessage(request, transfer)
  })
}

/**
 * Store the record. Its buffers go with the worker. If no worker could be made
 * they are still here, and the database on this thread takes them.
 */
export async function putSnapshot(database: IDBDatabase, record: SnapshotRecord, make: MakeWorker = snapshotWorker): Promise<void> {
  const reply = await ask({ op: 'put', record }, buffersOfRecord(record), make)
  if (reply?.ok) return
  // The worker failed after the buffers went to it: nothing left to store, and the next snapshot tries again.
  if (reply === null && buffersOfRecord(record).every((b) => b.byteLength > 0)) await putMeta(database, SNAPSHOT_KEY, record)
}

/** Read the record, off this thread where a worker can be made. */
export async function getSnapshot(database: IDBDatabase, make: MakeWorker = snapshotWorker): Promise<unknown> {
  const reply = await ask({ op: 'get' }, [], make)
  if (reply?.ok) return reply.record
  return getMeta(database, SNAPSHOT_KEY)
}
