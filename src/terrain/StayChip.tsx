/**
 * StayChip.tsx - the small lock by CARD while STAY IN THIS CHUNK is on
 * (terrain/chunkStay.ts), so you always know why the edge holds you. A tap on
 * it lets go. It stands in SURVEY's slot, over the corner the frame's chamfer
 * cuts, and takes no room of its own: nothing moves when it comes or goes.
 */

import { Lock } from 'lucide-react'
import { noCallout } from '../hooks/useRepeatable'
import { leaveStay, useStayKey } from './chunkStay'

/** What the chip says to a screen reader and on hover. */
export const STAY_CHIP_LABEL = 'Staying in this chunk: tap to let go'

export function StayChip(): JSX.Element | null {
  const key = useStayKey()
  if (!key) return null
  return (
    <button
      type="button"
      className="terrain-stay-chip"
      {...noCallout}
      // Its own press: never CARD's under it, never a tap on the scene.
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
      onClick={(e) => { e.stopPropagation(); e.currentTarget.blur(); leaveStay() }}
      aria-label={STAY_CHIP_LABEL}
      title={STAY_CHIP_LABEL}
    >
      <Lock size={11} strokeWidth={2.5} aria-hidden />
    </button>
  )
}
