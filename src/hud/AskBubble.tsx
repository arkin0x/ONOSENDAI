/**
 * AskBubble.tsx: the question everyone asks, under the wordmark.
 *
 * "ONOSENDAI looks amazing but I have no idea what I'm looking at." So the
 * menu says it first: a small face and a speech bubble that cycles through
 * the things people say, each phrase decoding out of glyph noise the way a
 * found key's chip does, then holding, then giving way to the next. The
 * whole row is a link to the /demo guided tour, which answers it. A plain
 * click starts the tour in place, with no page load (startTourInPlace); a
 * middle click, a modified click or "open in new tab" follows the real
 * href, and the tour starts from the address on that page's load. The row is
 * gone while the tour is on, so it never invites you into the tour you are
 * already taking. Under reduced motion the words simply change.
 */

import { useEffect, useReducer, useState } from 'react'
import { decodeText, seedOf, TEXT_DECODE_MS } from '../lib/decode'
import { parseDemoRoute } from '../lib/demoRoute'
import { startTourInPlace, useDemo } from '../store/useDemo'

/** The one asking. */
export const ASK_EMOJI = '🤔'
/** Where the row goes: the guided tour (store/useDemo.ts). */
export const TOUR_HREF = '/demo'
/** In the words people use. */
export const ASKS = ['what is all this?', 'what am i looking at?', "i'm confused", 'can someone explain this?', 'where am i?', 'i need an adult', 'cyberspace???', 'help, what is this?', 'is this for real?', "i'm lost"]
/** How long each phrase holds once it has decoded. */
const HOLD_MS = 2600

/**
 * Whether the row stays out of sight: while the tour runs, and on a /demo
 * address, which covers the first frame before the tour has started.
 */
export function askHidden(touring: boolean, pathname: string): boolean {
  return touring || parseDemoRoute(pathname) !== null
}

export function AskBubble(): JSX.Element | null {
  const touring = useDemo((s) => s.active)
  // Read again when the address moves under it: EXIT of a tour started in
  // place steps back off /demo with history.back(), which lands after the
  // render that saw the tour end, so the row stayed hidden on / until
  // something else redrew the menu (review of #362, 2026-10-15).
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    window.addEventListener('popstate', redraw)
    return () => window.removeEventListener('popstate', redraw)
  }, [])
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
  return askHidden(touring, pathname) ? null : <AskRow />
}

/**
 * A plain left click starts the tour where you are; anything else (a
 * modifier key, another button, a click already handled) is the browser's.
 */
export function onAskClick(e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented' | 'preventDefault'>): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  startTourInPlace()
}

/** The face and the cycling bubble, as one link to the tour. */
export function AskRow(): JSX.Element {
  const [index, setIndex] = useState(0)
  const [shown, setShown] = useState(ASKS[0])

  useEffect(() => {
    const target = ASKS[index % ASKS.length]
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const seed = seedOf(`ask-${index}`)
    const started = performance.now()
    let raf = 0
    let frame = 0
    const tick = (): void => {
      frame++
      const t = (performance.now() - started) / TEXT_DECODE_MS
      setShown(reduced ? target : decodeText(target, t, seed, frame))
      if (t < 1 && !reduced) raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    // The frame loop is throttled in a background tab; the whole phrase lands
    // on schedule either way.
    const settle = window.setTimeout(() => { window.cancelAnimationFrame(raf); setShown(target) }, reduced ? 0 : TEXT_DECODE_MS + 40)
    const next = window.setTimeout(() => setIndex((i) => i + 1), (reduced ? 0 : TEXT_DECODE_MS) + HOLD_MS)
    return () => { window.cancelAnimationFrame(raf); window.clearTimeout(settle); window.clearTimeout(next) }
  }, [index])

  return (
    <a className="ask" href={TOUR_HREF} onClick={onAskClick} title="A guided tour of what cyberspace is and what you are looking at">
      <span className="ask__emoji" aria-hidden="true">{ASK_EMOJI}</span>
      <span className="ask__bubble"><span className="ask__text">{shown}</span></span>
    </a>
  )
}
