/**
 * verify.worker.ts - checks a cloud proof off the main thread.
 *
 * Verification is cheap next to the proof itself, but "cheap" includes
 * recomputing any axis within the local ceiling (seconds of BigInt work at
 * h17) and a temporal root of up to 65,536 pairings. The main thread would
 * freeze through the VERIFYING state it is trying to show, so it runs here.
 * One message in, one message out; the caller terminates the worker.
 */

import { verifyCloud, type CloudMove } from '../lib/cloudVerify'
import type { HosakaAction } from '../lib/hosaka'

export interface VerifyRequest {
  id: number
  action: HosakaAction
  result: unknown
  move: CloudMove
  localCeiling: number
}

export type VerifyResponse =
  | { id: number; failed: string[] }
  | { id: number; error: string }

self.onmessage = (event: MessageEvent<VerifyRequest>) => {
  const { id, action, result, move, localCeiling } = event.data
  let response: VerifyResponse
  try {
    response = { id, failed: verifyCloud(action, result, move, localCeiling) }
  } catch (err) {
    response = { id, error: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage(response)
}
