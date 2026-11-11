/**
 * growClient.ts - the page's side of the seeds worker.
 *
 * One worker for every bloom, started on first use. A request goes out with
 * an id and its answer comes back by it. Where there is no Worker at all (the
 * tests, under node) the same job runs inline, so a test grows exactly what
 * the worker grows. A worker that fails is replaced on the next request, and
 * whatever it was asked fails with it, so nothing waits forever.
 */

import { GrowCache, handleBlobTimes, handleGrow, type BlobLoader, type BlobTimesRequest, type GrowRequest, type SeedsResponse } from './growJob'

type Pending = (answer: SeedsResponse) => void

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: Pending; req: GrowRequest | BlobTimesRequest }>()
/** The inline cache, when there is no worker. */
let inline: GrowCache | null = null
let inlineBlobs: BlobLoader | null = null

/** For tests: run blob reads inline from this loader. */
export function setInlineBlobLoader(load: BlobLoader | null): void {
  inlineBlobs = load
}

function failAll(why: string): void {
  for (const [id, { resolve, req }] of pending) {
    resolve(req.type === 'grow' ? { type: 'error', id, key: req.key, error: why } : { type: 'blob-times', id, startHeight: req.startHeight, times: null, error: why })
  }
  pending.clear()
}

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../../workers/seeds.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  worker.onmessage = (event: MessageEvent<SeedsResponse>) => {
    const answer = event.data
    const waiting = pending.get(answer.id)
    if (!waiting) return
    pending.delete(answer.id)
    waiting.resolve(answer)
  }
  worker.onerror = (e) => {
    e.preventDefault()
    worker?.terminate()
    worker = null
    failAll('The seeds worker stopped.')
  }
  return worker
}

function send<T extends GrowRequest | BlobTimesRequest>(req: Omit<T, 'id'>): Promise<SeedsResponse> {
  const id = nextId++
  const full = { ...req, id } as T
  const w = getWorker()
  if (!w) {
    if (full.type === 'grow') return Promise.resolve(handleGrow(full as GrowRequest, (inline ??= new GrowCache())).answer)
    if (!inlineBlobs) return Promise.resolve({ type: 'blob-times', id, startHeight: (full as BlobTimesRequest).startHeight, times: null, error: 'No worker.' })
    return handleBlobTimes(full as BlobTimesRequest, inlineBlobs).then((r) => r.answer)
  }
  return new Promise((resolve) => {
    pending.set(id, { resolve, req: full })
    w.postMessage(full)
  })
}

/** Grow and draw one bloom in the worker. */
export function growInWorker(req: Omit<GrowRequest, 'id' | 'type'>): Promise<SeedsResponse> {
  return send<GrowRequest>({ type: 'grow', ...req })
}

/** Read one header blob's times in the worker. */
export function blobTimesInWorker(req: Omit<BlobTimesRequest, 'id' | 'type'>): Promise<SeedsResponse> {
  return send<BlobTimesRequest>({ type: 'blob-times', ...req })
}

/** Let the worker drop grown strings it keeps for these seeds. */
export function forgetInWorker(keys: string[]): void {
  if (keys.length === 0) return
  if (worker) worker.postMessage({ type: 'forget', keys })
  else inline?.forget(keys)
}

/** For tests: drop the inline cache. */
export function resetInlineGrowth(): void {
  inline = null
}
