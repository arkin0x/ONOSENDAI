/**
 * useDecodeReveal.ts: a message's words resolving out of glyphs as its card
 * opens, every time it opens (lib/letterReveal.ts has the timing, decode.ts
 * decodeText the look).
 *
 * The plan is fixed when the card mounts: the seal's crack and the page's
 * unfold, then the decode. `skipped` (a tap on the page, held by the card so
 * the seal and the words skip together) shows the words at once. Frames are drawn about twenty-five times a second, as the find
 * ceremony's decode is, and stop once the words are whole, so a card left
 * open costs nothing.
 */

import { useEffect, useRef, useState } from 'react'
import { decodeText, seedOf } from '../lib/decode'
import { revealProgress, type RevealPlan } from '../lib/letterReveal'

/** How often a frame of glyphs is drawn, ms. */
const FRAME_MS = 40

/** The next frame, or a sixtieth of a second where there are no frames (a test). */
function nextFrame(cb: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => cb())
  else setTimeout(cb, 16)
}

/** The clock, one function for every card, so the frame loop is not restarted by each render. */
const perfNow = (): number => performance.now()

export interface DecodeReveal {
  /** The words as they show now: glyphs where they have not resolved. */
  shown: string
  /** The words are whole. */
  done: boolean
}

export function useDecodeReveal(text: string, key: string, plan: RevealPlan, skipped: boolean, now: () => number = perfNow): DecodeReveal {
  const seed = seedOf(key)
  const started = useRef(now())
  const [frame, setFrame] = useState(0)
  const progress = revealProgress(plan, now() - started.current, skipped)
  const done = progress >= 1
  useEffect(() => {
    if (done) return
    let last = 0
    let live = true
    const tick = (): void => {
      if (!live) return
      const t = now()
      if (t - last >= FRAME_MS) { last = t; setFrame((f) => f + 1) }
      nextFrame(tick)
    }
    nextFrame(tick)
    return () => { live = false }
  }, [done, now])
  return { shown: done ? text : decodeText(text, progress, seed, frame), done }
}
