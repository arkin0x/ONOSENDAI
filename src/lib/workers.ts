/**
 * workers.ts — module-level worker singletons.
 *
 * Created once per page rather than per component, so React StrictMode's
 * double-mount cannot spawn duplicate threads.
 */

import type { ProofRequest, ProofResponse } from '../workers/proof.worker'
import type { TerrainRequest, TerrainResponse } from '../workers/terrain.worker'

let proofWorker: Worker | null = null
let terrainWorker: Worker | null = null

export function getProofWorker(): Worker {
  if (!proofWorker) {
    proofWorker = new Worker(new URL('../workers/proof.worker.ts', import.meta.url), {
      type: 'module',
    })
  }
  return proofWorker
}

export function getTerrainWorker(): Worker {
  if (!terrainWorker) {
    terrainWorker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), {
      type: 'module',
    })
  }
  return terrainWorker
}

export function postProof(request: ProofRequest): void {
  getProofWorker().postMessage(request)
}

export function postTerrain(request: TerrainRequest): void {
  getTerrainWorker().postMessage(request)
}

export type { ProofRequest, ProofResponse, TerrainRequest, TerrainResponse }
