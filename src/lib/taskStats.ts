/**
 * taskStats.ts: for the diagnostics (lib/diag.ts), how long the work that
 * runs after an IndexedDB answer, or after the thread is handed back
 * (hopStage yieldTask), takes, and whose it was.
 *
 * A long frame's script is named by where its handler was written, not by
 * what the handler runs: most IndexedDB reads in the app resolve through one
 * onsuccess (lib/idb.ts request), and every yieldTask through one port
 * handler, so the owner's phone diag of 2026-11-22 could say only that "an
 * IndexedDB answer" took 229 to 270 ms while walking, and "a yielded task" up
 * to 372 ms. Here each is told by a label: the database and store a read was
 * made in, or what yielded. Labelled: every read through request(), and the
 * stop snapshot's read (hyperspace/snapshotRecord.ts); the other hand-written
 * onsuccess handlers are not, so a long IndexedDB answer with no label here
 * is one of those.
 *
 * The time runs from the handler to the first of: the next labelled handler
 * starting (the task before it has ended), or the next task (a message to
 * ourselves). It takes in the awaiting code that runs in the same task. It is
 * an upper bound: a rendered frame or another unlabelled task the browser
 * runs before that message is counted too. Nothing is measured until a
 * capture asks (countTasks).
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
  // The one still open ended when this handler began: its task is over.
  closeOpen(t0)
  try {
    const ch = new MessageChannel()
    const mine = { label, t0, ch }
    open = mine
    ch.port1.onmessage = () => { if (open === mine) closeOpen(performance.now()) }
    ch.port2.postMessage(0)
  } catch { /* no channel: nothing timed */ }
}

/** The measurement still running: one at a time, so none overlaps another. */
let open: { label: string; t0: number; ch: MessageChannel } | null = null

function closeOpen(now: number): void {
  const o = open
  if (!o) return
  open = null
  try { o.ch.port1.close() } catch { /* closed */ }
  record(o.label, now - o.t0)
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
