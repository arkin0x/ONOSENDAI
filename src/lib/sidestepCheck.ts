/**
 * sidestepCheck.ts - Level 1 of a sidestep this client just signed (spec
 * 8.7.2, cyberspace-core verifySidestepLevel1), under its own tags, with
 * everything but those tags taken from this client: the standing coordinate
 * it moved from, the destination it was proved for, the previous event. As
 * a hop is checked before it is kept or queued (localHopFailures), so a
 * sidestep whose proof does not hold for this very event is never kept or
 * sent, whatever made it wrong.
 *
 * Off the main thread (workers/verify.worker.ts). Most of the cost is the
 * temporal root, 2^K pairings for the destination's terrain K, and not the
 * wall's height: measured 2026-11-03 in Node, about 1 ms at K 8 for any wall
 * from h8 to h20, 11 ms at K 12, 52 ms at K 14, 125 ms at K 15 and 285 ms at
 * K 16. The openings at h40, the tall sidestep ceiling, with all three axes
 * crossing, are about 7 ms. A phone is several times slower, so the worst
 * case would freeze the panel for a second. Where no Worker can start (node
 * under vitest, or one that fails to load) it runs here instead.
 */

import type { Plane } from 'cyberspace-core'
import type { NostrEvent } from './events'
import type { Position } from './space'
import type { VerifyResponse } from '../workers/verify.worker'
import { checkSidestepClaim, sidestepClaimOf } from './sidestepLevel1'

export { sidestepClaimOf }

let checkId = 0

/** Level 1 of a sidestep just signed here: empty when it holds, else the names of what failed. */
export function localSidestepFailures(event: NostrEvent, fromHex: string, to: Position, plane: Plane, prevEventId: string): Promise<string[]> {
  const claim = sidestepClaimOf(event, fromHex, to, plane, prevEventId)
  if (Array.isArray(claim)) return Promise.resolve(claim)
  if (typeof Worker === 'undefined') return Promise.resolve(checkSidestepClaim(claim))
  const id = ++checkId
  return new Promise<string[]>((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('../workers/verify.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      resolve(checkSidestepClaim(claim))
      return
    }
    worker.onmessage = (event: MessageEvent<VerifyResponse>) => {
      worker.terminate()
      const msg = event.data
      if (msg.id !== id) return
      if ('failed' in msg) resolve(msg.failed)
      else if ('error' in msg) resolve([`check: ${msg.error}`])
      else resolve(['check: the verifier answered for something else'])
    }
    // A worker whose file could not load: the check runs here instead.
    worker.onerror = () => {
      worker.terminate()
      resolve(checkSidestepClaim(claim))
    }
    worker.postMessage({ id, kind: 'sidestep', claim })
  })
}
