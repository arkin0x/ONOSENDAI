/**
 * useScan.ts - SCAN mode (arkinox, 2026-11-14): "a new mode after build that
 * is called SCAN. Its theme will be purple. You can move the cursor and scan
 * wherever the cursor is. You can choose the scan height. The default minimum
 * will be 12 and the maximum will be your local compute power benchmark. If
 * you go beyond the maximum, it will automatically enlist Hosaka to help."
 *
 * What the mode is made of:
 *
 * - SCAN rides the standard VIEW (CyberFocus.view): the pad, W A S D, R and
 *   F and the zoom move the cursor exactly as in VIEW, and nothing here moves
 *   you or signs anything. `active` says the view is SCAN's; the pad's mode
 *   is SCAN while it is up (store/padMode.ts). The view ending any other way
 *   (RETURN, Esc, Earth, another identity) ends the mode, and BUILD or WALK
 *   coming on ends it too: the subscriptions at the bottom.
 * - The height is the side of the cube scanned, 2^height, the aligned cube
 *   holding the cursor (lib/scanCube.ts), drawn in purple
 *   (scene/ScanRegionBox.tsx). From 12, the passive scan's ceiling, up to this
 *   device's benchmark (localKeyCeiling) the key is computed here, in a
 *   worker of its own, and costs nothing. Above it, up to HOSAKA's hop cap,
 *   SCAN buys the key through the keyring's purchase flow as it stands
 *   (useSecrets `buy`: quote, invoice, pay, the key checked and held as
 *   bought). With HOSAKA off or its limits unknown, the range stops at the
 *   local max.
 * - One key per scan, the cube at the height chosen (lib/scanCube.ts says
 *   why not the ladder under it). It is held with source `scanmode` and asked
 *   about at once, so what it opens lands in the find chip and the Nearby
 *   list. A cube already held is only asked about again: never computed twice,
 *   never bought twice.
 * - One scan at a time. Leaving SCAN leaves a scan running: a local one
 *   finishes in its worker and is held, a HOSAKA one is the cloud flow's, with
 *   its pulse and its invoice, as any purchase is. CANCEL (or X) stops it:
 *   the worker is terminated; a HOSAKA job is stopped the way the Cloud
 *   compute panel stops one (useCyberspace `cancelCloud`), which keeps a paid
 *   job claimable.
 */

import { create } from 'zustand'
import { MAX_COMPUTE_HEIGHT, useCyberspace, type CyberspaceState } from './useCyberspace'
import { useBuilder } from './useBuilder'
import { useRegion } from './useRegion'
import { useSecrets } from './useSecrets'
import { useShards } from './useShards'
import { localKeyCeiling, localKeySeconds, regionKeyQuote } from '../lib/deployPlan'
import { useCalibration } from '../lib/calibration'
import { alignedBase } from '../lib/secrets/base'
import { clampScanHeight, computeCube, heldCube, scanRange, SCAN_MIN_HEIGHT, type CubeRun, type ScanRange, type WorkerFactory } from '../lib/scanCube'
import type { Position } from '../lib/space'
import type { Plane } from 'cyberspace-core'

/** The label SCAN's view carries. */
export const SCAN_FOCUS_LABEL = 'SCAN'

/** A scan under way. */
export interface ScanJob {
  /** Where the scan was aimed: the cube is the one of side 2^height holding it. */
  at: Position
  plane: Plane
  height: number
  /** `local` computes here; `cloud` is HOSAKA's; `held` is a key already held, only asked about. */
  route: 'local' | 'cloud' | 'held'
  startedAt: number
  /** What this device's benchmark says the key takes, in seconds; null when unknown. */
  estSeconds: number | null
  /** Asking the relays with the key, the computing done. */
  asking: boolean
}

/** How the last scan ended, for the line under the controls. */
export type ScanResult =
  | { kind: 'found'; height: number; count: number }
  | { kind: 'failed'; height: number; message: string }
  | { kind: 'cancelled'; height: number }

export interface ScanState {
  /** SCAN mode is on: the standard VIEW is SCAN's. */
  active: boolean
  /** The scan height: the cube's side is 2^height. */
  height: number
  job: ScanJob | null
  result: ScanResult | null
  /** SCAN at the cursor's view, or where you are looking: from HOP, VIEW, or BUILD's cursor. */
  enter: () => void
  /** SCAN off. The view goes with it unless `keepView`. A scan under way keeps running. */
  exit: (keepView?: boolean) => void
  setHeight: (height: number) => void
  stepHeight: (delta: number) => void
  /** Scan the cube at the cursor at the chosen height. */
  start: () => Promise<void>
  /** Stop the scan under way. */
  cancel: () => void
}

/** The range the stepper offers now. */
export function currentScanRange(s: Pick<CyberspaceState, 'cloudPrefs' | 'cloud'> = useCyberspace.getState()): ScanRange {
  return scanRange(localKeyCeiling(), s.cloudPrefs.mode !== 'off', s.cloud.limits?.max_hop_height ?? null)
}

/** Who computes `height`: this device, or HOSAKA. */
export function scanRoute(height: number, range: ScanRange = currentScanRange()): 'local' | 'cloud' {
  return height <= range.localMax ? 'local' : 'cloud'
}

/** HOSAKA's price for the cube at `height`, in sats; null when unknown. */
export function scanPrice(height: number, s: Pick<CyberspaceState, 'cloud'> = useCyberspace.getState()): number | null {
  return regionKeyQuote(height, s.cloud.provider)?.sats ?? null
}

/**
 * The cube the purple box draws (scene/ScanRegionBox.tsx): only in SCAN; the
 * cube being scanned while a scan in this plane runs, so what is being looked
 * at never moves; else the cube at the cursor at the chosen height.
 */
export function scanCubeShown(
  scan: Pick<ScanState, 'active' | 'height' | 'job'>,
  cs: { cursor: Position; anchorPlane: Plane; viewing: boolean; building: boolean },
): { at: Position; height: number } | null {
  if (!scan.active || !cs.viewing || cs.building) return null
  if (scan.job && scan.job.plane === cs.anchorPlane) return { at: scan.job.at, height: scan.job.height }
  return { at: cs.cursor, height: scan.height }
}

/** Where a scan aims: the view's cursor, in the plane the view shows. */
function aim(): { at: Position; plane: Plane } {
  const cs = useCyberspace.getState()
  return { at: { ...cs.cursor }, plane: cs.anchorPlane }
}

/** The local scan's worker, so CANCEL can stop it. */
let run: CubeRun | null = null
/** Each scan's number: an answer for an older one is dropped. */
let serial = 0
/** Tests hand in their own worker. */
let workerFactory: WorkerFactory | null | undefined
export function setScanWorkerFactory(f: WorkerFactory | null | undefined): void { workerFactory = f }

/** Hold a scan's key and ask the relays with it. Resolves to what it opened, -1 when the relays could not be read. */
async function holdAndAsk(at: Position, plane: Plane, height: number, lookupId: string, keyHex: string): Promise<number> {
  useSecrets.getState().hold([{ lookupId, keyHex, height, base: alignedBase(at, height), plane, source: 'scanmode', at: Math.floor(Date.now() / 1000) }])
  return useShards.getState().rescan(lookupId, keyHex)
}

function settle(id: number, height: number, count: number): void {
  if (id !== serial) return
  useScan.setState({
    job: null,
    result: count < 0 ? { kind: 'failed', height, message: 'The relays did not answer. Scan again.' } : { kind: 'found', height, count },
  })
}

export const useScan = create<ScanState>((set, get) => ({
  active: false,
  height: SCAN_MIN_HEIGHT,
  job: null,
  result: null,

  enter: () => {
    if (get().active) return
    const cs = useCyberspace.getState()
    // Region mode is a VIEW tool, as in BUILD.
    useRegion.getState().exit()
    if (!cs.viewing()) {
      cs.viewHere()
      if (!useCyberspace.getState().viewing()) return
    }
    set({ active: true, result: null, height: clampScanHeight(get().height, currentScanRange()) })
  },

  exit: (keepView = false) => {
    if (!get().active) return
    set({ active: false, result: null })
    if (keepView) return
    const cs = useCyberspace.getState()
    if (cs.focus?.drive) cs.clearFocus(true)
  },

  setHeight: (height) => {
    if (get().job) return
    set({ height: clampScanHeight(height, currentScanRange()), result: null })
  },

  stepHeight: (delta) => get().setHeight(get().height + delta),

  start: async () => {
    if (!get().active || get().job) return
    const range = currentScanRange()
    const height = clampScanHeight(get().height, range)
    const { at, plane } = aim()
    const held = heldCube(useSecrets.getState().keys, at, plane, height)
    const route = held ? 'held' : scanRoute(height, range)
    if (route === 'cloud') {
      // Never a purchase without its price on the button, nor over another one.
      const why = scanPrice(height) === null ? 'No price from HOSAKA yet. Try again in a moment.'
        : useSecrets.getState().buying ? 'HOSAKA is already computing a key for you.' : null
      if (why) { set({ result: { kind: 'failed', height, message: why } }); return }
    }
    const id = ++serial
    const estSeconds = route === 'local' ? localKeySeconds(height, useCalibration.getState().cantorMsByHeight) : route === 'cloud' ? regionKeyQuote(height, useCyberspace.getState().cloud.provider)?.seconds ?? null : null
    set({ result: null, job: { at, plane, height, route, startedAt: Date.now(), estSeconds, asking: route === 'held' } })

    if (held) {
      settle(id, height, await useShards.getState().rescan(held.lookupId, held.keyHex))
      return
    }

    if (route === 'local') {
      const r = computeCube(at, height, MAX_COMPUTE_HEIGHT, workerFactory)
      run = r
      const key = await r.done
      if (run === r) run = null
      if (id !== serial) return
      if (!key) {
        set({ job: null, result: { kind: 'failed', height, message: 'The scan could not be computed. Scan again.' } })
        return
      }
      set({ job: { ...get().job!, asking: true } })
      settle(id, height, await holdAndAsk(at, plane, height, key.lookupId, key.keyHex))
      return
    }

    // HOSAKA: the keyring's purchase as it stands, which holds the key as
    // bought and asks the relays with it. Asked again here for the count.
    const bought = await useSecrets.getState().buy(at, plane, height)
    if (id !== serial) return
    if (!bought) {
      set({ job: null, result: { kind: 'failed', height, message: useSecrets.getState().buyError ?? 'HOSAKA could not compute it.' } })
      return
    }
    set({ job: { ...get().job!, asking: true } })
    settle(id, height, await useShards.getState().rescan(bought.lookupId, bought.keyHex))
  },

  cancel: () => {
    const job = get().job
    if (!job) return
    serial++
    if (run) { run.cancel(); run = null }
    // A HOSAKA job stops the way the Cloud compute panel stops one.
    if (job.route === 'cloud') useCyberspace.getState().cancelCloud()
    set({ job: null, result: { kind: 'cancelled', height: job.height } })
  },
}))

// The view SCAN rides ended some other way (RETURN, Esc, Earth, a stop,
// another identity): the mode ends with it, and its marker.
// The cursor moving on clears the last scan's answer, which was for the cube it left.
useCyberspace.subscribe((s, prev) => {
  const scan = useScan.getState()
  if (scan.active && !s.viewing()) { scan.exit(true); return }
  if (scan.result && s.cursor !== prev.cursor) useScan.setState({ result: null })
})

// BUILD coming on (B, a DEPLOY) ends SCAN, keeping the view BUILD starts from.
useBuilder.subscribe((b, prev) => {
  if (b.active && !prev.active && useScan.getState().active) useScan.getState().exit(true)
})
