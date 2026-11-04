/**
 * The orbit ball: a lit globe to drag the view round with.
 *
 * Made for the workshop (arkinox, 2026-10-10: "not being able to orbit
 * hurts"), where a drag on it turns the view about the shard and a tap sends
 * the view home. WALK uses the same ball in the bottom left to look around
 * (arkinox, 2026-10-23: "bring back the sphere we have in the workshop and
 * use it to look"). What a drag and a tap do is the caller's.
 *
 * A drag started on the ball keeps turning after the finger leaves it, until
 * it lifts (arkinox, 2026-11-02: "a drag started on LOOK continues even off
 * the button"). The ball captures the pointer, and the drag is also followed
 * on the document, as the scene's own look is (scene/Scene.tsx), so it goes
 * on wherever the finger goes even where a capture is refused or dropped.
 *
 * One finger drives it at a time, whichever finger that is. It used to take
 * only the primary pointer, which is the first finger on the screen: with a
 * thumb already holding a pad key, a finger on LOOK was never primary and the
 * ball did nothing, so you could not walk and look at once. A new press on
 * the ball takes over from a drag still running, as the scene's own look
 * lets go of one (scene/Scene.tsx): a release the page never heard (the
 * finger lifted outside the window, a dropped event) must not leave the ball
 * dead. A mouse that moves with no button held has let go somewhere unheard,
 * and its drag ends there.
 *
 * `square` makes the whole square around the ball the thing you press
 * (arkinox, 2026-11-02: "the touch area is a full square containing the
 * sphere"); a round button's corners are not part of it.
 */

import { useEffect, useRef } from 'react'
import { noCallout } from '../../hooks/useRepeatable'

interface OrbitSphereProps {
  /** A drag of dx, dy CSS pixels since the last move, on a ball `size` CSS pixels wide. */
  onTurn: (dx: number, dy: number, size: number) => void
  /** A tap with no drag. Nothing when absent. */
  onTap?: () => void
  /** The small word on the ball. */
  label: string
  title: string
  ariaLabel: string
  /** Added to `benchorb`, for where the ball stands; with `square`, to the square it stands in. */
  className?: string
  /** Press anywhere in the square around the ball, not only on the ball. */
  square?: boolean
}

/** The document events a drag is followed through, in the capture phase. */
const FOLLOWED = ['pointermove', 'pointerup', 'pointercancel'] as const

export function OrbitSphere({ onTurn, onTap, label, title, ariaLabel, className, square = false }: OrbitSphereProps): JSX.Element {
  // The newest callbacks, read when an event arrives rather than when the drag began.
  const turn = useRef(onTurn)
  turn.current = onTurn
  const tap = useRef(onTap)
  tap.current = onTap
  const drag = useRef<{ id: number; x: number; y: number; size: number; moved: boolean; off: () => void } | null>(null)

  const end = (): void => {
    const d = drag.current
    if (!d) return
    drag.current = null
    d.off()
  }
  // Taken off the page mid-drag: the drag ends with it.
  useEffect(() => end, [])

  const down = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    // A drag still running, its release never heard, gives way to this press.
    end()
    const el = e.currentTarget
    try { el.setPointerCapture(e.pointerId) } catch { /* followed on the document anyway */ }
    const id = e.pointerId
    const doc = el.ownerDocument
    const listener = (ev: Event): void => {
      const p = ev as PointerEvent
      const d = drag.current
      if (!d || p.pointerId !== id) return
      if (p.type === 'pointermove') {
        // A mouse moving with no button held let go where the page did not hear it.
        if (p.pointerType === 'mouse' && (p.buttons & 1) === 0) { end(); return }
        const dx = p.clientX - d.x
        const dy = p.clientY - d.y
        if (dx === 0 && dy === 0) return
        d.x = p.clientX
        d.y = p.clientY
        d.moved = true
        turn.current(dx, dy, d.size)
        return
      }
      // Lifted, or taken by the browser: the drag is over, and with no move it was a tap.
      const moved = d.moved
      end()
      if (p.type === 'pointerup' && !moved) tap.current?.()
    }
    for (const t of FOLLOWED) doc.addEventListener(t, listener, true)
    drag.current = {
      id, x: e.clientX, y: e.clientY, size: el.getBoundingClientRect().width, moved: false,
      off: () => { for (const t of FOLLOWED) doc.removeEventListener(t, listener, true) },
    }
  }
  // A capture lost while the ball is still on screen changes nothing: the
  // document still has the drag. Hidden or gone (a modal over the HUD), the
  // drag ends there, and it was no tap.
  const lost = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const el = e.currentTarget
    if (!el.isConnected || el.getClientRects().length === 0) end()
  }

  const handlers = { ...noCallout, onPointerDown: down, onLostPointerCapture: lost }
  if (square) {
    return (
      <button className={className ? `orbsquare ${className}` : 'orbsquare'} title={title} aria-label={ariaLabel} {...handlers}>
        <span className="benchorb benchorb--inside" aria-hidden>
          <span className="benchorb__sub">{label}</span>
        </span>
      </button>
    )
  }
  return (
    <button className={className ? `benchorb ${className}` : 'benchorb'} title={title} aria-label={ariaLabel} {...handlers}>
      <span className="benchorb__sub">{label}</span>
    </button>
  )
}
