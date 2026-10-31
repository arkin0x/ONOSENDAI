/**
 * client.ts - how the page reaches the database: through the event worker
 * where there is one, and otherwise right here, running the same code on the
 * main thread (the fallback lib/sigCheck.ts takes). A worker that cannot
 * start, fails, or does not answer in time is given up for the rest of the
 * page, and what it had not answered runs here instead, in order. Every op is
 * safe to run twice, so a call the worker finished without saying so does no harm.
 */

import { answer, type EventDbOp, type EventDbOps, type EventDbRequest, type EventDbResponse } from './ops'
import { onNote, type EventDbNote } from './channel'

/** Who this tab is, in the notes every committed write posts. */
export const TAB_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** How long the worker gets to answer an ordinary call before it is given up. */
export const WORKER_PATIENCE_MS = 10_000

interface Waiting { request: EventDbRequest; settle: (response: EventDbResponse) => void; timer: ReturnType<typeof setTimeout> | null; patienceMs: number }

let worker: Worker | null = null
/** True once the worker is given up, or was never there to begin with. */
let here = typeof Worker === 'undefined'
let calls = 0
const waiting = new Map<number, Waiting>()
/** Calls made on the main thread run one at a time, in the order made, as the worker's do. */
let hereQueue: Promise<unknown> = Promise.resolve()

function runHere(request: EventDbRequest): Promise<EventDbResponse> {
  const next = hereQueue.then(() => answer(request))
  hereQueue = next
  return next
}

/** Give up the worker: what it has not answered runs here, in the order it was asked. */
function giveUp(why: string): void {
  if (here) return
  here = true
  console.warn(`[events] the event worker ${why}: the database runs on the main thread for this page`)
  try { worker?.terminate() } catch { /* already gone */ }
  worker = null
  const orphans = [...waiting.values()].sort((a, b) => a.request.call - b.request.call)
  waiting.clear()
  for (const w of orphans) {
    if (w.timer) clearTimeout(w.timer)
    void runHere(w.request).then(w.settle)
  }
}

function started(): Worker | null {
  if (here) return null
  if (worker) return worker
  try {
    const w = new Worker(new URL('../../workers/events.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (message: MessageEvent<EventDbResponse>) => {
      const entry = waiting.get(message.data.call)
      if (entry) {
        waiting.delete(message.data.call)
        if (entry.timer) clearTimeout(entry.timer)
        entry.settle(message.data)
      }
      // A worker answering is a worker alive: it runs one request at a time, so
      // what waits behind a long one has only been waiting its turn.
      for (const w2 of waiting.values()) {
        if (w2.timer) clearTimeout(w2.timer)
        w2.timer = setTimeout(() => giveUp('did not answer'), w2.patienceMs)
      }
    }
    w.onerror = () => giveUp('failed')
    worker = w
    return w
  } catch {
    giveUp('could not start')
    return null
  }
}

/** Run an op. Rejects with what stopped it, by name, so a caller can tell a full disk from the rest. */
export function callEventDb<K extends EventDbOp>(op: K, args: Parameters<EventDbOps[K]>, patienceMs = WORKER_PATIENCE_MS): Promise<Awaited<ReturnType<EventDbOps[K]>>> {
  const request: EventDbRequest = { call: ++calls, op, args }
  return new Promise<EventDbResponse>((settle) => {
    const w = started()
    if (!w) { void runHere(request).then(settle); return }
    const timer = setTimeout(() => giveUp('did not answer'), patienceMs)
    waiting.set(request.call, { request, settle, timer, patienceMs })
    try {
      w.postMessage(request)
    } catch {
      giveUp('refused a message')
    }
  }).then((response) => {
    if (response.ok) return response.value as Awaited<ReturnType<EventDbOps[K]>>
    throw Object.assign(new Error(response.message), { name: response.name })
  })
}

/** Hear what other tabs committed: this tab's own writes are left out. The returned function stops listening. */
export function onOtherTab(listen: (note: EventDbNote) => void): () => void {
  return onNote((note) => { if (note.by !== TAB_ID) listen(note) })
}

/** Whether this browser has IndexedDB at all (node under the tests has none unless a test installs one). */
export function eventDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}
