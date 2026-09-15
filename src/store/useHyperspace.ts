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
import { useCyberspace, type CyberFocus } from './useCyberspace'

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

/**
 * What the stop field is doing, so the HUD can say so rather than leave the
 * user guessing whether a thin cloud is the answer or a half-finished one.
 *
 * The field rebuilds in 12 ms slices across frames (StopField.SLICE_MS), so a
 * dense view fills in over several hundred milliseconds with nothing on screen
 * to say it is still working. `building` is set once when a rebuild starts and
 * cleared once when it commits: two writes per rebuild, never one per slice.
 *
 * `drawn` and `inside` are the last commit's counts. Inside a sphere of
 * interest the identity prefilter is switched off (StopField.ADMIT_ALL), so
 * every row in the cover is decoded and tested: `inside` is therefore the
 * EXACT number of stops in the sphere, not an estimate, and `drawn` is what
 * survived the thousand-point budget. Outside a sphere there is no sphere to
 * count, so `inside` is null.
 */
export interface FieldStatus {
  building: boolean
  drawn: number
  inside: number | null
}

interface HyperspaceState {
  sync: HyperspaceSync
  /** The stop field's own progress and counts; see FieldStatus. */
  field: FieldStatus
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
  /**
   * The focus that was standing when hyperspace took the camera, restored
   * whole when it gives it back. Null means there was none and the exit goes
   * home to the avatar, which is what it always did.
   *
   * This exists because "give the camera back" and "go home" are not the same
   * instruction. Tapping a block while looking at a place in the POSITION
   * panel used to end with the place thrown away and the zoom wound back to
   * whatever it was before the place was ever typed, because clearFocus
   * restores the scale remembered at the FIRST focus of the session, not the
   * one hyperspace borrowed from.
   */
  returnFocus: CyberFocus | null
  /** The stop height the owned hyperspace focus is on, or null when the
   * focus is not a stop (EARTH's centre) or hyperspace has no view. */
  viewedStop: number | null
  /** The chosen destination stop height; null = none. */
  destination: number | null
  startSync: () => void
  setScrubHeight: (h: number | null) => void
  /** The stop field starting a rebuild. Idempotent: a second call changes nothing. */
  fieldBuilding: () => void
  /** Clear the working flag without touching the counts: a build was abandoned, not finished. */
  fieldSettled: () => void
  /** The stop field committing one. `inside` is null when the build had no sphere. */
  fieldDone: (drawn: number, inside: number | null) => void
  setDestination: (h: number | null) => void
}

// A module flag rather than store state, the publisher/tracker pattern:
// React's dev double-mount must not start two sync pipelines.
let started = false

export const useHyperspace = create<HyperspaceState>((set) => ({
  sync: { status: 'idle', loaded: 0, total: 0, error: null, source: 'relay' },
  field: { building: false, drawn: 0, inside: null },
  indexVersion: 0,
  tipHeight: null,
  scrubHeight: null,
  viewOwned: false,
  returnScaleExp: null,
  returnFocus: null,
  viewedStop: null,
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
  // Both guarded against writing an identical value: the field commits on
  // every anchor nudge, and a no-op set would still notify every subscriber.
  fieldBuilding: () => set((s) => (s.field.building ? {} : { field: { ...s.field, building: true } })),
  // A build that is abandoned rather than finished: the counts on screen are
  // still the last real ones, so only the flag is cleared. Without this a
  // cancelled rebuild whose successor decides it has nothing to do leaves the
  // tag reading DRAWING with nobody left to finish it.
  fieldSettled: () => set((s) => (s.field.building ? { field: { ...s.field, building: false } } : {})),
  fieldDone: (drawn, inside) => set((s) => (
    !s.field.building && s.field.drawn === drawn && s.field.inside === inside
      ? {}
      : { field: { building: false, drawn, inside } }
  )),
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
  const cs = useCyberspace.getState()
  useHyperspace.setState({ viewOwned: true, returnScaleExp: cs.scaleExp, returnFocus: cs.focus })
}

/** Record which stop the owned focus is on (null for a non-stop focus like
 * EARTH's centre), so the scene can treat the viewed block specially. */
export function markViewedStop(height: number | null): void {
  useHyperspace.setState({ viewedStop: height })
}

/**
 * Leave the hyperspace view: close the scrubber, and clear the focus only if
 * hyperspace set it (never a shard's focus, never a running spectate).
 */
export function exitHyperspaceView(): void {
  const { viewOwned: owned, returnScaleExp, returnFocus } = useHyperspace.getState()
  useHyperspace.setState({ scrubHeight: null, viewOwned: false, returnScaleExp: null, returnFocus: null, viewedStop: null })
  const cs = useCyberspace.getState()
  if (!owned || cs.spectate !== null || cs.focus === null) return

  // Hand the camera back to whoever had it, which is not always the avatar.
  // A place typed into the POSITION panel is a focus of its own, and tapping a
  // block from it borrows the camera rather than replacing what the person was
  // doing; closing the overlay is "give it back", not "go home".
  if (returnFocus !== null) {
    cs.focusOn(returnFocus.position, returnFocus.plane, returnFocus.label, returnScaleExp ?? undefined, returnFocus.drive)
    return
  }

  cs.clearFocus()
  // Back at the zoom the user left, not whatever a stop view chose. Read the
  // scale fresh: clearFocus has just written one, and comparing against the
  // snapshot taken before it ran let the two disagree silently.
  if (returnScaleExp !== null && returnScaleExp !== useCyberspace.getState().scaleExp) {
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
      useHyperspace.setState({ scrubHeight: null, viewOwned: false, returnScaleExp: null, viewedStop: null })
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
