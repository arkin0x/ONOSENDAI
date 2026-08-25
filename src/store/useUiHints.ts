/**
 * useUiHints.ts - things the scene knows that the HUD should echo.
 *
 * The covering box lives inside the canvas and the touch pad lives above it,
 * with no shared parent below the app root, so a prop would have to thread
 * through the whole tree to connect them. A module-scope store is the house
 * answer to that (see useRideRun in HyperspacePanel): the scene writes, the
 * HUD subscribes, and neither knows the other exists.
 *
 * Everything in here is a hint about presentation, never protocol state, so
 * losing it all on reload costs nothing.
 */

import { create } from 'zustand'

interface UiHints {
  /**
   * True while the covering box on screen is a clipped stand-in: the region a
   * lined-up move covers extends past the drawable window, and zooming out is
   * the only way to see its true extent.
   */
  coveringClipped: boolean
  setCoveringClipped: (clipped: boolean) => void
}

export const useUiHints = create<UiHints>((set, get) => ({
  coveringClipped: false,
  // No-op on an unchanged value. The writer is an effect keyed on the flag, so
  // this is belt and braces, but zustand notifies subscribers on every set and
  // a redundant write here would nudge the HUD for nothing.
  setCoveringClipped: (clipped) => {
    if (get().coveringClipped !== clipped) set({ coveringClipped: clipped })
  },
}))
