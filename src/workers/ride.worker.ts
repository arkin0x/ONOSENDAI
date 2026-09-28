/**
 * ride.worker.ts: computes ride leaves off the main thread (DECK-0001 §5.3).
 *
 * A ride averages ~40k Cantor pairings per block with a worst block of 2^22,
 * and a full ride is 300k+ blocks, so this is hours of aggregate work. The
 * pool (lib/hyperspace/ridePool.ts) hands each worker a chunk of blocks and
 * the worker streams one message per finished leaf: a leaf lands every ~100 ms
 * on average, so per-leaf posting is both the progress signal and the
 * persistence trigger with no extra throttling needed. The pool terminates
 * workers outright to cancel; partial chunks cost nothing because every
 * finished leaf has already been posted and persisted.
 *
 * The same workers then search the re-roll nonce (§5.5): each takes a range
 * of nonces and posts every attempt, one height-16 Cantor tree, about one
 * average block, and stops its range at the first that meets the price.
 */

import { bytesToHex, hexToBytes } from 'cyberspace-core'
import { computeRideLeaf, grindAttempt, meetsPrice, timeCalibrationSample } from '../lib/hyperspace/ride'

export interface RideChunkRequest {
  type: 'chunk'
  id: number
  previousEventIdHex: string
  chunk: Array<{ height: number; blockHash: string }>
}

/** Time the calibration sample here, off the main thread: the first opening
 * of the Hyperspace panel used to spend seconds of the main thread on it. */
export interface CalibrateRequest {
  type: 'calibrate'
  id: number
}

/** Try the nonces start .. start + count - 1 against the price (§5.5). */
export interface RideGrindRequest {
  type: 'grind'
  id: number
  previousEventIdHex: string
  rootHex: string
  /** A, the price in attempts. */
  attempts: number
  start: number
  count: number
}

export type RideWorkerRequest = RideChunkRequest | CalibrateRequest | RideGrindRequest

export type RideChunkResponse =
  | { type: 'leaf'; id: number; height: number; leafHex: string }
  | { type: 'calibrated'; id: number; elapsedMs: number; pairs: number }
  /** One attempt; gHex is G when this nonce meets the price, else null. */
  | { type: 'attempt'; id: number; nonce: number; gHex: string | null }
  | { type: 'error'; id: number; message: string }

self.onmessage = (event: MessageEvent<RideWorkerRequest>) => {
  if (event.data.type === 'grind') {
    const { id, previousEventIdHex, rootHex, attempts, start, count } = event.data
    try {
      const root = hexToBytes(rootHex)
      for (let nonce = start; nonce < start + count; nonce++) {
        const G = grindAttempt(previousEventIdHex, root, BigInt(nonce))
        const hit = meetsPrice(G, attempts)
        const response: RideChunkResponse = { type: 'attempt', id, nonce, gHex: hit ? bytesToHex(G) : null }
        self.postMessage(response)
        if (hit) return
      }
    } catch (err) {
      const response: RideChunkResponse = { type: 'error', id, message: err instanceof Error ? err.message : String(err) }
      self.postMessage(response)
    }
    return
  }
  if (event.data.type === 'calibrate') {
    const { id } = event.data
    try {
      const { elapsedMs, pairs } = timeCalibrationSample()
      const response: RideChunkResponse = { type: 'calibrated', id, elapsedMs, pairs }
      self.postMessage(response)
    } catch (err) {
      const response: RideChunkResponse = { type: 'error', id, message: err instanceof Error ? err.message : String(err) }
      self.postMessage(response)
    }
    return
  }
  const { id, previousEventIdHex, chunk } = event.data
  try {
    for (const { height, blockHash } of chunk) {
      const leaf = computeRideLeaf(previousEventIdHex, height, blockHash)
      const response: RideChunkResponse = {
        type: 'leaf',
        id,
        height,
        leafHex: bytesToHex(leaf),
      }
      self.postMessage(response)
    }
  } catch (err) {
    const response: RideChunkResponse = {
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(response)
  }
}
