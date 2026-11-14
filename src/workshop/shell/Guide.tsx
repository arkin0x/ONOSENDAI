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

import { useEffect, useRef } from 'react'
import { hexToRgb, rgbToHex } from 'sno-core/shards'
import { BUILT_IN, hexAt } from 'sno-core/snoPalette'
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
  stamp: 'NEXT: TURN IT',
  turn: 'NEXT: PAINT IT',
  paint: 'THEN DEPLOY',
}

/** How long DEPLOY glows once the guide is done. */
const DEPLOY_GLOW_MS = 6000

/**
 * A color for the paint step that the block is not already: the block was
 * stamped in the color in hand, and painting it that color would change
 * nothing to see. The built-in's warm, bright tones, far from its cyan. Pure.
 */
export function paintStepColor(block: string): string {
  // Orange, red, yellow, magenta (hue h step s is index h * 8 + s).
  for (const i of [117, 108, 143, 77]) { const hex = hexAt(BUILT_IN, i); if (hex !== block) return hex }
  return hexAt(BUILT_IN, 117)
}

export function Guide(): JSX.Element | null {
  const step = useBeginner((s) => s.step)
  const tool = useWorkshop((s) => s.tool)
  const tutorial = useTutorial((s) => s.active)
  const b = useBeginner.getState
  // Put away with Esc for this opening (phase 5): hidden, its step kept for the next.
  const paused = useBeginner((s) => s.paused)
  const running = step !== null && !tutorial && !paused
  const glowTimer = useRef<number | null>(null)
  useEffect(() => () => { if (glowTimer.current !== null) window.clearTimeout(glowTimer.current) }, [])

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

  // The paint step: a color in hand the block is not, so the tap shows.
  useEffect(() => {
    if (!running || step !== 'paint') return
    const w = useWorkshop.getState()
    const hand = rgbToHex(w.color)
    if (w.current()?.vertices.some((v) => rgbToHex(v.c) === hand)) useWorkshop.setState({ color: hexToRgb(paintStepColor(hand)) })
  }, [running, step])

  // A block stamped, or a face painted: the shard on the bench changed by an
  // edit made with that tool (not an UNDO, which grows the future).
  useEffect(() => {
    if (!running || step === 'turn') return
    const want = step === 'stamp' ? 'stamp' : 'paint'
    return useWorkshop.subscribe((s, prev) => {
      if (s.tool !== want || s.currentId !== prev.currentId || s.future.length > prev.future.length) return
      // `current()` reads the store as it is now, so each state's own list is searched.
      if (s.shards.find((x) => x.id === s.currentId) === prev.shards.find((x) => x.id === prev.currentId)) return
      if (step === 'stamp') b().setStep('turn')
      else {
        b().finish()
        b().setGlow('deploy')
        useWorkshop.setState({ notice: 'That is a shard. DEPLOY puts it in the world.' })
        glowTimer.current = window.setTimeout(() => { if (useBeginner.getState().glow === 'deploy') useBeginner.getState().setGlow(null) }, DEPLOY_GLOW_MS)
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
