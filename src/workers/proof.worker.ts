/**
 * proof.worker.ts - computes movement proofs off the main thread.
 *
 * A hop costs O(2^h) Cantor pairings; a sidestep costs O(2^h) SHA-256 hashes
 * with no storage wall. Either way a single commit can be seconds of work, so
 * it runs here, streaming real progress instead of a spinner. The main thread
 * kills this worker outright to cancel (see lib/workers.ts).
 */

import {
  computeHopProof,
  computeSidestepProof,
  estimateHopCost,
  estimateSidestepCost,
  type Plane,
} from 'cyberspace-core'
import { bytesToHex } from '../lib/events'

export type ProofMode = 'hop' | 'sidestep'

export interface ProofRequest {
  id: number
  mode: ProofMode
  from: { x: bigint; y: bigint; z: bigint }
  to: { x: bigint; y: bigint; z: bigint }
  plane: Plane
  prevEventId: string
  maxComputeHeight: number
}

/**
 * What a sidestep event carries beyond the proof hash (spec §8.5): the
 * per-axis Merkle roots, the destination leaf's inclusion path on each axis,
 * and the LCA heights that tell a verifier how long each path should be.
 * Already hex, so the main thread can drop them straight into tags.
 */
export interface SidestepTags {
  merkleRoots: [string, string, string]
  inclusionProofs: [string, string, string]
  lcaHeights: [number, number, number]
}

export type ProofResponse =
  | { type: 'progress'; id: number; fraction: number; elapsedMs: number }
  | {
      type: 'done'
      id: number
      mode: ProofMode
      elapsedMs: number
      proofHash: string
      regionN: string
      terrainK: number
      lca: { x: number; y: number; z: number }
      /** Cantor pairings for hops; SHA-256 evaluations for sidesteps. */
      totalOps: number
      /** Present on sidesteps only. */
      sidestep?: SidestepTags
    }
  | { type: 'error'; id: number; message: string; elapsedMs: number }

/** Throttle progress posts; the core reports far more often than we can paint. */
const PROGRESS_INTERVAL_MS = 60

self.onmessage = (event: MessageEvent<ProofRequest>) => {
  const { id, mode, from, to, plane, prevEventId, maxComputeHeight } = event.data
  const started = performance.now()

  let lastPost = 0
  const onProgress = (fraction: number) => {
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
  }

  try {
    if (mode === 'sidestep') {
      const estimate = estimateSidestepCost(
        from.x, from.y, from.z,
        to.x, to.y, to.z,
      )
      const proof = computeSidestepProof(
        from.x, from.y, from.z,
        to.x, to.y, to.z,
        plane,
        prevEventId,
        onProgress,
      )
      // §8.5: siblings concatenated leaf-first per axis, empty where the axis
      // did not move.
      const path = (siblings: Uint8Array[]): string => siblings.map(bytesToHex).join('')
      const response: ProofResponse = {
        type: 'done',
        id,
        mode,
        elapsedMs: performance.now() - started,
        proofHash: proof.proofHash,
        regionN: proof.regionM.toString(),
        terrainK: proof.terrainK,
        lca: { x: proof.lcaHeights[0], y: proof.lcaHeights[1], z: proof.lcaHeights[2] },
        totalOps: estimate.totalHashes,
        sidestep: {
          merkleRoots: [bytesToHex(proof.merkleX), bytesToHex(proof.merkleY), bytesToHex(proof.merkleZ)],
          inclusionProofs: [
            path(proof.inclusionProofs.x),
            path(proof.inclusionProofs.y),
            path(proof.inclusionProofs.z),
          ],
          lcaHeights: proof.lcaHeights,
        },
      }
      self.postMessage(response)
      return
    }

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

    const proof = computeHopProof(
      from.x, from.y, from.z,
      to.x, to.y, to.z,
      plane,
      prevEventId,
      maxComputeHeight,
      onProgress,
    )

    const response: ProofResponse = {
      type: 'done',
      id,
      mode,
      elapsedMs: performance.now() - started,
      proofHash: proof.proofHash,
      regionN: proof.regionN.toString(),
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
