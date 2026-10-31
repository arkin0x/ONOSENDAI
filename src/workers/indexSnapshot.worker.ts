/**
 * indexSnapshot.worker.ts: the stop index's one big IndexedDB record, read and
 * written off the main thread.
 *
 * The record is about 130 MB of ArrayBuffers. Written on the main thread, its
 * structured clone blocked for 0.4 to 4 s on the first full sync; read there, it
 * blocked each boot. The worker lives for one call and takes its copy with it.
 *
 * It says it is ready before any buffers come (snapshotRecord SnapshotRequest).
 */

import { openDb } from '../lib/hyperspace/idb'
import { buffersOfRecord, errorLine, readSnapshotRecord, writeSnapshotRecord, type SnapshotReply, type SnapshotRequest } from '../lib/hyperspace/snapshotRecord'

const post = postMessage as unknown as (m: SnapshotReply, transfer?: Transferable[]) => void

let database: IDBDatabase | null = null

onmessage = async (e: MessageEvent<SnapshotRequest>) => {
  try {
    if (e.data.op === 'open') {
      database = await openDb()
      post({ ok: true, ready: true })
    } else if (e.data.op === 'put') {
      await writeSnapshotRecord(database!, e.data.record)
      post({ ok: true })
    } else {
      const record = await readSnapshotRecord(database!)
      post({ ok: true, record }, buffersOfRecord(record))
    }
  } catch (err) {
    post({ ok: false, error: errorLine(err) })
  }
}
