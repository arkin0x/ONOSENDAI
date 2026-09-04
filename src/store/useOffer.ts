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
import { localOnly, nextStep, routeFeasible, routeNeedsCloud, type Ceilings, type PlanStep } from '../lib/movePlan'
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
  routeFeasible(position, cursor, localOnly(hop, sidestep))

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
 * The one action the next commit would take toward the cursor, which is what
 * the COMMIT button names:
 *
 * - `hop`: this machine hops to the cursor.
 * - `hop-to-boundary`: this machine hops to the leaf touching the boundary
 *   it cannot hop across; the cursor stays where it is.
 * - `sidestep`: this machine sidesteps one gibson through that boundary.
 * - `offload`: the step is HOSAKA's (a hop or a sidestep past this machine),
 *   or might be, until HOSAKA's caps are known.
 * - `too-far`: some boundary on the way is higher than anyone computes.
 *
 * HOSAKA's caps are used whatever the cloud mode: what the move needs does
 * not depend on a setting, and the card's mode control turns the cloud on.
 */
export type NextAction = 'hop' | 'hop-to-boundary' | 'sidestep' | 'offload' | 'too-far'

export interface NextActionView {
  action: NextAction
  /** The step itself, for local actions and HOSAKA's; null when too far. */
  step: PlanStep | null
  cursorKey: string
}

export function nextActionFor(position: Position, cursor: Position, plane: number, hopCeil: number, sidestepCeil: number, limits: { max_hop_height: number; max_sidestep_height: number } | null): NextActionView | null {
  if (position.x === cursor.x && position.y === cursor.y && position.z === cursor.z) return null
  const machineCeiling = Math.min(MAX_COMPUTE_HEIGHT, hopCeil)
  const cursorKey = cursorKeyOf(cursor, plane)
  // Local first, per step (lib/movePlan.ts): the next step is this machine's
  // whenever it has one. HOSAKA enters only at a boundary this machine cannot
  // cross, which is when it is actually needed; a route with such a boundary
  // anywhere on it reads OFFLOAD from the start. A cursor no one reaches is
  // TOO FAR as soon as HOSAKA's caps are known; until they are, OFFLOAD asks.
  const ceilings: Ceilings = { hop: machineCeiling, sidestep: sidestepCeil, cloudHop: limits?.max_hop_height ?? 0, cloudSidestep: limits?.max_sidestep_height ?? 0 }
  if (limits !== null && !routeFeasible(position, cursor, ceilings)) return { action: 'too-far', step: null, cursorKey }
  const step = nextStep(position, cursor, ceilings)
  if (!step) return null
  // OFFLOAD whenever any step of the way is HOSAKA's, not only when the next
  // one is: the button names what the route costs. The step is still the
  // next one, local or not, so the ghost stands where this commit lands.
  if (step.source === 'infeasible') return { action: 'offload', step: null, cursorKey }
  if (routeNeedsCloud(position, cursor, ceilings)) return { action: 'offload', step, cursorKey }
  if (step.kind === 'sidestep') return { action: 'sidestep', step, cursorKey }
  const lands = step.to.x === cursor.x && step.to.y === cursor.y && step.to.z === cursor.z
  return { action: lands ? 'hop' : 'hop-to-boundary', step, cursorKey }
}

/** The next action, read from the stores. Not a hook: for the keyboard. */
export function nextAction(): NextActionView | null {
  const s = useCyberspace.getState()
  const cal = useCalibration.getState()
  return nextActionFor(s.position, s.cursor, s.plane, cal.hopHeight, cal.sidestepHeight, s.cloud.limits)
}

/** The same, for a component. */
export function useNextAction(): NextActionView | null {
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const plane = useCyberspace((s) => s.plane)
  const limits = useCyberspace((s) => s.cloud.limits)
  const hopCeil = useCalibration((s) => s.hopHeight)
  const sidestepCeil = useCalibration((s) => s.sidestepHeight)
  return nextActionFor(position, cursor, plane, hopCeil, sidestepCeil, limits)
}

/** What the COMMIT button says for each next action. */
export const ACTION_LABEL: Record<NextAction, string> = {
  hop: 'COMMIT',
  'hop-to-boundary': 'HOP TO BOUNDARY',
  sidestep: 'SIDESTEP',
  offload: 'OFFLOAD',
  'too-far': 'TOO FAR',
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
