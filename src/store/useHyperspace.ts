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
import { EARTH_SCALE_EXP } from '../lib/hyperspace/interest'
import type { StopIndex } from '../lib/hyperspace/station'
import type { Plane } from 'cyberspace-core'
import type { Position } from '../lib/space'
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
  /**
   * True while the view on screen is hyperspace's (a block, a station, EARTH,
   * CYBERSPACE, the ride). It ends with the view: RECALL always goes home to
   * your avatar, never back to an earlier view (arkinox, 2026-11-11).
   */
  viewOwned: boolean
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
/** The sync state with `patch` applied, or `prev` itself when nothing in it changes (so no subscriber is told). */
export function nextSync(prev: HyperspaceSync, patch: Partial<HyperspaceSync>): HyperspaceSync {
  const keys = Object.keys(patch) as (keyof HyperspaceSync)[]
  return keys.every((k) => patch[k] === prev[k]) ? prev : { ...prev, ...patch }
}

/** How often the anchor sync's loaded count reaches the store: it only feeds a progress readout. */
const LOADED_EVERY_MS = 1000

export const useHyperspace = create<HyperspaceState>((set) => ({
  sync: { status: 'idle', loaded: 0, total: 0, error: null, source: 'relay' },
  field: { building: false, drawn: 0, inside: null },
  indexVersion: 0,
  tipHeight: null,
  scrubHeight: null,
  viewOwned: false,
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
    // The sync reports progress several times a second while a fresh device
    // loads about a million anchors, and every report re-rendered each panel
    // that shows it (2026-10-15). A report that changes nothing is dropped,
    // and the loaded count reaches the store at most once a second; any other
    // change (status, source, total) carries the latest count with it.
    let pendingLoaded: number | null = null
    let loadedTimer: ReturnType<typeof setTimeout> | null = null
    const patch = (next: Partial<HyperspaceSync>, extra: Partial<HyperspaceState> = {}): void => set((s) => {
      const sync = nextSync(s.sync, pendingLoaded !== null ? { loaded: pendingLoaded, ...next } : next)
      pendingLoaded = null
      return sync === s.sync && Object.keys(extra).length === 0 ? s : { ...extra, sync }
    })
    void runAnchorSync({
      onStatus: (status, error) => patch({ status, error: error ?? null }),
      onSource: (source) => patch({ source }),
      onLoaded: (loaded) => {
        pendingLoaded = loaded
        if (loadedTimer !== null) return
        loadedTimer = setTimeout(() => { loadedTimer = null; if (pendingLoaded !== null) patch({}) }, LOADED_EVERY_MS)
      },
      onTip: (tip) => patch({ total: tip + 1 }, useHyperspace.getState().tipHeight === tip ? {} : { tipHeight: tip }),
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
  if (!useHyperspace.getState().viewOwned) useHyperspace.setState({ viewOwned: true })
}

/**
 * The zoom a block is viewed at, from every way to view one (arkinox,
 * 2026-11-11: every view arrives framed to fit): a landfall is a place on
 * Earth, so the globe with its side toward the camera; a port at 2^34, where
 * a cell is 2 meters and the stop reads as a place you could stand at.
 */
export function stopScale(stop: Pick<Stop, 'kind'>): number {
  return stop.kind === 'landfall' ? EARTH_SCALE_EXP : 34
}

/**
 * VIEW a hyperspace thing (a block, a station, EARTH, CYBERSPACE, a point on
 * the globe): the standard VIEW, framed on the thing (CyberFocus.fit), owned
 * by hyperspace with `height` the block it is on, null for none.
 */
export function viewHyperspace(position: Position, plane: Plane, label: string, scaleExp: number | undefined, height: number | null): void {
  useCyberspace.getState().viewAt(position, plane, label, scaleExp, { fit: true })
  useHyperspace.setState({ viewOwned: true, viewedStop: height })
}

/** Record which stop the owned focus is on (null for a non-stop focus like
 * EARTH's centre), so the scene can treat the viewed block specially. */
export function markViewedStop(height: number | null): void {
  useHyperspace.setState({ viewedStop: height })
}

/**
 * Close the scrubber chip and nothing else (arkinox, 2026-10-15: "I should be
 * able to close the hyperspace chip without affecting my current view at
 * all"). A block it was showing stays on screen, owned by hyperspace, until
 * RETURN on the viewing bar (exitHyperspaceView).
 */
export function closeScrubber(): void {
  if (useHyperspace.getState().scrubHeight !== null) useHyperspace.setState({ scrubHeight: null })
}

/**
 * Leave the hyperspace view: close the scrubber, and clear the focus only if
 * hyperspace set it (never a shard's focus, never a running spectate). Home
 * to your avatar, at the zoom from before the look began (clearFocus).
 */
export function exitHyperspaceView(): void {
  const owned = useHyperspace.getState().viewOwned
  useHyperspace.setState({ scrubHeight: null, viewOwned: false, viewedStop: null })
  const cs = useCyberspace.getState()
  if (owned && cs.spectate === null && cs.focus !== null) cs.clearFocus()
}

// Spectating a person replaces any hyperspace view: drop the scrubber and the
// ownership without touching the focus (beginSpectate already cleared it).
// A view that ends any other way (RECALL, RETURN, Esc) ends the hyperspace
// view with it, scrubber and all, and another VIEW taking its place drops the
// ownership, so no bar or marked block is left behind (arkinox, 2026-11-11).
useCyberspace.subscribe((s, prev) => {
  const hs = useHyperspace.getState()
  if (s.spectate !== null && prev.spectate === null) {
    if (hs.scrubHeight !== null || hs.viewOwned) useHyperspace.setState({ scrubHeight: null, viewOwned: false, viewedStop: null })
    return
  }
  if (!hs.viewOwned || s.focus === prev.focus) return
  if (s.focus === null) useHyperspace.setState({ scrubHeight: null, viewOwned: false, viewedStop: null })
  else if (s.focus.view === true && s.focus.label !== prev.focus?.label) useHyperspace.setState({ viewOwned: false, viewedStop: null })
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
