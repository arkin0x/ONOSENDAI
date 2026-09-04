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
import { offerVerdict, type OfferVerdict } from '../lib/offer'
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
}

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
  return verdict ? { verdict, cursorKey: cursorKeyOf(s.cursor, s.plane), machineCeiling } : null
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
  return verdict ? { verdict, cursorKey: cursorKeyOf(cursor, plane), machineCeiling } : null
}

/** The move needs HOSAKA (or may, until its caps are known) and the cloud is not OFF: COMMIT reads OFFLOAD. */
export function offloadWanted(need: OfferView | null, mode: CloudMode): boolean {
  return need !== null && mode !== 'off' && (need.verdict.tier === 'cloud' || need.verdict.tier === 'cloud-unknown')
}

/** The offer to show right now, or null. `hidden` is the caller's veto (a menu, a secret). */
export function useOfferView(hidden: boolean): OfferView | null {
  const atHead = useCyberspace((s) => s.atHead())
  // A route being quoted or funded keeps the card up (its ESTIMATE is what started it);
  // anything running takes the screen.
  const busy = useCyberspace((s) => (s.plan !== null && s.plan.status !== 'funding') || (s.plan === null && s.cloud.status !== 'idle') || s.proof.status === 'computing')
  const dismissedFor = useOffer((s) => s.dismissedFor)
  const requestedFor = useOffer((s) => s.requestedFor)
  const mode = useCyberspace((s) => s.cloudPrefs.mode)
  const need = useOfferNeed()

  if (hidden || !atHead || busy || mode === 'off' || need === null) return null
  if (dismissedFor === need.cursorKey) return null
  // Only for the cursor OFFLOAD was pressed for: a moved cursor puts it away.
  if (requestedFor !== need.cursorKey) return null
  return need
}
