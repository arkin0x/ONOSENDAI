/**
 * useOffer.ts - whether the HOSAKA offer card is on screen.
 *
 * The card's own state is one thing: which cursor NOT NOW was pressed for.
 * Everything else that decides its visibility is read from the main store and
 * calibration, here, so App can clear the other overlays while the card is up
 * and the card itself renders from the same answer.
 */

import { create } from 'zustand'
import { useCalibration } from '../lib/calibration'
import { offerVerdict, type OfferVerdict } from '../lib/offer'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from './useCyberspace'

interface OfferState {
  dismissedFor: string | null
  dismiss: (cursorKey: string) => void
}

export const useOffer = create<OfferState>((set) => ({
  dismissedFor: null,
  dismiss: (cursorKey) => set({ dismissedFor: cursorKey }),
}))

export interface OfferView {
  verdict: OfferVerdict
  cursorKey: string
  machineCeiling: number
}

/** The offer to show right now, or null. `hidden` is the caller's veto (a menu, a secret). */
export function useOfferView(hidden: boolean): OfferView | null {
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const plane = useCyberspace((s) => s.plane)
  const atHead = useCyberspace((s) => s.atHead())
  // A route being quoted or funded keeps the card up (its ESTIMATE is what started it);
  // anything running takes the screen.
  const busy = useCyberspace((s) => (s.plan !== null && s.plan.status !== 'funding') || (s.plan === null && s.cloud.status !== 'idle') || s.proof.status === 'computing')
  const limits = useCyberspace((s) => s.cloud.limits)
  const hopCeil = useCalibration((s) => s.hopHeight)
  const sidestepCeil = useCalibration((s) => s.sidestepHeight)
  const dismissedFor = useOffer((s) => s.dismissedFor)

  if (hidden || !atHead || busy) return null
  const cursorKey = `${cursor.x}:${cursor.y}:${cursor.z}:${plane}`
  if (dismissedFor === cursorKey) return null
  const machineCeiling = Math.min(MAX_COMPUTE_HEIGHT, hopCeil)
  const verdict = offerVerdict(position, cursor, plane, {
    hop: machineCeiling,
    sidestep: sidestepCeil,
    cloudHop: limits?.max_hop_height ?? 0,
    cloudSidestep: limits?.max_sidestep_height ?? 0,
  }, limits !== null)
  return verdict ? { verdict, cursorKey, machineCeiling } : null
}
