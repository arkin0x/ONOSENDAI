/**
 * What would fail silently without these tests: a columnar index that drops
 * or duplicates a row during a merge would return a plausible-but-wrong
 * station forever after; a blob column appended with the wrong height base
 * would hand the ride builder the wrong block hashes; and a permutation
 * corrupted by an interrupted incremental merge would poison every prefix
 * search. The cross-checks here build the same stop set through every entry
 * path (builder, blob columns, relay batches, single inserts) and demand
 * identical answers. The snapshot round trip has its own silent failure
 * mode: a snapshot adopted with a truncated column, a permutation that skips
 * a row, or a byHeight rebuilt off wrong heights would resume ~1M stops
 * instantly and answer plausibly-but-wrong forever, so the adopted index is
 * cross-checked against the original and malformed snapshots must be
 * refused with the target left untouched.
 */
import { describe, expect, it } from 'vitest'
import { xyzToCoord } from 'cyberspace-core'
import { bytesToHex, hexToBytes } from '../events'
import { bigToBytes32, type BlobColumns } from './headers'
import {
  adoptSnapshot,
  appendColumns,
  appendStops,
  createStopIndex,
  hasPending,
  keyHexAtSorted,
  mergeAll,
  mergeStep,
  rowByHeight,
  serializeIndex,
  stopAt,
  stopByHeight,
} from './compactIndex'
import { buildIndex, findStation, insertStop, maxAxisLca, nearestStops } from './station'
import type { Stop } from './stops'

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function rand85(rng: () => number): bigint {
  let v = 0n
  for (let i = 0; i < 6; i++) v = (v << 16n) | BigInt(Math.floor(rng() * 65536))
  return v & ((1n << 85n) - 1n)
}

function hex64(rng: () => number): string {
  let out = ''
  for (let i = 0; i < 8; i++) out += Math.floor(rng() * 0x100000000).toString(16).padStart(8, '0')
  return out
}

/** Synthetic ports only: findStation re-derives landfall finalists through
 * the exact decimal path, which is far too slow for hundreds of queries. */
function syntheticStop(height: number, coord: bigint, blockHash: string | null): Stop {
  return {
    height,
    kind: 'port',
    merkleRoot: coord.toString(16).padStart(64, '0'),
    blockHash,
    coordExact: coord,
    coordApprox: coord,
  }
}

function bruteStation(stops: Stop[], coord: bigint, maxHeight: number): { height: number; distance: number } | null {
  let best: { height: number; distance: number } | null = null
  for (const s of stops) {
    if (s.height > maxHeight) continue
    const d = maxAxisLca(coord, s.coordExact as bigint)
    if (best === null || d < best.distance || (d === best.distance && s.height < best.height)) {
      best = { height: s.height, distance: d }
    }
  }
  return best
}

/** Build worker-shaped columns from stops with consecutive heights, the way
 * verifyAndDerive would (keys = coord >> 1, order sorted by key). */
function columnsFrom(stops: Stop[], startHeight: number): BlobColumns {
  const count = stops.length
  const keys = new Uint8Array(count * 32)
  const kinds = new Uint8Array(count)
  const merkles = new Uint8Array(count * 32)
  const hashes = new Uint8Array(count * 32)
  const coords = new Uint8Array(count * 32)
  stops.forEach((stop, i) => {
    expect(stop.height).toBe(startHeight + i)
    keys.set(bigToBytes32(stop.coordApprox >> 1n), i * 32)
    kinds[i] = stop.kind === 'port' ? 1 : 0
    merkles.set(hexToBytes(stop.merkleRoot), i * 32)
    hashes.set(hexToBytes(stop.blockHash as string), i * 32)
    coords.set(bigToBytes32(stop.coordApprox), i * 32)
  })
  const order = new Uint32Array(count)
  for (let i = 0; i < count; i++) order[i] = i
  order.sort((a, b) => {
    const ha = bytesToHex(keys.subarray(a * 32, a * 32 + 32))
    const hb = bytesToHex(keys.subarray(b * 32, b * 32 + 32))
    return ha < hb ? -1 : ha > hb ? 1 : 0
  })
  return { startHeight, count, keys, kinds, merkles, hashes, coords, order }
}

function assertSorted(index: ReturnType<typeof createStopIndex>): void {
  for (let i = 1; i < index.permCount; i++) {
    expect(keyHexAtSorted(index, i) >= keyHexAtSorted(index, i - 1)).toBe(true)
  }
}

describe('blob columns and relay rows interleaved', () => {
  it('answers findStation exactly like the plain builder and brute force', () => {
    const rng = mulberry32(77)
    const stops: Stop[] = []
    for (let h = 0; h < 240; h++) {
      stops.push(syntheticStop(h, xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 1), hex64(rng)))
    }
    const reference = buildIndex(stops)

    // The mixed-path index: two "blobs" (heights 0..69, 70..139) with relay
    // batches interleaved between and after them, out of height order.
    const mixed = createStopIndex()
    appendColumns(mixed, columnsFrom(stops.slice(0, 70), 0))
    const relay = stops.slice(140)
    appendStops(mixed, relay.slice(60).reverse())
    appendColumns(mixed, columnsFrom(stops.slice(70, 140), 70))
    appendStops(mixed, relay.slice(0, 60))
    mergeAll(mixed)

    expect(mixed.size).toBe(240)
    assertSorted(mixed)
    for (let trial = 0; trial < 50; trial++) {
      const q = xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 0)
      const maxHeight = trial % 3 === 0 ? 100 : 10_000
      const got = findStation(mixed, q, maxHeight)
      const ref = findStation(reference, q, maxHeight)
      const brute = bruteStation(stops, q, maxHeight)
      expect(got?.stop.height).toBe(brute?.height)
      expect(got?.distance).toBe(brute?.distance)
      expect(got?.stop.height).toBe(ref?.stop.height)
    }
  })

  it('skips heights the index already has, first source wins', () => {
    const rng = mulberry32(5)
    const stops: Stop[] = []
    for (let h = 0; h < 60; h++) {
      stops.push(syntheticStop(h, xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 1), hex64(rng)))
    }
    const index = createStopIndex()
    appendColumns(index, columnsFrom(stops.slice(0, 50), 0))
    // Relay rows for 40..59 with DIFFERENT hashes: the overlap (40..49) must
    // keep the blob's version, the tail (50..59) must land.
    const relayVersion = stops.map((s) => ({ ...s, blockHash: hex64(rng) }))
    expect(appendStops(index, relayVersion.slice(40))).toBe(10)
    mergeAll(index)
    expect(index.size).toBe(60)
    expect(stopByHeight(index, 45)?.blockHash).toBe(stops[45].blockHash)
    expect(stopByHeight(index, 55)?.blockHash).toBe(relayVersion[55].blockHash)
  })
})

describe('getStopByHeight / blockHash round trip', () => {
  it('materializes stops from columns, memoized with stable identity', () => {
    const rng = mulberry32(13)
    const stops: Stop[] = []
    for (let h = 100; h < 130; h++) {
      stops.push(syntheticStop(h, xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 1), hex64(rng)))
    }
    const index = createStopIndex()
    appendColumns(index, columnsFrom(stops, 100))
    mergeAll(index)
    for (const want of stops) {
      const got = stopByHeight(index, want.height)
      expect(got).toBeDefined()
      expect(got?.height).toBe(want.height)
      expect(got?.merkleRoot).toBe(want.merkleRoot)
      expect(got?.blockHash).toBe(want.blockHash)
      expect(got?.coordApprox).toBe(want.coordApprox)
      // Ports carry their exact coordinate straight from the column.
      expect(got?.coordExact).toBe(want.coordApprox)
      // Identity is stable: the ride builder and the scrubber must see the
      // same object (stopCoordExact caches onto it).
      expect(stopByHeight(index, want.height)).toBe(got)
    }
    expect(rowByHeight(index, 99)).toBe(-1)
    expect(stopByHeight(index, 500)).toBeUndefined()
  })
})

describe('incremental merging', () => {
  it('a zero-budget merge completes over many slices with a correct result', () => {
    const rng = mulberry32(99)
    const stops: Stop[] = []
    for (let h = 0; h < 20_000; h++) {
      stops.push(syntheticStop(h, xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 1), null))
    }
    const index = createStopIndex()
    appendStops(index, stops.slice(0, 15_000))
    mergeAll(index)
    appendStops(index, stops.slice(15_000))
    let slices = 0
    while (!mergeStep(index, 0)) slices++
    // A 15k + 5k merge at zero budget must have yielded repeatedly; that is
    // the whole point of the sliced merge.
    expect(slices).toBeGreaterThan(2)
    expect(index.permCount).toBe(20_000)
    assertSorted(index)
    const reference = buildIndex(stops)
    for (let trial = 0; trial < 20; trial++) {
      const q = xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 0)
      expect(findStation(index, q, 30_000)?.stop.height)
        .toBe(findStation(reference, q, 30_000)?.stop.height)
    }
  })

  it('insertStop defers while rows are pending and still lands after the merge', () => {
    const rng = mulberry32(21)
    const index = createStopIndex()
    const batch: Stop[] = []
    for (let h = 0; h < 100; h++) {
      batch.push(syntheticStop(h, xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 1), null))
    }
    appendStops(index, batch)
    expect(hasPending(index)).toBe(true)
    const late = syntheticStop(500, xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 1), null)
    insertStop(index, late)
    // Deferred, not lost: visible by height at once, spatially after merging.
    expect(rowByHeight(index, 500)).not.toBe(-1)
    mergeAll(index)
    expect(index.permCount).toBe(101)
    assertSorted(index)
    expect(findStation(index, late.coordApprox, 10_000)?.stop.height).toBe(500)
    expect(stopAt(index, rowByHeight(index, 500)).height).toBe(500)
  })
})

describe('snapshot serialize / adopt', () => {
  /** A merged mixed-source index (blob columns + relay rows, some without a
   * block hash) and the stops behind it, for round-trip cross-checks. */
  function buildSample(): { index: ReturnType<typeof createStopIndex>; stops: Stop[] } {
    const rng = mulberry32(31)
    const stops: Stop[] = []
    for (let h = 0; h < 300; h++) {
      const hash = h < 150 ? hex64(rng) : h % 3 === 0 ? null : hex64(rng)
      stops.push(syntheticStop(h, xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 1), hash))
    }
    const index = createStopIndex()
    appendColumns(index, columnsFrom(stops.slice(0, 150), 0))
    appendStops(index, stops.slice(150))
    mergeAll(index)
    return { index, stops }
  }

  it('round-trips: the adopted index answers exactly like the original', () => {
    const { index, stops } = buildSample()
    const snap = serializeIndex(index)
    if (snap === null) throw new Error('expected a snapshot from a merged index')
    const fresh = createStopIndex()
    expect(adoptSnapshot(fresh, snap)).toBe(true)
    expect(fresh.size).toBe(index.size)
    expect(fresh.permCount).toBe(index.permCount)
    expect(fresh.maxHeight).toBe(index.maxHeight)
    assertSorted(fresh)
    // byHeight was rebuilt, not copied: every height must resolve with all
    // its columns intact, blockHash (and its absence) included.
    for (const want of stops) {
      const got = stopByHeight(fresh, want.height)
      expect(got?.merkleRoot).toBe(want.merkleRoot)
      expect(got?.blockHash).toBe(want.blockHash)
      expect(got?.coordApprox).toBe(want.coordApprox)
    }
    expect(rowByHeight(fresh, 300)).toBe(-1)
    const rng = mulberry32(87)
    for (let trial = 0; trial < 40; trial++) {
      const q = xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 0)
      const maxHeight = trial % 3 === 0 ? 120 : 10_000
      const a = findStation(index, q, maxHeight)
      const b = findStation(fresh, q, maxHeight)
      expect(b?.stop.height).toBe(a?.stop.height)
      expect(b?.distance).toBe(a?.distance)
      const na = nearestStops(index, q, 8).map((r) => [r.stop.height, r.distance])
      const nb = nearestStops(fresh, q, 8).map((r) => [r.stop.height, r.distance])
      expect(nb).toEqual(na)
    }
  })

  it('an adopted index keeps growing: appends land and stay queryable', () => {
    const { index } = buildSample()
    const fresh = createStopIndex()
    expect(adoptSnapshot(fresh, serializeIndex(index))).toBe(true)
    const rng = mulberry32(53)
    const late = syntheticStop(1000, xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 1), hex64(rng))
    insertStop(fresh, late)
    expect(stopByHeight(fresh, 1000)?.blockHash).toBe(late.blockHash)
    expect(findStation(fresh, late.coordApprox, 10_000)?.stop.height).toBe(1000)
    assertSorted(fresh)
  })

  it('returns null with rows pending or a merge parked mid-flight, works after mergeAll', () => {
    const rng = mulberry32(61)
    const stops: Stop[] = []
    for (let h = 0; h < 6000; h++) {
      stops.push(syntheticStop(h, xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 1), null))
    }
    const index = createStopIndex()
    appendStops(index, stops.slice(0, 3000))
    expect(serializeIndex(index)).toBeNull()
    mergeAll(index)
    appendStops(index, stops.slice(3000))
    expect(mergeStep(index, 0)).toBe(false)
    expect(serializeIndex(index)).toBeNull()
    mergeAll(index)
    expect(serializeIndex(index)).not.toBeNull()
  })

  it('rejects malformed snapshots outright, leaving the target untouched', () => {
    const { index } = buildSample()
    const snap = serializeIndex(index)
    if (snap === null) throw new Error('expected a snapshot from a merged index')

    // A non-empty target must refuse: adopting over existing rows would
    // duplicate heights behind byHeight's back.
    const occupied = createStopIndex()
    const rng = mulberry32(19)
    appendStops(occupied, [syntheticStop(0, xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 1), null)])
    expect(adoptSnapshot(occupied, snap)).toBe(false)

    // A permutation with a duplicated entry (so another row is skipped).
    const dupPerm = snap.perm.slice(0)
    const dupView = new Uint32Array(dupPerm)
    dupView[1] = dupView[0]

    const cases: unknown[] = [
      null,
      42,
      { ...snap, version: 2 },
      { ...snap, count: snap.count + 1 },
      { ...snap, count: snap.count - 1 },
      { ...snap, keys: snap.keys.slice(0, snap.keys.byteLength - 1) },
      { ...snap, heights: snap.heights.slice(0, snap.heights.byteLength - 4) },
      { ...snap, perm: snap.coords },
      { ...snap, perm: dupPerm },
      { ...snap, maxHeight: snap.maxHeight + 1 },
    ]
    for (const bad of cases) {
      const fresh = createStopIndex()
      expect(adoptSnapshot(fresh, bad)).toBe(false)
      // The failed adopt mutated nothing: the same target still accepts the
      // good snapshot afterwards.
      expect(fresh.size).toBe(0)
      expect(adoptSnapshot(fresh, snap)).toBe(true)
      expect(fresh.size).toBe(index.size)
    }
  })
})
