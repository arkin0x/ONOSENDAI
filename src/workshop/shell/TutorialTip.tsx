/**
 * TutorialTip.tsx - the tour's word inside the workshop (new-user feedback,
 * 2026-11-21: "I followed a tip to open the workshop and landed there with no
 * other tip. I had no idea what to do and just left").
 *
 * The tutorial's caption panel steps aside while the workshop is open (it has
 * the screen), and the workshop's own first-visit guide waits while the
 * tutorial runs (shell/Guide.tsx), so a player sent here by the tour used to
 * get neither. This card is the tour's voice here: what to do first, and the
 * way back. It stands under the top bar, clear of the rail, in one place in
 * every state, with room kept for two lines so nothing moves when its words
 * change; BACK TO THE TOUR closes the workshop as the ✕ does.
 *
 *   - The workshop step, MENU up (as the tour opens it): the pieces found are
 *     in the list; tap one.
 *   - The workshop step, a piece on the bench: turn it, then try STAMP.
 *   - Any other step (the workshop opened some other way mid-tour): the tour
 *     is waiting, and the way back.
 */

import { ArrowLeft, Lightbulb } from 'lucide-react'
import { useTutorial } from '../../store/useTutorial'
import { useWorkshop } from '../../store/useWorkshop'
import type { SheetKind } from '../sheets/areas'

/** The tutorial step whose tip this card gives most fully (tutorial/script.ts WORKSHOP). */
export const WORKSHOP_STEP_ID = 'workshop'

/** What the card says, by where the player is. Short, plain, the owner's voice. */
export const TIP_TEXT = {
  menu: 'These are the pieces you found. Tap one to put it on the grid.',
  bench: 'Drag the grid to turn it. Then tap STAMP and tap the grid to add a block.',
  other: 'The tour is waiting for you.',
} as const

/** The line under it: always the way back. */
export const TIP_BACK = 'WHEN YOU ARE DONE, TAP BACK TO THE TOUR'

/** Which line the card shows, or null when there is no tour running. Pure. */
export function tipFor(active: boolean, stepId: string | undefined, sheet: SheetKind | null): keyof typeof TIP_TEXT | null {
  if (!active || !stepId) return null
  if (stepId !== WORKSHOP_STEP_ID) return 'other'
  return sheet === 'menu' ? 'menu' : 'bench'
}

export function TutorialTip({ sheet }: { sheet: SheetKind | null }): JSX.Element | null {
  const active = useTutorial((s) => s.active)
  const stepId = useTutorial((s) => s.script.steps[s.index]?.id)
  const which = tipFor(active, stepId, sheet)
  if (which === null) return null
  return (
    <div className="ws__tuttip" role="note" aria-label="Tutorial">
      <Lightbulb className="ws__tuttip-icon" size={18} strokeWidth={2} aria-hidden />
      <div className="ws__tuttip-body">
        <p className="ws__tuttip-text">{TIP_TEXT[which]}</p>
        <p className="ws__tuttip-sub">{TIP_BACK}</p>
      </div>
      <button className="ws__tuttip-back" onClick={() => useWorkshop.getState().closeWorkshop()} title="Close the workshop and go on with the tour (Esc)">
        <ArrowLeft size={14} strokeWidth={2.25} aria-hidden />
        <span>BACK TO THE TOUR</span>
      </button>
    </div>
  )
}
