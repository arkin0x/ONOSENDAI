/**
 * ViewFlyButtons.tsx - VIEW's fly, forward and back, as two buttons (arkinox,
 * 2026-11-02): "left side, above the menu button. Translucent spheres like
 * WALK's LOOK sphere, each with a 3D-looking arrow icon for forward and back.
 * Size them similar to the menu button, not the LOOK sphere."
 *
 * Held, they fly the view the way the camera faces, or the other way; let go,
 * the fly stops, and two seconds later the cursor goes to where the view has
 * got to (lib/viewFly.ts, lib/viewCamera.ts). The pad's FAR and NEAR do the
 * same in VIEW (flyHold). Forward stands on top, back under it, the
 * menu button under both, all on one column. The arrows are the shared pair
 * WALK's forward and back wear too (ui/FlyArrows.tsx).
 *
 * Only while a free view is up (canFly): VIEW, or a place looked at with the
 * cursor brought along, and never in BUILD or WALK, which have their own.
 */

import { useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { canFly, steerBy, useViewFly, type FlyDir } from '../lib/viewFly'
import { noCallout } from '../hooks/useRepeatable'
import { ForwardArrow3D, ReverseArrow3D } from './ui/FlyArrows'

/** Which of the fly's holds a press is: so far only the fly buttons. */
type FlyHold = 'button'

/** The pointer a fly button holds, and where it last was, so a drag steers from it. */
let dragging: { id: number; x: number; y: number } | null = null

/**
 * Press-and-hold props that fly the view while held: forward or back, from the
 * fly buttons (lib/viewFly.ts useViewFly). Held even when the finger slides off
 * the button, until it lifts. A drag while held steers: it orbits the camera by
 * the drag, the way a drag on open scene would (lib/viewFly.ts steerBy).
 */
export function flyHold(source: FlyHold, dir: Exclude<FlyDir, 0>) {
  const set = (d: FlyDir): void => { useViewFly.getState().setButton(d) }
  const release = (e?: ReactPointerEvent<HTMLButtonElement>): void => {
    if (useViewFly.getState()[source] === dir) set(0)
    if (!e || (dragging && dragging.id === e.pointerId)) dragging = null
  }
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* the press still counts */ }
      dragging = { id: e.pointerId, x: e.clientX, y: e.clientY }
      set(dir)
    },
    onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!dragging || dragging.id !== e.pointerId) return
      steerBy(e.clientX - dragging.x, e.clientY - dragging.y)
      dragging.x = e.clientX
      dragging.y = e.clientY
    },
    onPointerUp: release,
    onPointerCancel: release,
    onLostPointerCapture: release,
    ...noCallout,
  }
}

export function ViewFlyButtons(): JSX.Element | null {
  const building = useBuilder((s) => s.active)
  const shown = useCyberspace((s) => canFly(s, building))
  // Gone mid-press (RETURN, the mode ended): the fly stops with it.
  useEffect(() => { if (!shown) useViewFly.getState().setButton(0) }, [shown])
  useEffect(() => () => useViewFly.getState().setButton(0), [])
  if (!shown) return null

  return (
    <div className="flyorbs" role="group" aria-label="Fly the view">
      <div className="flyorb__row">
        <button className="flyorb flyorb--fwd" title="Hold to fly forward, the way the camera faces (Space)" aria-label="Fly forward" {...flyHold('button', 1)}>
          <ForwardArrow3D size={24} />
        </button>
        {/* The key that does the same, in VIEW's yellow (arkinox, 2026-11-11). */}
        <span className="flyorb__key" aria-hidden>SPACE</span>
      </div>
      <div className="flyorb__row">
        <button className="flyorb flyorb--back" title="Hold to fly back (Shift)" aria-label="Fly back" {...flyHold('button', -1)}>
          <ReverseArrow3D size={24} />
        </button>
        <span className="flyorb__key" aria-hidden>SHIFT</span>
      </div>
    </div>
  )
}
