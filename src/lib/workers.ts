/**
 * workers.ts — worker pool management.
 *
 * Terrain workers: pool of N parallel workers sampling runs of terrain K.
 * Proof worker: single worker for Cantor proof computation.
 */

import type { RunRequest, RunResponse, TerrainReady } from '../workers/terrain.worker'
import { tlog } from './log'
import { checkVersion, useVersionGate } from './versionGate'
import type { ProofMode, ProofRequest, ProofResponse, ProofWorkerMessage } from '../workers/proof.worker'

let proofWorker: Worker | null = null
let proofHandler: ((msg: ProofResponse) => void) | null = null

/** How long a worker has to say it has the request. Covers fetching its file on a slow link. */
export const PROOF_START_MS = 20_000
/** The same for its replacement: killing a fetch at the same point again would fail a slow link on every press. */
export const PROOF_RETRY_START_MS = 60_000
/**
 * How long a started worker may stay silent. Far past the longest quiet stage
 * of the tallest hop a machine is allowed, so it ends a worker that is gone (a
 * phone can drop one while the tab is asleep, with no error event).
 */
export const PROOF_QUIET_MS = 5 * 60_000
/** A timer this far past due was asleep with the worker, whose silence then says nothing. */
export const PROOF_LATE_MS = 5_000
/** What a worker gets after a sleep, or while the tab is hidden, to say something. */
export const PROOF_THAW_MS = 30_000
/** What a move says when no worker could compute it. */
export const PROOF_WORKER_FAILED_MESSAGE = "This move's proof could not run. Press again."

/**
 * The proof being computed. Nothing else can end a move whose worker failed:
 * the store waits in 'computing' for an answer, and a worker that never loaded
 * or has died never gives one (arkinox, 2026-11-01: a hop at 0% until a
 * refresh). A worker that failed before it started is replaced once, since a
 * dropped connection is the usual reason. One that failed after starting is
 * not: the same proof may fail the same way, and it may have been a tall one.
 */
let proofRun: { request: ProofRequest; started: boolean; retried: boolean; at: number; timer: ReturnType<typeof setTimeout> | undefined } | null = null

function dropProofWorker(): void {
  proofWorker?.terminate()
  proofWorker = null
}

function endProofRun(): void {
  if (proofRun) clearTimeout(proofRun.timer)
  proofRun = null
}

function watchProofRun(ms: number): void {
  if (!proofRun) return
  clearTimeout(proofRun.timer)
  const armed = Date.now()
  proofRun.timer = setTimeout(() => {
    // A frozen tab freezes its worker too, and this timer is the first thing
    // to run when they thaw: a healthy proof must not be killed for it.
    const slept = Date.now() - armed - ms > PROOF_LATE_MS
    const hidden = typeof document !== 'undefined' && document.hidden
    if (slept || hidden) watchProofRun(PROOF_THAW_MS)
    else proofWorkerFailed('no answer')
  }, ms)
}

function proofWorkerFailed(why: string): void {
  tlog('[workers] proof worker FAILED:', why)
  dropProofWorker()
  const run = proofRun
  if (!run) return
  if (!run.started && !run.retried) {
    run.retried = true
    sendProof()
    return
  }
  endProofRun()
  proofHandler?.({ type: 'error', id: run.request.id, message: PROOF_WORKER_FAILED_MESSAGE, elapsedMs: performance.now() - run.at })
}

function sendProof(): void {
  if (!proofRun) return
  watchProofRun(proofRun.retried ? PROOF_RETRY_START_MS : PROOF_START_MS)
  try {
    getProofWorker().postMessage(proofRun.request)
  } catch (err) {
    proofWorkerFailed(err instanceof Error ? err.message : String(err))
  }
}

const TERRAIN_WORKER_COUNT = Math.max(1, (navigator.hardwareConcurrency || 4) - 1)
const terrainWorkers: Worker[] = []

/**
 * Dispatch is a pull queue, not a round robin.
 *
 * Round robin posted every job up front and let each worker drain its own
 * FIFO, so a worker that drew a slow job held back everything queued behind it
 * while other workers sat idle, and the caller's ordering was shredded across
 * the pool. Here a worker is handed the next job only when it reports the
 * previous one done, so the pool stays saturated and work starts in the order
 * the caller asked for.
 */
const terrainIdle: boolean[] = []
const runQueue: RunRequest[] = []
/** The id of the run each worker is on, so a worker that throws can say which run it lost. */
const terrainRunning: (number | null)[] = []
/** Whether each worker has said it loaded (terrain.worker.ts TerrainReady): one that errors before it has never loaded, its file gone with a deploy. */
const terrainLoaded: boolean[] = []

/**
 * Told the ids of runs that will never be answered: dropped from the queue
 * before any worker started them, or lost when a worker threw. The caller
 * marked their blocks as asked for, and those marks have to go with the runs,
 * or the blocks are never asked for again (2026-10-20).
 */
let runDropHandler: ((ids: number[]) => void) | null = null

export function setRunDropHandler(handler: ((ids: number[]) => void) | null): void {
  runDropHandler = handler
}

/**
 * Told each run's answer, after its worker is free again. One handler for
 * the pool rather than a listener on each worker, so the pool can let its
 * workers go and start new ones without anyone listening to a dead worker.
 */
let runResultHandler: ((answer: RunResponse) => void) | null = null

export function setRunResultHandler(handler: ((answer: RunResponse) => void) | null): void {
  runResultHandler = handler
}

/**
 * A pool with nothing to do for this long lets its workers go, and the next
 * run starts them again. One per core but one, each its own V8 heap with
 * cyberspace-core loaded, they sat idle for the life of the page: 7 of the
 * 12 workers alive in arkinox's ?diag=1 report (2026-11-18), on a view that
 * asks for terrain only when it moves.
 */
export const TERRAIN_IDLE_MS = 60_000
/** Pools in a row that failed to load before the next waits LOAD_REST_MS. */
export const LOAD_FAILURES_BEFORE_REST = 3
export const LOAD_REST_MS = 60_000
let loadFailures = 0
let lastLoadFailure = 0
let retireTimer: ReturnType<typeof setTimeout> | null = null

function poolIdle(): boolean {
  return runQueue.length === 0 && terrainIdle.every(Boolean)
}

/**
 * Never once a newer build is deployed: a worker holds its code while it runs,
 * but a new one asks for this build's hashed file, which the deploy may have
 * taken away (the proof worker's note, preloadProofWorker).
 */
function mayRetire(): boolean {
  return useVersionGate.getState().verdict === 'ok'
}

function armRetire(): void {
  if (retireTimer !== null || terrainWorkers.length === 0 || !poolIdle() || !mayRetire()) return
  retireTimer = setTimeout(retireTerrain, TERRAIN_IDLE_MS)
}

function retireTerrain(): void {
  retireTimer = null
  if (!poolIdle() || !mayRetire()) return
  tlog(`[workers] pool idle ${TERRAIN_IDLE_MS / 1000} s: letting ${terrainWorkers.length} workers go`)
  dropPool()
}

function dropPool(): void {
  for (const w of terrainWorkers) w.terminate()
  terrainWorkers.length = 0
  terrainIdle.length = 0
  terrainRunning.length = 0
  terrainLoaded.length = 0
}

/** Terrain workers alive now (tests). */
export function terrainWorkersAlive(): number {
  return terrainWorkers.length
}

export function setProofHandler(handler: ((msg: ProofResponse) => void) | null): void {
  proofHandler = handler
}

function getProofWorker(): Worker {
  if (!proofWorker) {
    const worker = new Worker(new URL('../workers/proof.worker.ts', import.meta.url), {
      type: 'module',
    })
    proofWorker = worker
    // A replaced worker has no say: its late answer could be a second one, and
    // its late error would end the run of the worker that replaced it.
    worker.onmessage = (event: MessageEvent<ProofWorkerMessage>) => {
      if (worker !== proofWorker) return
      const msg = event.data
      if (proofRun?.request.id === msg.id) {
        if (msg.type === 'started') proofRun.started = true
        if (msg.type === 'done' || msg.type === 'error') endProofRun()
        else watchProofRun(PROOF_QUIET_MS)
      }
      if (msg.type !== 'started') proofHandler?.(msg)
    }
    worker.onerror = (event) => { if (worker === proofWorker) proofWorkerFailed(event.message || 'worker error') }
    worker.onmessageerror = () => { if (worker === proofWorker) proofWorkerFailed('unreadable message') }
  }
  return proofWorker
}

/**
 * Start the proof worker before it is needed. A running worker holds its code,
 * so a deploy that removes the file from under an open tab costs that tab
 * nothing until the worker is replaced. A failure here is nobody's move: the
 * worker is dropped, and the move that needs one tries again.
 */
export function preloadProofWorker(): void {
  if (typeof Worker === 'undefined') return
  try {
    getProofWorker()
  } catch (err) {
    tlog('[workers] proof worker did not preload:', err instanceof Error ? err.message : String(err))
  }
}

export function getTerrainWorkers(): Worker[] {
  if (terrainWorkers.length === 0) {
    tlog(`[workers] pool: ${TERRAIN_WORKER_COUNT} workers (hardwareConcurrency=${navigator.hardwareConcurrency})`)
    for (let i = 0; i < TERRAIN_WORKER_COUNT; i++) {
      const worker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), {
        type: 'module',
      })
      const slot = i
      // Free the slot before the consumer's own listener runs, so the next
      // job is already in flight while the result is being folded into cache.
      worker.addEventListener('message', (event: MessageEvent<RunResponse | TerrainReady>) => {
        // A worker let go may still have an answer on its way: nobody's now.
        if (terrainWorkers[slot] !== worker) return
        if ('ready' in event.data) { terrainLoaded[slot] = true; loadFailures = 0; return }
        terrainIdle[slot] = true
        terrainRunning[slot] = null
        pumpRunQueue()
        runResultHandler?.(event.data)
        armRetire()
      })
      // A worker that throws never posts back, so without this its slot stays
      // busy forever and the queue drains one worker short each time until the
      // pool wedges completely and no result ever arrives again.
      worker.addEventListener('error', (event) => {
        if (terrainWorkers[slot] !== worker) return
        tlog(`[workers] w${slot} FAILED:`, event.message)
        if (!terrainLoaded[slot]) {
          // It never loaded, and its siblings came from the same file: handed
          // the next run, each would hold it for good and the pool would
          // wedge. The whole pool goes, every run out or queued is given back,
          // and the next run starts a new pool. A file gone with a deploy means
          // a newer build: the version gate is asked now, so the page says so.
          const lost = [...terrainRunning.filter((id): id is number => id !== null), ...runQueue.map((r) => r.id)]
          runQueue.length = 0
          dropPool()
          loadFailures++
          lastLoadFailure = Date.now()
          void checkVersion().catch(() => { /* asked again on its own clock */ })
          if (lost.length) runDropHandler?.(lost)
          return
        }
        const lost = terrainRunning[slot]
        terrainIdle[slot] = true
        terrainRunning[slot] = null
        pumpRunQueue()
        if (lost !== null) runDropHandler?.([lost])
        armRetire()
      })
      terrainWorkers.push(worker)
      terrainIdle.push(true)
      terrainRunning.push(null)
      terrainLoaded.push(false)
    }
  }
  return terrainWorkers
}

/** Hand queued runs to whichever workers are free. */
function pumpRunQueue(): void {
  for (let i = 0; i < terrainWorkers.length && runQueue.length > 0; i++) {
    if (!terrainIdle[i]) continue
    const run = runQueue.shift()!
    terrainIdle[i] = false
    terrainRunning[i] = run.id
    terrainWorkers[i].postMessage(run)
  }
}

export function cancelProof(): void {
  // Nothing running (the proof is done and waiting on the relays or the signer,
  // or this is a cloud flow): the worker is idle, and holds code a deploy may
  // have taken off the server.
  if (!proofRun) return
  endProofRun()
  dropProofWorker()
  preloadProofWorker()
}

export function postProof(request: ProofRequest): void {
  // A run still out would hold this one behind it.
  if (proofRun) dropProofWorker()
  endProofRun()
  proofRun = { request, started: false, retried: false, at: performance.now(), timer: undefined }
  sendProof()
}

/** Queue a run. Order is preserved: the first queued is the first started. */
export function postRun(request: RunRequest): void {
  if (retireTimer !== null) { clearTimeout(retireTimer); retireTimer = null }
  // Pools that keep failing to load are not started again on every move: a
  // minute's rest after the third in a row, the run given back meanwhile.
  if (terrainWorkers.length === 0 && loadFailures >= LOAD_FAILURES_BEFORE_REST && Date.now() - lastLoadFailure < LOAD_REST_MS) {
    runDropHandler?.([request.id])
    return
  }
  getTerrainWorkers()
  runQueue.push(request)
  pumpRunQueue()
}

/** Drop everything not yet started. Used when the view moves and stale work
 * would otherwise sit ahead of what is now on screen. Runs already on a
 * worker carry on, and their answers are kept. */
export function clearRunQueue(): void {
  if (runQueue.length === 0) return
  const dropped = runQueue.map((run) => run.id)
  runQueue.length = 0
  runDropHandler?.(dropped)
}

export function queuedRuns(): number {
  return runQueue.length
}

export type { RunRequest, RunResponse, ProofMode, ProofRequest, ProofResponse }
