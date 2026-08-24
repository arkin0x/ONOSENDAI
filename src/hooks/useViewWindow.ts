/**
 * useViewWindow.ts — where the visible window sits, in screen cells.
 *
 * The camera pans to the cursor while the world stays anchored to the avatar,
 * so the region on screen is no longer centred on the avatar's cell. Anything
 * that renders a bounded region (the terrain box, the lattice) has to follow the
 * window or the view runs off its edge into empty space.
 *
 * Coordinates are cell offsets from the avatar's aligned cell along the screen
 * axes, which is the frame the whole scene is drawn in. Rounded to whole cells
 * so sub-cell drift does not rebuild geometry every frame.
 */

import { useEffect, useState } from 'react'
import { useCyberspace } from '../store/useCyberspace'

export interface ViewWindow {
  right: number
  up: number
  out: number
}

/**
 * How long the cursor must be still before the window follows it.
 *
 * The window is what the terrain volume is centred on, and recentring it costs
 * a full rescan of every cell in the volume plus a geometry rebuild, measured
 * at 30 to 60ms of main thread. Paying that per keypress put it directly on
 * the critical path of movement, which is the one thing that has to feel
 * instant. Terrain has no such requirement: while you are travelling the stale
 * field is fine, and it need not update at all until you stop.
 *
 * 250ms is chosen to outlast every repeating input in the app: OS key repeat
 * delivers a keydown every 30 to 80ms and the touch pad repeats at 110ms, so
 * any held or rapidly tapped run of moves coalesces into a single rescan when
 * you come to rest, while after a lone tap the field still catches up within a
 * quarter second.
 */
export const CURSOR_SETTLE_MS = 250

/** The window the cursor is in right now, read straight off the store. */
function read(): ViewWindow {
  const [right, up, out] = useCyberspace.getState().cursorOffset()
  return { right: Math.round(right), up: Math.round(up), out: Math.round(out) }
}

export function useViewWindow(): ViewWindow {
  const [win, setWin] = useState<ViewWindow>(read)

  useEffect(() => {
    let handle: number | null = null

    const fire = (): void => {
      handle = null
      const next = read()
      setWin((prev) =>
        prev.right === next.right && prev.up === next.up && prev.out === next.out ? prev : next,
      )
    }
    const schedule = (): void => {
      if (handle !== null) clearTimeout(handle)
      handle = window.setTimeout(fire, CURSOR_SETTLE_MS)
    }

    // A transient store subscription rather than selector hooks. Subscribing
    // this hook to `cursor` re-rendered the entire World subtree on every
    // keypress just to restart a timer, so each move paid a React commit it
    // did not need. The subscription restarts the timer without rendering
    // anything, and the only render is the setWin once the cursor settles.
    const unsubscribe = useCyberspace.subscribe((s, prev) => {
      if (
        s.cursor !== prev.cursor ||
        s.anchor !== prev.anchor ||
        s.exploreIndex !== prev.exploreIndex ||
        s.scaleExp !== prev.scaleExp ||
        s.view !== prev.view
      ) schedule()
    })

    // The store may have moved between the initial state read and this effect
    // attaching, so reconcile once on mount.
    schedule()

    return () => {
      unsubscribe()
      if (handle !== null) clearTimeout(handle)
    }
  }, [])

  return win
}
