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
let nextTerrainWorkerIdx = 0

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
      terrainWorkers.push(worker)
    }
  }
  return terrainWorkers
}

export function cancelProof(): void {
  proofWorker?.terminate()
  proofWorker = null
}

export function postProof(request: ProofRequest): void {
  getProofWorker().postMessage(request)
}

export function postChunk(request: ChunkRequest): void {
  const workers = getTerrainWorkers()
  const worker = workers[nextTerrainWorkerIdx]
  nextTerrainWorkerIdx = (nextTerrainWorkerIdx + 1) % workers.length
  worker.postMessage(request)
}

export type { ChunkRequest, ChunkResponse, ProofMode, ProofRequest, ProofResponse }
