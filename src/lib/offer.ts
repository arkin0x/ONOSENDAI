/**
 * offer.ts - when to offer HOSAKA, and what to say.
 *
 * The offer appears the moment the cursor is lined up somewhere this machine
 * cannot hop to. It is decided from the same numbers the store routes with
 * (calibrated ceilings, HOSAKA's caps when known), so the offer and the
 * commit never disagree about what is possible.
 */

import { estimateHopCost, type Plane } from 'cyberspace-core'
import { planSummary, type Ceilings } from './movePlan'
import type { Position } from './space'

export type OfferTier = 'machine' | 'cloud' | 'cloud-unknown' | 'impossible'

export interface OfferVerdict {
  /** Tallest per-axis LCA height of the lined-up move. */
  tallestWall: number
  /** Who can do it: this machine (no offer), HOSAKA, HOSAKA once its caps are known, or nobody. */
  tier: OfferTier
  /** Steps HOSAKA would do, when the route is feasible with the cloud on. */
  cloudSteps: number
  /** The route's step count, when feasible. */
  steps: number
}

/**
 * Null when this machine hops there itself (nothing to offer). Otherwise the
 * verdict for the offer card. `ceilings.cloudHop` of 0 means the cloud is off
 * or unknown; `cloudKnown` tells the two apart for the wording.
 */
export function offerVerdict(
  position: Position,
  cursor: Position,
  plane: Plane,
  ceilings: Ceilings,
  cloudKnown: boolean,
): OfferVerdict | null {
  if (position.x === cursor.x && position.y === cursor.y && position.z === cursor.z) return null
  const hop = estimateHopCost(position.x, position.y, position.z, cursor.x, cursor.y, cursor.z, plane, ceilings.hop)
  if (!hop.exceedsLimit) return null
  const tallestWall = hop.maxHeight
  if (!cloudKnown) return { tallestWall, tier: 'cloud-unknown', cloudSteps: 0, steps: 0 }
  // Plan with HOSAKA's caps even when the mode is off: the offer is about
  // what HOSAKA could do, and the mode control on the card turns it on.
  const s = planSummary(position, cursor, ceilings, 20_000)
  if (s.infeasibleAt !== null) return { tallestWall, tier: 'impossible', cloudSteps: s.cloudSteps, steps: s.steps }
  return { tallestWall, tier: 'cloud', cloudSteps: s.cloudSteps, steps: s.steps }
}
