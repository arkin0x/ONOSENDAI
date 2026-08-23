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

import { useEffect, useRef, useState } from 'react'
import { useCyberspace } from '../store/useCyberspace'

export interface ViewWindow {
  right: number
  up: number
  out: number
}

/**
 * How long the window waits behind the cursor before it moves.
 *
 * The window is what the terrain volume is centred on, and recentring it costs
 * a full rescan of every cell in the volume, measured at ~37ms. Running that
 * inside the same render that moves the cursor put it directly on the critical
 * path of a keypress, which is the one thing that has to feel instant.
 *
 * Terrain has no such requirement: it can arrive a frame or two late without
 * anyone noticing, and while a key is held it need not arrive at all until you
 * stop. So the cursor moves now and the field catches up, rather than the field
 * holding the cursor back.
 */
const SETTLE_MS = 90

export function useViewWindow(): ViewWindow {
  const cursor = useCyberspace((s) => s.cursor)
  const anchor = useCyberspace((s) => s.anchor)
  const exploreIndex = useCyberspace((s) => s.exploreIndex)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const view = useCyberspace((s) => s.view)

  const read = (): ViewWindow => {
    const [right, up, out] = useCyberspace.getState().cursorOffset()
    return { right: Math.round(right), up: Math.round(up), out: Math.round(out) }
  }

  const [win, setWin] = useState<ViewWindow>(read)
  const handle = useRef<number | null>(null)

  useEffect(() => {
    if (handle.current !== null) clearTimeout(handle.current)
    handle.current = window.setTimeout(() => {
      handle.current = null
      const next = read()
      setWin((prev) =>
        prev.right === next.right && prev.up === next.up && prev.out === next.out ? prev : next,
      )
    }, SETTLE_MS)
    return () => {
      if (handle.current !== null) clearTimeout(handle.current)
    }
    // cursorOffset derives from exactly these five.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, anchor, exploreIndex, scaleExp, view])

  return win
}
