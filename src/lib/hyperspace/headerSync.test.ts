/**
 * What would fail silently without these tests: a lax manifest parser would
 * let a malformed or hostile manifest describe overlapping or misaligned
 * blobs, and the worker's per-blob height arithmetic (row r = startHeight +
 * r) would then file every stop under the wrong block. The parser is the
 * gate that makes those invariants safe to assume everywhere downstream.
 */
import { describe, expect, it } from 'vitest'
import { HEADERS_MANIFEST_URL, blobUrl, manifestUrl, overlapsCovered, parseManifest, shouldSkipBlob } from './headerSync'

const good = () => ({
  formatVersion: 1,
  network: 'mainnet',
  blobSize: 50000,
  generatedAtHeight: 964321,
  blobs: [
    { ordinal: 0, startHeight: 0, count: 50000, sha256: 'a'.repeat(64), file: 'headers-000.bin' },
    { ordinal: 1, startHeight: 50000, count: 14322, sha256: 'b'.repeat(64), file: 'headers-001.bin' },
  ],
  checkpoints: [
    { height: 49999, blockHash: 'c'.repeat(64) },
    { height: 64321, blockHash: 'd'.repeat(64) },
  ],
})

describe('parseManifest', () => {
  it('accepts a well-formed manifest', () => {
    const m = parseManifest(good())
    expect(m).not.toBeNull()
    expect(m?.blobs.length).toBe(2)
    expect(m?.blobs[1].startHeight).toBe(50000)
    expect(m?.checkpoints[0].blockHash).toBe('c'.repeat(64))
  })

  it('rejects the wrong format version or network', () => {
    expect(parseManifest({ ...good(), formatVersion: 2 })).toBeNull()
    expect(parseManifest({ ...good(), network: 'testnet' })).toBeNull()
    expect(parseManifest(null)).toBeNull()
    expect(parseManifest('manifest')).toBeNull()
  })

  it('rejects misaligned or non-contiguous blobs', () => {
    const gap = good()
    gap.blobs[1].ordinal = 2
    expect(parseManifest(gap)).toBeNull()
    const misaligned = good()
    misaligned.blobs[1].startHeight = 50001
    expect(parseManifest(misaligned)).toBeNull()
  })

  it('rejects impossible counts, and partial blobs before the last', () => {
    const zero = good()
    zero.blobs[0].count = 0
    expect(parseManifest(zero)).toBeNull()
    const oversized = good()
    oversized.blobs[0].count = 50001
    expect(parseManifest(oversized)).toBeNull()
    const partialFirst = good()
    partialFirst.blobs[0].count = 49999
    expect(parseManifest(partialFirst)).toBeNull()
  })

  it('rejects malformed digests and checkpoints', () => {
    const badSha = good()
    badSha.blobs[0].sha256 = 'xyz'
    expect(parseManifest(badSha)).toBeNull()
    const badCp = good()
    badCp.checkpoints[0].blockHash = 'C'.repeat(64) // uppercase is out of spec
    expect(parseManifest(badCp)).toBeNull()
  })
})

describe('URL plumbing', () => {
  it('defaults to the release manifest URL when no override exists', () => {
    // Under node there is no localStorage, which is exactly the guarded path.
    expect(manifestUrl()).toBe(HEADERS_MANIFEST_URL)
  })

  it('resolves blob files relative to the manifest', () => {
    expect(blobUrl('https://example.com/x/manifest.json', 'headers-000.bin'))
      .toBe('https://example.com/x/headers-000.bin')
    expect(blobUrl('https://example.com/x/manifest.json', 'https://cdn.example.com/h.bin'))
      .toBe('https://cdn.example.com/h.bin')
  })
})

describe('skipping blobs the cache already holds', () => {
  const blob = (startHeight: number, count: number) => ({ ordinal: 0, startHeight, count, sha256: 'a'.repeat(64), file: 'x.bin' })

  it('overlapsCovered sees touching ranges and misses disjoint ones', () => {
    const covered: Array<[number, number]> = [[0, 999], [5000, 5999]]
    expect(overlapsCovered(covered, [1000, 1999])).toBe(false)
    expect(overlapsCovered(covered, [999, 1999])).toBe(true)
    expect(overlapsCovered(covered, [4000, 5000])).toBe(true)
    expect(overlapsCovered(covered, [6000, 7000])).toBe(false)
    expect(overlapsCovered([], [0, 10])).toBe(false)
  })

  it('a blob fully inside the cache is skipped', () => {
    expect(shouldSkipBlob(blob(0, 1000), [[0, 9999]])).toBe(true)
  })

  it('a blob the cache has no height of is verified', () => {
    expect(shouldSkipBlob(blob(10000, 1000), [[0, 9999]])).toBe(false)
  })

  it('a blob the cache holds only part of is skipped whole, for the relay to finish', () => {
    expect(shouldSkipBlob(blob(9500, 1000), [[0, 9999]])).toBe(true)
  })

  it('a cold cache skips nothing', () => {
    expect(shouldSkipBlob(blob(0, 1000), [])).toBe(false)
  })
})
