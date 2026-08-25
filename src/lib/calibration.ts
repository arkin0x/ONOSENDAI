/**
 * calibration.ts - what THIS machine can really compute, learned quietly.
 *
 * The protocol allows Cantor hops up to h20 and the UI used to advertise
 * exactly that, but an h20 hop has never been observed to finish on real
 * hardware: a commit computes up to three axis trees plus terrain, and the
 * BigInt levels of one big tree allocate hundreds of megabytes, so the tab
 * stalls or dies well below the nominal cap. Advertising a move the machine
 * cannot complete is worse than an honest smaller ceiling.
 *
 * So a one-shot benchmark (workers/calibrate.worker.ts) times real single-axis
 * Cantor trees and the raw SHA-256 rate, and the ceilings recommended here are
 * derived from those timings against a wall-clock budget. MAX_COMPUTE_HEIGHT
 * in the store stays the HARD cap (memory safety); this module only lowers
 * what the app voluntarily attempts. Bigger moves are a future cloud offload's
 * job, not this module's.
 *
 * The math is exported pure so tests can pin it down - a wrong ceiling fails
 * silently as a stalled tab, never as an error. The singleton below owns the
 * worker, the localStorage cache and the snapshot the HUD subscribes to.
 */

import { create } from 'zustand'
import type { CalibrateResponse } from '../workers/calibrate.worker'

/** Budget for ONE axis tree of a hop. A worst-case commit computes up to
 * three axis trees plus the temporal tree, so 5 s per axis keeps a whole
 * commit under roughly 20 s. */
export const HOP_AXIS_BUDGET_MS = 5000
/** Budget for a whole sidestep. Pure SHA-256 in O(h) memory, so it can run
 * far longer than a hop without endangering the tab; a minute is the most a
 * progress bar can honestly ask of anyone. */
export const SIDESTEP_BUDGET_MS = 60_000

/** Until measured: h17 finishes in seconds on modest hardware, where the old
 * advertised h20 has never been seen to finish anywhere. */
export const DEFAULT_HOP_HEIGHT = 17
export const DEFAULT_SIDESTEP_HEIGHT = 24

/** Cantor cost per height never grows slower than this in practice (2x the
 * leaves times widening BigInts). Flooring the fitted ratio keeps one lucky
 * pair of fast timings from projecting an h19/h20 the machine cannot do. */
const GROWTH_RATIO_FLOOR = 2.5

/** The range a hop recommendation can land in. The top mirrors the protocol's
 * DEFAULT_MAX_COMPUTE_HEIGHT (the store's hard cap; importing it from there
 * would be an import cycle), the bottom is the floor of the benchmark. */
const HOP_CEILING_MIN = 12
const HOP_CEILING_MAX = 20

/** Sidestep recommendations are clamped here: below h20 a sidestep loses to a
 * plain hop, above h40 even a fast machine is into hours of hashing. */
const SIDESTEP_CEILING_MIN = 20
const SIDESTEP_CEILING_MAX = 40

/**
 * Projected wall-clock ms for ONE axis Cantor tree at height h. Measured
 * heights are returned as measured; gaps and heights above the data are
 * log-linear extrapolations from the nearest measured height at the growth
 * ratio fitted to the top two measurements, floored at GROWTH_RATIO_FLOOR so
 * the projection is conservative. NaN when there are no measurements at all.
 */
export function projectCantorMs(cantorMsByHeight: Record<number, number>, h: number): number {
  const measured = cantorMsByHeight[h]
  if (measured !== undefined) return measured
  const heights = Object.keys(cantorMsByHeight).map(Number).sort((a, b) => a - b)
  if (heights.length === 0) return NaN
  const top = heights[heights.length - 1]
  let ratio = GROWTH_RATIO_FLOOR
  if (heights.length >= 2) {
    // Coarse timers can report ~0 ms; clamping keeps the fit finite.
    const topMs = Math.max(cantorMsByHeight[top], 0.5)
    const below = heights[heights.length - 2]
    const belowMs = Math.max(cantorMsByHeight[below], 0.5)
    const fitted = Math.pow(topMs / belowMs, 1 / (top - below))
    if (Number.isFinite(fitted)) ratio = Math.max(fitted, GROWTH_RATIO_FLOOR)
  }
  // Project from the nearest measured height ABOVE h when one exists (an
  // unmeasured gap), else upward from the top measurement. Projecting a gap
  // downward from the top, not upward from below, keeps a cheap low reading
  // from underquoting a height the data already showed to be expensive.
  const baseH = heights.find((x) => x > h) ?? top
  const baseMs = Math.max(cantorMsByHeight[baseH], 0.5)
  return baseMs * Math.pow(ratio, h - baseH)
}

/**
 * The largest hop height in [12, 20] whose projected single-axis time fits
 * the budget; 12 when nothing does, and the conservative default when there
 * is nothing measured to project from.
 */
export function hopCeiling(cantorMsByHeight: Record<number, number>, budgetMs: number = HOP_AXIS_BUDGET_MS): number {
  if (Object.keys(cantorMsByHeight).length === 0) return DEFAULT_HOP_HEIGHT
  for (let h = HOP_CEILING_MAX; h > HOP_CEILING_MIN; h--) {
    if (projectCantorMs(cantorMsByHeight, h) <= budgetMs) return h
  }
  return HOP_CEILING_MIN
}

/**
 * The largest sidestep height whose ~2^(h+1) hashes fit the budget at the
 * measured rate, clamped to [20, 40]. The default when the rate is junk.
 */
export function sidestepCeiling(sha256PerSec: number, budgetMs: number = SIDESTEP_BUDGET_MS): number {
  if (!Number.isFinite(sha256PerSec) || sha256PerSec <= 0) return DEFAULT_SIDESTEP_HEIGHT
  const affordable = sha256PerSec * (budgetMs / 1000)
  // Largest h with 2^(h+1) <= affordable.
  const h = Math.floor(Math.log2(affordable)) - 1
  return Math.min(SIDESTEP_CEILING_MAX, Math.max(SIDESTEP_CEILING_MIN, h))
}

/** What the cache stores: the raw measurements, not derived ceilings, so a
 * future budget change re-derives without re-benchmarking. */
export interface CalibrationCacheEntry {
  version: 1
  /** Date.now() at measurement. */
  at: number
  /** cacheFingerprint() at measurement; a different machine must remeasure. */
  fingerprint: string
  cantorMsByHeight: Record<number, number>
  sha256PerSec: number
}

/** Hardware does not change often, but browsers update and machines get
 * swapped; a week keeps the numbers honest without re-running every load. */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Whether a stored entry may be trusted right now. Pure so the tests can walk
 * the clock and the fingerprint; a stale or foreign entry that slipped
 * through would quietly serve another machine's ceilings.
 */
export function cacheValid(entry: unknown, now: number, fingerprint: string): entry is CalibrationCacheEntry {
  if (typeof entry !== 'object' || entry === null) return false
  const e = entry as Partial<CalibrationCacheEntry>
  if (e.version !== 1) return false
  if (e.fingerprint !== fingerprint) return false
  // A timestamp in the future means the clock moved; its age is meaningless.
  if (typeof e.at !== 'number' || now < e.at || now - e.at >= CACHE_TTL_MS) return false
  if (typeof e.sha256PerSec !== 'number' || !Number.isFinite(e.sha256PerSec) || e.sha256PerSec <= 0) return false
  if (typeof e.cantorMsByHeight !== 'object' || e.cantorMsByHeight === null) return false
  const values = Object.values(e.cantorMsByHeight)
  if (values.length === 0) return false
  return values.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
}

/** What the cache is keyed by: logical cores plus a COARSE user agent
 * (digits stripped, so a browser point release keeps the measurements while a
 * different browser or machine throws them away). */
export function cacheFingerprint(): string {
  if (typeof navigator === 'undefined') return 'no-navigator'
  return `${navigator.hardwareConcurrency ?? 0}:${navigator.userAgent.replace(/[0-9]/g, '')}`
}

export type CalibrationStatus = 'pending' | 'measured' | 'cached'

interface CalibrationSnapshot {
  status: CalibrationStatus
  /** Recommended hop ceiling: measured, else the conservative default. */
  hopHeight: number
  /** Recommended sidestep ceiling: measured, else the default. */
  sidestepHeight: number
}

/**
 * The live snapshot, as a store so the HUD re-renders the moment a benchmark
 * or a cache read lands, the same mechanism every other panel uses.
 */
export const useCalibration = create<CalibrationSnapshot>(() => ({
  status: 'pending',
  hopHeight: DEFAULT_HOP_HEIGHT,
  sidestepHeight: DEFAULT_SIDESTEP_HEIGHT,
}))

/** The hop ceiling commit() should route by. Conservative until measured. */
export function recommendedHopHeight(): number {
  return useCalibration.getState().hopHeight
}

/** The sidestep ceiling the UI should quote. Conservative until measured. */
export function recommendedSidestepHeight(): number {
  return useCalibration.getState().sidestepHeight
}

export function calibrationState(): CalibrationStatus {
  return useCalibration.getState().status
}

const CACHE_KEY = 'onosendai:calibration'
/** Startup is the busiest this app ever is (terrain pool, relays, profile
 * fetches); the benchmark waits out that burst so it never competes with it. */
const START_DELAY_MS = 8000

function loadCache(): CalibrationCacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const entry: unknown = JSON.parse(raw)
    return cacheValid(entry, Date.now(), cacheFingerprint()) ? entry : null
  } catch {
    /* corrupt, private mode, or no localStorage (tests) */
    return null
  }
}

function saveCache(entry: CalibrationCacheEntry): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch { /* private mode or quota; remeasuring next load is fine */ }
}

let started = false

/**
 * Idempotent. A valid cached measurement applies immediately with no worker;
 * otherwise the benchmark is deferred past startup and runs once. Under
 * vitest (node, no Worker) this is a no-op and the defaults stand.
 */
export function startCalibration(): void {
  if (started) return
  started = true
  if (typeof Worker === 'undefined') return
  const cached = loadCache()
  if (cached) {
    useCalibration.setState({
      status: 'cached',
      hopHeight: hopCeiling(cached.cantorMsByHeight),
      sidestepHeight: sidestepCeiling(cached.sha256PerSec),
    })
    return
  }
  setTimeout(runBenchmark, START_DELAY_MS)
}

/** The worker is owned here, not in lib/workers.ts: it runs exactly once and
 * dies, so it has no place in the long-lived pool registry. */
function runBenchmark(): void {
  let worker: Worker
  try {
    worker = new Worker(new URL('../workers/calibrate.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return
  }
  worker.onmessage = (event: MessageEvent<CalibrateResponse>) => {
    const msg = event.data
    worker.terminate()
    // A failed benchmark leaves the conservative defaults standing, which is
    // the right failure mode: never promise more than was proven.
    if (msg.type !== 'result') return
    saveCache({
      version: 1,
      at: Date.now(),
      fingerprint: cacheFingerprint(),
      cantorMsByHeight: msg.cantorMsByHeight,
      sha256PerSec: msg.sha256PerSec,
    })
    useCalibration.setState({
      status: 'measured',
      hopHeight: hopCeiling(msg.cantorMsByHeight),
      sidestepHeight: sidestepCeiling(msg.sha256PerSec),
    })
  }
  worker.onerror = () => worker.terminate()
  worker.postMessage({ id: 1 })
}
