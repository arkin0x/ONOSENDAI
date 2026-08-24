/**
 * useHyperspace.ts: sync state and UI selections for the hyperspace line.
 *
 * The store holds only what React should re-render on: sync progress, the
 * tip, the scrubber position and the chosen destination. The ~1M stops
 * themselves live in a module-level columnar singleton owned by the anchors
 * engine (the cameraPose convention: per-frame and bulk data must not flow
 * through state). Components read them through getStopIndex / getStopByHeight
 * and subscribe to indexVersion to learn that stops changed; the engine
 * batches bumps to at most one per 2.5 s during the bulk load and one per
 * 500 ms once ready.
 */

import { create } from 'zustand'
import { anchorIndex, runAnchorSync, type SyncSource } from '../lib/hyperspace/anchors'
import { stopByHeight } from '../lib/hyperspace/compactIndex'
import type { Stop } from '../lib/hyperspace/stops'
import type { StopIndex } from '../lib/hyperspace/station'
import { useCyberspace } from './useCyberspace'

export interface HyperspaceSync {
  status: 'idle' | 'loading-cache' | 'syncing' | 'ready' | 'error'
  /** Unique heights currently in the index. */
  loaded: number
  /** tipHeight + 1 when known, else 0. */
  total: number
  error: string | null
  /** Where stops have come from: verified header blobs, the relay, or both. */
  source: SyncSource
}

interface HyperspaceState {
  sync: HyperspaceSync
  /** Bumped whenever stops are added to the index. */
  indexVersion: number
  tipHeight: number | null
  /** The stop being viewed on the line; null = scrubber off. */
  scrubHeight: number | null
  /** True while hyperspace UI owns the camera focus (VIEW, EARTH, the scrubber). */
  viewOwned: boolean
  /** The zoom to restore when the owned view exits; captured when hyperspace
   * first takes the focus, because its views re-frame at their own scales. */
  returnScaleExp: number | null
  /** The chosen destination stop height; null = none. */
  destination: number | null
  startSync: () => void
  setScrubHeight: (h: number | null) => void
  setDestination: (h: number | null) => void
}

// A module flag rather than store state, the publisher/tracker pattern:
// React's dev double-mount must not start two sync pipelines.
let started = false

export const useHyperspace = create<HyperspaceState>((set) => ({
  sync: { status: 'idle', loaded: 0, total: 0, error: null, source: 'relay' },
  indexVersion: 0,
  tipHeight: null,
  scrubHeight: null,
  viewOwned: false,
  returnScaleExp: null,
  destination: null,

  startSync: () => {
    if (started) return
    started = true
    // vitest runs this module under node, where neither API exists; the
    // guard keeps the store importable and startSync callable anywhere.
    if (typeof indexedDB === 'undefined' || typeof WebSocket === 'undefined') {
      set((s) => ({ sync: { ...s.sync, status: 'error', error: 'IndexedDB or WebSocket is unavailable in this environment' } }))
      return
    }
    void runAnchorSync({
      onStatus: (status, error) => set((s) => ({ sync: { ...s.sync, status, error: error ?? null } })),
      onSource: (source) => set((s) => ({ sync: { ...s.sync, source } })),
      onLoaded: (loaded) => set((s) => ({ sync: { ...s.sync, loaded } })),
      onTip: (tip) => set((s) => ({ tipHeight: tip, sync: { ...s.sync, total: tip + 1 } })),
      onIndexChanged: () => set((s) => ({ indexVersion: s.indexVersion + 1 })),
    })
  },

  setScrubHeight: (h) => set({ scrubHeight: h }),
  setDestination: (h) => set({ destination: h }),
}))

/** The live, mutable index instance; identity is stable for the page. */
export function getStopIndex(): StopIndex {
  return anchorIndex
}

export function getStopByHeight(height: number): Stop | undefined {
  return stopByHeight(anchorIndex, height)
}

export function stopCount(): number {
  return anchorIndex.size
}


/** Mark the current camera focus as hyperspace's, so RETURN and Escape know to clear it. */
export function ownHyperspaceView(): void {
  if (useHyperspace.getState().viewOwned) return
  // First ownership: remember the zoom the user was actually at, because the
  // hyperspace views re-frame at their own scales and RETURN must not strand
  // the camera there.
  useHyperspace.setState({ viewOwned: true, returnScaleExp: useCyberspace.getState().scaleExp })
}

/**
 * Leave the hyperspace view: close the scrubber, and clear the focus only if
 * hyperspace set it (never a shard's focus, never a running spectate).
 */
export function exitHyperspaceView(): void {
  const { viewOwned: owned, returnScaleExp } = useHyperspace.getState()
  useHyperspace.setState({ scrubHeight: null, viewOwned: false, returnScaleExp: null })
  const cs = useCyberspace.getState()
  if (owned && cs.spectate === null && cs.focus !== null) cs.clearFocus()
  // Back at the zoom the user left, not whatever a stop view chose.
  if (owned && returnScaleExp !== null && returnScaleExp !== cs.scaleExp) {
    useCyberspace.setState({ scaleExp: returnScaleExp })
  }
}

// Spectating a person replaces any hyperspace view: drop the scrubber and the
// ownership without touching the focus (beginSpectate already cleared it).
useCyberspace.subscribe((s, prev) => {
  if (s.spectate !== null && prev.spectate === null) {
    const hs = useHyperspace.getState()
    if (hs.scrubHeight !== null || hs.viewOwned) {
      // No zoom restore here: the spectate is taking the camera somewhere
      // else on purpose, and yanking the scale under it would fight that.
      useHyperspace.setState({ scrubHeight: null, viewOwned: false, returnScaleExp: null })
    }
  }
})


// DEV window handle, the house pattern (__store, __shards): lets a headless
// smoke test drive the scrubber and destination without waiting for a full
// relay sync to unlock the rail UI.
declare global {
  interface Window { __hyper?: unknown }
}
try {
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    window.__hyper = { store: useHyperspace, getStopByHeight, stopCount }
  }
} catch {
  // node or a locked-down context: the handle is a convenience only
}
