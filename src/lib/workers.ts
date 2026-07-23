/**
 * workers.ts - module-level worker singletons.
 *
 * Created once per page rather than per component, so React StrictMode's
 * double-mount cannot spawn duplicate threads. The proof worker can also be
 * killed mid-computation (cancelProof) and respawns lazily on the next post,
 * with its message handler re-wired at spawn time.
 */

import type { ProofMode, ProofRequest, ProofResponse } from '../workers/proof.worker'
import type { TerrainRequest, TerrainResponse } from '../workers/terrain.worker'

let proofWorker: Worker | null = null
let terrainWorker: Worker | null = null
let proofHandler: ((msg: ProofResponse) => void) | null = null

/** Register the sink for proof messages. Survives worker respawns. */
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

/**
 * Abandon whatever the proof worker is doing. A Cantor proof is one
 * synchronous computation that cannot be interrupted cooperatively, so cancel
 * means terminate the thread; the next postProof spawns a fresh one.
 */
export function cancelProof(): void {
  proofWorker?.terminate()
  proofWorker = null
}

export function postTerrain(request: TerrainRequest): void {
  getTerrainWorker().postMessage(request)
}

export type { ProofMode, ProofRequest, ProofResponse, TerrainRequest, TerrainResponse }
