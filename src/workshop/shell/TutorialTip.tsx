/**
 * TutorialTip.tsx - the tour's word inside the workshop (new-user feedback,
 * 2026-11-21: "I followed a tip to open the workshop and landed there with no
 * other tip. I had no idea what to do and just left").
 *
 * The tutorial's caption panel steps aside while the workshop is open (it has
 * the screen), and the workshop's own first-visit guide waits while the
 * tutorial runs (shell/Guide.tsx), so a player sent here by the tour's
 * workshop step used to get neither. This card is the tour's voice here on
 * that step: what to do first, and the way back. It stands under the top
 * bar, clear of the rail and the view ball, in one place in every state, with
 * room kept for two lines so nothing moves when its words change; BACK TO
 * THE TOUR closes the workshop as the X does, and the tour goes on.
 *
 *   - MENU up (as the tour opens it): the pieces found are in the list.
 *   - A piece on the bench: turn it, then STAMP.
 *
 * Other tour steps that use the workshop say so themselves (BUILD: "it will
 * not interrupt this"), so the card is the workshop step's alone.
 */

import { ArrowLeft, Lightbulb } from 'lucide-react'
import { useTutorial } from '../../store/useTutorial'
import { useWorkshop } from '../../store/useWorkshop'
import type { SheetKind } from '../sheets/areas'

/** The tutorial step this card belongs to (tutorial/script.ts WORKSHOP). */
export const WORKSHOP_STEP_ID = 'workshop'

/** What the card says, by where the player is. Short, plain, the owner's voice; two lines at most on a 375px phone. */
export const TIP_TEXT = {
  menu: 'Your pieces are here. Tap one to open it.',
  bench: 'Drag to turn it. Tap STAMP to add blocks.',
} as const

/** Which line the card shows, or null when it is not drawn: only on the tour's workshop step, never while the eye is being set. Pure. */
export function tipFor(active: boolean, stepId: string | undefined, sheet: SheetKind | null, eyeEdit = false): keyof typeof TIP_TEXT | null {
  if (!active || stepId !== WORKSHOP_STEP_ID || eyeEdit) return null
  return sheet === 'menu' ? 'menu' : 'bench'
}

export function TutorialTip({ sheet, eyeEdit = false }: { sheet: SheetKind | null; eyeEdit?: boolean }): JSX.Element | null {
  const active = useTutorial((s) => s.active)
  const stepId = useTutorial((s) => s.script.steps[s.index]?.id)
  const which = tipFor(active, stepId, sheet, eyeEdit)
  if (which === null) return null
  return (
    <div className="ws__tuttip" role="note" aria-label="Tutorial">
      <p className="ws__tuttip-text">
        <Lightbulb className="ws__tuttip-icon" size={14} strokeWidth={2.25} aria-hidden />
        {TIP_TEXT[which]}
      </p>
      <button className="ws__tuttip-back" onClick={() => useWorkshop.getState().closeWorkshop()} title="Close the workshop and go on with the tour">
        <ArrowLeft size={14} strokeWidth={2.25} aria-hidden />
        <span>BACK TO THE TOUR</span>
      </button>
    </div>
  )
}
