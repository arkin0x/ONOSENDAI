/**
 * verify.worker.ts - checks a cloud proof off the main thread.
 *
 * Verification is cheap next to the proof itself, but "cheap" includes
 * recomputing any axis within the local ceiling (seconds of BigInt work at
 * h17) and a temporal root of up to 65,536 pairings. The main thread would
 * freeze through the VERIFYING state it is trying to show, so it runs here.
 * One message in, one message out; the caller terminates the worker.
 *
 * A HOSAKA ride is checked here too (arkinox, 2026-10-11): Level 1
 * recomputes 32 sampled leaves, each a Cantor tree of up to 2^22 pairings,
 * which is seconds of work. The caller looks up the sampled blocks' hashes
 * first and sends them along, since the stop index lives on the main thread.
 */

import { verifyCloud, type CloudMove } from '../lib/cloudVerify'
import type { HosakaAction } from '../lib/hosaka'
import { verifyRideLevel1, type RideVerifyResult } from '../lib/hyperspace/ride'

export interface MoveVerifyRequest {
  id: number
  kind?: 'move'
  action: HosakaAction
  result: unknown
  move: CloudMove
  localCeiling: number
}

/** A ride proof's Level 1 check, with the hashes of the blocks it samples. */
export interface RideVerifyRequest {
  id: number
  kind: 'ride'
  ride: { previousEventIdHex: string; fromHeight: number; toHeight: number; rootHex: string; mp: string; mn: string }
  hashes: Record<number, string>
}

export type VerifyRequest = MoveVerifyRequest | RideVerifyRequest

export type VerifyResponse =
  | { id: number; failed: string[] }
  | { id: number; ride: RideVerifyResult }
  | { id: number; error: string }

self.onmessage = async (event: MessageEvent<VerifyRequest>) => {
  const req = event.data
  let response: VerifyResponse
  try {
    if (req.kind === 'ride') {
      const { hashes } = req
      const ride = await verifyRideLevel1({
        ...req.ride,
        blockHashFor: (h) => {
          const hash = hashes[h]
          if (!hash) throw new Error(`no hash for block ${h}`)
          return hash
        },
      })
      response = { id: req.id, ride }
    } else {
      response = { id: req.id, failed: verifyCloud(req.action, req.result, req.move, req.localCeiling) }
    }
  } catch (err) {
    response = { id: req.id, error: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage(response)
}
