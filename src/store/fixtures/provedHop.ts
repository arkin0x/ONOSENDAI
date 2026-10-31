/**
 * provedHop.ts - for tests: the proof fields of a worker's `done` message,
 * proved by cyberspace-core for the move actually lined up.
 *
 * finishProof checks every local hop at Level 1 under its own signed id
 * (review of #539, F2), so a stand-in seal is refused like a forged one. A
 * test that lands a hop gives the move it lined up (from where it stands to
 * its pending target, in its plane, from its head) and gets a real proof.
 * Pure: it takes the move, never a store, since some tests load the store
 * more than once.
 */

import { computeHopProofV2, type Plane } from 'cyberspace-core'
import type { HopTags } from '../../workers/proof.worker'
import { buildChain, chainHead, type NostrEvent } from '../../lib/events'

interface Move {
  position: { x: bigint; y: bigint; z: bigint }
  pendingTarget: { x: bigint; y: bigint; z: bigint } | null
  plane: Plane
  prevEventId: string
}

/** The proof fields for this move: real for a hop, a stand-in for anything else (a sidestep's checks are not this one's). */
export function provedHop(m: Move, mode: string = 'hop'): { proofHash: string; hop?: HopTags } {
  if (mode !== 'hop' || !m.pendingTarget || !/^[0-9a-f]{64}$/.test(m.prevEventId)) return { proofHash: 'dd'.repeat(32) }
  const { position: a, pendingTarget: b } = m
  const p = computeHopProofV2(a.x, a.y, a.z, b.x, b.y, b.z, m.plane, m.prevEventId)
  return { proofHash: p.tags.proof, hop: { sealHex: p.tags.proof, mnHex: p.tags.mn, mpHex: p.tags.mp } }
}

/** The same from a posted proof request. */
export function provedFor(request: unknown, events?: NostrEvent[]): { proofHash: string; hop?: HopTags } {
  // The request as lib/workers posted it (ProofRequest); tests type it narrowly.
  const req = request as { mode: string; from: Move['position']; to: Move['position']; plane?: Plane; prevEventId?: string }
  // A test that stood the avatar somewhere by hand, without a move, signs
  // from where the chain stands (the hop's c), as the store does; the proof
  // has to be for that.
  const standing = events && events.length > 0 ? chainHead(buildChain(events))?.position : undefined
  return provedHop({ position: standing ?? req.from, pendingTarget: req.to, plane: req.plane ?? 0, prevEventId: req.prevEventId ?? '' }, req.mode)
}
