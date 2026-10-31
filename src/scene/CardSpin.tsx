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

import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { ShardModel } from 'sno-core/shards'
import { watchContext } from '../lib/glContext'
import { ShardSpin, type Pace } from './ShardSpin'
import { topClaim, useSpinStack, type SpinClaim } from './cardSpinStack'
import { stageIdleMs } from './ThumbStage'

/** Milliseconds between drawn frames: about 30 a second. */
export const CARD_SPIN_FRAME_MS = 1000 / 30

/** The one host: made by the first card, kept for the session. */
let host: HTMLDivElement | null = null
/** Where the canvas waits, out of sight, while no card holds it. */
let parking: HTMLDivElement | null = null
/** The canvas threw and has not been made again. */
let broken = false
/** The canvas's context, to ask at the next card whether it is lost. */
let context: Pick<WebGL2RenderingContext, 'isContextLost'> | null = null

/** How long a lost context gets to come back on its own before the canvas is made again. */
export const CONTEXT_BACK_MS = 3000

/** Whether the next card must have the canvas made again before it can show anything. */
export function needsRemake(wasBroken: boolean, gl: Pick<WebGL2RenderingContext, 'isContextLost'> | null): boolean {
  return wasBroken || (gl?.isContextLost() ?? false)
}

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

/**
 * A canvas that cannot be made throws, and this root has nothing above it to
 * catch that: it would unmount, and every card after it would have no canvas
 * (review of #560). Caught, the next claim makes it again.
 */
class HostBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  componentDidCatch(e: unknown): void {
    console.warn('[onosendai] card preview: the canvas failed', e)
    broken = true
  }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

function Host(): JSX.Element {
  const top = useSpinStack((s) => topClaim(s.claims))
  const shard = top?.shard ?? null
  const pace = usePaced(shard !== null)
  const remake = useSpinStack((s) => s.remake)
  const stopWatching = useRef<(() => void) | null>(null)
  useEffect(() => () => { stopWatching.current?.(); context = null }, [])
  // A lost context that does not come back would stay a broken square for the session.
  const created = (canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): void => {
    context = gl
    let back: ReturnType<typeof setTimeout> | null = null
    const lost = (): void => { back = setTimeout(() => { if (gl.isContextLost()) remake() }, CONTEXT_BACK_MS) }
    const restored = (): void => { if (back) clearTimeout(back) }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    const stop = watchContext(canvas, 'cards')
    stopWatching.current = () => {
      stop()
      if (back) clearTimeout(back)
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
    }
  }
  // The canvas keeps showing its last frame until it draws again, so it is out
  // of sight from the moment it moves until the next card's shard is drawn.
  const shown = (): void => { if (host) host.style.visibility = 'visible' }
  return <ShardSpin shard={shard} size={top?.size ?? 160} pace={pace} ignoreOpacity={top?.ignoreOpacity ?? false} onDrawn={shown} onContext={created} />
}

/**
 * The canvas for as long as it is wanted. With a mouse that is the session. On a
 * phone, where a browser keeps few contexts, it goes once cards have been closed
 * a while (stageIdleMs, as the pictures' stage does), and the next card makes it.
 */
function Root(): JSX.Element | null {
  const made = useSpinStack((s) => s.made)
  const wanted = useSpinStack((s) => s.claims.length > 0)
  const [up, setUp] = useState(true)
  useEffect(() => {
    if (wanted) { setUp(true); return }
    if (window.matchMedia('(pointer: fine)').matches) return
    const t = setTimeout(() => setUp(false), stageIdleMs(false))
    return () => clearTimeout(t)
  }, [wanted])
  if (!up && !wanted) return null
  return <HostBoundary key={made}><Host /></HostBoundary>
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
  createRoot(host).render(<Root />)
  return host
}

/** As much of an element as moving the canvas touches, so a test can hand it fakes. */
export interface Placeable { parentElement: unknown; style: { visibility: string }; append?: (child: never) => void }

/** Move `what` to the card on top, or park it, and out of sight until it has drawn there. */
export function moveHost(what: Placeable, top: Pick<SpinClaim, 'slot'> | null, park: unknown): void {
  const to = (top?.slot ?? park) as { append(child: unknown): void } | null
  if (!to || what.parentElement === to) return
  what.style.visibility = 'hidden'
  to.append(what)
}

/** Move the canvas to the card on top, or park it. */
function place(): void {
  if (host) moveHost(host, topClaim(useSpinStack.getState().claims), parking)
}
useSpinStack.subscribe(place)

/** A shard turning in a card, for as long as the card shows it. Takes the place of ShardSpin in a card. */
export function CardSpin({ shard, size = 160, ignoreOpacity = false }: { shard: ShardModel | null; size?: number; ignoreOpacity?: boolean }): JSX.Element {
  const slot = useRef<HTMLDivElement>(null)
  const id = useRef<number | null>(null)
  useLayoutEffect(() => {
    hostElement()
    // A canvas that threw, or whose context is gone, is made again for this card.
    if (needsRemake(broken, context)) { broken = false; context = null; useSpinStack.getState().remake() }
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
