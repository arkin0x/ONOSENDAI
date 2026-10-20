/**
 * workers.ts — worker pool management.
 *
 * Terrain workers: pool of N parallel workers sampling runs of terrain K.
 * Proof worker: single worker for Cantor proof computation.
 */

import type { RunRequest, RunResponse } from '../workers/terrain.worker'
import { tlog } from './log'
import type { ProofMode, ProofRequest, ProofResponse } from '../workers/proof.worker'

let proofWorker: Worker | null = null
let proofHandler: ((msg: ProofResponse) => void) | null = null

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

export function setProofHandler(handler: ((msg: ProofResponse) => void) | null): void {
  proofHandler = handler
}

function getProofWorker(): Worker {
  if (!proofWorker) {
    proofWorker = new Worker(new URL('../workers/proof.worker.ts', import.meta.url), {
      type: 'module',
    })
    proofWorker.onmessage = (event: MessageEvent<ProofResponse>) => proofHandler?.(event.data)
  }
  return proofWorker
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
      worker.addEventListener('message', () => {
        terrainIdle[slot] = true
        terrainRunning[slot] = null
        pumpRunQueue()
      })
      // A worker that throws never posts back, so without this its slot stays
      // busy forever and the queue drains one worker short each time until the
      // pool wedges completely and no result ever arrives again.
      worker.addEventListener('error', (event) => {
        tlog(`[workers] w${slot} FAILED:`, event.message)
        const lost = terrainRunning[slot]
        terrainIdle[slot] = true
        terrainRunning[slot] = null
        pumpRunQueue()
        if (lost !== null) runDropHandler?.([lost])
      })
      terrainWorkers.push(worker)
      terrainIdle.push(true)
      terrainRunning.push(null)
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
  proofWorker?.terminate()
  proofWorker = null
}

export function postProof(request: ProofRequest): void {
  getProofWorker().postMessage(request)
}

/** Queue a run. Order is preserved: the first queued is the first started. */
export function postRun(request: RunRequest): void {
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
