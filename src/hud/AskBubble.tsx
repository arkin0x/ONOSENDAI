/**
 * AskBubble.tsx — the question everyone asks, under the wordmark.
 *
 * "ONOSENDAI looks amazing but I have no idea what I'm looking at." So the
 * menu says it first: a small face and a speech bubble that cycles through
 * the things people say, each phrase decoding out of glyph noise the way a
 * found key's chip does, then holding, then giving way to the next. The
 * whole row is a link to the channel where the one-minute videos answer it.
 * Under reduced motion the words simply change.
 */

import { useEffect, useState } from 'react'
import { decodeText, seedOf, TEXT_DECODE_MS } from '../lib/decode'

/** The one asking. */
export const ASK_EMOJI = '🤔'
export const CHANNEL_URL = 'https://youtube.com/channel/UC1f8lCTlq6WvQ9ucCe3Dpyw'
/** In the words people use. */
export const ASKS = ['what is all this?', 'what am i looking at?', "i'm confused", 'can someone explain this?', 'where am i?', 'i need an adult', 'cyberspace???', 'help, what is this?', 'is this for real?', "i'm lost"]
/** How long each phrase holds once it has decoded. */
const HOLD_MS = 2600

export function AskBubble(): JSX.Element {
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
    <a className="ask" href={CHANNEL_URL} target="_blank" rel="noopener noreferrer" title="One-minute videos on what cyberspace is and what you are looking at">
      <span className="ask__emoji" aria-hidden="true">{ASK_EMOJI}</span>
      <span className="ask__bubble">{shown}</span>
    </a>
  )
}
