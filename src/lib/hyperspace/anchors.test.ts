/**
 * What would fail silently without these tests: a covered-range merge that
 * drops a range or misses an adjacency would make every reload re-fetch
 * thousands of heights, or worse, believe a hole is covered and never fetch
 * it; a wrong complement or batching would skip heights outright; a dedupe
 * keeping the legacy anchor over the v3 one would pin a landfall to a
 * derived coordinate when the publisher supplied the exact one; and a cache
 * round trip that loses bigint precision would quietly misplace every stop.
 * The UI would look plausible in all of these.
 */
import { describe, expect, it } from 'vitest'
import {
  batchesOf,
  mergeCovered,
  missingRanges,
  pickBetter,
  recordFromStop,
  runsOf,
  stopFromRecord,
  subtractCovered,
  type StopRecord,
} from './anchors'
import type { Stop } from './stops'

describe('mergeCovered', () => {
  it('inserts into an empty list', () => {
    expect(mergeCovered([], [3, 7])).toEqual([[3, 7]])
  })

  it('merges an overlap', () => {
    expect(mergeCovered([[0, 5]], [4, 9])).toEqual([[0, 9]])
  })

  it('merges adjacency: end + 1 touching start is one stretch', () => {
    expect(mergeCovered([[0, 4]], [5, 9])).toEqual([[0, 9]])
    expect(mergeCovered([[5, 9]], [0, 4])).toEqual([[0, 9]])
  })

  it('absorbs a contained range without changing the container', () => {
    expect(mergeCovered([[0, 10]], [3, 5])).toEqual([[0, 10]])
  })

  it('bridges across several existing ranges', () => {
    expect(mergeCovered([[0, 2], [5, 6], [10, 12]], [3, 9])).toEqual([[0, 12]])
  })

  it('keeps disjoint ranges sorted', () => {
    expect(mergeCovered([[10, 12]], [0, 3])).toEqual([[0, 3], [10, 12]])
    expect(mergeCovered([[0, 3]], [10, 12])).toEqual([[0, 3], [10, 12]])
  })

  it('never mutates its inputs', () => {
    const covered: Array<[number, number]> = [[0, 5]]
    mergeCovered(covered, [4, 9])
    expect(covered).toEqual([[0, 5]])
  })
})

describe('subtractCovered', () => {
  it('removes a whole range', () => {
    expect(subtractCovered([[0, 9]], [0, 9])).toEqual([])
    expect(subtractCovered([[3, 5]], [0, 9])).toEqual([])
  })

  it('trims overlaps on either side', () => {
    expect(subtractCovered([[0, 9]], [0, 4])).toEqual([[5, 9]])
    expect(subtractCovered([[0, 9]], [5, 9])).toEqual([[0, 4]])
  })

  it('splits a containing range', () => {
    expect(subtractCovered([[0, 9]], [3, 5])).toEqual([[0, 2], [6, 9]])
  })

  it('leaves disjoint ranges alone and never mutates', () => {
    const covered: Array<[number, number]> = [[0, 2], [10, 12]]
    expect(subtractCovered(covered, [4, 8])).toEqual([[0, 2], [10, 12]])
    expect(covered).toEqual([[0, 2], [10, 12]])
  })

  it('subtracts across several ranges', () => {
    expect(subtractCovered([[0, 2], [4, 6], [8, 10]], [1, 9])).toEqual([[0, 0], [10, 10]])
  })

  it('round-trips with mergeCovered', () => {
    const merged = mergeCovered([[0, 4]], [10, 14])
    expect(subtractCovered(mergeCovered(merged, [5, 9]), [5, 9])).toEqual(merged)
  })
})

describe('missingRanges', () => {
  it('is everything when nothing is covered', () => {
    expect(missingRanges([], 7)).toEqual([[0, 7]])
    expect(missingRanges([], 0)).toEqual([[0, 0]])
  })

  it('is empty when fully covered', () => {
    expect(missingRanges([[0, 3]], 3)).toEqual([])
    expect(missingRanges([[0, 10]], 3)).toEqual([])
  })

  it('finds the holes between and around covered ranges', () => {
    expect(missingRanges([[2, 4], [8, 9]], 12)).toEqual([[0, 1], [5, 7], [10, 12]])
  })

  it('clamps to the tip when coverage starts beyond it', () => {
    expect(missingRanges([[10, 20]], 5)).toEqual([[0, 5]])
  })
})

describe('batchesOf', () => {
  it('chunks one range into batches of at most size', () => {
    expect(batchesOf([[0, 4]], 2)).toEqual([[0, 1], [2, 3], [4]])
  })

  it('fills a batch across disjoint ranges, ascending', () => {
    expect(batchesOf([[0, 1], [5, 6]], 3)).toEqual([[0, 1, 5], [6]])
  })

  it('handles exact multiples and empty input', () => {
    expect(batchesOf([[0, 3]], 2)).toEqual([[0, 1], [2, 3]])
    expect(batchesOf([], 500)).toEqual([])
  })
})

describe('runsOf', () => {
  it('splits an ascending list into contiguous runs', () => {
    expect(runsOf([1, 2, 3, 7, 8, 10])).toEqual([[1, 3], [7, 8], [10, 10]])
    expect(runsOf([])).toEqual([])
    expect(runsOf([4])).toEqual([[4, 4]])
  })
})

describe('pickBetter', () => {
  const legacy = { hasM: false, name: 'legacy' }
  const v3 = { hasM: true, name: 'v3' }

  it('prefers the anchor with an M tag regardless of order', () => {
    expect(pickBetter(legacy, v3)).toBe(v3)
    expect(pickBetter(v3, legacy)).toBe(v3)
  })

  it('keeps the first seen on a tie', () => {
    expect(pickBetter(legacy, { hasM: false, name: 'second' })).toBe(legacy)
    expect(pickBetter(v3, { hasM: true, name: 'second' })).toBe(v3)
  })
})

describe('stop record round trip', () => {
  const hex64 = (last: string): string => '0'.repeat(63) + last

  it('round-trips a landfall through hex without losing bigint precision', () => {
    // High bit and low bit set: any float64 detour would destroy one of them.
    const coord = (1n << 255n) | 1n
    const stop: Stop = {
      height: 900123,
      kind: 'landfall',
      merkleRoot: hex64('2'),
      blockHash: hex64('a'),
      coordExact: null,
      coordApprox: coord,
    }
    const row = recordFromStop(stop)
    expect(row.coordApproxHex).toHaveLength(64)
    const back = stopFromRecord(row)
    expect(back).not.toBeNull()
    expect(back?.coordApprox).toBe(coord)
    // A landfall's exact coordinate is re-derived from the hash, not cached.
    expect(back?.coordExact).toBeNull()
    expect(back?.blockHash).toBe(stop.blockHash)
  })

  it('pads small coordinates to 64 hex chars and restores them', () => {
    const stop: Stop = {
      height: 0,
      kind: 'landfall',
      merkleRoot: hex64('4'),
      blockHash: hex64('b'),
      coordExact: null,
      coordApprox: 5n,
    }
    const row = recordFromStop(stop)
    expect(row.coordApproxHex).toBe(hex64('5'))
    expect(stopFromRecord(row)?.coordApprox).toBe(5n)
  })

  it('restores a port with coordExact equal to coordApprox', () => {
    const coord = (0xabcdefn << 200n) | 0x1234567890n
    const stop: Stop = {
      height: 42,
      kind: 'port',
      merkleRoot: coord.toString(16).padStart(64, '0'),
      blockHash: null,
      coordExact: coord,
      coordApprox: coord,
    }
    const back = stopFromRecord(recordFromStop(stop))
    expect(back?.coordExact).toBe(coord)
    expect(back?.coordApprox).toBe(coord)
  })

  it('rejects corrupt rows instead of trusting the cache', () => {
    const good: StopRecord = {
      height: 7,
      kind: 'landfall',
      merkleRoot: hex64('2'),
      blockHash: hex64('c'),
      coordApproxHex: hex64('9'),
    }
    expect(stopFromRecord(good)).not.toBeNull()
    expect(stopFromRecord({ ...good, height: -1 })).toBeNull()
    expect(stopFromRecord({ ...good, height: 1.5 })).toBeNull()
    expect(stopFromRecord({ ...good, kind: 'weird' as StopRecord['kind'] })).toBeNull()
    expect(stopFromRecord({ ...good, merkleRoot: 'zz' })).toBeNull()
    expect(stopFromRecord({ ...good, coordApproxHex: '0x12' })).toBeNull()
    expect(stopFromRecord({ ...good, blockHash: 'short' })).toBeNull()
  })
})
