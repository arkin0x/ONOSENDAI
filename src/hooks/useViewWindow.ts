/**
 * useViewWindow.ts — where the visible window sits, in screen cells.
 *
 * The camera pans to the cursor while the world stays anchored to the avatar,
 * so the region on screen is no longer centred on the avatar's cell. Anything
 * that renders a bounded region (the terrain box, the LCA boundary grid) has
 * to follow the window or the view runs off its edge into empty space.
 *
 * Coordinates are cell offsets from the avatar's aligned cell along the screen
 * axes, which is the frame the whole scene is drawn in. Rounded to whole cells
 * so sub-cell drift does not rebuild geometry every frame.
 */

import { useMemo } from 'react'
import { useCyberspace } from '../store/useCyberspace'

export interface ViewWindow {
  right: number
  up: number
  out: number
}

export function useViewWindow(): ViewWindow {
  const cursor = useCyberspace((s) => s.cursor)
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const view = useCyberspace((s) => s.view)

  return useMemo(() => {
    const [right, up, out] = useCyberspace.getState().cursorOffset()
    return { right: Math.round(right), up: Math.round(up), out: Math.round(out) }
    // cursorOffset derives from exactly these four.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, position, scaleExp, view])
}
