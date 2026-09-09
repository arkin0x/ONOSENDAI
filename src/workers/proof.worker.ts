/**
 * proof.worker.ts - computes movement proofs off the main thread.
 *
 * A hop costs O(2^h) Cantor pairings; a sidestep costs O(2^h) SHA-256 hashes
 * with no storage wall. Either way a single commit can be seconds of work, so
 * it runs here, streaming real progress instead of a spinner. The main thread
 * kills this worker outright to cancel (see lib/workers.ts).
 */

import {
  deriveRegionKeys,
  alignedBase,
  computeHopProof,
  computeSidestepProof,
  encodeOpenings,
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
  /** Per-axis mp segments (spec 8.5): every opening's siblings, leaf first, as hex. */
  openings: [string, string, string]
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
      terrainK: number
      lca: { x: number; y: number; z: number }
      /** Cantor pairings for hops; SHA-256 evaluations for sidesteps; 0 for a cloud proof. */
      totalOps: number
      /** Present on sidesteps only. */
      sidestep?: SidestepTags
      /** Where the proof was computed. Absent means this worker (lib/cloud.ts sets 'cloud'). */
      source?: 'local' | 'cloud'
      /** Cloud proofs only: the HOSAKA job, what it cost, and for a hop the region's lookup id (spec 7.2). */
      jobId?: string
      costMsats?: number
      lookupId?: string
      /**
       * A hop's own region (spec §4.7 and §7.2): the box the movement crossed,
       * its three axes at their own heights, with the key that opens whatever
       * is hidden there. The computation makes it either way; dropping it threw
       * away the one thing a hop grants beyond the movement itself.
       */
      region?: {
        keyHex: string
        lookupId: string
        heights: [number, number, number]
        base: [string, string, string]
      }
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
      const response: ProofResponse = {
        type: 'done',
        id,
        mode,
        elapsedMs: performance.now() - started,
        proofHash: proof.proofHash,
        terrainK: proof.terrainK,
        lca: { x: proof.lcaHeights[0], y: proof.lcaHeights[1], z: proof.lcaHeights[2] },
        totalOps: estimate.totalHashes,
        sidestep: {
          merkleRoots: [bytesToHex(proof.merkleX), bytesToHex(proof.merkleY), bytesToHex(proof.merkleZ)],
          // §8.5: every opening's siblings leaf first per axis, empty where the axis did not move.
          openings: [encodeOpenings(proof.openings.x), encodeOpenings(proof.openings.y), encodeOpenings(proof.openings.z)],
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
      terrainK: proof.terrainK,
      lca: { x: estimate.lcaX, y: estimate.lcaY, z: estimate.lcaZ },
      totalOps: estimate.totalOps,
      // The region this hop crossed, and its key (§7.2). Free: the proof
      // already built region_n on its way to the movement proof.
      region: {
        keyHex: bytesToHex(deriveRegionKeys(proof.regionN).locationDecryptionKey),
        lookupId: deriveRegionKeys(proof.regionN).lookupIdHex,
        heights: [estimate.lcaX, estimate.lcaY, estimate.lcaZ],
        base: [
          alignedBase(from.x, estimate.lcaX).toString(),
          alignedBase(from.y, estimate.lcaY).toString(),
          alignedBase(from.z, estimate.lcaZ).toString(),
        ],
      },
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
