/**
 * useRegion.ts - the region selector, a tool inside VIEW (arkinox, 2026-11-11).
 *
 * The Region button in the CONTROLS panel turns it on while you are in VIEW.
 * The cursor box becomes the region a /C/ prefix fixes (lib/coordRoute.ts),
 * drawn in the bright /C/-visit yellow (scene/RegionSelectBox.tsx), and the
 * REGION chip shows that prefix for you to copy or reserve (hud/RegionChip.tsx).
 *
 * The selection is the smallest valid prefix that holds two cells at the zoom
 * you are at: the one the cursor sat on when you turned region mode on (the
 * entry cell) and the one it sits on now. Move the cursor with the usual keys
 * and the region grows to keep holding both; zoom out and it grows to the
 * coarser cells. A move or zoom that would not land on a valid prefix leaves
 * the region where it is. X collapses it back to the entry cell at the zoom
 * you are now at; RESET puts it back to the size it had on entry.
 *
 * The prefix math is coordRoute's, shared with the relay's region vectors, so
 * a region picked here is exactly the one relay.onosendai.tech/<hex> serves
 * (the relay path is the bare hex; /C/<hex> is the app's own form).
 *
 * Entered on a /C/ region link's own view (an arrival with ?mode=region,
 * store/arrivalMode.ts, or the Region button pressed there, toggleRegion;
 * owner, 2026-11-13), the link's region is the seed: region mode starts on
 * exactly that prefix, and the region grows from the whole seed box, not
 * from one cell, so it never shrinks inside the region the link named. Once
 * the view is something else (another view, or the cursor panned out of the
 * link's box: useCoordRoute linkRegionSeed), the button starts at the
 * cursor's cell, as anywhere else.
 *
 * A prefix of 1 to 63 hex has no plane (CYBERSPACE_V2.md §2.5): the region is
 * the same box in both, so a plane switch keeps region mode and its prefix,
 * and everything here reads the plane the view shows now.
 */

import { create } from 'zustand'
import { coveringRegion, prefixRegion } from '../lib/coordRoute'
import type { Position } from '../lib/space'
import { samePosition, useCyberspace } from './useCyberspace'
import { linkRegionSeed } from './useCoordRoute'

interface RegionState {
  /** Region mode is on. Only ever true while VIEW's free view is up. */
  active: boolean
  /** The cursor's cell when region mode started, the region's one fixed corner. */
  entry: Position | null
  /** The zoom region mode started at, for the original-size test. */
  entryScale: number
  /** The prefix the region had on entry: RESET returns to it. */
  entryPrefix: string | null
  /** The region's current prefix hex, null when no valid prefix covers the cells. */
  prefix: string | null
  /** The low and high corners of the seed region a /C/ link named; empty without one. Every region holds them. */
  seed: Position[]
  /** Region mode on, at the cursor; with `seedPrefix`, on that prefix's region (a /C/ link's). */
  enter: (seedPrefix?: string) => void
  exit: () => void
  /** X: cursor back to the entry cell, region collapsed to that one cell at the current zoom. */
  collapseToEntry: () => void
  /** RESET: the region back to the size it had on entry, the cursor left where it is. */
  resetSize: () => void
}

/** The region holding only `at` (and the seed), at `scaleExp`; its prefix or null. The plane never reaches a prefix, so the view's is as good as any. */
function regionFor(at: Position, scaleExp: number, seed: readonly Position[]): string | null {
  return coveringRegion([...seed, at], scaleExp, useCyberspace.getState().anchorPlane)?.prefix ?? null
}

/** A prefix's box as its two corners, so a covering of them is that prefix (or a coarser one at a coarse zoom). */
function seedCorners(prefix: string | undefined): Position[] {
  if (!prefix || !/^[0-9a-f]{1,63}$/.test(prefix)) return []
  const { base, heights } = prefixRegion(prefix)
  const top = (v: bigint, h: number): bigint => v + (1n << BigInt(h)) - 1n
  return [base, { x: top(base.x, heights.x), y: top(base.y, heights.y), z: top(base.z, heights.z) }]
}

/** Watches the view while region mode is on; torn down on exit. */
let watch: (() => void) | null = null

export const useRegion = create<RegionState>((set, get) => ({
  active: false,
  entry: null,
  entryScale: 0,
  entryPrefix: null,
  prefix: null,
  seed: [],

  enter: (seedPrefix) => {
    const cs = useCyberspace.getState()
    if (!cs.viewing() || get().active) return
    const entry = { ...cs.cursor }
    const seed = seedCorners(seedPrefix)
    const prefix = regionFor(entry, cs.scaleExp, seed)
    set({ active: true, entry, entryScale: cs.scaleExp, entryPrefix: prefix, prefix, seed })
    // Grow (or reject) the region as the cursor moves or the zoom changes, and
    // fold region mode the moment VIEW ends (RECALL, a mode change, a hop) or
    // another view takes its place (a search, a block, a star). A plane
    // switch is neither: it keeps the view, its label and the region.
    let last = { cursor: cs.cursor, scaleExp: cs.scaleExp }
    const label = cs.focus?.label
    watch?.()
    watch = useCyberspace.subscribe((s) => {
      if (!get().active) return
      if (!s.viewing() || s.focus?.label !== label) { get().exit(); return }
      if (s.cursor === last.cursor && s.scaleExp === last.scaleExp) return
      last = { cursor: s.cursor, scaleExp: s.scaleExp }
      const self = get()
      if (!self.entry) return
      // Both whole cells, at the zoom now: the smallest prefix over them, or
      // the one we have if there is none (reject the move's effect).
      const grown = coveringRegion([...self.seed, self.entry, s.cursor], s.scaleExp, s.anchorPlane)
      if (grown) set({ prefix: grown.prefix })
    })
  },

  exit: () => {
    watch?.()
    watch = null
    if (!get().active) return
    set({ active: false, entry: null, entryPrefix: null, prefix: null, seed: [] })
  },

  collapseToEntry: () => {
    const self = get()
    const cs = useCyberspace.getState()
    if (!self.active || !self.entry) return
    const prefix = regionFor(self.entry, cs.scaleExp, self.seed)
    // Move the cursor home first (this fires the watch, which recomputes the
    // same one-cell prefix), then settle the prefix in case the move was a
    // no-op (the cursor was already on the entry cell). The view keeps the
    // plane it is in, which may not be the one region mode began in.
    if (!samePosition(cs.cursor, self.entry)) cs.aimView({ ...self.entry }, cs.anchorPlane)
    set({ prefix })
  },

  resetSize: () => {
    const self = get()
    if (!self.active) return
    set({ prefix: self.entryPrefix })
  },
}))

/** The region is still the size it was on entry: RECALL stays RECALL, not RESET. */
export function regionAtOriginalSize(s: Pick<RegionState, 'prefix' | 'entryPrefix'>): boolean {
  return s.prefix === s.entryPrefix
}

/**
 * The Region button in VIEW: region mode off when it is on; else on, over the
 * /C/ region link's own region while that link's view is still up
 * (useCoordRoute linkRegionSeed), at the cursor's cell otherwise.
 */
export function toggleRegion(): void {
  const r = useRegion.getState()
  if (r.active) r.exit()
  else r.enter(linkRegionSeed())
}
