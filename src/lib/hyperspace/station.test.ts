/**
 * What would fail silently without these tests: a wrong shift in the prefix
 * search would return a plausible-but-wrong station, the traveler's hyperjump
 * would verify locally and be rejected by everyone else, and nothing in the UI
 * would look broken. The brute-force cross-check is the guard.
 */
import { describe, expect, it } from 'vitest'
import { xyzToCoord } from 'cyberspace-core'
import { buildIndex, findStation, insertStop, maxAxisLca, maxAxisLcaViaAxes, nearestStops } from './station'
import type { Stop } from './stops'

function rand85(rng: () => number): bigint {
  let v = 0n
  for (let i = 0; i < 6; i++) v = (v << 16n) | BigInt(Math.floor(rng() * 65536))
  return v & ((1n << 85n) - 1n)
}

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

function syntheticStop(height: number, coord: bigint): Stop {
  return {
    height,
    kind: 'port',
    merkleRoot: coord.toString(16).padStart(64, '0'),
    blockHash: null,
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

describe('maxAxisLca', () => {
  it('agrees with the per-axis definition on random pairs', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 200; i++) {
      const a = xyzToCoord(rand85(rng), rand85(rng), rand85(rng), Math.random() < 0.5 ? 0 : 1)
      const b = xyzToCoord(rand85(rng), rand85(rng), rand85(rng), Math.random() < 0.5 ? 0 : 1)
      expect(maxAxisLca(a, b)).toBe(maxAxisLcaViaAxes(a, b))
    }
  })

  it('ignores the plane bit', () => {
    const a = xyzToCoord(5n, 6n, 7n, 0)
    const b = xyzToCoord(5n, 6n, 7n, 1)
    expect(maxAxisLca(a, b)).toBe(0)
  })
})

describe('findStation', () => {
  it('matches brute force over random stop sets, including height bounds and ties', () => {
    const rng = mulberry32(42)
    const stops: Stop[] = []
    for (let h = 0; h < 300; h++) {
      stops.push(syntheticStop(h, xyzToCoord(rand85(rng), rand85(rng), rand85(rng), h % 2 === 0 ? 0 : 1)))
    }
    // A deliberate tie: two stops at the same coordinate, different heights.
    stops.push(syntheticStop(500, stops[10].coordExact as bigint))
    const index = buildIndex(stops)
    for (let trial = 0; trial < 60; trial++) {
      const q = xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 0)
      const maxHeight = trial % 3 === 0 ? 50 : 10_000
      const got = findStation(index, q, maxHeight)
      const want = bruteStation(stops, q, maxHeight)
      expect(got?.stop.height).toBe(want?.height)
      expect(got?.distance).toBe(want?.distance)
    }
    // Query at the tied coordinate: the lower height must win.
    const tied = findStation(index, stops[10].coordExact as bigint, 10_000)
    expect(tied?.stop.height).toBe(10)
    expect(tied?.distance).toBe(0)
  })

  it('honours the destination-height bound even when nearer newer stops exist', () => {
    const rng = mulberry32(9)
    const q = xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 0)
    const near = syntheticStop(900, q ^ 2n) // one interleaved bit away
    const far = syntheticStop(3, xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 0))
    const index = buildIndex([near, far])
    expect(findStation(index, q, 10_000)?.stop.height).toBe(900)
    expect(findStation(index, q, 100)?.stop.height).toBe(3)
    expect(findStation(index, q, 1)).toBeNull()
  })

  it('insertStop keeps the index sorted and searchable', () => {
    const rng = mulberry32(11)
    const index = buildIndex([])
    const stops: Stop[] = []
    for (let h = 0; h < 50; h++) {
      const s = syntheticStop(h, xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 0))
      stops.push(s)
      insertStop(index, s)
    }
    for (let i = 1; i < index.keys.length; i++) {
      expect(index.keys[i] >= index.keys[i - 1]).toBe(true)
    }
    const q = xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 0)
    expect(findStation(index, q, 10_000)?.stop.height).toBe(bruteStation(stops, q, 10_000)?.height)
  })

  it('nearestStops returns k results sorted by prefix distance', () => {
    const rng = mulberry32(23)
    const stops: Stop[] = []
    for (let h = 0; h < 100; h++) {
      stops.push(syntheticStop(h, xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 0)))
    }
    const index = buildIndex(stops)
    const q = xyzToCoord(rand85(rng), rand85(rng), rand85(rng), 0)
    const got = nearestStops(index, q, 5)
    expect(got.length).toBe(5)
    const all = stops.map((s) => maxAxisLca(q, s.coordExact as bigint)).sort((a, b) => a - b)
    expect(got[0].distance).toBe(all[0])
  })
})
