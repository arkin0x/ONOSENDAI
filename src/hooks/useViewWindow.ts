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

import { useEffect, useMemo, useState } from 'react'
import { originShift, type Position } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { flyDir } from '../lib/viewFly'
import { useViewCentre } from '../lib/viewCamera'

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

/**
 * A fly (VIEW's, lib/viewFly.ts) never comes to rest while it is held, so
 * waiting for rest meant nothing new was drawn or loaded until it stopped
 * (review of #592). While it flies, the window and the terrain's new data
 * catch up at most this often instead: one rescan of 30 to 60 ms in every
 * 600 ms, about a twentieth of the main thread, where per-frame was all of it.
 */
export const FLY_REFRESH_MS = 600

/**
 * How long to wait before following the cursor, in ms (0: now): until it
 * has been still for CURSOR_SETTLE_MS, or, while a fly is under way, no longer
 * than FLY_REFRESH_MS after the last time it was followed.
 */
export function settleWait(sinceMove: number, sinceRefresh: number, flying: boolean): number {
  const rest = Math.max(0, CURSOR_SETTLE_MS - sinceMove)
  return flying ? Math.min(rest, Math.max(0, FLY_REFRESH_MS - sinceRefresh)) : rest
}

/**
 * A window as read: its offsets, and the render origin, zoom and view they
 * were read against. The offsets are only meaningful in that frame.
 */
interface ReadWindow extends ViewWindow {
  origin: Position
  scaleExp: number
  view: unknown
}

/**
 * The window the view centres on right now, read straight off the store: the
 * cursor's, or where a fly or a pan has taken the camera off it
 * (lib/viewCamera.ts useViewCentre).
 */
function read(): ReadWindow {
  const s = useCyberspace.getState()
  const [right, up, out] = s.cursorOffset()
  const off = useViewCentre.getState()
  return { right: Math.round(right) + off.right, up: Math.round(up) + off.up, out: Math.round(out) + off.out, origin: alignedOrigin(s.anchor, s.scaleExp), scaleExp: s.scaleExp, view: s.view }
}

const sameOrigin = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y && a.z === b.z

/** The largest origin shift carried, in cells: far more than any landing, far less than a double's exact range. */
export const MAX_CARRY_CELLS = 1 << 20

/** A shift the window may be carried by: a whole number of cells, and a small one. */
export function carriable(d: number): boolean {
  return Number.isInteger(d) && Math.abs(d) <= MAX_CARRY_CELLS
}

export function useViewWindow(): ViewWindow {
  const [win, setWin] = useState<ReadWindow>(read)
  // The window stays where it is in cyberspace when the anchor moves under
  // it. A landing re-anchors render space by whole cells, so the offsets are
  // carried by exactly that shift, worked out here in the same render that
  // sees the new anchor rather than in a later update: what the window covers
  // does not change, so nothing downstream rescans it (the terrain volume
  // keys on its world centre). Before, a landing moved the window one cell in
  // the world, the volume rescanned there, and the settled window moved it
  // back and rescanned again: two full rescans and two point-field rebuilds
  // per step of a walk, at the moment it landed (2026-10-13).
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const view = useCyberspace((s) => s.view)
  const origin = alignedOrigin(anchor, scaleExp)
  const carried = useMemo<ViewWindow>(() => {
    if (win.scaleExp !== scaleExp || win.view !== view || sameOrigin(win.origin, origin)) return win
    const [dr, du, dz] = originShift(win.origin, origin, scaleExp, useCyberspace.getState().axes())
    // Only a landing's shift is carried: a few whole cells. A jump across the
    // cube (stepping the hyperspace scrubber between two ports, which sit at
    // random coordinates) shifts the origin by more cells than a double holds
    // exactly, the carried offsets came out fractional, and the terrain
    // volume's BigInt threw, which took the scene and its GL context down
    // (Android's GPU process crashed stepping block 6 to 7, 2026-10-15).
    // Such a jump starts the window afresh, where the cursor is now.
    if (!carriable(dr) || !carriable(du) || !carriable(dz)) return read()
    return { right: win.right + dr, up: win.up + du, out: win.out + dz }
    // origin.x/y/z stand in for origin, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, scaleExp, view, origin.x, origin.y, origin.z])

  useEffect(() => watchCursorSettle(() => {
    const next = read()
    setWin((prev) =>
      prev.right === next.right && prev.up === next.up && prev.out === next.out &&
      prev.scaleExp === next.scaleExp && prev.view === next.view && sameOrigin(prev.origin, next.origin) ? prev : next,
    )
  }), [])

  return carried
}

/**
 * Call `fire` once the cursor (or the anchor, the history step, the zoom or
 * the view) has settled (CURSOR_SETTLE_MS), and while VIEW flies, at most
 * FLY_REFRESH_MS apart (settleWait). Once on install too: the store may have
 * moved before it. Returns the uninstall.
 *
 * A transient store subscription rather than selector hooks. Subscribing the
 * window to `cursor` re-rendered the entire World subtree on every keypress
 * just to restart a timer, so each move paid a React commit it did not need.
 * The subscription restarts the timer without rendering anything, and the
 * only render is the window's own once `fire` runs.
 */
export function watchCursorSettle(fire: () => void, clock: () => number = () => performance.now()): () => void {
  let handle: ReturnType<typeof setTimeout> | null = null
  // When `fire` last ran, for a fly's refresh.
  let lastFire = -Infinity
  const run = (): void => {
    handle = null
    lastFire = clock()
    fire()
  }
  const schedule = (): void => {
    if (handle !== null) clearTimeout(handle)
    handle = setTimeout(run, settleWait(0, clock() - lastFire, flyDir() !== 0))
  }
  const unsubscribe = useCyberspace.subscribe((s, prev) => {
    if (
      s.cursor !== prev.cursor ||
      s.anchor !== prev.anchor ||
      s.exploreIndex !== prev.exploreIndex ||
      s.scaleExp !== prev.scaleExp ||
      s.view !== prev.view
    ) schedule()
  })
  // The camera flown or panned off the cursor by another whole cell.
  const unsubscribeCentre = useViewCentre.subscribe(schedule)
  schedule()
  return () => {
    unsubscribeCentre()
    unsubscribe()
    if (handle !== null) clearTimeout(handle)
  }
}
