/**
 * station.ts: DECK-0001 v3 §4. The station is the stop nearest an identity's
 * coordinate in the protocol's cube metric, ties to the lowest height,
 * over stops with height at or below the destination height.
 *
 * The metric: d(p, q) = max over axes of findLcaHeight, which equals
 * 85 - floor(L / 3) where L is the shared prefix of the interleaved
 * coordinates with the plane bit stripped. So nearest-by-cube is
 * longest-common-prefix, and a sorted array turns the lookup into a binary
 * search plus a scan of the run sharing the winning prefix. Never an O(N)
 * comparison against every stop.
 *
 * Landfalls enter the index with float64-approximate coordinates (about a
 * metre of error). That cannot change a distance decided at h47 and above,
 * but to be safe against ties the finalists are re-derived exactly before
 * the winner is chosen.
 */
import { findLcaHeight, coordToXyz } from 'cyberspace-core'
import { type Stop, stopCoordExact } from './stops'

/** Max-axis LCA height between two coord256 values, plane bits ignored. */
export function maxAxisLca(a: bigint, b: bigint): number {
  const xor = (a >> 1n) ^ (b >> 1n)
  if (xor === 0n) return 0
  const j = xor.toString(2).length - 1 // index of the highest differing interleaved bit
  return Math.floor(j / 3) + 1
}

export interface StopIndex {
  /** Plane-stripped interleaved keys, ascending. */
  keys: bigint[]
  /** stops[i] corresponds to keys[i]. */
  stops: Stop[]
}

export function buildIndex(stops: Stop[]): StopIndex {
  const entries = stops.map((s) => ({ key: s.coordApprox >> 1n, stop: s }))
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return { keys: entries.map((e) => e.key), stops: entries.map((e) => e.stop) }
}

/** Insert one stop, keeping the index sorted. O(log n) search, O(n) splice. */
export function insertStop(index: StopIndex, stop: Stop): void {
  const key = stop.coordApprox >> 1n
  let lo = 0
  let hi = index.keys.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (index.keys[mid] < key) lo = mid + 1
    else hi = mid
  }
  index.keys.splice(lo, 0, key)
  index.stops.splice(lo, 0, stop)
}

function lowerBound(keys: bigint[], value: bigint): number {
  let lo = 0
  let hi = keys.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (keys[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** [start, end) of the run of keys sharing coordKey's prefix down to axis bit d. */
function prefixRange(index: StopIndex, coordKey: bigint, d: number): [number, number] {
  if (d >= 85) return [0, index.keys.length]
  const shift = BigInt(3 * d)
  const base = (coordKey >> shift) << shift
  const end = base + (1n << shift)
  return [lowerBound(index.keys, base), lowerBound(index.keys, end)]
}

export interface StationResult {
  stop: Stop
  /** Max-axis LCA height from the query coordinate to the stop, exact. */
  distance: number
}

/**
 * The station per §4.2: nearest stop by max-axis LCA with height <= maxHeight,
 * ties to the lowest height. Exact: finalists are re-derived before deciding.
 */
export function findStation(index: StopIndex, coord: bigint, maxHeight: number): StationResult | null {
  if (index.keys.length === 0) return null
  const key = coord >> 1n

  // Approximate best distance from the sort neighbours.
  const p = lowerBound(index.keys, key)
  let dGuess = 86
  for (const i of [p - 1, p]) {
    if (i >= 0 && i < index.keys.length) {
      const d = maxAxisLcaKeys(key, index.keys[i])
      if (d < dGuess) dGuess = d
    }
  }
  if (dGuess > 85) dGuess = 85

  // Widen the cube until it holds a qualifying stop, then decide exactly.
  for (let d = dGuess; d <= 85; d++) {
    const [start, end] = prefixRange(index, key, d)
    let best: StationResult | null = null
    for (let i = start; i < end; i++) {
      const stop = index.stops[i]
      if (stop.height > maxHeight) continue
      const exact = maxAxisLca(coord, stopCoordExact(stop))
      if (
        best === null ||
        exact < best.distance ||
        (exact === best.distance && stop.height < best.stop.height)
      ) {
        best = { stop, distance: exact }
      }
    }
    if (best !== null) return best
  }
  return null
}

function maxAxisLcaKeys(aKey: bigint, bKey: bigint): number {
  const xor = aKey ^ bKey
  if (xor === 0n) return 0
  const j = xor.toString(2).length - 1
  return Math.floor(j / 3) + 1
}

/** The k nearest stops to a coordinate (no height bound), for the UI. */
export function nearestStops(index: StopIndex, coord: bigint, k: number): StationResult[] {
  if (index.keys.length === 0) return []
  const key = coord >> 1n
  const p = lowerBound(index.keys, key)
  const out: StationResult[] = []
  const seen = new Set<number>()
  let lo = p - 1
  let hi = p
  // The k nearest by prefix all sit adjacent in sort order; merge outward.
  while (out.length < k && (lo >= 0 || hi < index.keys.length)) {
    const dLo = lo >= 0 ? maxAxisLcaKeys(key, index.keys[lo]) : 86
    const dHi = hi < index.keys.length ? maxAxisLcaKeys(key, index.keys[hi]) : 86
    if (dLo <= dHi) {
      if (!seen.has(lo)) {
        out.push({ stop: index.stops[lo], distance: dLo })
        seen.add(lo)
      }
      lo--
    } else {
      if (!seen.has(hi)) {
        out.push({ stop: index.stops[hi], distance: dHi })
        seen.add(hi)
      }
      hi++
    }
  }
  return out
}

/** Cross-check helper: the same distance computed the slow, per-axis way. */
export function maxAxisLcaViaAxes(a: bigint, b: bigint): number {
  const pa = coordToXyz(a)
  const pb = coordToXyz(b)
  return Math.max(
    findLcaHeight(pa.x, pb.x),
    findLcaHeight(pa.y, pb.y),
    findLcaHeight(pa.z, pb.z),
  )
}
