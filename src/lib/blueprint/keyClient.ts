/**
 * keyClient.ts - a blueprint's key and lookup, made in the blueprint worker
 * (workers/blueprint.worker.ts) so the page never waits on PBKDF2. Where no
 * worker can start (tests, an old browser) or the worker fails, the same
 * WebCrypto call runs on the page: slower for a moment, never wrong. The
 * worker is made on first use and kept, since smashes come in runs.
 */

import { deriveKey, encodeArrangement, lookupOf, type Arrangement } from './format'
import type { KeyAnswer, KeyRequest } from '../../workers/blueprint.worker'

let worker: Worker | null = null
let broken = false
let nextId = 1
const waiting = new Map<number, { resolve: (v: { key: Uint8Array; lookup: string }) => void; reject: (e: Error) => void; req: KeyRequest }>()

async function inline(req: KeyRequest): Promise<{ key: Uint8Array; lookup: string }> {
  const key = await deriveKey(req.encoding, req.rounds)
  return { key, lookup: await lookupOf(key) }
}

function getWorker(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    const w = new Worker(new URL('../../workers/blueprint.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (event: MessageEvent<KeyAnswer>) => {
      const job = waiting.get(event.data.id)
      if (!job) return
      waiting.delete(event.data.id)
      if ('error' in event.data) void inline(job.req).then(job.resolve, job.reject)
      else job.resolve({ key: event.data.key, lookup: event.data.lookup })
    }
    // A failed worker hands every job back to the page.
    w.onerror = () => {
      broken = true
      if (worker === w) worker = null
      w.terminate()
      const jobs = [...waiting.values()]
      waiting.clear()
      for (const job of jobs) void inline(job.req).then(job.resolve, job.reject)
    }
    worker = w
    return w
  } catch {
    broken = true
    return null
  }
}

/** The key and lookup of raw canonical bytes. */
export function keyOfBytes(encoding: Uint8Array, rounds?: number): Promise<{ key: Uint8Array; lookup: string }> {
  const req: KeyRequest = { id: nextId++, encoding, rounds }
  const w = getWorker()
  if (!w) return inline(req)
  return new Promise((resolve, reject) => {
    waiting.set(req.id, { resolve, reject, req })
    w.postMessage(req)
  })
}

/** The key and lookup of an arrangement (with the region key for a location lock). */
export function keyOf(a: Arrangement, regionKey?: Uint8Array | null, rounds?: number): Promise<{ key: Uint8Array; lookup: string }> {
  return keyOfBytes(encodeArrangement(a, regionKey), rounds)
}
