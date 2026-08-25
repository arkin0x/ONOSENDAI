/**
 * What would fail silently: a wrong domain constant, byte order, or padding
 * rule would produce internally consistent proofs that no other implementation
 * accepts. The round-trip test proves prover and verifier agree; the tamper
 * tests prove the verifier is actually looking.
 */
import { describe, expect, it } from 'vitest'
import { bytesToHex, sha256 } from 'cyberspace-core'
import {
  K_LINE,
  SAMPLES,
  buildRideProof,
  computeRideLeaf,
  decodeOpenings,
  encodeOpenings,
  exactRidePairs,
  inclusionPath,
  lineTerrainK,
  merkleDepth,
  merkleLayers,
  rideBlocks,
  rideSeed,
  sampleIndices,
  verifyInclusion,
  verifyRideLevel1,
} from './ride'

const PREV = 'ab'.repeat(32)

/** Deterministic fake block hashes for synthetic chains. */
function fakeHash(height: number): string {
  const bytes = new TextEncoder().encode(`fake-block-${height}`)
  return Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

describe('line terrain and seeds', () => {
  it('K is in [0, 16] and deterministic', () => {
    for (let b = 0; b < 50; b++) {
      const k = lineTerrainK(fakeHash(b))
      expect(k).toBeGreaterThanOrEqual(0)
      expect(k).toBeLessThanOrEqual(16)
      expect(lineTerrainK(fakeHash(b))).toBe(k)
    }
  })

  it('seeds differ per block and per chain position, and fit in 85 bits', () => {
    const a = rideSeed(PREV, 100)
    const b = rideSeed(PREV, 101)
    const c = rideSeed('cd'.repeat(32), 100)
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
    expect(a < 1n << 85n).toBe(true)
  })

  it('leaves are deterministic and bound to the chain position', () => {
    const l1 = computeRideLeaf(PREV, 100, fakeHash(100))
    const l2 = computeRideLeaf(PREV, 100, fakeHash(100))
    const l3 = computeRideLeaf('cd'.repeat(32), 100, fakeHash(100))
    expect(bytesToHex(l1)).toBe(bytesToHex(l2))
    expect(bytesToHex(l1)).not.toBe(bytesToHex(l3))
  })
})

describe('ride geometry', () => {
  it('rideBlocks spans (lo, hi] in either direction', () => {
    expect(rideBlocks(10, 13)).toEqual([11, 12, 13])
    expect(rideBlocks(13, 10)).toEqual([11, 12, 13])
    expect(rideBlocks(7, 7)).toEqual([])
  })

  it('merkleDepth matches padding', () => {
    expect(merkleDepth(1)).toBe(0)
    expect(merkleDepth(2)).toBe(1)
    expect(merkleDepth(3)).toBe(2)
    expect(merkleDepth(5)).toBe(3)
  })
})

describe('merkle and openings', () => {
  it('inclusion paths verify for every leaf, including padded trees', () => {
    const leaves = [0, 1, 2, 3, 4].map((i) => sha256(new Uint8Array([i])))
    const layers = merkleLayers(leaves)
    const root = layers[layers.length - 1][0]
    for (let i = 0; i < leaves.length; i++) {
      const path = inclusionPath(layers, i)
      expect(verifyInclusion(leaves[i], i, path, root)).toBe(true)
      expect(verifyInclusion(leaves[i], i ^ 1, path, root)).toBe(false)
    }
  })

  it('openings encode/decode round-trips', () => {
    const leaves = [0, 1, 2, 3].map((i) => sha256(new Uint8Array([i])))
    const layers = merkleLayers(leaves)
    const paths = [0, 2].map((i) => inclusionPath(layers, i))
    const mp = encodeOpenings(paths)
    const back = decodeOpenings(mp, 2)
    expect(back).not.toBeNull()
    expect(encodeOpenings(back as Uint8Array[][])).toBe(mp)
    expect(decodeOpenings(mp, 3)).toBeNull()
  })

  it('sample indices are deterministic and in range', () => {
    const root = sha256(new Uint8Array([9]))
    const idx = sampleIndices(root, 7)
    expect(idx.length).toBe(SAMPLES)
    for (const i of idx) {
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(7)
    }
    expect(sampleIndices(root, 7)).toEqual(idx)
  })
})

describe('full ride round trip (prover and verifier agree)', () => {
  it('a synthetic 5-block ride proves and verifies at Level 1', async () => {
    const blocks = rideBlocks(100, 105)
    const leaves = blocks.map((b) => computeRideLeaf(PREV, b, fakeHash(b)))
    const proof = buildRideProof(leaves)
    const result = await verifyRideLevel1({
      previousEventIdHex: PREV,
      fromHeight: 100,
      toHeight: 105,
      rootHex: proof.rootHex,
      mp: proof.mp,
      blockHashFor: (h) => fakeHash(h),
    })
    expect(result.reason).toBeNull()
    expect(result.ok).toBe(true)
    expect(result.checked).toBe(SAMPLES)
  })

  it('rejects a proof built under a different chain position', async () => {
    const blocks = rideBlocks(100, 105)
    const leaves = blocks.map((b) => computeRideLeaf('cd'.repeat(32), b, fakeHash(b)))
    const proof = buildRideProof(leaves)
    const result = await verifyRideLevel1({
      previousEventIdHex: PREV,
      fromHeight: 100,
      toHeight: 105,
      rootHex: proof.rootHex,
      mp: proof.mp,
      blockHashFor: (h) => fakeHash(h),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a tampered opening', async () => {
    const blocks = rideBlocks(200, 203)
    const leaves = blocks.map((b) => computeRideLeaf(PREV, b, fakeHash(b)))
    const proof = buildRideProof(leaves)
    const tampered = proof.mp.replace(/^../, proof.mp.startsWith('00') ? '11' : '00')
    const result = await verifyRideLevel1({
      previousEventIdHex: PREV,
      fromHeight: 200,
      toHeight: 203,
      rootHex: proof.rootHex,
      mp: tampered,
      blockHashFor: (h) => fakeHash(h),
    })
    expect(result.ok).toBe(false)
  })

  it('accepts only the zero root for a zero-length ride', async () => {
    const proof = buildRideProof([])
    expect(proof.rootHex).toBe('0'.repeat(64))
    const ok = await verifyRideLevel1({
      previousEventIdHex: PREV,
      fromHeight: 7,
      toHeight: 7,
      rootHex: proof.rootHex,
      mp: '',
      blockHashFor: (h) => fakeHash(h),
    })
    expect(ok.ok).toBe(true)
    const bad = await verifyRideLevel1({
      previousEventIdHex: PREV,
      fromHeight: 7,
      toHeight: 7,
      rootHex: 'ab'.repeat(32),
      mp: '',
      blockHashFor: (h) => fakeHash(h),
    })
    expect(bad.ok).toBe(false)
  })
})

describe('cost estimates', () => {
  it('exactRidePairs sums 2^(K + K_LINE)', () => {
    const hashes = [fakeHash(1), fakeHash(2)]
    const expected = hashes.reduce((acc, h) => acc + 2 ** (lineTerrainK(h) + K_LINE), 0)
    expect(exactRidePairs(hashes)).toBe(expected)
  })
})

import { rideVisualHeight } from './ride'

describe('rideVisualHeight', () => {
  it('walks the line in order, both directions, and clamps at the ends', () => {
    expect(rideVisualHeight(10, 15, 0, 5)).toBe(10)
    expect(rideVisualHeight(10, 15, 3, 5)).toBe(13)
    expect(rideVisualHeight(10, 15, 5, 5)).toBe(15)
    expect(rideVisualHeight(15, 10, 2, 5)).toBe(13)
    expect(rideVisualHeight(15, 10, 5, 5)).toBe(10)
    // A zero-length ride is already at the destination.
    expect(rideVisualHeight(7, 7, 0, 0)).toBe(7)
    // A stray count can never walk past the destination.
    expect(rideVisualHeight(10, 15, 9, 5)).toBe(15)
    expect(rideVisualHeight(10, 15, -1, 5)).toBe(10)
  })
})
