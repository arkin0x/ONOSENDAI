/**
 * taskStats.ts: for the diagnostics (lib/diag.ts), how long the work that
 * runs after an IndexedDB answer, or after the thread is handed back
 * (hopStage yieldTask), takes, and whose it was.
 *
 * A long frame's script is named by where its handler was written, not by
 * what the handler runs: every IndexedDB read in the app resolves through
 * one onsuccess (lib/idb.ts request), and every yieldTask through one
 * port handler, so the owner's phone diag of 2026-11-22 could say only that
 * "an IndexedDB answer" took 229 to 270 ms while walking, and "a yielded
 * task" up to 372 ms. Here each is told by a label: the database and store
 * a read was made in, or what yielded.
 *
 * The time is from the handler to the start of the next task (a message to
 * ourselves), which takes in the awaiting code that runs in the same task.
 * Nothing is measured until a capture asks (countTasks).
 */

export interface TaskStat { n: number; ms: number; max: number }

let stats: Map<string, TaskStat> | null = null

/** Start counting, and get the window's counts with `take` (each take starts a fresh window). */
export function countTasks(): { take: () => Map<string, TaskStat> } {
  stats ??= new Map()
  return { take: () => { const out = stats ?? new Map(); stats = new Map(); return out } }
}

/** Whether a capture counts now: the callers skip their timing otherwise. */
export function countingTasks(): boolean {
  return stats !== null
}

function record(label: string, ms: number): void {
  if (!stats) return
  let s = stats.get(label)
  if (!s) { s = { n: 0, ms: 0, max: 0 }; stats.set(label, s) }
  s.n++
  s.ms += ms
  if (ms > s.max) s.max = ms
}

/**
 * Time the rest of this task from now, under `label`: called first thing in
 * a handler, it covers the handler and what its promise's awaiters run.
 */
export function timeRestOfTask(label: string): void {
  if (!stats || typeof MessageChannel === 'undefined') return
  const t0 = performance.now()
  const ch = new MessageChannel()
  ch.port1.onmessage = () => { ch.port1.close(); record(label, performance.now() - t0) }
  ch.port2.postMessage(0)
}

/** The label of an IndexedDB request: its database and store (and index), names the app chose. */
export function idbLabel(req: IDBRequest): string {
  try {
    const src = req.source as IDBObjectStore | IDBIndex | null
    const os = src && 'objectStore' in src ? src.objectStore : (src as IDBObjectStore | null)
    const store = src && 'objectStore' in src ? `${src.objectStore.name}.${src.name}` : os?.name ?? '?'
    return `idb:${os?.transaction?.db.name ?? req.transaction?.db.name ?? '?'}.${store}`
  } catch {
    return 'idb:?'
  }
}
