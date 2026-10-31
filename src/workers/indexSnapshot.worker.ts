/**
 * indexSnapshot.worker.ts: the stop index's one big IndexedDB record, read and
 * written off the main thread.
 *
 * The record is about 130 MB of ArrayBuffers. Written on the main thread, its
 * structured clone blocked for 0.4 to 4 s on the first full sync; read there, it
 * blocked each boot. The worker lives for one call and takes its copy with it.
 */

import { openDb, getMeta, putMeta } from '../lib/hyperspace/idb'
import { SNAPSHOT_KEY, buffersOfRecord, type SnapshotReply, type SnapshotRequest } from '../lib/hyperspace/snapshotRecord'

const post = postMessage as unknown as (m: SnapshotReply, transfer?: Transferable[]) => void

onmessage = async (e: MessageEvent<SnapshotRequest>) => {
  const database = await openDb().catch(() => null)
  if (!database) { post({ ok: false }); return }
  try {
    if (e.data.op === 'put') {
      await putMeta(database, SNAPSHOT_KEY, e.data.record)
      post({ ok: true })
    } else {
      const record = await getMeta(database, SNAPSHOT_KEY)
      post({ ok: true, record }, buffersOfRecord(record))
    }
  } catch {
    post({ ok: false })
  } finally {
    database.close()
  }
}
