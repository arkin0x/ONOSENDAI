/**
 * rescanSignal.ts: a scan found an object it already holds, with a table of
 * carried objects.
 *
 * Parsed again each scan, such an object was a new table, and a new table is what
 * made its draw resolve its parts again (lib/parts useResolved), which is how a
 * part missing the first time was ever found. Kept as one model it has no new
 * table, so this says the same thing out loud, and a draw with a part still
 * missing asks again. Apart from both, since parts and hidden should not import
 * each other for it.
 */

const listeners = new Set<() => void>()
let queued = false

/** Hear of a rescan; the return stops it. */
export function onRescan(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Say so, once however many objects one scan found. */
export function signalRescan(): void {
  if (queued) return
  queued = true
  queueMicrotask(() => {
    queued = false
    for (const l of listeners) l()
  })
}
