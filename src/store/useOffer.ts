/**
 * useOffer.ts - whether the HOSAKA offer card is on screen, and whether the
 * COMMIT button should read OFFLOAD.
 *
 * The card used to appear on its own the moment the cursor needed the cloud,
 * and stood between the person and the cursor they were still adjusting. Now
 * it appears only for the cursor OFFLOAD was pressed for: the verdict (this
 * machine, HOSAKA, HOSAKA once its caps are known, nobody) is computed here
 * from the main store and calibration, the button reads it to change its
 * label and colour, and the card reads it once asked for. NOT NOW, a moved
 * cursor, or a running flow put the card away.
 */

import { create } from 'zustand'
import { useCalibration } from '../lib/calibration'
import type { CloudMode } from '../lib/cloud'
import { localOnly, planSummary } from '../lib/movePlan'
import { offerVerdict, type OfferVerdict } from '../lib/offer'
import type { Position } from '../lib/space'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from './useCyberspace'

interface OfferState {
  dismissedFor: string | null
  /** The cursor OFFLOAD was pressed for: the card shows for it, and for nothing else. */
  requestedFor: string | null
  dismiss: (cursorKey: string) => void
  request: (cursorKey: string) => void
}

export const useOffer = create<OfferState>((set) => ({
  dismissedFor: null,
  requestedFor: null,
  dismiss: (cursorKey) => set({ dismissedFor: cursorKey, requestedFor: null }),
  request: (cursorKey) => set({ requestedFor: cursorKey, dismissedFor: null }),
}))

export interface OfferView {
  verdict: OfferVerdict
  cursorKey: string
  machineCeiling: number
  /**
   * This machine can walk it without the cloud: hops to each wall and a
   * Merkle sidestep through it. False only when some wall is taller than the
   * machine's sidestep ceiling, which is the one case nothing local crosses.
   */
  localFeasible: boolean
}

const localFeasibleFor = (position: Position, cursor: Position, hop: number, sidestep: number): boolean =>
  planSummary(position, cursor, localOnly(hop, sidestep), 20_000).infeasibleAt === null

const cursorKeyOf = (c: { x: bigint; y: bigint; z: bigint }, plane: number): string => `${c.x}:${c.y}:${c.z}:${plane}`

/** What the lined-up move needs, or null when this machine can do it. Not a hook: for the keyboard. */
export function offerNeed(): OfferView | null {
  const s = useCyberspace.getState()
  const cal = useCalibration.getState()
  const machineCeiling = Math.min(MAX_COMPUTE_HEIGHT, cal.hopHeight)
  const verdict = offerVerdict(s.position, s.cursor, s.plane, {
    hop: machineCeiling,
    sidestep: cal.sidestepHeight,
    cloudHop: s.cloud.limits?.max_hop_height ?? 0,
    cloudSidestep: s.cloud.limits?.max_sidestep_height ?? 0,
  }, s.cloud.limits !== null)
  return verdict ? { verdict, cursorKey: cursorKeyOf(s.cursor, s.plane), machineCeiling, localFeasible: localFeasibleFor(s.position, s.cursor, machineCeiling, cal.sidestepHeight) } : null
}

/** The same, for a component: recomputed as the cursor, the caps or the ceilings change. */
export function useOfferNeed(): OfferView | null {
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const plane = useCyberspace((s) => s.plane)
  const limits = useCyberspace((s) => s.cloud.limits)
  const hopCeil = useCalibration((s) => s.hopHeight)
  const sidestepCeil = useCalibration((s) => s.sidestepHeight)
  const machineCeiling = Math.min(MAX_COMPUTE_HEIGHT, hopCeil)
  const verdict = offerVerdict(position, cursor, plane, {
    hop: machineCeiling,
    sidestep: sidestepCeil,
    cloudHop: limits?.max_hop_height ?? 0,
    cloudSidestep: limits?.max_sidestep_height ?? 0,
  }, limits !== null)
  return verdict ? { verdict, cursorKey: cursorKeyOf(cursor, plane), machineCeiling, localFeasible: localFeasibleFor(position, cursor, machineCeiling, sidestepCeil) } : null
}

/**
 * COMMIT reads OFFLOAD only when HOSAKA is actually needed: some wall on the
 * way is taller than this machine's sidestep ceiling, so no local walk
 * crosses it. A wall above the hop ceiling alone is not that: the machine
 * hops to it, sidesteps through, and hops on, in more steps and more time,
 * which the proof panel's preview shows. Whether the cloud is ON, ASK or OFF
 * does not change what is needed, so the mode is not consulted here; the
 * card's own mode control turns it on.
 */
export function offloadWanted(need: OfferView | null, _mode?: CloudMode): boolean {
  return need !== null && !need.localFeasible
}

/** The offer to show right now, or null. `hidden` is the caller's veto (a menu, a secret). */
export function useOfferView(hidden: boolean): OfferView | null {
  const atHead = useCyberspace((s) => s.atHead())
  // A route being quoted or funded keeps the card up (its ESTIMATE is what started it);
  // anything running takes the screen.
  const busy = useCyberspace((s) => (s.plan !== null && s.plan.status !== 'funding') || (s.plan === null && s.cloud.status !== 'idle') || s.proof.status === 'computing')
  const dismissedFor = useOffer((s) => s.dismissedFor)
  const requestedFor = useOffer((s) => s.requestedFor)
  const need = useOfferNeed()

  // The cloud mode is not a veto here: the card appears only when asked for,
  // and its mode control is how the cloud is turned on when a move needs it.
  if (hidden || !atHead || busy || need === null) return null
  if (dismissedFor === need.cursorKey) return null
  // Only for the cursor OFFLOAD was pressed for: a moved cursor puts it away.
  if (requestedFor !== need.cursorKey) return null
  return need
}
