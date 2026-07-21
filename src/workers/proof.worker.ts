/**
 * proof.worker.ts — computes movement proofs off the main thread.
 *
 * A hop costs O(2^h) Cantor pairings where h is the LCA height, so at higher
 * scales a single keypress can be seconds of work. Running it here keeps the
 * scene at 60fps and lets the HUD stream real progress instead of a spinner.
 */

import { computeHopProof, estimateHopCost, type Plane } from 'cyberspace-core'

export interface ProofRequest {
  id: number
  from: { x: bigint; y: bigint; z: bigint }
  to: { x: bigint; y: bigint; z: bigint }
  plane: Plane
  prevEventId: string
  maxComputeHeight: number
}

export type ProofResponse =
  | { type: 'progress'; id: number; fraction: number; elapsedMs: number }
  | {
      type: 'done'
      id: number
      elapsedMs: number
      proofHash: string
      regionN: string
      hopN: string
      terrainK: number
      lca: { x: number; y: number; z: number }
      totalOps: number
    }
  | { type: 'error'; id: number; message: string; elapsedMs: number }

/** Throttle progress posts; the core reports far more often than we can paint. */
const PROGRESS_INTERVAL_MS = 60

self.onmessage = (event: MessageEvent<ProofRequest>) => {
  const { id, from, to, plane, prevEventId, maxComputeHeight } = event.data
  const started = performance.now()

  try {
    const estimate = estimateHopCost(
      from.x, from.y, from.z,
      to.x, to.y, to.z,
      plane,
      maxComputeHeight,
    )

    if (estimate.exceedsLimit) {
      // Not a crash: this is the protocol telling us the move needs a sidestep
      // rather than a Cantor hop. Surface it as a first-class result.
      const message =
        `LCA height ${estimate.maxHeight} exceeds the compute ceiling of ${maxComputeHeight}. ` +
        `This hop would need ~2^${estimate.maxHeight} pairings; the protocol crosses ` +
        `boundaries this large with a Merkle sidestep instead.`
      const response: ProofResponse = {
        type: 'error',
        id,
        message,
        elapsedMs: performance.now() - started,
      }
      self.postMessage(response)
      return
    }

    let lastPost = 0
    const proof = computeHopProof(
      from.x, from.y, from.z,
      to.x, to.y, to.z,
      plane,
      prevEventId,
      maxComputeHeight,
      (fraction) => {
        const now = performance.now()
        if (now - lastPost < PROGRESS_INTERVAL_MS) return
        lastPost = now
        const response: ProofResponse = {
          type: 'progress',
          id,
          fraction,
          elapsedMs: now - started,
        }
        self.postMessage(response)
      },
    )

    const response: ProofResponse = {
      type: 'done',
      id,
      elapsedMs: performance.now() - started,
      proofHash: proof.proofHash,
      regionN: proof.regionN.toString(),
      hopN: proof.hopN.toString(),
      terrainK: proof.terrainK,
      lca: { x: estimate.lcaX, y: estimate.lcaY, z: estimate.lcaZ },
      totalOps: estimate.totalOps,
    }
    self.postMessage(response)
  } catch (err) {
    const response: ProofResponse = {
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
      elapsedMs: performance.now() - started,
    }
    self.postMessage(response)
  }
}
