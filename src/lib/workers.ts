/**
 * workers.ts — worker pool management.
 *
 * Terrain workers: pool of N parallel workers for chunk computation.
 * Proof worker: single worker for Cantor proof computation.
 */

import type { ChunkRequest, ChunkResponse } from '../workers/terrain.worker'
import type { ProofMode, ProofRequest, ProofResponse } from '../workers/proof.worker'

let proofWorker: Worker | null = null
let proofHandler: ((msg: ProofResponse) => void) | null = null

const TERRAIN_WORKER_COUNT = Math.max(1, (navigator.hardwareConcurrency || 4) - 1)
const terrainWorkers: Worker[] = []

/**
 * Chunk dispatch is a pull queue, not a round robin.
 *
 * Round robin posted every chunk up front and let each worker drain its own
 * FIFO, so a worker that drew a slow chunk held back everything queued behind
 * it while other workers sat idle, and the caller's nearest-first ordering was
 * shredded across the pool. Here a worker is handed the next chunk only when
 * it reports the previous one done, so the pool stays saturated and chunks are
 * started in the order the caller asked for.
 */
const terrainIdle: boolean[] = []
const chunkQueue: ChunkRequest[] = []

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
    console.log(`[workers] Creating terrain worker pool: ${TERRAIN_WORKER_COUNT} workers (hardwareConcurrency=${navigator.hardwareConcurrency})`)
    for (let i = 0; i < TERRAIN_WORKER_COUNT; i++) {
      const worker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), {
        type: 'module',
      })
      const slot = i
      // Free the slot before the consumer's own listener runs, so the next
      // chunk is already in flight while React renders the one that landed.
      worker.addEventListener('message', () => {
        terrainIdle[slot] = true
        pumpChunkQueue()
      })
      terrainWorkers.push(worker)
      terrainIdle.push(true)
    }
  }
  return terrainWorkers
}

/** Hand queued chunks to whichever workers are free. */
function pumpChunkQueue(): void {
  for (let i = 0; i < terrainWorkers.length && chunkQueue.length > 0; i++) {
    if (!terrainIdle[i]) continue
    terrainIdle[i] = false
    terrainWorkers[i].postMessage(chunkQueue.shift())
  }
}

export function cancelProof(): void {
  proofWorker?.terminate()
  proofWorker = null
}

export function postProof(request: ProofRequest): void {
  getProofWorker().postMessage(request)
}

/** Queue a chunk. Order is preserved: the first queued is the first started. */
export function postChunk(request: ChunkRequest): void {
  getTerrainWorkers()
  chunkQueue.push(request)
  pumpChunkQueue()
}

export type { ChunkRequest, ChunkResponse, ProofMode, ProofRequest, ProofResponse }
