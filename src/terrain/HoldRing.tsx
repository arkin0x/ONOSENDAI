/**
 * HoldRing.tsx - the progress of a press-and-hold, at the cross (owner,
 * 2026-11-27: "on the buttons you have to hold, we should show the progress
 * somewhere else because my thumb covers the bar"). One ring for every hold
 * in TERRAIN (HOLDS below): a thin circle round the cross that fills
 * clockwise from the top over the hold, in the action's colour, with its name
 * and the seconds left under it in white.
 *
 * It is there only while a hold is: letting go, or a finger sliding off,
 * takes it away at once, and so does the hold completing, which is the
 * moment a smash's swing begins (terrain/smashHold.ts `swingAt`), so the ring
 * is gone before the hammer's impact flash at the cross. The fill is a plain
 * linear sweep drawn by the page (styles.css .hold-ring), nothing pulses, and
 * with reduced motion it does not even fade in.
 *
 * The buttons keep their own small bar for a key held on a desktop.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { useSmashHold } from './smashHold'
import { SURVEY_HOLD_MS, useSurveyHold } from './surveyHold'
import { HOLD_ACTIONS, RING_C, RING_R, holdFraction, holdSecondsLeft, ringOffset, type HoldAction } from './holdProgress'

/** A hold under way: which action, when it began, how long it lasts. */
export interface ActiveHold {
  action: HoldAction
  since: number
  ms: number
}

/**
 * Every hold the ring shows, first come first shown: its action and its
 * store, read as two plain values so nothing new is made per render. A new
 * hold in TERRAIN adds a line here and in holdProgress.ts HOLD_ACTIONS.
 */
export const HOLDS: ReadonlyArray<{ action: HoldAction; useSince: () => number | null; useMs: () => number }> = [
  { action: HOLD_ACTIONS.smash, useSince: () => useSmashHold((s) => s.since), useMs: () => useSmashHold((s) => s.ms) },
  { action: HOLD_ACTIONS.survey, useSince: () => useSurveyHold((s) => s.since), useMs: () => SURVEY_HOLD_MS },
]

/** The hold under way, or null. */
export function useActiveHold(): ActiveHold | null {
  let found: ActiveHold | null = null
  // The same hooks in the same order every render: HOLDS never changes.
  for (const h of HOLDS) {
    const since = h.useSince()
    const ms = h.useMs()
    if (!found && since !== null) found = { action: h.action, since, ms }
  }
  return found
}

/** The ring at the cross while a hold is under way; nothing otherwise. */
export function HoldRing(): JSX.Element | null {
  const hold = useActiveHold()
  // A new hold is a new ring: its sweep starts again from where that hold is.
  return hold ? <Ring key={`${hold.action.id}:${hold.since}`} hold={hold} /> : null
}

/** The four short ticks just outside the ring, at the top, right, bottom and left. */
const TICKS = [0, 90, 180, 270]

function Ring({ hold }: { hold: ActiveHold }): JSX.Element {
  const { action, since, ms } = hold
  // Where the hold is as the ring appears: the page's sweep runs on from there to the end, linear.
  const [shownAt] = useState(() => performance.now())
  const into = Math.max(0, shownAt - since)
  const [left, setLeft] = useState(() => holdSecondsLeft(since, ms, shownAt))
  useEffect(() => {
    const t = window.setInterval(() => setLeft(holdSecondsLeft(since, ms, performance.now())), 100)
    return () => clearInterval(t)
  }, [since, ms])

  const fill: CSSProperties & Record<string, string | number> = {
    strokeDasharray: RING_C,
    strokeDashoffset: ringOffset(holdFraction(since, ms, shownAt)),
    '--ring-c': RING_C,
    '--hold-ms': `${ms}ms`,
    animationDelay: `-${Math.round(into)}ms`,
  }
  return (
    <div className="hold-ring" data-hold={action.id} style={{ ['--hold-colour' as string]: action.colour }} aria-hidden>
      <svg className="hold-ring__svg" viewBox="0 0 48 48" width="48" height="48">
        <circle className="hold-ring__track" cx="24" cy="24" r={RING_R} />
        <circle className="hold-ring__fill" cx="24" cy="24" r={RING_R} transform="rotate(-90 24 24)" style={fill} />
        {TICKS.map((a) => <line key={a} className="hold-ring__tick" x1="24" y1="0.5" x2="24" y2="2.5" transform={`rotate(${a} 24 24)`} />)}
      </svg>
      <span className="hold-ring__label">
        <span className="hold-ring__word">{action.label}</span>
        <span className="hold-ring__secs">{left}s</span>
      </span>
    </div>
  )
}
