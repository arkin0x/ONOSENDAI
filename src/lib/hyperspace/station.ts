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
 * Landfalls enter the index with float64-approximate coordinates (within
 * 2^LANDFALL_SLACK_BITS G of the exact point per axis). Near a cube's face
 * that can move a stop across it, so the search bounds which stops could be
 * on either side and derives exactly only those, never the whole cube
 * (nearestExact).
 */
import { findLcaHeight, coordToXyz, xyzToCoord } from 'cyberspace-core'
import { stepFor } from '../space'
import { type Stop, stopCoordExact } from './stops'
import { bigToBytes32 } from './headers'
import {
  LANDFALL_SLACK_BITS,
  appendStops,
  coordApproxAt,
  createStopIndex,
  insertRow,
  kindIsPort,
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
 * ties to the lowest height. Exact (see nearestExact).
 */
export function findStation(index: StopIndex, coord: bigint, maxHeight: number): StationResult | null {
  return nearestExact(index, coord, null, maxHeight)
}

/**
 * The stop nearest `coord` in one plane, with no height bound: the stop a
 * trip to `coord` should leave the line at (GOAL, arkinox 2026-10-14). Ports
 * are ideaspace and landfalls dataspace, so a destination in dataspace exits
 * at a landfall and one in ideaspace at a port. Same metric, ties and
 * exactness as findStation; the index key carries no plane, so stops of the
 * other plane are skipped while the cube widens.
 *
 * The place being looked at may be a stop itself (a port view); `exclude`
 * names it, so the nearest is then its neighbor, never itself at distance 0.
 */
export function findNearestInPlane(index: StopIndex, coord: bigint, plane: 0 | 1, exclude?: bigint): StationResult | null {
  if (plane === 1) return nearestPort(index, coord, Number.POSITIVE_INFINITY, exclude)
  return nearestExact(index, coord, 0, Number.POSITIVE_INFINITY, exclude)
}

/**
 * The nearest port. Ports are filed at their exact coordinate, so nearest is
 * the longest shared key prefix, and the port sharing the longest one sits
 * beside the query in sorted order (the shared prefix only grows toward the
 * query's position). The first qualifying port on each side fixes the
 * distance; the lowest height in that cube takes the tie. Two short walks and
 * one run, with nothing derived.
 */
function nearestPort(index: StopIndex, coord: bigint, maxHeight: number, exclude?: bigint): StationResult | null {
  if (index.permCount === 0) return null
  const key = bigToBytes32(coord >> 1n)
  const { perm, heights } = index
  const qualifies = (row: number): boolean =>
    kindIsPort(index, row) && heights[row] <= maxHeight && (exclude === undefined || coordApproxAt(index, row) !== exclude)
  const p = lowerBound(index, key)
  let distance = 86
  for (let i = p - 1; i >= 0; i--) {
    if (qualifies(perm[i])) {
      distance = lcaAtSorted(index, key, i)
      break
    }
  }
  for (let i = p; i < index.permCount; i++) {
    if (qualifies(perm[i])) {
      distance = Math.min(distance, lcaAtSorted(index, key, i))
      break
    }
  }
  if (distance > 85) return null
  const [start, end] = prefixRange(index, key, distance)
  let best = -1
  for (let i = start; i < end; i++) {
    const row = perm[i]
    if ((best < 0 || heights[row] < heights[best]) && qualifies(row)) best = row
  }
  return best < 0 ? null : { stop: stopAt(index, best), distance }
}

/**
 * Where axis bit i of x, y and z sits in the 255-bit key: cyberspace-core
 * interleaves z, y, x at coord bits 3i + 1, 3i + 2, 3i + 3, and the key drops
 * the plane bit, so x, y, z land at key bits 3i + 2, 3i + 1, 3i.
 */
const AXIS_LANE = [2, 1, 0] as const
const KEY_BITS_ALL = (1n << 255n) - 1n
const LANE_MASK = AXIS_LANE.map((lane) => {
  let m = 0n
  for (let i = 0; i < 85; i++) m |= 1n << BigInt(3 * i + lane)
  return m
})

/**
 * The level at and below which the query's neighborhood is searched by
 * deriving every stop in it: the cube there is no wider than four times the
 * landfall slack, so the slack can carry a stop across more than one face.
 * It is a few meters of ground, which holds a landfall about once in a planet.
 */
const NEAR_LEVEL = LANDFALL_SLACK_BITS + 2

interface CellRun {
  start: number
  end: number
  /** The cell's offset from the query's own cell on x, y, z: -1, 0 or 1. */
  off: readonly [number, number, number]
  /** A key inside the cell (bits below the cell's level are don't-care). */
  key: Uint8Array
}

function isOwnCell(run: CellRun): boolean {
  return run.off[0] === 0 && run.off[1] === 0 && run.off[2] === 0
}

/**
 * Sorted-view runs of the 3x3x3 aligned cells of side 2^d around the query's
 * own (that one first), skipping cells off the edge of the axis and cells
 * holding no stop. Each cell is one prefix run; its key is the query's with
 * each axis's lane moved one cell down or up, a masked add on the interleaved
 * key (borrows and carries pass through the other lanes' bits). The blocks
 * nest as d grows: the block at d + 1 contains the block at d.
 */
function neighborhood(index: StopIndex, key: bigint, axes: readonly bigint[], d: number): CellRun[] {
  if (d >= 85) return index.permCount > 0 ? [{ start: 0, end: index.permCount, off: [0, 0, 0], key: bigToBytes32(key) }] : []
  const step = 1n << BigInt(d)
  const lanes = AXIS_LANE.map((lane, a) => {
    const mask = LANE_MASK[a]
    const inc = 1n << BigInt(3 * d + lane)
    const own = key & mask
    return [
      axes[a] >= step ? (own - inc) & mask : null,
      own,
      axes[a] + step <= AXIS_MAX ? ((key | (KEY_BITS_ALL ^ mask)) + inc) & mask : null,
    ]
  })
  const runs: CellRun[] = []
  for (let ox = 0; ox < 3; ox++) {
    const lx = lanes[0][ox]
    if (lx === null) continue
    for (let oy = 0; oy < 3; oy++) {
      const ly = lanes[1][oy]
      if (ly === null) continue
      for (let oz = 0; oz < 3; oz++) {
        const lz = lanes[2][oz]
        if (lz === null) continue
        const cellKey = bigToBytes32(lx | ly | lz)
        const [start, end] = prefixRange(index, cellKey, d)
        if (end <= start) continue
        const run: CellRun = { start, end, off: [ox - 1, oy - 1, oz - 1], key: cellKey }
        // The query's own cell first: its best height prunes the rest.
        if (ox === 1 && oy === 1 && oz === 1) runs.unshift(run)
        else runs.push(run)
      }
    }
  }
  return runs
}

/** Axis bits [LANDFALL_SLACK_BITS, d) of one axis in the key, as (byte, mask) pairs, most significant first. */
interface AxisBand {
  idx: number[]
  mask: number[]
}

const bandCache: Array<AxisBand[] | undefined> = []

function bandsAt(d: number): AxisBand[] {
  let bands = bandCache[d]
  if (!bands) {
    bands = AXIS_LANE.map((lane) => {
      const bytes = new Uint8Array(32)
      for (let i = LANDFALL_SLACK_BITS; i < d; i++) {
        const j = 3 * i + lane
        bytes[31 - (j >> 3)] |= 1 << (j & 7)
      }
      const band: AxisBand = { idx: [], mask: [] }
      for (let b = 0; b < 32; b++) {
        if (bytes[b] !== 0) {
          band.idx.push(b)
          band.mask.push(bytes[b])
        }
      }
      return band
    })
    bandCache[d] = bands
  }
  return bands
}

const BAND_MIXED = 0
const BAND_ZEROS = 1
const BAND_ONES = 2

/** Whether a row's band bits on one axis are mixed, all 0 or all 1. */
function bandOf(keys: Uint8Array, off: number, band: AxisBand): number {
  let ones = false
  let zeros = false
  for (let k = 0; k < band.idx.length; k++) {
    const m = band.mask[k]
    const v = keys[off + band.idx[k]] & m
    if (v !== 0) ones = true
    if (v !== m) zeros = true
    if (ones && zeros) return BAND_MIXED
  }
  return ones ? BAND_ONES : BAND_ZEROS
}

/** A row of a neighbor cell whose filed point is within the slack of the face it shares with the query's cell. */
function inNeighborBand(keys: Uint8Array, row: number, bands: AxisBand[], off: readonly number[]): boolean {
  for (let a = 0; a < 3; a++) {
    if (off[a] !== 0 && bandOf(keys, row * 32, bands[a]) !== (off[a] < 0 ? BAND_ONES : BAND_ZEROS)) return false
  }
  return true
}

/** Below this many rows a band sub-run is scanned rather than split again. */
const BAND_SCAN_ROWS = 32

/**
 * The sub-runs of a neighbor cell that can hold a row of its band: on each
 * axis where the cell is below the query's, the band bits all 1, on each
 * where it is above, all 0. A neighbor can hold a quarter of the planet, and
 * testing every row of it is a random read per row, so this descends instead,
 * one level at a time into the sub-cells whose next band bit already agrees,
 * until a run is short enough to scan. Empty sub-cells end their branch on
 * two binary searches. Rows in the result still get the full band test.
 */
function bandRuns(index: StopIndex, cell: CellRun, d: number, out: CellRun[]): void {
  const choices = cell.off.map((o) => (o < 0 ? [1] : o > 0 ? [0] : [0, 1]))
  const visit = (key: Uint8Array, level: number, start: number, end: number): void => {
    if (end - start <= BAND_SCAN_ROWS || level <= LANDFALL_SLACK_BITS) {
      out.push({ start, end, off: cell.off, key })
      return
    }
    const bit = level - 1
    for (const bx of choices[0]) {
      for (const by of choices[1]) {
        for (const bz of choices[2]) {
          const child = key.slice()
          const values = [bx, by, bz]
          for (let a = 0; a < 3; a++) {
            const j = 3 * bit + AXIS_LANE[a]
            const byte = 31 - (j >> 3)
            child[byte] = values[a] ? child[byte] | (1 << (j & 7)) : child[byte] & ~(1 << (j & 7))
          }
          const [s, e] = prefixRange(index, child, bit)
          if (e > s) visit(child, bit, s, e)
        }
      }
    }
  }
  visit(cell.key, d, cell.start, cell.end)
}

/**
 * The exact nearest stop, deriving as few landfalls exactly as it can.
 *
 * The decimal landfall derivation costs about 0.6 ms, and the old search ran
 * it for every stop in the first cube holding one: with the query off the
 * surface that cube held up to an octant of the planet, tens of thousands of
 * landfalls, and GOAL froze the tab for half a minute or more.
 *
 * The index files a landfall under its float64 coordinate, which is within
 * E = 2^LANDFALL_SLACK_BITS - 1 G of the exact one on every axis: the float
 * path's worst case is about 2^31 G, near the poles where sqrt(1 - z^2)
 * loses half its digits, and measured over 90,000 axis samples it is 202 G.
 * Ports are filed exactly.
 *
 * Distance <= d means "inside the aligned cube of side 2^d holding the
 * query". A stop whose exact point is inside has its filed point inside the
 * cube grown by E on every side, and above NEAR_LEVEL that lies in the 3x3x3
 * block of same-level cells around it, one prefix run each. Per landfall,
 * the key bits [LANDFALL_SLACK_BITS, d) of each axis settle it without
 * decoding anything:
 *
 * | Filed in | Band bits | Exact point |
 * |---|---|---|
 * | the query's cell | mixed on every axis | inside, for sure: at least E from every face |
 * | the query's cell | all 0 or all 1 on some axis | maybe: within E of a face |
 * | a neighbor cell | all 1 on each axis it is below, all 0 on each it is above | maybe: within E of the shared face |
 * | a neighbor cell | anything else | outside |
 *
 * Levels are walked up from the first whose block holds any stop (the
 * blocks nest, so a binary search finds it). At the first level where some
 * stop is inside, the answer is the lowest height inside, so a row at or
 * above the best sure height is skipped on one u32 read, and the "maybe"
 * rows are derived in height order only while they could still win: a
 * handful of derivations, not tens of thousands. At and below NEAR_LEVEL the
 * few meters around the query are searched by deriving every stop there.
 *
 * The winner is always derived before it is returned, so a stop filed away
 * from its true point (a relay anchor with a wrong C tag) is never reported
 * at a distance it does not have. Whenever the E bound holds the result is
 * identical to an exhaustive exact search, which the brute-force test pins.
 */
function nearestExact(
  index: StopIndex,
  coord: bigint,
  plane: 0 | null,
  maxHeight: number,
  exclude?: bigint,
): StationResult | null {
  if (index.permCount === 0) return null
  const key = coord >> 1n
  const t = coordToXyz(coord)
  const axes = [t.x, t.y, t.z]
  const { perm, heights, keys } = index
  const exactAt = (row: number): bigint => (kindIsPort(index, row) ? coordApproxAt(index, row) : stopCoordExact(stopAt(index, row)))
  const result = (row: number, distance: number): StationResult => ({ stop: stopAt(index, row), distance })

  // The first level whose block holds any stop at all; nothing is nearer.
  let lo = NEAR_LEVEL
  let hi = 85
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (neighborhood(index, key, axes, mid).length > 0) hi = mid
    else lo = mid + 1
  }

  if (lo === NEAR_LEVEL) {
    // Every stop within NEAR_LEVEL of the query is filed in this block.
    let bestRow = -1
    let bestDistance = 86
    for (const run of neighborhood(index, key, axes, NEAR_LEVEL)) {
      for (let pos = run.start; pos < run.end; pos++) {
        const row = perm[pos]
        if (heights[row] > maxHeight || (plane === 0 && kindIsPort(index, row))) continue
        const at = exactAt(row)
        if (exclude !== undefined && at === exclude) continue
        const distance = maxAxisLca(coord, at)
        if (distance > NEAR_LEVEL) continue
        if (distance < bestDistance || (distance === bestDistance && heights[row] < heights[bestRow])) {
          bestRow = row
          bestDistance = distance
        }
      }
    }
    if (bestRow >= 0) return result(bestRow, bestDistance)
    lo = NEAR_LEVEL + 1
  }

  // Stops found to be the excluded place; skipped at every level.
  const excluded = new Set<number>()
  for (let d = lo; d <= 85; d++) {
    const bands = bandsAt(d)
    const cells = neighborhood(index, key, axes, d)
    const own = cells.length > 0 && isOwnCell(cells[0]) ? cells[0] : null
    const near: CellRun[] = []
    for (const cell of cells) if (cell !== own) bandRuns(index, cell, d, near)
    // Stops derived at this level and found outside its cube.
    const outside = new Set<number>()
    for (;;) {
      let bestRow = -1
      let bestHeight = Number.POSITIVE_INFINITY
      const maybe: number[] = []
      if (own) {
        for (let pos = own.start; pos < own.end; pos++) {
          const row = perm[pos]
          const h = heights[row]
          if (h >= bestHeight || h > maxHeight) continue
          if (kindIsPort(index, row)) {
            // Filed exactly, and filed in the query's cell: inside.
            if (plane === 0) continue
            if (exclude !== undefined && coordApproxAt(index, row) === exclude) continue
          } else if (
            bandOf(keys, row * 32, bands[0]) !== BAND_MIXED ||
            bandOf(keys, row * 32, bands[1]) !== BAND_MIXED ||
            bandOf(keys, row * 32, bands[2]) !== BAND_MIXED
          ) {
            maybe.push(row)
            continue
          }
          if (outside.has(row) || excluded.has(row)) continue
          bestRow = row
          bestHeight = h
        }
      }
      // A port filed in a neighbor cell is outside; only landfalls can straddle.
      for (const run of near) {
        for (let pos = run.start; pos < run.end; pos++) {
          const row = perm[pos]
          const h = heights[row]
          if (h >= bestHeight || h > maxHeight || kindIsPort(index, row)) continue
          if (inNeighborBand(keys, row, bands, run.off)) maybe.push(row)
        }
      }
      // The maybes that could still beat the sure best, lowest height first:
      // the first one inside wins outright.
      const contenders = maybe.filter((row) => heights[row] < bestHeight && !outside.has(row) && !excluded.has(row))
      contenders.sort((a, b) => heights[a] - heights[b])
      for (const row of contenders) {
        const at = exactAt(row)
        if (exclude !== undefined && at === exclude) {
          excluded.add(row)
          continue
        }
        const distance = maxAxisLca(coord, at)
        if (distance <= d) return result(row, distance)
        outside.add(row)
      }
      if (bestRow < 0) break
      // Confirm the sure winner exactly; a stop filed away from its true
      // point fails here, and the level is rescanned without it.
      const at = exactAt(bestRow)
      if (exclude !== undefined && at === exclude) {
        excluded.add(bestRow)
        continue
      }
      const distance = maxAxisLca(coord, at)
      if (distance <= d) return result(bestRow, distance)
      outside.add(bestRow)
    }
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
  return mergeRuns(runs)
}

/** Sorted, disjoint runs from any set of runs: overlapping and touching ones fused. */
function mergeRuns(runs: Array<[number, number]>): Array<[number, number]> {
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

/**
 * Sorted-view runs covering every stop within `radius` gibsons of a
 * centre: the cover for the sphere of interest (interest.ts).
 *
 * coverageRuns would do it, with the sphere's bounding box as the reach,
 * but its cover is eight cubes at the first level whose side exceeds the
 * box, and for a sphere that is eight cubes of side FOUR radii: at 2^49
 * the sphere is 2097 km across and each cube is 8389 km, wider than the
 * planet, so the cover was the whole landfall shell and every one of the
 * half million rows had to be decoded to keep the twelve thousand inside.
 * This walks the aligned cubes of side a quarter of the radius instead,
 * keeping only those the ball actually touches (the cube's nearest point
 * to the centre is within the radius, in fixed point) and taking each
 * cube's prefix run. A few hundred binary searches, and the rows they
 * cover reach at most about a cube's diagonal past the sphere, which on
 * the ground is roughly twice the area inside it rather than forty times.
 *
 * A superset by construction: callers still test every row exactly.
 */
export function ballCoverageRuns(
  index: StopIndex,
  centre: { x: bigint; y: bigint; z: bigint },
  radius: bigint,
): Array<[number, number]> {
  if (index.permCount === 0 || radius <= 0n) return []
  const d = Math.max(0, Math.min(85, radius.toString(2).length - 3))
  const side = 1n << BigInt(d)
  const r2 = radius * radius
  const clamp = (v: bigint): bigint => (v < 0n ? 0n : v > AXIS_MAX ? AXIS_MAX : v)
  const alignDown = (v: bigint): bigint => (v >> BigInt(d)) << BigInt(d)
  const lo = { x: alignDown(clamp(centre.x - radius)), y: alignDown(clamp(centre.y - radius)), z: alignDown(clamp(centre.z - radius)) }
  const hi = { x: clamp(centre.x + radius), y: clamp(centre.y + radius), z: clamp(centre.z + radius) }
  // Signed distance from the centre to the nearest point of [c, c + side) along one axis.
  const gapAlong = (c: bigint, v: bigint): bigint => (v < c ? c - v : v >= c + side ? v - (c + side - 1n) : 0n)
  const runs: Array<[number, number]> = []
  for (let cx = lo.x; cx <= hi.x; cx += side) {
    const gx = gapAlong(cx, centre.x)
    if (gx * gx > r2) continue
    for (let cy = lo.y; cy <= hi.y; cy += side) {
      const gy = gapAlong(cy, centre.y)
      if (gx * gx + gy * gy > r2) continue
      for (let cz = lo.z; cz <= hi.z; cz += side) {
        const gz = gapAlong(cz, centre.z)
        if (gx * gx + gy * gy + gz * gz > r2) continue
        const key = bigToBytes32(xyzToCoord(cx, cy, cz, 0) >> 1n)
        const run = prefixRange(index, key, d)
        if (run[1] > run[0]) runs.push(run)
      }
    }
  }
  return mergeRuns(runs)
}

/**
 * The sorted-view run of every stop inside the aligned cube of `height`
 * that contains a position: one exact prefix range, both planes (the key
 * carries no plane bit), found by two binary searches. The cover for the
 * port cube of interest (interest.ts portCube), and exact rather than a
 * superset: a row is in the run if and only if its key is in the cube.
 */
export function cubeRun(index: StopIndex, x: bigint, y: bigint, z: bigint, height: number): [number, number] {
  if (index.permCount === 0) return [0, 0]
  return prefixRange(index, bigToBytes32(xyzToCoord(x, y, z, 0) >> 1n), Math.max(0, Math.min(85, height)))
}
