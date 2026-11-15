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
 *   bought), asked first as the Cloud compute panel's mode says, as a hide
 *   above the ceiling is (lib/deployPlan.ts needsAsk): in ASK, or in AUTO
 *   over its cap, the first press arms CONFIRM with the price and only a
 *   second press on the same cube, height and price buys. With HOSAKA off
 *   or its limits unknown, the range stops at the local max.
 * - One key per scan, the cube at the height chosen (lib/scanCube.ts says
 *   why not the ladder under it). It is held with source `scanmode` and asked
 *   about at once, so what it opens lands in the find chip and the Nearby
 *   list. A cube already held (in either plane: a region key is the same in
 *   both) is only asked about again: never computed twice, never bought twice.
 * - One scan at a time. Leaving SCAN leaves a scan running: a local one
 *   finishes in its worker and is held, a HOSAKA one is the cloud flow's, with
 *   its pulse and its invoice, as any purchase is. CANCEL (or X) stops a
 *   local scan (the worker is terminated) and a HOSAKA scan whose invoice is
 *   still unpaid (useCyberspace `cancelCloud`). Once HOSAKA is asked and
 *   paid there is nothing to cancel that would not lose what was paid for:
 *   it finishes and the key is held as bought. RECALL in SCAN never stops it
 *   either (store/padMode.ts recall).
 */

import { create } from 'zustand'
import { MAX_COMPUTE_HEIGHT, useCyberspace, type CyberspaceState } from './useCyberspace'
import { useBuilder } from './useBuilder'
import { useRegion } from './useRegion'
import { useSecrets } from './useSecrets'
import { useShards } from './useShards'
import { localKeyCeiling, needsAsk, regionKeyQuote } from '../lib/deployPlan'
import { HOP_AXIS_BUDGET_MS, projectCantorMs, useCalibration } from '../lib/calibration'
import { ratioOf, useExperience } from '../lib/experience'
import type { HosakaProvider } from '../lib/hosaka'
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

/** What the controls showed when SCAN was pressed: the scan goes only if it still holds. */
export interface ScanShown {
  route: 'local' | 'cloud' | 'held'
  /** The price on the button, for a HOSAKA height. */
  sats?: number | null
  /** Arm CONFIRM first whatever the Cloud compute mode says: Space never pays on one press. */
  confirmFirst?: boolean
}

/** A HOSAKA scan armed by a first press, waiting for the second (the Cloud compute mode asks). */
export interface ScanConfirm {
  height: number
  sats: number
  /** The cube's corner and plane, so a move or a change of height disarms it. */
  cube: string
}

export interface ScanState {
  /** SCAN mode is on: the standard VIEW is SCAN's. */
  active: boolean
  /** The scan height: the cube's side is 2^height. */
  height: number
  job: ScanJob | null
  result: ScanResult | null
  confirm: ScanConfirm | null
  /** SCAN at the cursor's view, or where you are looking: from HOP, VIEW, or BUILD's cursor. */
  enter: () => void
  /** SCAN off. The view goes with it unless `keepView`. A scan under way keeps running. */
  exit: (keepView?: boolean) => void
  setHeight: (height: number) => void
  stepHeight: (delta: number) => void
  /**
   * Scan the cube at the cursor at the chosen height. `shown` is what the
   * controls said (free, held, or HOSAKA at a price): if that no longer holds
   * nothing is scanned or bought. Space passes a free route only.
   */
  start: (shown?: ScanShown) => Promise<void>
  /** Stop the scan under way, where that loses nothing paid for (scanCancellable). */
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

/** What a scan's time is estimated from: this device's benchmark, and HOSAKA's ladder. */
export interface ScanClock {
  /** The benchmark's milliseconds per Cantor axis tree, by height; absent until it has run. */
  cantorMsByHeight?: Record<number, number>
  /** This device's hop ceiling, the device max (localKeyCeiling reads it). */
  hopHeight: number
  provider: Pick<HosakaProvider, 'pricing'> | null | undefined
  /** How HOSAKA's estimates have compared with its clock here (lib/experience.ts). */
  experience: number
}

/** What the stores know now, for scanSeconds. */
export function currentScanClock(): ScanClock {
  const cal = useCalibration.getState()
  return {
    cantorMsByHeight: cal.cantorMsByHeight,
    hopHeight: cal.hopHeight,
    provider: useCyberspace.getState().cloud.provider,
    experience: ratioOf(useExperience.getState().samples),
  }
}

/**
 * A scan's key in axis trees' worth of work. The key is three Cantor axis
 * trees of 2^height leaves, then two pairings of their roots, then two hashes
 * (cyberspace-core deriveRegionN and deriveRegionKeys, run by
 * lib/scanCube.ts computeCube). The roots are huge numbers (a Cantor pair
 * doubles its inputs' size), so the two pairings are not free: timed against
 * the benchmark's one axis (2026-11-15, node and the browser), the whole key
 * took 3.5 to 5 axes, more at the low heights; 4.5 sits in that, and keeps a
 * scan from often outrunning its estimate and its bar from waiting at 99.
 * The pairings grow with the roots, as the trees do, so it stays a multiple.
 */
export const SCAN_KEY_AXES = 4.5

/**
 * How long a scan at `height` takes, in seconds; null when nobody can say.
 *
 * On this device: SCAN_KEY_AXES times the benchmark's time for one axis tree
 * at that height (lib/calibration.ts, the same benchmark that sets the device
 * max), measured, or projected from the measurements at their fitted growth
 * per height, never under 2.5 times a height (projectCantorMs: twice the
 * leaves, and wider numbers). Before the benchmark has run, the device max
 * stands for what it is chosen by: one axis at the hop budget
 * (HOP_AXIS_BUDGET_MS), the heights under it projected down from there; an
 * upper bound, not a measurement (`measured` false).
 *
 * HOSAKA: its region key ladder's estimate for the height, corrected by what
 * its jobs have taken here (lib/deployPlan.ts regionKeyQuote). A cube already
 * held is only a question to the relays: no computing at all, 0.
 */
export function scanSeconds(height: number, route: 'local' | 'cloud' | 'held', clock: ScanClock = currentScanClock()): number | null {
  if (route === 'held') return 0
  if (route === 'cloud') return regionKeyQuote(height, clock.provider, clock.experience)?.seconds ?? null
  const ms = projectCantorMs(benchmarked(clock) ? clock.cantorMsByHeight! : { [clock.hopHeight]: HOP_AXIS_BUDGET_MS }, height)
  return Number.isFinite(ms) ? (SCAN_KEY_AXES * ms) / 1000 : null
}

/** This device's benchmark has landed. */
function benchmarked(clock: Pick<ScanClock, 'cantorMsByHeight'>): boolean {
  return clock.cantorMsByHeight !== undefined && Object.keys(clock.cantorMsByHeight).length > 0
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

/**
 * Space in SCAN (hooks/useKeyboard.ts): what a tap of the SCAN button does,
 * for what the button shows now. On a HOSAKA height it always takes two
 * presses (arkinox, 2026-11-15): the first arms CONFIRM with the price, the
 * second pays, whatever the Cloud compute mode would let a tap do, so one
 * press never pays. Held down it does nothing more; nothing while a scan
 * runs, nor where the button is disabled (no price yet, a purchase under way).
 */
export function scanSpace(repeat: boolean): void {
  if (repeat) return
  const scan = useScan.getState()
  if (!scan.active || scan.job) return
  const cs = useCyberspace.getState()
  const range = currentScanRange()
  const height = clampScanHeight(scan.height, range)
  const held = heldCube(useSecrets.getState().keys, cs.cursor, cs.anchorPlane, height) !== null
  const route = held ? 'held' : scanRoute(height, range)
  if (route !== 'cloud') { void scan.start({ route }); return }
  const sats = scanPrice(height)
  if (sats === null || useSecrets.getState().buying) return
  void scan.start({ route, sats, confirmFirst: true })
}

/** A HOSAKA scan's purchase is under way: RECALL and X leave it be. */
export function scanBuying(): boolean {
  return useScan.getState().job?.route === 'cloud'
}

/**
 * Whether CANCEL can stop the scan under way: a local one, or a HOSAKA one
 * whose invoice waits unpaid. Asking HOSAKA (the request may already be
 * charged to the balance), paid, or computing: no.
 */
export function scanCancellable(job: ScanJob | null, cloud: Pick<CyberspaceState['cloud'], 'status' | 'job'> = useCyberspace.getState().cloud): boolean {
  if (!job) return false
  if (job.route !== 'cloud') return true
  return !job.asking && cloud.status === 'awaiting_payment' && (cloud.job === null || cloud.job.stage === 'awaiting_payment')
}

/** The cube a confirmation is for. */
function cubeKey(at: Position, plane: Plane, height: number): string {
  const h = BigInt(height)
  return `${at.x >> h}:${at.y >> h}:${at.z >> h}:${plane}:${height}`
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
  confirm: null,

  enter: () => {
    if (get().active) return
    const cs = useCyberspace.getState()
    // Region mode is a VIEW tool, as in BUILD.
    useRegion.getState().exit()
    if (!cs.viewing()) {
      cs.viewHere()
      if (!useCyberspace.getState().viewing()) return
    }
    // A scan that landed while SCAN was off keeps its answer on show.
    set({ active: true, confirm: null, height: get().job ? get().height : clampScanHeight(get().height, currentScanRange()) })
  },

  exit: (keepView = false) => {
    if (!get().active) return
    set({ active: false, confirm: null })
    if (keepView) return
    const cs = useCyberspace.getState()
    if (cs.focus?.drive) cs.clearFocus(true)
  },

  setHeight: (height) => {
    if (get().job) return
    set({ height: clampScanHeight(height, currentScanRange()), result: null, confirm: null })
  },

  stepHeight: (delta) => get().setHeight(get().height + delta),

  start: async (shown) => {
    if (!get().active || get().job) return
    const range = currentScanRange()
    const height = clampScanHeight(get().height, range)
    const { at, plane } = aim()
    const held = heldCube(useSecrets.getState().keys, at, plane, height)
    const route = held ? 'held' : scanRoute(height, range)
    const price = scanPrice(height)
    const fail = (message: string): void => set({ confirm: null, result: { kind: 'failed', height, message } })
    // What was on screen when SCAN was pressed must still hold: never a
    // purchase for a height shown as free, nor at a price not shown.
    if (shown && route !== 'held' && (shown.route !== route || (route === 'cloud' && shown.sats !== price))) {
      fail(route === 'cloud' ? 'The price changed. Check it and scan again.' : 'Check the height and scan again.')
      return
    }
    if (route === 'cloud') {
      // Never a purchase without its price on the button, nor over another one.
      if (price === null) { fail('No price from HOSAKA yet. Try again in a moment.'); return }
      if (useSecrets.getState().buying) { fail('HOSAKA is already computing a key for you.'); return }
      // Asked first as the Cloud compute panel's mode says, as a hide is.
      const prefs = useCyberspace.getState().cloudPrefs
      const cube = cubeKey(at, plane, height)
      const armed = get().confirm
      if ((needsAsk(prefs.mode, price, prefs.autoMaxSats) || shown?.confirmFirst) && !(armed && armed.cube === cube && armed.height === height && armed.sats === price)) {
        set({ confirm: { height, sats: price, cube }, result: null })
        return
      }
    }
    set({ confirm: null })
    const id = ++serial
    // The same estimate the tag under the height shows, so the bar and the tag
    // agree; no bar for a local scan before the benchmark (only a guess then).
    const clock = currentScanClock()
    const estSeconds = route === 'held' || (route === 'local' && !benchmarked(clock)) ? null : scanSeconds(height, route, clock)
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
    if (!job) { if (get().confirm) set({ confirm: null }); return }
    if (!scanCancellable(job)) return
    serial++
    if (run) { run.cancel(); run = null }
    // An unpaid invoice is abandoned the way the Cloud compute panel abandons one.
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
  if ((scan.result || scan.confirm) && (s.cursor !== prev.cursor || s.anchorPlane !== prev.anchorPlane)) useScan.setState({ result: null, confirm: null })
})

// Region mode is VIEW's tool: turned on in SCAN (a /C/ region link arriving), SCAN gives way to VIEW.
useRegion.subscribe((r, prev) => {
  if (r.active && !prev.active && useScan.getState().active) useScan.getState().exit(true)
})

// BUILD coming on (B, a DEPLOY) ends SCAN, keeping the view BUILD starts from.
useBuilder.subscribe((b, prev) => {
  if (b.active && !prev.active && useScan.getState().active) useScan.getState().exit(true)
})
