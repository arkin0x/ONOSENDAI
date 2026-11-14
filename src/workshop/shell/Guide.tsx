/**
 * Guide.tsx - the first visit (workshop redesign, phase 4): three steps that
 * teach by doing, on the real buttons, each one stepping forward when you do
 * the thing. Stamp a block, turn the view, paint a face; then DEPLOY lights
 * up. The button a step needs glows on the dock. SKIP is always there, and
 * once done or skipped the guide never comes back. It replaces the old text
 * card, which explained six things before anything had been touched.
 *
 * It waits while the tutorial runs, without counting as done, so entering
 * the workshop from the tutorial never interrupts it (feedback 2026-11-11,
 * item 11b).
 */

import { useEffect } from 'react'
import { FLOOR } from 'sno-core/stamps'
import { useTutorial } from '../../store/useTutorial'
import { useWorkshop } from '../../store/useWorkshop'
import { GUIDE_STEPS, useBeginner, useViewTurned, type GuideStep } from '../beginner'

/** What each step asks, in the owner's short words. */
export const GUIDE_TEXT: Record<GuideStep, string> = {
  stamp: 'Tap STAMP, then tap the grid. A block lands where the outline shows.',
  turn: 'Drag one finger across the grid to turn the view.',
  paint: 'Tap PAINT, then tap a face of your block.',
}

/** What is still to come after each step, for the line under it. */
const NEXT: Record<GuideStep, string> = {
  stamp: 'NEXT: TURN THE VIEW, PAINT IT',
  turn: 'NEXT: PAINT IT',
  paint: 'THEN DEPLOY',
}

/** How long DEPLOY glows once the guide is done. */
const DEPLOY_GLOW_MS = 6000

export function Guide(): JSX.Element | null {
  const step = useBeginner((s) => s.step)
  const tool = useWorkshop((s) => s.tool)
  const tutorial = useTutorial((s) => s.active)
  const b = useBeginner.getState
  const running = step !== null && !tutorial

  // The button this step needs glows until it is in hand; DEPLOY glows once the last step is done.
  useEffect(() => {
    if (!running) { if (b().glow !== 'deploy') b().setGlow(null); return }
    const wants = step === 'stamp' ? 'stamp' : step === 'paint' ? 'paint' : null
    b().setGlow(wants && tool !== wants ? wants : null)
  }, [running, step, tool, b])

  // STAMP in hand: the outline shows where a tap would land before any finger has aimed.
  useEffect(() => {
    if (!running || step !== 'stamp' || tool !== 'stamp') return
    const w = useWorkshop.getState()
    if (!w.aim && w.plane === FLOOR) w.setAim([0, w.level, 0])
  }, [running, step, tool])

  // A block stamped, or a face painted: the shard itself changed under that tool.
  useEffect(() => {
    if (!running || step === 'turn') return
    const want = step === 'stamp' ? 'stamp' : 'paint'
    return useWorkshop.subscribe((s, prev) => {
      // `current()` reads the store as it is now, so the shard list itself is what is compared.
      if (s.tool !== want || s.currentId !== prev.currentId || s.shards === prev.shards) return
      if (step === 'stamp') b().setStep('turn')
      else {
        b().finish()
        b().setGlow('deploy')
        useWorkshop.setState({ notice: 'That is a shard. DEPLOY puts it in the world.' })
        window.setTimeout(() => { if (useBeginner.getState().glow === 'deploy') useBeginner.getState().setGlow(null) }, DEPLOY_GLOW_MS)
      }
    })
  }, [running, step, b])

  useViewTurned(running && step === 'turn', () => b().setStep('paint'))

  if (!running || step === null) return null
  const n = GUIDE_STEPS.indexOf(step) + 1
  return (
    <div className="ws__guide" role="note" aria-label="First visit">
      <span className="ws__guide-n" aria-hidden>{n}</span>
      <div className="ws__guide-body">
        <p className="ws__guide-text">{GUIDE_TEXT[step]}</p>
        <p className="ws__guide-sub">STEP {n} OF 3 · {NEXT[step]}</p>
      </div>
      <button className="ws__guide-skip" onClick={() => { b().finish(); b().setGlow(null) }} title="Put the guide away; it does not come back">SKIP</button>
    </div>
  )
}
