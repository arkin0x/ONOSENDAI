/**
 * shortTrip.ts: the tour's first trip is a short one (onboarding write-up,
 * 2026-11-21: "The tour's first trip to Earth can mean hours or days of
 * computing (22 min to 2.5 days depending on the dot tapped)").
 *
 * A ride's work is the blocks between where it starts and where it ends,
 * not how far apart the two places are: a stop a few blocks from your
 * station is a few blocks of work wherever on Earth it lands. So the tour
 * offers landfalls (stops on Earth) a few blocks along the line from the
 * player's station, priced with this device's own ride estimate
 * (lib/hyperspace/ridePool.ts rideEstimateMs, corrected in #893 and #894),
 * and a tap on a stop further than SHORT_TRIP_MS is refused in plain words.
 * HOSAKA's price is shown beside the short trip (hud/EarthTrips.tsx); the
 * RIDE step offers RIDE HERE and RIDE VIA HOSAKA as the panel always does,
 * for that short trip only.
 *
 * Nothing here boards, rides or spends: it only picks the destination the
 * player taps.
 */

import { create } from 'zustand'
import { xyzToCoord } from 'cyberspace-core'
import { useCyberspace } from '../store/useCyberspace'
import { firstUnhashedHeight, getStopByHeight, getStopIndex, useHyperspace } from '../store/useHyperspace'
import { clearRideDestination, setRideDestination } from '../store/destination'
import { findStation } from '../lib/hyperspace/station'
import { lineStateOf } from '../lib/hyperspace/ride'
import { calibrate, rideBenchmark, rideEstimateMs, type RideBench } from '../lib/hyperspace/ridePool'
import { coordToLatLon } from '../lib/hyperspace/landfall'
import { onSceneStopTap, useStopTapPicks } from '../hud/HyperspacePanel'
import type { Stop } from '../lib/hyperspace/stops'

/** The longest first trip the tour offers: a few minutes of computing on this device. */
export const SHORT_TRIP_MS = 3 * 60_000
/** Before this device's ride speed is measured: trips this many blocks long at most (a slow phone's few minutes). */
export const FALLBACK_TRIP_BLOCKS = 40
/** How many short trips the tour lists. */
export const TRIP_COUNT = 3
/** How far along the line to look for a landfall around each target length, blocks. */
const SEARCH_SPAN = 64

/** One short trip: a landfall, how many blocks away, and this device's time for it (null before the speed is measured). */
export interface ShortTrip {
  height: number
  blocks: number
  ms: number | null
  lat: number
  lon: number
}

/** Whether a ride of `blocks` is short on this device. */
export function isShortLength(blocks: number, bench: RideBench | null, limitMs = SHORT_TRIP_MS): boolean {
  if (blocks <= 0) return false
  if (!bench) return blocks <= FALLBACK_TRIP_BLOCKS
  return rideEstimateMs(blocks, bench) <= limitMs
}

/**
 * The longest short ride, in blocks (binary search over rideEstimateMs,
 * which grows with the length). 0 when even one block is too long.
 */
export function longestShortRide(bench: RideBench | null, limitMs = SHORT_TRIP_MS): number {
  if (!bench) return FALLBACK_TRIP_BLOCKS
  if (!isShortLength(1, bench, limitMs)) return 0
  let lo = 1
  let hi = 2
  while (hi < 1 << 24 && isShortLength(hi, bench, limitMs)) { lo = hi; hi *= 2 }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (isShortLength(mid, bench, limitMs)) lo = mid
    else hi = mid
  }
  return lo
}

/** What picking trips reads, so a test can hand in a line of its own. */
export interface TripLine {
  /** The block the ride starts from (the station, or the stop the chain stands at). */
  from: number
  /** The synced tip: no trip past it. */
  tip: number
  stopAt: (height: number) => Pick<Stop, 'kind' | 'coordApprox'> | undefined
  /** Whether every block from `lo` to `hi` has its hash (a ride needs them all). */
  hashed: (lo: number, hi: number) => boolean
}

/**
 * Up to `count` short trips from `line.from`: landfalls spread over the
 * short range (a near one, a middle one, a far one), each checked against
 * this device's estimate, never the starting block itself.
 */
export function shortTripsOn(line: TripLine, bench: RideBench | null, count = TRIP_COUNT): ShortTrip[] {
  const max = longestShortRide(bench)
  if (max <= 0) return []
  const picked = new Map<number, ShortTrip>()
  const tryHeight = (h: number): boolean => {
    if (h < 0 || h > line.tip || h === line.from || picked.has(h)) return false
    const blocks = Math.abs(h - line.from)
    if (!isShortLength(blocks, bench)) return false
    const stop = line.stopAt(h)
    if (!stop || stop.kind !== 'landfall') return false
    if (!line.hashed(Math.min(h, line.from) + 1, Math.max(h, line.from))) return false
    const { lat, lon } = coordToLatLon(stop.coordApprox)
    picked.set(h, { height: h, blocks, ms: bench ? rideEstimateMs(blocks, bench) : null, lat, lon })
    return true
  }
  for (let i = 0; i < count; i++) {
    // Targets spread over the short range, the nearest first.
    const target = Math.max(1, Math.round((max * (i + 1)) / (count + 1)))
    // Nearer first from each target, ahead on the line and behind it.
    for (let d = 0; d <= SEARCH_SPAN; d++) {
      const len = target - d
      if (len >= 1 && (tryHeight(line.from + len) || tryHeight(line.from - len))) break
    }
  }
  return [...picked.values()].sort((a, b) => a.blocks - b.blocks)
}

/** Where a ride from the player's chain head starts, as the HYPERSPACE panel works it out, or null when the stops cannot say yet. */
export function rideStart(): number | null {
  const cs = useCyberspace.getState()
  const line = lineStateOf(cs.actions())
  if (line !== null && line.fromHeight !== null) return line.fromHeight
  const tip = useHyperspace.getState().tipHeight
  if (tip === null) return null
  const here = xyzToCoord(cs.position.x, cs.position.y, cs.position.z, cs.headPlane)
  return findStation(getStopIndex(), here, tip)?.stop.height ?? null
}

/** The player's line as it stands, or null while the stops are not in. */
export function currentLine(): TripLine | null {
  const hs = useHyperspace.getState()
  if (hs.sync.status !== 'ready' || hs.tipHeight === null) return null
  const from = rideStart()
  if (from === null) return null
  return {
    from,
    tip: hs.tipHeight,
    stopAt: getStopByHeight,
    hashed: (lo, hi) => lo > hi || firstUnhashedHeight(lo, hi) === null,
  }
}

/** This device's ride speed as it is known, kept in a store so the trip list redraws once it is measured. */
export const useTripBench = create<{ bench: RideBench | null }>(() => ({ bench: rideBenchmark() }))

/** Measure the ride speed if it is not yet (once per session, lib/hyperspace/ridePool.ts calibrate). */
export function measureTripSpeed(): void {
  if (useTripBench.getState().bench) return
  calibrate().then((bench) => useTripBench.setState({ bench }), () => { /* the fallback length stands */ })
}

/** The short trips from where the player stands now. */
export function currentShortTrips(): ShortTrip[] {
  const line = currentLine()
  return line ? shortTripsOn(line, useTripBench.getState().bench) : []
}

/** How many blocks a ride to `height` is from where the player stands, or null when the stops cannot say. */
export function tripBlocks(height: number): number | null {
  const from = rideStart()
  return from === null ? null : Math.abs(height - from)
}

/** Whether a ride to `height` is a short trip from here. Unknown (the stops not in) counts as not short. */
export function isShortTrip(height: number): boolean {
  const blocks = tripBlocks(height)
  return blocks !== null && isShortLength(blocks, useTripBench.getState().bench)
}

/** A ride's time as people say it: "40 s", "2 min", "3.5 h", "2.5 days". */
export function tripTime(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`
  const m = ms / 60_000
  if (m < 90) return `${Math.round(m)} min`
  const h = m / 60
  if (h < 48) return `${h.toFixed(1)} h`
  return `${(h / 24).toFixed(1)} days`
}

/** What the tour says when a tapped stop is too far for a first trip. */
export function tooFarNote(height: number): string {
  const blocks = tripBlocks(height)
  const bench = useTripBench.getState().bench
  const time = blocks !== null && bench ? `about ${tripTime(rideEstimateMs(blocks, bench))} of computing` : 'too long a trip'
  return `That stop is ${time} from here. Pick one of the short trips below.`
}

/**
 * Make `height` the destination: the player's tap on a short trip. A
 * destination already set that is not short is cleared first (the tour
 * never rides it); a short one already set is kept, as setRideDestination
 * keeps any.
 */
export function chooseTrip(height: number): boolean {
  const current = useHyperspace.getState().destination
  if (current !== null && current !== height) clearRideDestination()
  return setRideDestination(height)
}

/**
 * While on, a tap on a stop in the scene picks it as the destination only
 * when it is a short trip; a stop further away is refused, and `onFar` says
 * so. Counts as a tap picking (useStopTapPicks), so BOARD's reason line asks
 * for a tap. Returns what turns it off.
 */
export function pickShortStopByTap(onFar: (height: number) => void): () => void {
  measureTripSpeed()
  const off = onSceneStopTap((height) => {
    const dest = useHyperspace.getState().destination
    if (dest !== null && isShortTrip(dest)) return
    if (isShortTrip(height)) chooseTrip(height)
    else onFar(height)
  })
  useStopTapPicks.setState((s) => ({ on: s.on + 1 }))
  let done = false
  return () => {
    if (done) return
    done = true
    off()
    useStopTapPicks.setState((s) => ({ on: Math.max(0, s.on - 1) }))
  }
}
