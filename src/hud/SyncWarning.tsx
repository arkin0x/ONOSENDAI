/**
 * SyncWarning.tsx: WALK has run too far ahead of its proofs.
 *
 * WALK shows every step the moment it is pressed and proves them behind you
 * (store/useWalk.ts). Two steps behind is a walk keeping up; from three the
 * view is promising more than the chain has, and this says so in the middle
 * of the screen (arkinox, 2026-10-13): red, WARNING: LOSING SYNC, and how far
 * behind the proof chain is. It fades in, and fades out faster than it came
 * in once the walk is back to two, so catching up reads as relief rather
 * than as another flash.
 *
 * pointer-events: none from the stylesheet, and nothing in it is a control:
 * it sits over the scene and the pad and never takes a touch from either.
 * The count it shows is the last one worth warning about, so the words do
 * not tick down to "2 BEHIND" while it is fading away.
 */

import { useRef } from 'react'
import { losingSync, useWalk } from '../store/useWalk'
import { useCyberspace } from '../store/useCyberspace'

export function SyncWarning(): JSX.Element {
  const walking = useCyberspace((s) => s.walking)
  const behind = useWalk((s) => s.behind)
  const on = walking && losingSync(behind)
  const shown = useRef(behind)
  if (on) shown.current = behind
  return (
    <div className={`syncwarn${on ? ' is-on' : ''}`} role="status" aria-live="polite" aria-hidden={!on}>
      <div className="syncwarn__title">WARNING: LOSING SYNC</div>
      <div className="syncwarn__sub">PROOF CHAIN {shown.current} BEHIND</div>
    </div>
  )
}
