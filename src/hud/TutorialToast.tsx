/**
 * TutorialToast.tsx: the tutorial toast (tutorial/toast.ts), in the
 * instrument stack's toast group: the words, START and LATER, on the
 * Builder's toast chip with two buttons as GOAL's chip has. On screen only
 * while its offer stands and START could resume or start the tutorial
 * (toastFits): it steps aside under the tutorial, TV, the tour, a ride or a
 * game, and comes back after. Each time it is on screen for an offer counts
 * one show (noteToastOnScreen), once.
 */

import { useEffect } from 'react'
import { Gift } from 'lucide-react'
import { useCyberspace } from '../store/useCyberspace'
import { cannotStageHere, useTutorial } from '../store/useTutorial'
import { useDemo } from '../store/useDemo'
import { useTv } from '../store/useTv'
import { useGame } from '../store/useGame'
import { useTutorialSwitch } from '../tutorial/gate'
import { dismissTutorialToast, noteToastOnScreen, startFromTutorialToast, toastFits, TUTORIAL_TOAST_TEXT, useTutorialToast } from '../tutorial/toast'

export function TutorialToast(): JSX.Element | null {
  const offer = useTutorialToast((s) => s.offer)
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  // No offer for the identity on screen: nothing to watch (cannotStageHere reads the chain on every change).
  return offer !== null && offer === pubkey ? <OfferedToast pubkey={pubkey} /> : null
}

/** The chip for an offer standing for `pubkey`, while START could resume or start the tutorial. */
function OfferedToast({ pubkey }: { pubkey: string }): JSX.Element | null {
  // Each of these redraws the chip when what toastFits reads changes.
  useTutorialSwitch((s) => s.value)
  useTutorial((s) => s.active)
  useDemo((s) => s.active)
  useTv((s) => s.on)
  useGame((s) => s.session !== null)
  useCyberspace(() => cannotStageHere())
  const shown = toastFits(pubkey)

  useEffect(() => {
    if (shown) noteToastOnScreen(pubkey)
  }, [shown, pubkey])

  if (!shown) return null
  return (
    <div className="hyperbar hyperbar--toast hyperbar--buildtoast tutorialtoast">
      <Gift className="toast__build" size={16} strokeWidth={2.25} aria-hidden />
      {/* The sentence is announced; the buttons are not read out with it. */}
      <span className="hyperbar__text" role="status">
        <span className="hyperbar__meta">{TUTORIAL_TOAST_TEXT}</span>
      </span>
      <button className="hyperbar__end tutorialtoast__start" onClick={startFromTutorialToast}>START</button>
      <button className="hyperbar__end tutorialtoast__later" onClick={dismissTutorialToast}>LATER</button>
    </div>
  )
}
