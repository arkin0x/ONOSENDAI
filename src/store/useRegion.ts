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
 * a region picked here is exactly the one relay.onosendai.tech/C/<hex> serves.
 */

import { create } from 'zustand'
import type { Plane } from 'cyberspace-core'
import { coveringRegion } from '../lib/coordRoute'
import type { Position } from '../lib/space'
import { samePosition, useCyberspace } from './useCyberspace'

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
  /** The plane the region is read in (the view's). */
  plane: Plane
  enter: () => void
  exit: () => void
  /** X: cursor back to the entry cell, region collapsed to that one cell at the current zoom. */
  collapseToEntry: () => void
  /** RESET: the region back to the size it had on entry, the cursor left where it is. */
  resetSize: () => void
}

/** The region holding only `at`, at `scaleExp`, in `plane`; its prefix or null. */
function regionFor(at: Position, scaleExp: number, plane: Plane): string | null {
  return coveringRegion([at], scaleExp, plane)?.prefix ?? null
}

/** Watches the view while region mode is on; torn down on exit. */
let watch: (() => void) | null = null

export const useRegion = create<RegionState>((set, get) => ({
  active: false,
  entry: null,
  entryScale: 0,
  entryPrefix: null,
  prefix: null,
  plane: 0,

  enter: () => {
    const cs = useCyberspace.getState()
    if (!cs.viewing() || get().active) return
    const entry = { ...cs.cursor }
    const plane = cs.anchorPlane
    const prefix = regionFor(entry, cs.scaleExp, plane)
    set({ active: true, entry, entryScale: cs.scaleExp, entryPrefix: prefix, prefix, plane })
    // Grow (or reject) the region as the cursor moves or the zoom changes, and
    // fold region mode the moment VIEW ends (RECALL, a mode change, a hop).
    let last = { cursor: cs.cursor, scaleExp: cs.scaleExp }
    watch?.()
    watch = useCyberspace.subscribe((s) => {
      if (!get().active) return
      if (!s.viewing()) { get().exit(); return }
      if (s.cursor === last.cursor && s.scaleExp === last.scaleExp) return
      last = { cursor: s.cursor, scaleExp: s.scaleExp }
      const self = get()
      if (!self.entry) return
      // Both whole cells, at the zoom now: the smallest prefix over them, or
      // the one we have if there is none (reject the move's effect).
      const grown = coveringRegion([self.entry, s.cursor], s.scaleExp, self.plane)
      if (grown) set({ prefix: grown.prefix })
    })
  },

  exit: () => {
    watch?.()
    watch = null
    if (!get().active) return
    set({ active: false, entry: null, entryPrefix: null, prefix: null })
  },

  collapseToEntry: () => {
    const self = get()
    const cs = useCyberspace.getState()
    if (!self.active || !self.entry) return
    const prefix = regionFor(self.entry, cs.scaleExp, self.plane)
    // Move the cursor home first (this fires the watch, which recomputes the
    // same one-cell prefix), then settle the prefix in case the move was a
    // no-op (the cursor was already on the entry cell).
    if (!samePosition(cs.cursor, self.entry)) cs.aimView({ ...self.entry }, self.plane)
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
