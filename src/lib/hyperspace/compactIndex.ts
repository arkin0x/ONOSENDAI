/**
 * compactIndex.ts: the columnar stop index behind hyperspace.
 *
 * The line is ~1M stops. The previous index held them as a million Stop
 * objects plus a parallel bigint key array; between object headers, bigints
 * and hex strings that was hundreds of megabytes and made every bulk merge a
 * GC event. Here the hot data lives in five flat typed-array columns (32-byte
 * keys, coords, merkles, hashes, plus a kind byte and a u32 height per row),
 * and Stop objects are materialized on demand only for the handful of rows
 * the UI actually touches (memoized so identity is stable and lazy exact
 * coordinates cache on the object as before).
 *
 * Rows are append-only and never move, so a row id is a stable handle for
 * the page's life. Sorted order lives in a separate permutation (`perm`),
 * because bulk arrivals must not stall the main thread: appended rows sit in
 * key-sorted pending runs until an incremental merge (mergeStep, bounded by
 * a time budget per slice) folds them into a new permutation. Height lookups
 * (byHeight) see appended rows immediately; spatial queries see them when
 * the merge lands, which is the same freshness contract the bulk relay sync
 * always had.
 *
 * Keys are big-endian byte strings rather than bigints on purpose: bytewise
 * compare is allocation-free, and 32 fixed bytes in a flat buffer is what
 * makes the worker handoff a transferable copy instead of a million boxed
 * bigint constructions.
 */

import { coordToXyz, type Xyz } from 'cyberspace-core'
import { bytesToHex, hexToBytes } from '../events'
import { bigToBytes32, bytesToBigAt, type BlobColumns } from './headers'
import type { Stop } from './stops'

/** kinds column bits. */
const KIND_PORT = 1
const HAS_HASH = 2

interface MergeState {
  /** Row ids being merged in, ascending by key. */
  incoming: Uint32Array
  /** The permutation being built; swapped in whole when complete, so queries
   * keep a consistent view mid-merge. */
  out: Uint32Array
  i: number
  j: number
  k: number
}

export interface StopIndex {
  /** Rows appended so far. Rows never move and are never removed. */
  size: number
  /** Allocated row capacity of the columns. */
  capacity: number
  keys: Uint8Array
  coords: Uint8Array
  merkles: Uint8Array
  hashes: Uint8Array
  kinds: Uint8Array
  heights: Uint32Array
  /** Sorted view: perm[0..permCount) are row ids ascending by key bytes. */
  perm: Uint32Array
  permCount: number
  /** height -> row + 1 (0 = absent); dense because heights are. */
  byHeight: Uint32Array
  /** Highest height present, or -1 when empty. */
  maxHeight: number
  /** Key-sorted row-id runs appended but not yet merged into perm. */
  pending: Uint32Array[]
  merge: MergeState | null
  /** Materialized stops by row. Only rows the UI touched, so it stays small
   * relative to the columns; identity stability is what StopField's decode
   * cache and stopCoordExact's lazy caching rely on. */
  stopCache: Map<number, Stop>
  /** Decoded axes by row, for the renderer (coordToXyz costs seconds over a
   * million rows, so each row is de-interleaved once, ever). */
  xyz: Array<Xyz | undefined>
}

export function createStopIndex(): StopIndex {
  return {
    size: 0,
    capacity: 0,
    keys: new Uint8Array(0),
    coords: new Uint8Array(0),
    merkles: new Uint8Array(0),
    hashes: new Uint8Array(0),
    kinds: new Uint8Array(0),
    heights: new Uint32Array(0),
    perm: new Uint32Array(0),
    permCount: 0,
    byHeight: new Uint32Array(0),
    maxHeight: -1,
    pending: [],
    merge: null,
    stopCache: new Map(),
    xyz: [],
  }
}

function grow<T extends Uint8Array | Uint32Array>(old: T, length: number, make: (n: number) => T): T {
  const next = make(length)
  next.set(old as never)
  return next
}

function ensureCapacity(index: StopIndex, extra: number): void {
  const needed = index.size + extra
  if (needed <= index.capacity) return
  const cap = Math.max(needed, index.capacity * 2, 65536)
  index.keys = grow(index.keys, cap * 32, (n) => new Uint8Array(n))
  index.coords = grow(index.coords, cap * 32, (n) => new Uint8Array(n))
  index.merkles = grow(index.merkles, cap * 32, (n) => new Uint8Array(n))
  index.hashes = grow(index.hashes, cap * 32, (n) => new Uint8Array(n))
  index.kinds = grow(index.kinds, cap, (n) => new Uint8Array(n))
  index.heights = grow(index.heights, cap, (n) => new Uint32Array(n))
  index.capacity = cap
}

function ensureByHeight(index: StopIndex, height: number): void {
  if (height < index.byHeight.length) return
  const cap = Math.max(height + 1, index.byHeight.length * 2, 65536)
  index.byHeight = grow(index.byHeight, cap, (n) => new Uint32Array(n))
}

// ---------------------------------------------------------------------------
// Row accessors
// ---------------------------------------------------------------------------

export function rowByHeight(index: StopIndex, height: number): number {
  if (height < 0 || height >= index.byHeight.length) return -1
  return index.byHeight[height] - 1
}

export function heightAt(index: StopIndex, row: number): number {
  return index.heights[row]
}

export function kindIsPort(index: StopIndex, row: number): boolean {
  return (index.kinds[row] & KIND_PORT) !== 0
}

export function coordApproxAt(index: StopIndex, row: number): bigint {
  return bytesToBigAt(index.coords, row * 32)
}

/** Decoded axes for a row, de-interleaved once and cached. */
export function xyzAt(index: StopIndex, row: number): Xyz {
  let d = index.xyz[row]
  if (!d) {
    d = coordToXyz(coordApproxAt(index, row))
    index.xyz[row] = d
  }
  return d
}

/** Materialize the Stop for a row; memoized so identity is stable. */
export function stopAt(index: StopIndex, row: number): Stop {
  const cached = index.stopCache.get(row)
  if (cached) return cached
  const col = row * 32
  const port = (index.kinds[row] & KIND_PORT) !== 0
  const coordApprox = coordApproxAt(index, row)
  const stop: Stop = {
    height: index.heights[row],
    kind: port ? 'port' : 'landfall',
    merkleRoot: bytesToHex(index.merkles.subarray(col, col + 32)),
    blockHash: (index.kinds[row] & HAS_HASH) !== 0
      ? bytesToHex(index.hashes.subarray(col, col + 32))
      : null,
    coordExact: port ? coordApprox : null,
    coordApprox,
  }
  index.stopCache.set(row, stop)
  return stop
}

export function stopByHeight(index: StopIndex, height: number): Stop | undefined {
  const row = rowByHeight(index, height)
  return row === -1 ? undefined : stopAt(index, row)
}

// ---------------------------------------------------------------------------
// Key comparison
// ---------------------------------------------------------------------------

export function compareRowKeys(index: StopIndex, a: number, b: number): number {
  const keys = index.keys
  const oa = a * 32
  const ob = b * 32
  for (let i = 0; i < 32; i++) {
    const d = keys[oa + i] - keys[ob + i]
    if (d !== 0) return d
  }
  return 0
}

export function compareRowKeyToBytes(index: StopIndex, row: number, bytes: Uint8Array): number {
  const keys = index.keys
  const off = row * 32
  for (let i = 0; i < 32; i++) {
    const d = keys[off + i] - bytes[i]
    if (d !== 0) return d
  }
  return 0
}

/** The key at sorted position `pos`, as hex; fixed width makes hex order
 * equal numeric order, which is what the sortedness tests lean on. */
export function keyHexAtSorted(index: StopIndex, pos: number): string {
  const off = index.perm[pos] * 32
  return bytesToHex(index.keys.subarray(off, off + 32))
}

// ---------------------------------------------------------------------------
// Appending
// ---------------------------------------------------------------------------

/** Write one stop's columns at the next row; caller ensured capacity. */
function writeRow(index: StopIndex, stop: Stop): number {
  const row = index.size
  const col = row * 32
  index.keys.set(bigToBytes32(stop.coordApprox >> 1n), col)
  index.coords.set(bigToBytes32(stop.coordApprox), col)
  index.merkles.set(hexToBytes(stop.merkleRoot), col)
  if (stop.blockHash !== null) index.hashes.set(hexToBytes(stop.blockHash), col)
  index.kinds[row] = (stop.kind === 'port' ? KIND_PORT : 0) | (stop.blockHash !== null ? HAS_HASH : 0)
  index.heights[row] = stop.height
  ensureByHeight(index, stop.height)
  index.byHeight[stop.height] = row + 1
  if (stop.height > index.maxHeight) index.maxHeight = stop.height
  index.size = row + 1
  return row
}

/**
 * Append relay-sourced stops as one key-sorted pending run. Heights already
 * in the index (and duplicates within the batch, first wins) are skipped:
 * every source of a given height describes the same block. Returns how many
 * rows were actually appended; call mergeStep (or a scheduler around it) to
 * make them visible to spatial queries.
 */
export function appendStops(index: StopIndex, stops: Stop[]): number {
  if (stops.length === 0) return 0
  ensureCapacity(index, stops.length)
  const rows: number[] = []
  for (const stop of stops) {
    if (rowByHeight(index, stop.height) !== -1) continue
    rows.push(writeRow(index, stop))
  }
  if (rows.length === 0) return 0
  const run = Uint32Array.from(rows)
  run.sort((a, b) => compareRowKeys(index, a, b))
  index.pending.push(run)
  return run.length
}

/**
 * Append a verified header blob's columns. Heights are consecutive from
 * cols.startHeight, so row r of the blob is height startHeight + r. The
 * common case (no height already present) is a bulk buffer copy; overlap
 * with cached relay rows falls back to per-row filtering.
 */
export function appendColumns(index: StopIndex, cols: BlobColumns): number {
  const { startHeight, count } = cols
  if (count === 0) return 0
  ensureCapacity(index, count)
  ensureByHeight(index, startHeight + count - 1)

  let dup = false
  for (let r = 0; r < count; r++) {
    if (rowByHeight(index, startHeight + r) !== -1) {
      dup = true
      break
    }
  }

  const base = index.size
  if (!dup) {
    index.keys.set(cols.keys, base * 32)
    index.coords.set(cols.coords, base * 32)
    index.merkles.set(cols.merkles, base * 32)
    index.hashes.set(cols.hashes, base * 32)
    for (let r = 0; r < count; r++) {
      index.kinds[base + r] = (cols.kinds[r] === 1 ? KIND_PORT : 0) | HAS_HASH
      index.heights[base + r] = startHeight + r
      index.byHeight[startHeight + r] = base + r + 1
    }
    index.size = base + count
    const run = new Uint32Array(count)
    for (let k = 0; k < count; k++) run[k] = base + cols.order[k]
    index.pending.push(run)
    if (startHeight + count - 1 > index.maxHeight) index.maxHeight = startHeight + count - 1
    return count
  }

  // Overlap path: copy only the missing heights, preserving the blob's key
  // order for the pending run via a source-row -> dest-row map.
  const dest = new Int32Array(count).fill(-1)
  for (let r = 0; r < count; r++) {
    const height = startHeight + r
    if (rowByHeight(index, height) !== -1) continue
    const row = index.size
    const col = row * 32
    const src = r * 32
    index.keys.set(cols.keys.subarray(src, src + 32), col)
    index.coords.set(cols.coords.subarray(src, src + 32), col)
    index.merkles.set(cols.merkles.subarray(src, src + 32), col)
    index.hashes.set(cols.hashes.subarray(src, src + 32), col)
    index.kinds[row] = (cols.kinds[r] === 1 ? KIND_PORT : 0) | HAS_HASH
    index.heights[row] = height
    index.byHeight[height] = row + 1
    if (height > index.maxHeight) index.maxHeight = height
    index.size = row + 1
    dest[r] = row
  }
  const kept: number[] = []
  for (let k = 0; k < count; k++) {
    const row = dest[cols.order[k]]
    if (row !== -1) kept.push(row)
  }
  if (kept.length === 0) return 0
  index.pending.push(Uint32Array.from(kept))
  return kept.length
}

/**
 * Insert one stop (the live tail: one block per ten minutes). When the index
 * is quiescent this splices the permutation in place (one native memmove);
 * during a bulk merge it joins the pending queue instead so the merge's
 * snapshot arithmetic stays valid.
 */
export function insertRow(index: StopIndex, stop: Stop): void {
  if (rowByHeight(index, stop.height) !== -1) return
  if (index.merge !== null || index.pending.length > 0) {
    appendStops(index, [stop])
    return
  }
  ensureCapacity(index, 1)
  const row = writeRow(index, stop)
  const keyOff = row * 32
  const key = index.keys.subarray(keyOff, keyOff + 32)
  let lo = 0
  let hi = index.permCount
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (compareRowKeyToBytes(index, index.perm[mid], key) < 0) lo = mid + 1
    else hi = mid
  }
  if (index.permCount === index.perm.length) {
    index.perm = grow(index.perm, Math.max(index.permCount + 1, index.perm.length * 2, 1024), (n) => new Uint32Array(n))
  }
  index.perm.copyWithin(lo + 1, lo, index.permCount)
  index.perm[lo] = row
  index.permCount += 1
}

// ---------------------------------------------------------------------------
// Incremental merging
// ---------------------------------------------------------------------------

export function hasPending(index: StopIndex): boolean {
  return index.pending.length > 0 || index.merge !== null
}

function mergeRuns(index: StopIndex, a: Uint32Array, b: Uint32Array): Uint32Array {
  const out = new Uint32Array(a.length + b.length)
  let i = 0
  let j = 0
  let k = 0
  while (i < a.length && j < b.length) {
    out[k++] = compareRowKeys(index, a[i], b[j]) <= 0 ? a[i++] : b[j++]
  }
  if (i < a.length) out.set(a.subarray(i), k)
  if (j < b.length) out.set(b.subarray(j), k)
  return out
}

/** Fold every pending run into one sorted incoming list. Runs are already
 * sorted, so this is linear pairwise merging, cheap even for many small
 * relay batches coalesced behind one bulk merge. */
function drainPending(index: StopIndex): Uint32Array {
  let runs = index.pending
  index.pending = []
  while (runs.length > 1) {
    const next: Uint32Array[] = []
    for (let i = 0; i < runs.length; i += 2) {
      next.push(i + 1 < runs.length ? mergeRuns(index, runs[i], runs[i + 1]) : runs[i])
    }
    runs = next
  }
  return runs[0]
}

/** Check the clock every this many merge steps; a step is a compare + a u32
 * write, so 1024 of them are far below a millisecond. */
const BUDGET_CHECK_EVERY = 1024

/**
 * Advance the merge by at most `budgetMs` of work. Returns true when the
 * permutation is fully up to date (nothing pending, no merge in flight).
 * The permutation swaps atomically at the end, so a caller can keep querying
 * between slices and always sees a consistent (if slightly stale) view.
 */
export function mergeStep(index: StopIndex, budgetMs: number): boolean {
  let st = index.merge
  if (st === null) {
    if (index.pending.length === 0) return true
    const incoming = drainPending(index)
    st = { incoming, out: new Uint32Array(index.permCount + incoming.length), i: 0, j: 0, k: 0 }
    index.merge = st
  }
  const deadline = performance.now() + budgetMs
  const perm = index.perm
  const inc = st.incoming
  const out = st.out
  const n = index.permCount
  const m = inc.length
  let { i, j, k } = st
  let steps = 0
  while (i < n && j < m) {
    out[k++] = compareRowKeys(index, perm[i], inc[j]) <= 0 ? perm[i++] : inc[j++]
    if (++steps === BUDGET_CHECK_EVERY) {
      steps = 0
      if (performance.now() >= deadline) {
        st.i = i
        st.j = j
        st.k = k
        return false
      }
    }
  }
  if (i < n) {
    out.set(perm.subarray(i, n), k)
    k += n - i
  }
  if (j < m) {
    out.set(inc.subarray(j, m), k)
    k += m - j
  }
  index.perm = out
  index.permCount = k
  index.merge = null
  return index.pending.length === 0
}

/** Drain everything synchronously: builders, tests, and node. */
export function mergeAll(index: StopIndex): void {
  while (!mergeStep(index, Number.POSITIVE_INFINITY)) { /* keep folding */ }
}

// ---------------------------------------------------------------------------
// Snapshot persistence
// ---------------------------------------------------------------------------

/**
 * The built index as a handful of ArrayBuffers, the shape IndexedDB can store
 * and hand back wholesale. Replaying ~1M cached rows re-sorts the whole line
 * on every page load; adopting a snapshot is one bulk read plus a byHeight
 * rebuild. The buffers are copies sliced to `count`, never views into the
 * live typed arrays, so an in-flight IndexedDB write is not racing rows
 * appended after serialization.
 */
export interface IndexSnapshot {
  version: 1
  count: number
  maxHeight: number
  keys: ArrayBuffer
  coords: ArrayBuffer
  merkles: ArrayBuffer
  hashes: ArrayBuffer
  kinds: ArrayBuffer
  heights: ArrayBuffer
  perm: ArrayBuffer
}

/**
 * Serialize a fully merged index, or null while rows are still pending: a
 * mid-merge permutation does not order every row, and persisting it would
 * silently hide the unmerged tail from spatial queries after adoption.
 * Callers run mergeAll first.
 */
export function serializeIndex(index: StopIndex): IndexSnapshot | null {
  if (hasPending(index) || index.permCount !== index.size) return null
  const count = index.size
  return {
    version: 1,
    count,
    maxHeight: index.maxHeight,
    keys: index.keys.slice(0, count * 32).buffer,
    coords: index.coords.slice(0, count * 32).buffer,
    merkles: index.merkles.slice(0, count * 32).buffer,
    hashes: index.hashes.slice(0, count * 32).buffer,
    kinds: index.kinds.slice(0, count).buffer,
    heights: index.heights.slice(0, count).buffer,
    perm: index.perm.slice(0, count).buffer,
  }
}

/** The value when it is an ArrayBuffer of exactly byteLength, else null. */
function bufferOf(v: unknown, byteLength: number): ArrayBuffer | null {
  return v instanceof ArrayBuffer && v.byteLength === byteLength ? v : null
}

/**
 * Adopt a stored snapshot into an EMPTY index. Everything is validated before
 * the first mutation (shape, version, exact buffer lengths, perm being a real
 * permutation, heights unique and consistent with maxHeight), because a
 * half-adopted index would answer queries plausibly and wrongly forever; on
 * any mismatch the index is untouched (false) and the caller falls back to
 * the row replay. The buffers become the live columns without copying: the
 * snapshot comes out of IndexedDB as a structured clone the index then owns,
 * and no code path writes inside the first `count` rows afterwards (rows
 * never mutate, and adoption leaves capacity === count so the next append
 * grows into fresh buffers before writing).
 */
export function adoptSnapshot(index: StopIndex, snap: unknown): boolean {
  if (index.size !== 0 || index.permCount !== 0 || hasPending(index)) return false
  if (typeof snap !== 'object' || snap === null) return false
  const s = snap as Record<string, unknown>
  if (s.version !== 1) return false
  const count = s.count
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return false
  const maxHeight = s.maxHeight
  if (typeof maxHeight !== 'number' || !Number.isSafeInteger(maxHeight)) return false
  if (count === 0 ? maxHeight !== -1 : maxHeight < 0) return false
  const keys = bufferOf(s.keys, count * 32)
  const coords = bufferOf(s.coords, count * 32)
  const merkles = bufferOf(s.merkles, count * 32)
  const hashes = bufferOf(s.hashes, count * 32)
  const kinds = bufferOf(s.kinds, count)
  const heights = bufferOf(s.heights, count * 4)
  const perm = bufferOf(s.perm, count * 4)
  if (!keys || !coords || !merkles || !hashes || !kinds || !heights || !perm) return false

  const heightCol = new Uint32Array(heights)
  const permCol = new Uint32Array(perm)
  const byHeight = new Uint32Array(count === 0 ? 0 : maxHeight + 1)
  const seen = new Uint8Array(count)
  let highest = -1
  for (let row = 0; row < count; row++) {
    const h = heightCol[row]
    if (h > maxHeight || byHeight[h] !== 0) return false
    byHeight[h] = row + 1
    if (h > highest) highest = h
    const p = permCol[row]
    if (p >= count || seen[p] !== 0) return false
    seen[p] = 1
  }
  if (highest !== maxHeight) return false

  index.keys = new Uint8Array(keys)
  index.coords = new Uint8Array(coords)
  index.merkles = new Uint8Array(merkles)
  index.hashes = new Uint8Array(hashes)
  index.kinds = new Uint8Array(kinds)
  index.heights = heightCol
  index.perm = permCol
  index.permCount = count
  index.byHeight = byHeight
  index.maxHeight = maxHeight
  index.size = count
  index.capacity = count
  return true
}
