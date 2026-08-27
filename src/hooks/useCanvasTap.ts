/**
 * useCanvasTap.ts — distinguish a tap on the scene from an orbit drag.
 *
 * The camera owns dragging and pinching, and that must not change: those are
 * the gestures that already worked on a phone. A tap is what is left over, so
 * it is the only gesture free to summon the controls.
 *
 * Telling them apart is a matter of thresholds. A press that stays within a few
 * pixels and lifts quickly is a tap; anything else is the camera's. The slop
 * allowance matters more than it looks, because a thumb never lands and lifts
 * on exactly the same pixel.
 */

import { useEffect } from 'react'

/**
 * Marks the current gesture as already meaning something.
 *
 * A tap on a block, a shard or the planet lands on the canvas like any other,
 * so without this the same press both selected the thing and toggled the
 * controls away. Scene handlers call stopPropagation, but that is R3F's own
 * event and says nothing to a window listener, so they say it here instead.
 *
 * A timestamp rather than a flag: the scene handler runs during the pointerup
 * that this hook is also watching, so the mark only has to outlive one event,
 * and one that is never cleared cannot strand the gesture after it.
 */
let handledAt = 0

export function markSceneTapHandled(): void {
  handledAt = performance.now()
}

/** How long a scene handler's claim on the gesture lasts, in milliseconds. */
const HANDLED_MS = 50

/** How far a press may wander and still count as a tap, in CSS pixels. */
const SLOP = 12
/** How long it may last, in milliseconds. */
const MAX_MS = 400

export function useCanvasTap(onTap: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return

    let startX = 0
    let startY = 0
    let startedAt = 0
    let tracking = false

    const down = (e: PointerEvent): void => {
      // Only presses that land on the scene itself. Anything over a button or a
      // panel is that control's business.
      const target = e.target as HTMLElement | null
      if (!target || target.tagName !== 'CANVAS') { tracking = false; return }
      // A second finger means a pinch, which belongs to the camera.
      if (!e.isPrimary) { tracking = false; return }
      tracking = true
      startX = e.clientX
      startY = e.clientY
      startedAt = e.timeStamp
    }

    const up = (e: PointerEvent): void => {
      if (!tracking) return
      tracking = false
      if (e.timeStamp - startedAt > MAX_MS) return
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > SLOP) return
      if (performance.now() - handledAt < HANDLED_MS) return
      onTap()
    }

    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    window.addEventListener('pointercancel', () => { tracking = false }, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
    }
  }, [onTap, enabled])
}
