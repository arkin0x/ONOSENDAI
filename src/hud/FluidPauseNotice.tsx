/**
 * FluidPauseNotice.tsx: the word beside the CHAIN chip while fluid WALK is
 * paused for the chain (arkinox, 2026-11-22: "on the 21st action ahead, we
 * could automatically switch off fluid walk mode (and always turn it back on
 * (if it was on before) when the chain queue drops to 15 or lower").
 *
 * | State (store/fluidSwitch.ts) | Shown |
 * |---|---|
 * | paused | "Fluid paused while your chain catches up", for as long as it is |
 * | back on by itself | "Fluid back on", for FLUID_RESUME_NOTICE_MS, then it fades |
 * | anything else, out of WALK, or a chain not yours to walk | nothing |
 *
 * Calm on purpose: small white words with a dark edge, on a thin chamfered
 * tag (the house chamfer, top left and bottom right cut, drawn by hand in
 * styles.css), amber while paused and cyan once back on, the CHAIN chip's
 * own colours for those counts. It sits beside the chip, absolutely placed
 * in a row that is the chip's own size, and takes no pointer events, so
 * nothing moves when it shows, changes or goes; it fades in and out by
 * opacity alone, and is on the page only while it has something to say (and
 * for its fade). Its words are a polite live region, so a screen reader
 * hears the pause and the return.
 *
 * Drawn after FUI status tags (HUD callouts set beside the readout they
 * explain, on Dribbble and Behance "sci-fi HUD" boards) and augmented-ui's
 * clipped corners, without the dependency.
 */

import { memo, useEffect, useLayoutEffect, useReducer, useRef } from 'react'
import { FLUID_RESUME_NOTICE_MS, useFluidWalk } from '../store/fluidSwitch'
import { useCyberspace } from '../store/useCyberspace'

export const FLUID_PAUSED_TEXT = 'Fluid paused while your chain catches up'
export const FLUID_RESUMED_TEXT = 'Fluid back on'

/** What the notice says now, or null for nothing: `now` in performance.now ms. */
export function fluidNotice(s: { paused: boolean; resumedAt: number }, walking: boolean, own: boolean, now: number): 'paused' | 'resumed' | null {
  if (!walking || !own) return null
  if (s.paused) return 'paused'
  if (s.resumedAt > 0 && now - s.resumedAt < FLUID_RESUME_NOTICE_MS) return 'resumed'
  return null
}

/** How long the words stay on the page fading out after they are done, in ms: the stylesheet's fade (320 ms) and a little over. */
export const FLUID_NOTICE_FADE_MS = 400

/** The notice, beside the CHAIN chip. `own`: the chip shows your own chain at its head, the one the walk is on. Nothing on the page while it has nothing to say. Memoized, so a render of the chain explorer for its own reasons leaves it alone. */
export const FluidPauseNotice = memo(function FluidPauseNotice({ own }: { own: boolean }): JSX.Element | null {
  const paused = useFluidWalk((s) => s.paused)
  const resumedAt = useFluidWalk((s) => s.resumedAt)
  const walking = useCyberspace((s) => s.walking)
  const [, tick] = useReducer((x: number) => x + 1, 0)
  // Once back on: render again when the brief notice is over, to fade it.
  useEffect(() => {
    if (paused || resumedAt === 0) return
    const left = resumedAt + FLUID_RESUME_NOTICE_MS - performance.now()
    if (left <= 0) return
    const t = setTimeout(tick, left + 20)
    return () => clearTimeout(t)
  }, [paused, resumedAt])
  const say = fluidNotice({ paused, resumedAt }, walking, own, performance.now())
  // Done, it keeps the last words it said while it fades out, then leaves the page.
  const last = useRef<'paused' | 'resumed' | null>(null)
  useLayoutEffect(() => {
    if (say) { last.current = say; return }
    if (last.current === null) return
    const t = setTimeout(() => { last.current = null; tick() }, FLUID_NOTICE_FADE_MS)
    return () => clearTimeout(t)
  }, [say])
  const shown = say ?? last.current
  if (shown === null) return null
  return (
    <span className={`fluidnote is-${shown}${say ? ' is-on' : ''}`} role="status" aria-live="polite">
      {shown === 'paused' ? FLUID_PAUSED_TEXT : FLUID_RESUMED_TEXT}
    </span>
  )
})
