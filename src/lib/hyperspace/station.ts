/**
 * station.ts: DECK-0001 v3 §4. The station is the stop nearest an identity's
 * coordinate in the protocol's cube metric, ties to the lowest height,
 * over stops with height at or below the destination height.
 *
 * The metric: d(p, q) = max over axes of findLcaHeight, which equals
 * 85 - floor(L / 3) where L is the shared prefix of the interleaved
 * coordinates with the plane bit stripped. So nearest-by-cube is
 * longest-common-prefix, and a sorted view turns the lookup into a binary
 * search plus a scan of the run sharing the winning prefix. Never an O(N)
 * comparison against every stop.
 *
 * The index is the columnar StopIndex (compactIndex.ts): keys are 32-byte
 * big-endian plane-stripped coordinates and sorted order is a permutation of
 * row ids, so every comparison here is bytewise over flat buffers rather
 * than bigint maths over boxed keys. The prefix arithmetic (mask, +2^shift)
 * is done on byte arrays for the same reason.
 *
 * Landfalls enter the index with float64-approximate coordinates (about a
 * metre of error). That cannot change a distance decided at h47 and above,
 * but to be safe against ties the finalists are re-derived exactly before
 * the winner is chosen.
 */
import { findLcaHeight, coordToXyz, xyzToCoord } from 'cyberspace-core'
import { stepFor } from '../space'
import { type Stop, stopCoordExact } from './stops'
import { bigToBytes32 } from './headers'
import {
  appendStops,
  createStopIndex,
  heightAt,
  insertRow,
  mergeAll,
  stopAt,
  type StopIndex,
} from './compactIndex'

export type { StopIndex } from './compactIndex'

/** Max-axis LCA height between two coord256 values, plane bits ignored. */
export function maxAxisLca(a: bigint, b: bigint): number {
  const xor = (a >> 1n) ^ (b >> 1n)
  if (xor === 0n) return 0
  const j = xor.toString(2).length - 1 // index of the highest differing interleaved bit
  return Math.floor(j / 3) + 1
}

/** Build a fully merged index from stops; the test and boot-time builder. */
export function buildIndex(stops: Stop[]): StopIndex {
  const index = createStopIndex()
  appendStops(index, stops)
  mergeAll(index)
  return index
}

/** Insert one stop, keeping the sorted view coherent (compactIndex decides
 * between an in-place splice and the pending-merge queue). */
export function insertStop(index: StopIndex, stop: Stop): void {
  insertRow(index, stop)
}

/** First sorted position whose key is >= bytes. */
function lowerBound(index: StopIndex, bytes: Uint8Array): number {
  const keys = index.keys
  const perm = index.perm
  let lo = 0
  let hi = index.permCount
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const off = perm[mid] * 32
    let cmp = 0
    for (let i = 0; i < 32; i++) {
      const d = keys[off + i] - bytes[i]
      if (d !== 0) {
        cmp = d
        break
      }
    }
    if (cmp < 0) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * [start, end) of the sorted run sharing keyBytes' prefix down to axis bit d,
 * i.e. keys in [key & ~(2^(3d) - 1), same + 2^(3d)). Byte arithmetic: zero
 * the low 3d bits for the base, then add one at bit 3d for the end; a carry
 * off the top means the run extends to the end of the array.
 */
function prefixRange(index: StopIndex, keyBytes: Uint8Array, d: number): [number, number] {
  if (d >= 85) return [0, index.permCount]
  const shift = 3 * d
  const base = keyBytes.slice()
  const fullBytes = shift >> 3
  for (let i = 0; i < fullBytes; i++) base[31 - i] = 0
  const rem = shift & 7
  if (rem > 0) base[31 - fullBytes] &= (0xff << rem) & 0xff
  const start = lowerBound(index, base)
  const end = base.slice()
  let byteIdx = 31 - fullBytes
  let add = 1 << rem
  while (byteIdx >= 0) {
    const sum = end[byteIdx] + add
    end[byteIdx] = sum & 0xff
    if (sum < 256) break
    add = 1
    byteIdx--
  }
  if (byteIdx < 0) return [start, index.permCount]
  return [start, lowerBound(index, end)]
}

/** Max-axis LCA between a query key and the key at sorted position pos,
 * from the first differing byte; equal keys are distance 0. */
function lcaAtSorted(index: StopIndex, qBytes: Uint8Array, pos: number): number {
  const keys = index.keys
  const off = index.perm[pos] * 32
  for (let b = 0; b < 32; b++) {
    const x = keys[off + b] ^ qBytes[b]
    if (x !== 0) {
      const msb = 31 - Math.clz32(x)
      const j = (31 - b) * 8 + msb // bit index from the LSB of the 255-bit key
      return Math.floor(j / 3) + 1
    }
  }
  return 0
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
  if (index.permCount === 0) return null
  const key = bigToBytes32(coord >> 1n)

  // Approximate best distance from the sort neighbours.
  const p = lowerBound(index, key)
  let dGuess = 86
  for (const i of [p - 1, p]) {
    if (i >= 0 && i < index.permCount) {
      const d = lcaAtSorted(index, key, i)
      if (d < dGuess) dGuess = d
    }
  }
  if (dGuess > 85) dGuess = 85

  // Widen the cube until it holds a qualifying stop, then decide exactly.
  for (let d = dGuess; d <= 85; d++) {
    const [start, end] = prefixRange(index, key, d)
    let best: StationResult | null = null
    for (let i = start; i < end; i++) {
      const row = index.perm[i]
      if (heightAt(index, row) > maxHeight) continue
      const stop = stopAt(index, row)
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

/** The k nearest stops to a coordinate (no height bound), for the UI. */
export function nearestStops(index: StopIndex, coord: bigint, k: number): StationResult[] {
  if (index.permCount === 0) return []
  const key = bigToBytes32(coord >> 1n)
  const p = lowerBound(index, key)
  const out: StationResult[] = []
  const seen = new Set<number>()
  let lo = p - 1
  let hi = p
  // The k nearest by prefix all sit adjacent in sort order; merge outward.
  while (out.length < k && (lo >= 0 || hi < index.permCount)) {
    const dLo = lo >= 0 ? lcaAtSorted(index, key, lo) : 86
    const dHi = hi < index.permCount ? lcaAtSorted(index, key, hi) : 86
    if (dLo <= dHi) {
      if (!seen.has(lo)) {
        out.push({ stop: stopAt(index, index.perm[lo]), distance: dLo })
        seen.add(lo)
      }
      lo--
    } else {
      if (!seen.has(hi)) {
        out.push({ stop: stopAt(index, index.perm[hi]), distance: dHi })
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

const AXIS_MAX = (1n << 85n) - 1n

/**
 * Sorted-view runs covering every stop within `reachCells` of a position at
 * this scale. An axis-aligned box no wider than an aligned cube spans at
 * most two aligned cells per axis, so the cubes of the box's eight corners,
 * at the first level whose cube side exceeds the box, are the whole cover;
 * each cube is one prefixRange run and the runs are merged. A superset by
 * construction: callers still range-test each row, they just never touch
 * the hundreds of thousands of rows that cannot qualify, which is what
 * keeps a spawn-scale scan at microseconds instead of seconds of decode.
 */
export function coverageRuns(
  index: StopIndex,
  x: bigint,
  y: bigint,
  z: bigint,
  scaleExp: number,
  reachCells: number,
): Array<[number, number]> {
  if (index.permCount === 0) return []
  let r = BigInt(Math.max(1, Math.ceil(reachCells))) * stepFor(scaleExp)
  if (r < 1n) r = 1n
  // 2^d must exceed the box's 2r+1 gibsons; the bit length of 2r does that
  // whether or not 2r is a power of two.
  const d = Math.min(85, (2n * r).toString(2).length)
  const clamp = (v: bigint): bigint => (v < 0n ? 0n : v > AXIS_MAX ? AXIS_MAX : v)
  const runs: Array<[number, number]> = []
  for (const cx of [clamp(x - r), clamp(x + r)]) {
    for (const cy of [clamp(y - r), clamp(y + r)]) {
      for (const cz of [clamp(z - r), clamp(z + r)]) {
        const key = bigToBytes32(xyzToCoord(cx, cy, cz, 0) >> 1n)
        const run = prefixRange(index, key, d)
        if (run[1] > run[0]) runs.push(run)
      }
    }
  }
  runs.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Array<[number, number]> = []
  for (const [start, end] of runs) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) {
      if (end > last[1]) last[1] = end
    } else {
      merged.push([start, end])
    }
  }
  return merged
}
