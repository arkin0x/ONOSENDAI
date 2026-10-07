/**
 * What would fail silently: a wrong domain constant, byte order, or padding
 * rule would produce internally consistent proofs that no other implementation
 * accepts. The round-trip test proves prover and verifier agree; the tamper
 * tests prove the verifier is actually looking.
 */
import { describe, expect, it } from 'vitest'
import type { ActionEvent } from '../../events'
import { bytesToHex, hexToBytes, sha256 } from 'cyberspace-core'
import { CALIBRATION_KS, K_LINE, SAMPLES, ZERO_NONCE_HEX, attemptsRequired, be32, be64, buildRideProof, calibrationHashes, computeRideLeaf, decodeNonce, decodeOpenings, encodeNonce, encodeOpenings, exactRidePairs, expectedPricePairs, grindAttempt, inclusionPath, isGrandfatheredV1Hyperjump, lineTerrainK, meetsPrice, merkleDepth, merkleLayers, rideBlocks, rideSeed, sampleIndices, timeCalibrationSample, verifyInclusion, verifyRideLevel1, lineStateOf, rideStatsOf } from '../ride'
import { GRANDFATHERED_V1_HYPERJUMPS, GRANDFATHERED_V1_HYPERJUMPS_SOURCE } from '../grandfathered'

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
    const proof = buildRideProof(PREV, leaves)
    const result = await verifyRideLevel1({
      previousEventIdHex: PREV,
      fromHeight: 100,
      toHeight: 105,
      rootHex: proof.rootHex,
      mp: proof.mp,
      mn: proof.mnHex,
      blockHashFor: (h) => fakeHash(h),
    })
    expect(result.reason).toBeNull()
    expect(result.ok).toBe(true)
    expect(result.checked).toBe(SAMPLES)
    expect(result.grandfathered).toBe(false)
  })

  it('rejects a proof built under a different chain position', async () => {
    const blocks = rideBlocks(100, 105)
    const leaves = blocks.map((b) => computeRideLeaf('cd'.repeat(32), b, fakeHash(b)))
    const proof = buildRideProof('cd'.repeat(32), leaves)
    const result = await verifyRideLevel1({
      previousEventIdHex: PREV,
      fromHeight: 100,
      toHeight: 105,
      rootHex: proof.rootHex,
      mp: proof.mp,
      mn: proof.mnHex,
      blockHashFor: (h) => fakeHash(h),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a tampered opening', async () => {
    const blocks = rideBlocks(200, 203)
    const leaves = blocks.map((b) => computeRideLeaf(PREV, b, fakeHash(b)))
    const proof = buildRideProof(PREV, leaves)
    const tampered = proof.mp.replace(/^../, proof.mp.startsWith('00') ? '11' : '00')
    const result = await verifyRideLevel1({
      previousEventIdHex: PREV,
      fromHeight: 200,
      toHeight: 203,
      rootHex: proof.rootHex,
      mp: tampered,
      mn: proof.mnHex,
      blockHashFor: (h) => fakeHash(h),
    })
    expect(result.ok).toBe(false)
  })

  it('a zero-length ride carries the zero root, an all-zero mn and nothing else', async () => {
    const proof = buildRideProof(PREV, [])
    expect(proof).toEqual({ rootHex: '0'.repeat(64), mp: '', mnHex: ZERO_NONCE_HEX })
    const verify = (rootHex: string, mn: string | null) => verifyRideLevel1({
      previousEventIdHex: PREV, fromHeight: 7, toHeight: 7, rootHex, mp: '', mn, blockHashFor: (h) => fakeHash(h),
    })
    expect((await verify(proof.rootHex, proof.mnHex)).ok).toBe(true)
    expect((await verify('ab'.repeat(32), proof.mnHex)).ok).toBe(false)
    expect((await verify(proof.rootHex, '0000000000000001')).ok).toBe(false)
    // Without an mn it is an old-format ride, and this one is not listed.
    expect((await verify(proof.rootHex, null)).ok).toBe(false)
  })
})

/**
 * DECK-0001 decks/hyperjump-reference.py at cyberspace 7f724d5. Its block
 * hashes are synthetic: for each height the first of
 * sha256("CYBERSPACE_TEST_BLOCK" || be64(b) || be32(j)), j = 0, 1, ..., whose
 * ride height K + 6 is at most 10, so every leaf is cheap.
 */
function syntheticBlockHash(b: number): string {
  const domain = new TextEncoder().encode('CYBERSPACE_TEST_BLOCK')
  for (let j = 0; ; j++) {
    const hex = bytesToHex(sha256(new Uint8Array([...domain, ...be64(b), ...be32(j)])))
    if (lineTerrainK(hex) + K_LINE <= 10) return hex
  }
}

const ZERO = '00'.repeat(32)
const RANGE_32 = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('')

describe('ride openings version 2: golden vectors', () => {
  it('the synthetic block hash and one leaf', () => {
    expect(syntheticBlockHash(900001)).toBe('4cc35fd75b8cbdea8bb92adb8ff97f54413dc0af8240fed67d81058ee234b678')
    expect(bytesToHex(computeRideLeaf(ZERO, 900001, syntheticBlockHash(900001))))
      .toBe('ffde7ee869b9b0c4a780f2ac0f481e257070e96294e0a5ead72486857f24633a')
  })

  it('one attempt: grind_attempt(zero, zero_root, 0)', () => {
    expect(bytesToHex(grindAttempt(ZERO, new Uint8Array(32), 0n)))
      .toBe('4bac0e5bb9c3bd5058732e2715457c036f87144879e923cdd2a54eab31303707')
  })

  it('a 40-block ride: root, nonce, G and first sample, and it passes Level 1', async () => {
    const blocks = rideBlocks(900000, 900040)
    const leaves = blocks.map((b) => computeRideLeaf(ZERO, b, syntheticBlockHash(b)))
    const proof = buildRideProof(ZERO, leaves)
    expect(proof.rootHex).toBe('83187e3a539d79fa9d218843f37d25912b9fb7fbe3d198948d74063e0193a8f3')
    expect(proof.mnHex).toBe('0000000000000000')
    const G = grindAttempt(ZERO, hexToBytes(proof.rootHex), 0n)
    expect(bytesToHex(G)).toBe('1ba2e1b836822a7d2263d6e4d83df1d6eb9b70cfa6f77c29ff79d4c09926b08e')
    expect(sampleIndices(G, 40)[0]).toBe(21)
    expect(attemptsRequired(40)).toBe(2)

    const verify = (over: { mp?: string; mn?: string | null; previousEventIdHex?: string }) => verifyRideLevel1({
      previousEventIdHex: ZERO, fromHeight: 900000, toHeight: 900040, rootHex: proof.rootHex, mp: proof.mp, mn: proof.mnHex,
      blockHashFor: syntheticBlockHash, ...over,
    })
    expect(await verify({})).toEqual({ ok: true, checked: SAMPLES, reason: null, grandfathered: false })

    // A nonce that misses the price: G for nonce 2 is above 2^255 and A is 2.
    expect(meetsPrice(grindAttempt(ZERO, hexToBytes(proof.rootHex), 2n), 2)).toBe(false)
    expect((await verify({ mn: '0000000000000002' })).reason).toBe('the mn nonce does not meet the price')

    // Version 1 openings (samples drawn from the root) do not pass under G.
    const layers = merkleLayers(leaves)
    const v1Domain = new TextEncoder().encode('CYBERSPACE_HYPERSPACE_SAMPLE_V1')
    const v1 = Array.from({ length: SAMPLES }, (_, i) => {
      const d = sha256(new Uint8Array([...v1Domain, ...hexToBytes(proof.rootHex), ...be32(i)]))
      return Number(BigInt('0x' + bytesToHex(d)) % 40n)
    })
    expect((await verify({ mp: encodeOpenings(v1.map((i) => inclusionPath(layers, i))) })).ok).toBe(false)

    // Bound to its chain position: the same proof under another previous fails.
    expect((await verify({ previousEventIdHex: RANGE_32 })).ok).toBe(false)
    // Malformed or missing mn.
    expect((await verify({ mn: '00' })).reason).toBe('malformed mn')
    expect((await verify({ mn: null })).ok).toBe(false)
  })

  it('a 1-block ride under bytes(0..31)', () => {
    const leaf = computeRideLeaf(RANGE_32, 900001, syntheticBlockHash(900001))
    const proof = buildRideProof(RANGE_32, [leaf])
    expect(proof.rootHex).toBe('20ef123bafc81ad21a14ffc1d5ffe3be7481ff142a60c5021c0875ac6d2953f0')
    expect(proof.mnHex).toBe('0000000000000000')
    const G = grindAttempt(RANGE_32, hexToBytes(proof.rootHex), 0n)
    expect(bytesToHex(G)).toBe('e1a04954bdc47c37af1eee22123da22faa2716529b1199fc2e91a9682197ef5f')
    expect(sampleIndices(G, 1)[0]).toBe(0)
  })

  it('the mn tag is 16 lowercase hex, big-endian', () => {
    expect(encodeNonce(0n)).toBe(ZERO_NONCE_HEX)
    expect(encodeNonce(0x1234n)).toBe('0000000000001234')
    expect(encodeNonce((1n << 64n) - 1n)).toBe('ffffffffffffffff')
    expect(() => encodeNonce(1n << 64n)).toThrow()
    expect(decodeNonce('0000000000001234')).toBe(0x1234n)
    expect(decodeNonce('000000000000123')).toBeNull()
    expect(decodeNonce('000000000000123A')).toBeNull()
  })

  it('the price is about one thirty-second of the ride, and nothing for a zero-length one', () => {
    expect(attemptsRequired(0)).toBe(1)
    expect(attemptsRequired(32)).toBe(1)
    expect(attemptsRequired(33)).toBe(2)
    expect(attemptsRequired(320_000)).toBe(10_000)
    expect(expectedPricePairs(0)).toBe(0)
    expect(expectedPricePairs(320_000)).toBe(10_000 * 2 ** 16)
  })
})

describe('rides from before the re-roll price (§5.8)', () => {
  const listed = '43628b3880fb004f3f1236f298152fd093e3e0f3740fb4029b9ed9716249ae5c'
  const input = {
    previousEventIdHex: PREV, fromHeight: 363971, toHeight: 363734, rootHex: 'ab'.repeat(32), mp: 'not openings',
    blockHashFor: (): string => { throw new Error('a listed ride is not recomputed') },
  }

  it('a listed ride without mn is accepted without re-checking its root or openings', async () => {
    expect(await verifyRideLevel1({ ...input, eventId: listed, mn: null }))
      .toEqual({ ok: true, checked: 0, reason: null, grandfathered: true })
  })

  it('an unlisted ride without mn is invalid', async () => {
    const r = await verifyRideLevel1({ ...input, eventId: 'ee'.repeat(32), mn: null })
    expect(r.ok).toBe(false)
    expect(r.grandfathered).toBe(false)
    expect((await verifyRideLevel1({ ...input, mn: null })).ok).toBe(false)
  })

  it('a listed id that carries an mn is checked like any other ride', async () => {
    expect((await verifyRideLevel1({ ...input, eventId: listed, mn: ZERO_NONCE_HEX, blockHashFor: fakeHash })).ok).toBe(false)
  })

  it('embeds the 16 ids of decks/grandfathered-v1-hyperjumps.txt with their source commit', () => {
    expect(GRANDFATHERED_V1_HYPERJUMPS.size).toBe(16)
    for (const id of GRANDFATHERED_V1_HYPERJUMPS) expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(GRANDFATHERED_V1_HYPERJUMPS_SOURCE).toMatch(/^[0-9a-f]{40}$/)
    expect(isGrandfatheredV1Hyperjump(listed)).toBe(true)
    expect(isGrandfatheredV1Hyperjump(undefined)).toBe(false)
  })
})

/**
 * Real rides from the relay, recomputed from Bitcoin's block hashes. A Level 2
 * audit on 2026-09-28 reported seven published rides whose roots did not match
 * and blamed this client for computing leaves from wrong (byte-reversed) block
 * hashes. It was the audit: it keyed recomputed leaves by height alone, so
 * rides over the same heights overwrote each other's leaves. Recomputed per
 * ride, every leaf of all seven matches and every root is exact. These are
 * sampled openings from three of them, each leaf rebuilt here from the block
 * hash in display order (as explorers and kind-321 anchors print it) and
 * carried up its published path to the published root. A byte-order or seed
 * regression in computeRideLeaf fails this.
 */
const PUBLISHED_OPENINGS = [
  {
    event: '43628b3880fb004f3f1236f298152fd093e3e0f3740fb4029b9ed9716249ae5c',
    previous: '9a542c89185f096f20ef7cb2c235d72f3a617b6e72d2fc39facb7d9429d327a9',
    root: '3d5ad294710aceb2a05529534252df3ecdc51a74d74923982040500bfbfbb21d',
    height: 363896,
    index: 161,
    blockHash: '00000000000000000ee9da2d6b75cbeb876ec5edea0cf4758519b1b0cac6c916',
    path: [
      '741a73c6bb520bb157937d184d586504f8186414b9dcb95959c87aeaba1bb139',
      '8431914d2134041580e5b03fd624cb96f10153c06541a6ad7d2fe1b09f63a7f5',
      'a4f068d6d5838072f16cdcd8c778963e8741f66dd1d7c8a24821c7138e1e54a4',
      'f6871244267b64e9240f6597052e9847959f84f626ba9ddd6618773f2043ea65',
      'b11a042c22cb32e2876e4607ea958505020b08cc6210b4074f9e7e357324a9c2',
      '677cd384dbf9fd26a27291b7d0b47513190cf96b966c94e79dd9d66912b7076f',
      '5d2dc97bbdc0a7609da1755b09d56869b3f3c46e752a107eb808fc8039cacf64',
      '59e58ed0221eabdd776875ace250af9fb00c0ceaa852626c6742eed093ae5803',
    ],
  },
  {
    event: '5222e768c6d6a2583b839bb94db9d4170573974dff6263f969dbe12ce4b62afd',
    previous: '11b587c54e034d6a45fad85102a9ccee7c63adee083d2e83c1244e608afe6dc5',
    root: 'c04d15060424e65945b1fd01cad1ec5762034c1af3899d92ef9f6f2bba9927bc',
    height: 146240,
    index: 89,
    blockHash: '0000000000000546ab1a679dce0543a4b30f1d69249e87ef8509274f7f85ba43',
    path: [
      '2dba055054f68095adac6e596678248de7c1fd065a4f098136a505092049f8e5',
      '965fadc63350379960b2338a58d04049a360dd75dd68eaafdc3371c52e4f817f',
      'b1322e55f7dd315dd88619cb1cba173d99298074f562d3d50db5b496d634d2f3',
      '6a23777c624103fa6febd25f530d7674ddc4d47bcdfab1e3d0d3413bdef2caf4',
      '689ce512e309f16ca2eff2b8da31446540dfe5a50cd5d70a2e2db6725c1db30e',
      'ffbca407116e5e82d195efd04718c7bcd3976eb656735a2dd96e89920b9e1e2b',
      '403e66a37dbcd2a1deb4ceac285460c975e8a98104394095a5707130828b0b12',
      '7ceb578082dcf1eba542a7e8614bf65af502c26d14ce6d11f3569de7fe85afa0',
      '4374cbdf6abcb03cf8be5f9dd2b9e85ee510d838b287fae1c1217610abb35bb5',
    ],
  },
  {
    event: '6c98e33191f30bccd5882f318326e59126d997f8e4cf2d7986b89f8f6ef411e8',
    previous: '011f772fe6f8121ea86111c73a9728d6613cb0b858bd13c9c85602349e764eba',
    root: '8d97171a9c889dc6378c4ccce8ade223311c44e5fcba48252de4364bd6d39016',
    height: 339035,
    index: 16493,
    blockHash: '000000000000000014f466dd447c06774d53849c6febd1d1fd7ace0213b78a92',
    path: [
      '18806973a4b2357900851b0fdcd06cb47b84d6c058cfcbeaa4147eb3562c3ddf',
      '1e63eeaddad40811b1b85cb4d3c185580445603f719c28e8ed9f58a0331d7579',
      'ce945ee3faf15c935a6e4580361468985a69a810b6a7d65d93341288a3fbd9b5',
      '5e14025920240aaac8b55ae99dfa013be32c8ad1606277ad611dd3546a238268',
      'c9c5f6095ef818cef0c3f2da9b250c25b44845c6fd5e45b594994f4364b0fb50',
      '72a6c00f7b541863b3fd08817a1af9542afc51e52cca944189f38dbc5c31f887',
      'bb3abe1b05c0f4ae8ade4cd2f25743630da7b79514434728fe46e7c43214a5b0',
      'bc826624850d6010da5c0dcd45dd6b314b0dd6e5e278a61146c4a3b2f3fadbca',
      '34418d163f40f24c57537c39892a21741f4fe5c01fdde4def9da0ef2fef1ddc9',
      'fac82d6e3ae85ccc12322800feb02fb8a4aaa671786d964342e6d89b03aed224',
      'b05c5b83242b6bae7476bbc10fffec9689bb782ebd97cbdf325bf61ec5a9fe80',
      '0142f42568493d19c2934da98cc0ecbf0f4447f6bb9d9c9e5eb3f793aa40900d',
      'd250b7bf406a6f8f0cfc5920fde6467b1cee7fe3289c957f1a39d0ea0893daf5',
      '1265dab003ed03121aeac838ad2d19ada16724a32ccc18659a530abcc15b0e99',
      '1fc3d11f9a0f73f7c471215475238dc8445daec8d851df1d4d1cf69af26c003c',
      '1dd2817c67d184d0bbf06aefb0aa5825ac434d25548de1d55149aa3b5759d0e5',
    ],
  },
]

describe('published rides recompute exactly from display-order block hashes', () => {
  for (const o of PUBLISHED_OPENINGS) {
    it(`${o.event.slice(0, 10)} block ${o.height}`, () => {
      const leaf = computeRideLeaf(o.previous, o.height, o.blockHash)
      expect(verifyInclusion(leaf, o.index, o.path.map(hexToBytes), hexToBytes(o.root))).toBe(true)
      // The internal (byte-reversed) order is a different block to the line.
      const reversed = o.blockHash.match(/../g)!.reverse().join('')
      if (lineTerrainK(reversed) !== lineTerrainK(o.blockHash)) {
        expect(verifyInclusion(computeRideLeaf(o.previous, o.height, reversed), o.index, o.path.map(hexToBytes), hexToBytes(o.root))).toBe(false)
      }
    })
  }
})

describe('cost estimates', () => {
  it('exactRidePairs sums 2^(K + K_LINE)', () => {
    const hashes = [fakeHash(1), fakeHash(2)]
    const expected = hashes.reduce((acc, h) => acc + 2 ** (lineTerrainK(h) + K_LINE), 0)
    expect(exactRidePairs(hashes)).toBe(expected)
  })
})

import { rideVisualHeight } from '../ride'

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

import { rideTrail } from '../ride'

describe('rideTrail', () => {
  it('is oldest-first with the head last, capped, in both directions', () => {
    expect(rideTrail(10, 15, 3, 5, 100)).toEqual([10, 11, 12, 13])
    expect(rideTrail(15, 10, 3, 5, 100)).toEqual([15, 14, 13, 12])
    expect(rideTrail(10, 15, 3, 5, 2)).toEqual([12, 13])
    expect(rideTrail(10, 15, 0, 5, 100)).toEqual([10])
    expect(rideTrail(7, 7, 0, 0, 100)).toEqual([7])
  })
})

describe('calibration sample', () => {
  it('is one block per calibration K, in K order, and deterministic', () => {
    const hashes = calibrationHashes()
    expect(hashes.map(lineTerrainK)).toEqual(CALIBRATION_KS)
    expect(calibrationHashes()).toEqual(hashes)
  })
  it('times the sample and reports its exact pairings', () => {
    const { elapsedMs, pairs } = timeCalibrationSample()
    expect(elapsedMs).toBeGreaterThan(0)
    expect(pairs).toBe(exactRidePairs(calibrationHashes()))
  })
})

describe('lineStateOf: what the chain head says about the line', () => {
  const action = (over: Partial<ActionEvent>): ActionEvent => ({
    id: 'e'.repeat(64), pubkey: 'p'.repeat(64), createdAt: 1, type: 'hop', name: 'hop', role: 'base', coordHex: 'c'.repeat(64),
    position: { x: 0n, y: 0n, z: 0n }, plane: 0, prevCoordHex: null, genesisId: null, previousId: null, proofHash: null, sector: '0-0-0',
    ...over,
  })

  it('is nothing with no chain, and nothing after a hop', () => {
    expect(lineStateOf([])).toBeNull()
    expect(lineStateOf([action({ type: 'spawn' }), action({ type: 'hop', id: 'h'.repeat(64) })])).toBeNull()
  })

  it('an enter-hyperspace head is boarded, with the station still to decide the start', () => {
    const s = lineStateOf([action({ type: 'spawn' }), action({ type: 'enter-hyperspace', id: 'a'.repeat(64), coordHex: 'b'.repeat(64) })])
    expect(s).toEqual({ previousId: 'a'.repeat(64), coordHex: 'b'.repeat(64), fromHeight: null })
  })

  it('a hyperjump head stands at its stop: the next ride starts from B and chains from it', () => {
    const s = lineStateOf([action({ type: 'enter-hyperspace' }), action({ type: 'hyperjump', id: 'j'.repeat(64), coordHex: 'd'.repeat(64), fromHeight: 100, toHeight: 398 })])
    expect(s).toEqual({ previousId: 'j'.repeat(64), coordHex: 'd'.repeat(64), fromHeight: 398 })
  })

  it('a hop after a hyperjump leaves the line', () => {
    expect(lineStateOf([action({ type: 'hyperjump', toHeight: 398 }), action({ type: 'hop' })])).toBeNull()
  })

  // Spec §8.9 rule 4 and §8.11.4 rule 8: the rule looks back through a
  // skipped action and a closed bracket; the work is still seeded by the
  // actual last event, which is the next ride's `previous`.
  const jump = action({ type: 'hyperjump', id: 'j'.repeat(64), coordHex: 'd'.repeat(64), toHeight: 398 })
  const enter = action({ type: 'enter-virtual', role: 'enter', id: 'v'.repeat(64), bracketId: 'v'.repeat(64), coordHex: 'd'.repeat(64) })
  const exit = action({ type: 'exit-virtual', role: 'exit', id: 'x'.repeat(64), bracketId: 'v'.repeat(64), coordHex: 'd'.repeat(64) })
  const skipped = action({ type: 'other', name: 'wave', role: 'skipped', id: 's'.repeat(64), coordHex: 'd'.repeat(64) })

  it('still stands at the stop after an action this client does not recognize', () => {
    expect(lineStateOf([action({ type: 'enter-hyperspace' }), jump, skipped])).toEqual({ previousId: 's'.repeat(64), coordHex: 'd'.repeat(64), fromHeight: 398 })
  })

  it('still stands at the stop after a game entered and left there', () => {
    expect(lineStateOf([action({ type: 'enter-hyperspace' }), jump, enter, exit])).toEqual({ previousId: 'x'.repeat(64), coordHex: 'd'.repeat(64), fromHeight: 398 })
    expect(lineStateOf([action({ type: 'enter-hyperspace' }), jump, enter, exit, skipped])?.previousId).toBe('s'.repeat(64))
  })

  it('is off the line while the game is still open: a ride there would be a base action inside a game', () => {
    const move = action({ type: 'other', name: 'move', role: 'virtual', id: 'm'.repeat(64), bracketId: 'v'.repeat(64) })
    expect(lineStateOf([action({ type: 'enter-hyperspace' }), jump, enter])).toBeNull()
    expect(lineStateOf([action({ type: 'enter-hyperspace' }), jump, enter, move])).toBeNull()
  })
})

describe('rideStatsOf: what the chain has ridden', () => {
  const act = (over: Partial<ActionEvent>): ActionEvent => ({
    id: 'e'.repeat(64), pubkey: 'p'.repeat(64), createdAt: 1, type: 'hop', name: 'hop', role: 'base', coordHex: 'c'.repeat(64),
    position: { x: 0n, y: 0n, z: 0n }, plane: 0, prevCoordHex: null, genesisId: null, previousId: null, proofHash: null, sector: '0-0-0',
    ...over,
  })

  it('is zero with no rides', () => {
    expect(rideStatsOf([act({ type: 'spawn' }), act({ type: 'hop' })])).toEqual({ hyperjumps: 0, blocksRidden: 0 })
  })

  it('counts each hyperjump and the blocks it passed, whichever way it went', () => {
    const chain = [
      act({ type: 'spawn' }),
      act({ type: 'enter-hyperspace' }),
      act({ type: 'hyperjump', fromHeight: 100, toHeight: 398 }),
      act({ type: 'hyperjump', fromHeight: 398, toHeight: 250 }),
      act({ type: 'hop' }),
    ]
    expect(rideStatsOf(chain)).toEqual({ hyperjumps: 2, blocksRidden: 298 + 148 })
  })

  it('a zero-length ride counts as a ride that passed nothing', () => {
    expect(rideStatsOf([act({ type: 'hyperjump', fromHeight: 50, toHeight: 50 })])).toEqual({ hyperjumps: 1, blocksRidden: 0 })
  })
})
