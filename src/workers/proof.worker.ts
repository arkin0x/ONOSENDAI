import { movementCapabilityIssue } from '../lib/proofCapability'
/**
 * proof.worker.ts - computes movement proofs off the main thread.
 *
 * A hop costs O(2^h) Cantor pairings; a sidestep costs O(2^h) SHA-256 hashes
 * with no storage wall. Either way a single commit can be seconds of work, so
 * it runs here, streaming real progress instead of a spinner. The main thread
 * kills this worker outright to cancel (see lib/workers.ts).
 *
 * A hop is always hop proof version 2 (spec 5.9 to 5.13): the trees, the
 * region from the axis roots, and the residue openings over hop_n, which is
 * never built. What it hands back is the three tags, `proof` (the seal),
 * `mn` and `mp`, and the region the hop crossed with its key.
 */

import {
  deriveRegionKeys,
  alignedBase,
  computeHopProofV2,
  computeSidestepProof,
  encodeNonce,
  encodeOpenings,
  estimateHopCost,
  estimateSidestepCost,
  type Plane,
} from 'cyberspace-core'
import { bytesToHex } from '../lib/events'
import { hopProgressPlan } from '../lib/hopProgress'

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
 * per-axis Merkle roots, the openings on each axis, the re-roll nonce the
 * sampled openings were drawn under, and the LCA heights that tell a verifier
 * how long each path should be. Already hex, so the main thread can drop them
 * straight into tags.
 */
export interface SidestepTags {
  merkleRoots: [string, string, string]
  /** Per-axis mp segments (spec 8.5): every opening's siblings, leaf first, as hex. */
  openings: [string, string, string]
  /** The `mn` tag (spec 6.10, 8.5): the nonce as 16 lowercase hex. */
  mnHex: string
  lcaHeights: [number, number, number]
}

/**
 * What a hop event carries (spec 8.4): the seal for `proof`, the re-roll
 * nonce for `mn` and the 16 openings for `mp`, each already the tag's value.
 */
export interface HopTags {
  sealHex: string
  mnHex: string
  mpHex: string
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
      /**
       * Present on hops, local and cloud alike: the three tags. `proofHash`
       * above is the same seal. A hop without them is never signed.
       */
      hop?: HopTags
      /**
       * The chain head the proof's work was seeded by (spec §5.3): the event
       * the signed action must name as its `previous`. The store refuses to
       * sign onto any other head.
       */
      prevEventId?: string
      /** Where the proof was computed. Absent means this worker (lib/cloud.ts sets 'cloud'). */
      source?: 'local' | 'cloud'
      /** Cloud proofs only: the HOSAKA job, what it cost, and for a hop the region's lookup id (spec 7.2). */
      jobId?: string
      costMsats?: number
      lookupId?: string
      /**
       * Cloud proofs only: the move the job was bought for, from its record,
       * as coordinate hex (`to` in the record's plane). The signed event's c
       * and C must match it, or it is not kept (review of #539).
       */
      move?: { fromHex: string; toHex: string }
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
    const issue = movementCapabilityIssue(mode, from, to, plane)
    if (issue) throw new Error(issue)
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
        prevEventId,
        elapsedMs: performance.now() - started,
        proofHash: proof.proofHash,
        terrainK: proof.terrainK,
        lca: { x: proof.lcaHeights[0], y: proof.lcaHeights[1], z: proof.lcaHeights[2] },
        // The trees' hashes plus the price's attempts: the core searches the
        // nonce upward from 0, one SHA-256 each, so it made nonce + 1.
        totalOps: estimate.totalHashes + Number(proof.nonce) + 1,
        sidestep: {
          merkleRoots: [bytesToHex(proof.merkleX), bytesToHex(proof.merkleY), bytesToHex(proof.merkleZ)],
          // §8.5: every opening's siblings leaf first per axis, empty where the axis did not move.
          openings: [encodeOpenings(proof.openings.x), encodeOpenings(proof.openings.y), encodeOpenings(proof.openings.z)],
          mnHex: encodeNonce(proof.nonce),
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

    // The bar in time, not in core's units of work (lib/hopProgress.ts):
    // the residue extension is more than half of a tall hop.
    const bar = hopProgressPlan({ x: estimate.lcaX, y: estimate.lcaY, z: estimate.lcaZ, K: estimate.terrainK })
    const proof = computeHopProofV2(
      from.x, from.y, from.z,
      to.x, to.y, to.z,
      plane,
      prevEventId,
      { maxComputeHeight, onProgress: (f) => onProgress(bar.remap(f)) },
    )
    // Derived once: each derivation hashes all of region_n, 0.67 s at h20.
    const keys = deriveRegionKeys(proof.regionN)

    const response: ProofResponse = {
      type: 'done',
      id,
      mode,
      prevEventId,
      elapsedMs: performance.now() - started,
      proofHash: proof.tags.proof,
      terrainK: proof.terrainK,
      lca: { x: estimate.lcaX, y: estimate.lcaY, z: estimate.lcaZ },
      totalOps: estimate.totalOps,
      hop: { sealHex: proof.tags.proof, mnHex: proof.tags.mn, mpHex: proof.tags.mp },
      // The region this hop crossed, and its key (§7.2). Free: the proof
      // builds region_n from the axis roots anyway.
      region: {
        keyHex: bytesToHex(keys.locationDecryptionKey),
        lookupId: keys.lookupIdHex,
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
