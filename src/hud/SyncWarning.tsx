/**
 * SyncWarning.tsx: WALK has run too far ahead of its proofs.
 *
 * WALK shows every step the moment it is pressed and proves them behind you
 * (store/useWalk.ts). A few events ahead is a walk keeping up; past
 * FLUID_EASE_FROM (14) fluid WALK slows down, and this fades in with the
 * slowdown in the middle of the screen (arkinox, 2026-11-17: "fade in the
 * sync warning relative to the slowdown amount with 14=0% and 20=100%
 * opacity"): red, WARNING: LOSING SYNC, and how far behind the proof chain
 * is. Its opacity is lib/fluidWalk.ts syncWarnOpacity of the events ahead
 * (store/walkAhead.ts): 0 at 14 or fewer, 0.5 at 17, 1 from 20, where the
 * walk stops. It eases between counts (styles.css), and the same rule holds
 * with fluid WALK off. It was all or nothing at 10 closed segments
 * (2026-11-14).
 *
 * Dressed as v1's derezz warning: a black panel in a red and black hazard
 * frame, the words in red Krypton (styles.css, .syncwarn).
 *
 * position: fixed and pointer-events: none from the stylesheet: it sits
 * over the scene and the pad, takes no space in any layout at any opacity,
 * and never takes a touch from either. Hidden, it keeps the last count it
 * showed, so the words do not change while it fades out.
 *
 * Under the box, one small line, "Turn off this warning in settings"
 * (arkinox, 2026-11-18), opens the menu at that switch (hud/settingsLink.ts).
 * It is the one control here: drawn whenever the box is, at its opacity and
 * absolutely placed under it, so nothing moves when it appears, and it takes
 * a tap or the keyboard only once the box is at least half shown. It sits
 * outside the box's live region, so a screen reader hears the count, not the
 * line, as it changes. Once pressed, the warning steps aside until the walk
 * catches up (useSyncWarnAside), so it does not cover the switch on a phone. With the sync limit off in Settings
 * (store/walkLimits.ts) the warning never shows: the walk does not slow or
 * stop either, and the CHAIN chip's edge bar still shows how far ahead you
 * are.
 */

import { useRef } from 'react'
import { create } from 'zustand'
import { useCyberspace } from '../store/useCyberspace'
import { useLayers } from '../store/useLayers'
import { useEventsAhead } from '../store/walkAhead'
import { walkWarnOpacity } from '../store/walkLimits'
import { WALK_LIMITS_ROW, openSettingAt } from './settingsLink'
import { hudFlags } from '../lib/hudFlags'

/**
 * The line was pressed: the warning steps aside until it would have gone
 * anyway (the walk caught up), so on a phone it does not sit over the switch
 * the menu just opened at.
 */
export const useSyncWarnAside = create<{ aside: boolean }>(() => ({ aside: false }))

/** At least this shown before the line takes a tap or the keyboard: a faint box is not a place to tap. */
export const SYNCWARN_TAP_FROM = 0.5

/** The warning; not mounted at all with ?nosyncwarn=1 (lib/hudFlags.ts), so none of its hooks run. */
export function SyncWarning(): JSX.Element | null {
  return hudFlags().nosyncwarn ? null : <SyncWarningBox />
}

function SyncWarningBox(): JSX.Element {
  const walking = useCyberspace((s) => s.walking)
  const ahead = useEventsAhead()
  const limits = useLayers((s) => s.walkLimits)
  const aside = useSyncWarnAside((s) => s.aside)
  const due = walking ? walkWarnOpacity(ahead, limits) : 0
  if (aside && due === 0) useSyncWarnAside.setState({ aside: false })
  const opacity = aside ? 0 : due
  const on = opacity > 0
  const tappable = opacity >= SYNCWARN_TAP_FROM
  const shown = useRef(ahead)
  if (on) shown.current = ahead
  const open = (): void => {
    useSyncWarnAside.setState({ aside: true })
    openSettingAt(WALK_LIMITS_ROW)
  }
  return (
    <div className={`syncwarn${on ? ' is-on' : ''}${tappable ? ' is-tappable' : ''}`} style={{ opacity }}>
      <div className="syncwarn__panel" role="status" aria-live="polite" aria-hidden={!on}>
        <div className="syncwarn__title">WARNING: LOSING SYNC</div>
        <div className="syncwarn__sub">PROOF CHAIN {shown.current} BEHIND</div>
      </div>
      <button type="button" className="syncwarn__off" disabled={!tappable} aria-hidden={!tappable} onClick={open}>Turn off this warning in settings</button>
    </div>
  )
}
