/**
 * snapshotStore.ts: reading and writing the stop index's snapshot without
 * stopping the main thread.
 *
 * The copy of the columns is made in slices between other work, the buffers are
 * handed to a worker that exists for the one call, and it does the structured
 * clone and the IndexedDB call. Where a worker cannot be made, the old way still
 * works: a cache write that blocks is better than none.
 */

import { buffersOfRecord, readSnapshotRecord, writeSnapshotRecord, type SnapshotRecord, type SnapshotReply, type SnapshotRequest } from './snapshotRecord'

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

/** How long a read may take before this thread reads for itself. The boot's sync waits on it. */
export const READ_WAIT_MS = 20_000
/** How long a write may take. A stuck one must not hold up the sync after it; the next snapshot tries again. */
export const WRITE_WAIT_MS = 120_000
/** How long a worker gets to load and open the database. Past that the buffers stay here. */
export const READY_WAIT_MS = 10_000

/** How a call went: `here` while nothing was handed over, so this thread can still do it. */
type Answer = { here: true; why: string } | { here: false; reply: SnapshotReply }

/** One call to a worker of its own, which says it is ready before anything is handed over. */
function ask(request: Exclude<SnapshotRequest, { op: 'open' }>, transfer: Transferable[], make: MakeWorker, waitMs: number): Promise<Answer> {
  const worker = make()
  if (!worker) return Promise.resolve({ here: true, why: 'no worker' })
  return new Promise((resolve) => {
    let ready = false
    let timer = setTimeout(() => fail('did not answer in time'), READY_WAIT_MS)
    function done(answer: Answer): void { clearTimeout(timer); worker!.terminate(); resolve(answer) }
    function fail(why: string): void { done(ready ? { here: false, reply: { ok: false, error: why } } : { here: true, why }) }
    worker.onmessage = (e: MessageEvent<SnapshotReply>) => {
      if (ready) { done({ here: false, reply: e.data }); return }
      if (!e.data.ok) { fail(e.data.error ?? 'could not open the database'); return }
      ready = true
      clearTimeout(timer)
      timer = setTimeout(() => fail('did not answer in time'), waitMs)
      worker.postMessage(request, transfer)
    }
    worker.onerror = (e) => fail(e.message || 'worker failed')
    worker.postMessage({ op: 'open' } satisfies SnapshotRequest)
  })
}

/**
 * Store the record, or reject saying why: a failure here must not be silent, as
 * the one that hid this record outgrowing a put was. Its buffers go to the worker
 * only once it is ready. Until then they are here, and this thread writes them.
 */
export async function putSnapshot(database: IDBDatabase, record: SnapshotRecord, make: MakeWorker = snapshotWorker): Promise<void> {
  const answer = await ask({ op: 'put', record }, buffersOfRecord(record), make, WRITE_WAIT_MS)
  if (answer.here) { await writeSnapshotRecord(database, record); return }
  if (!answer.reply.ok) throw new Error(answer.reply.error ?? 'snapshot write failed')
}

/** Read the record, off this thread where a worker can be made. */
export async function getSnapshot(database: IDBDatabase, make: MakeWorker = snapshotWorker): Promise<unknown> {
  const answer = await ask({ op: 'get' }, [], make, READ_WAIT_MS)
  if (!answer.here && answer.reply.ok) return answer.reply.record
  return readSnapshotRecord(database)
}

/** Writes that may fail in a row before this session stops trying: each copies the whole index. */
export const SNAPSHOT_GIVE_UP_AFTER = 3
/** Rows that make a new snapshot worth its 128 MB. */
export const SNAPSHOT_MIN_GROWTH = 5000
const SNAPSHOT_INTERVAL_MS = 10 * 60_000

/** Whether a long-lived tab should write again: after an interval that doubles with each failure, and grown enough. */
export function tailSnapshotDue(now: number, lastAt: number, size: number, lastSize: number, failures: number): boolean {
  if (failures >= SNAPSHOT_GIVE_UP_AFTER) return false
  return now - lastAt >= SNAPSHOT_INTERVAL_MS * 2 ** failures && size - lastSize >= SNAPSHOT_MIN_GROWTH
}

/** Whether a boot should write: nothing stored yet, or grown enough. One new row is not worth rewriting 128 MB. */
export function bootSnapshotDue(size: number, lastSize: number, failures: number): boolean {
  if (failures >= SNAPSHOT_GIVE_UP_AFTER || size === 0) return false
  return lastSize === 0 || size - lastSize >= SNAPSHOT_MIN_GROWTH
}
