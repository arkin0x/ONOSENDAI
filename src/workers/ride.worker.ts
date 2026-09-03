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
 */

import { bytesToHex } from 'cyberspace-core'
import { computeRideLeaf, timeCalibrationSample } from '../lib/hyperspace/ride'

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

export type RideWorkerRequest = RideChunkRequest | CalibrateRequest

export type RideChunkResponse =
  | { type: 'leaf'; id: number; height: number; leafHex: string }
  | { type: 'calibrated'; id: number; elapsedMs: number; pairs: number }
  | { type: 'error'; id: number; message: string }

self.onmessage = (event: MessageEvent<RideWorkerRequest>) => {
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
