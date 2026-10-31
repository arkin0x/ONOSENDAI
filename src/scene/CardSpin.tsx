/**
 * CardSpin.tsx: a card's turning preview, on the one canvas all cards share.
 *
 * Each card had a ShardSpin of its own: a new WebGL context per opened card,
 * with every shader program compiled again for it, and a context made and
 * thrown away is the churn that wears out the GPU process on Windows (TV's
 * freeze, #394). Measured at his block 101 spot under SwiftShader: 6 to 20 s
 * of frozen main thread per card opened. So the first card makes the canvas,
 * it stays for the session, and each card lends it a place on the page.
 *
 * It is drawn at about 30 frames a second, whatever the display's rate. A turn
 * of twelve seconds moves about a pixel between those frames at this size, and
 * at a desktop's 144 Hz most frames showed nothing new (TV's pace, #414).
 *
 * The canvas has its own React root, so a card closing does not unmount it, and
 * it is moved by hand between the cards' slots. Empty, it draws nothing.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { ShardModel } from 'sno-core/shards'
import { ShardSpin, type Pace } from './ShardSpin'
import { topClaim, useSpinStack } from './cardSpinStack'

/** Milliseconds between drawn frames: about 30 a second. */
export const CARD_SPIN_FRAME_MS = 1000 / 30

/** The one host: made by the first card, kept for the session. */
let host: HTMLDivElement | null = null
/** Where the canvas waits, out of sight, while no card holds it. */
let parking: HTMLDivElement | null = null

/** Asks for frames at CARD_SPIN_FRAME_MS while it is mounted and the tab draws. */
function usePaced(active: boolean): Pace {
  const next = useRef<(() => void) | null>(null)
  const pace = useMemo<Pace>(() => (ask, mine) => {
    if (ask) next.current = ask
    else if (next.current === mine) next.current = null
  }, [])
  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = 0
    const tick = (t: number): void => {
      // A frame's slack: at 60 Hz, 16.7 ms frames, this draws every second one.
      if (t - last >= CARD_SPIN_FRAME_MS - 2) { last = t; next.current?.() }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])
  return pace
}

function Host(): JSX.Element {
  const top = useSpinStack((s) => topClaim(s.claims))
  const shard = top?.shard ?? null
  const pace = usePaced(shard !== null)
  // The canvas keeps showing its last frame until it draws again, so it is out
  // of sight from the moment it moves until the next card's shard is drawn.
  const shown = (): void => { if (host) host.style.visibility = 'visible' }
  return <ShardSpin shard={shard} size={top?.size ?? 160} pace={pace} ignoreOpacity={top?.ignoreOpacity ?? false} onDrawn={shown} />
}

function hostElement(): HTMLDivElement {
  if (host) return host
  parking = document.createElement('div')
  parking.setAttribute('aria-hidden', 'true')
  // Sized, not zero: the spin's max-width would follow it to nothing, and a canvas measured empty stops drawing.
  parking.style.cssText = 'position:fixed;left:-10000px;top:0;width:512px;height:512px;overflow:hidden;'
  document.body.append(parking)
  host = document.createElement('div')
  host.className = 'cardspin'
  parking.append(host)
  createRoot(host).render(<Host />)
  return host
}

/** Move the canvas to the card on top, or park it. */
function place(): void {
  if (!host) return
  const top = topClaim(useSpinStack.getState().claims)
  const to = top?.slot ?? parking
  if (!to || host.parentElement === to) return
  host.style.visibility = 'hidden'
  to.append(host)
}
useSpinStack.subscribe(place)

/** A shard turning in a card, for as long as the card shows it. Takes the place of ShardSpin in a card. */
export function CardSpin({ shard, size = 160, ignoreOpacity = false }: { shard: ShardModel | null; size?: number; ignoreOpacity?: boolean }): JSX.Element {
  const slot = useRef<HTMLDivElement>(null)
  const id = useRef<number | null>(null)
  useLayoutEffect(() => {
    hostElement()
    const mine = useSpinStack.getState().claim({ shard, size, ignoreOpacity, slot: slot.current! })
    id.current = mine
    return () => { id.current = null; useSpinStack.getState().release(mine) }
    // The claim lives as long as the card; a new shard updates it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    if (id.current !== null) useSpinStack.getState().update(id.current, { shard, size, ignoreOpacity })
  }, [shard, size, ignoreOpacity])
  return <div ref={slot} style={{ width: size, height: size }} />
}
