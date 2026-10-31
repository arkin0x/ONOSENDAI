/**
 * cloudVerify.test.ts - the verifier against cyberspace-core as the oracle.
 *
 * A remote result is built exactly the way HOSAKA builds one (hop proof
 * version 2 tags flat, the region key as an envelope, hex roots and hex
 * sibling paths for a sidestep) from proofs cyberspace-core computes at small
 * heights, then one field at a time is corrupted. Every corruption must name
 * its check; the untouched result must pass with nothing to say.
 */

import { describe, expect, it } from 'vitest'
import {
  AXIS_BYTE,
  bytesToHex,
  computeAxisMerkleRoot,
  computeHopProof,
  computeHopProofV2,
  computeSidestepProof,
  deriveRegionKeys,
  encodeNonce,
  hexToBytes,
  meetsPrice,
  seedPrefix,
  sha256Hex,
  sidestepAttempts,
  sidestepGrindHash,
  sidestepLanding,
  type Plane,
} from 'cyberspace-core'
import { CLOUD_VERIFY_MAX_HEIGHT, cloudHopShape, cloudVerifyIssue, doubleSha256Hex, hopMaxHeight, temporalCantor, verifyCloud, verifyCloudHop, verifyCloudSidestep, type CloudMove } from '../cloudVerify'
import type { CloudHopResult, CloudSidestepResult } from '../hosaka'

const PREV = 'ab'.repeat(32)
const PLANE: Plane = 0

/** HOSAKA's version 2 hop result (hosaka-api ha-1): seal, mn and mp flat, K, and region_n as the region's key. */
function hopResult(move: CloudMove): CloudHopResult {
  const p = computeHopProofV2(move.from.x, move.from.y, move.from.z, move.to.x, move.to.y, move.to.z, move.plane, move.prevEventId)
  const keys = deriveRegionKeys(p.regionN)
  return {
    seal: p.tags.proof,
    mn: p.tags.mn,
    mp: p.tags.mp,
    K: p.terrainK,
    region_n: { public_proof: keys.lookupIdHex, secret_key: bytesToHex(keys.locationDecryptionKey) },
    // Bookkeeping HOSAKA sends and this client never reads for the proof.
    max_height: 13,
    compute_msats: 1000,
  }
}

/** One character of a hex string changed, at `at`. */
function flip(hex: string, at: number): string {
  const c = hex[at] === '0' ? '1' : '0'
  return hex.slice(0, at) + c + hex.slice(at + 1)
}

// x crosses h13, y crosses h3, z stays put.
const HOP: CloudMove = { from: { x: 0n, y: 0n, z: 0n }, to: { x: 4104n, y: 5n, z: 0n }, plane: PLANE, prevEventId: PREV }

describe('verifyCloudHop (hop proof version 2, Level 1)', () => {
  const good = hopResult(HOP)

  it('models the server: the seal is the proof tag and region_n is the region key', () => {
    expect(good.seal).toMatch(/^[0-9a-f]{64}$/)
    expect(good.mn).toMatch(/^[0-9a-f]{16}$/)
    expect(good.mp).toMatch(/^[0-9a-f]+$/)
    expect(sha256Hex(hexToBytes(good.region_n.secret_key))).toBe(good.region_n.public_proof)
  })

  it('passes an honest result, and needs no ceiling of this machine to do it', () => {
    expect(verifyCloudHop(good, HOP)).toEqual([])
    expect(verifyCloud('hop', good, HOP)).toEqual([])
  })

  it('takes nothing but the three tags from HOSAKA: a proof for another head fails', () => {
    const other = hopResult({ ...HOP, prevEventId: 'cd'.repeat(32) })
    const failed = verifyCloudHop({ ...good, seal: other.seal, mn: other.mn, mp: other.mp }, HOP)
    expect(failed.length).toBeGreaterThan(0)
    expect(failed.every((f) => f.startsWith('level1:'))).toBe(true)
  })

  it('rejects a corrupted seal, nonce or opening at Level 1', () => {
    expect(verifyCloudHop({ ...good, seal: flip(good.seal, 0) }, HOP)[0]).toMatch(/^level1:(price|path:\d+)$/)
    expect(verifyCloudHop({ ...good, mn: flip(good.mn, 15) }, HOP)[0]).toMatch(/^level1:(price|path:\d+|residue:\d+)$/)
    // The first residue of the first opening.
    expect(verifyCloudHop({ ...good, mp: flip(good.mp, 3) }, HOP)[0]).toMatch(/^level1:(residue|path):\d+$/)
    expect(verifyCloudHop({ ...good, mp: good.mp.slice(0, -2) }, HOP)).toEqual(['level1:form:mp'])
  })

  it('requires all three tags once any is there', () => {
    const { mp: _mp, ...noMp } = good
    expect(verifyCloudHop(noMp as unknown as CloudHopResult, HOP)).toEqual(['mp'])
    const { seal: _seal, mn: _mn, ...onlyMp } = good
    expect(verifyCloudHop(onlyMp as unknown as CloudHopResult, HOP)).toEqual(['seal', 'mn'])
  })

  it('names the old hop_n shape, and anything else that is not a result', () => {
    const v1 = { hop_n: { public_proof: 'aa'.repeat(32), secret_key: 'bb'.repeat(32) }, region_n: good.region_n, K: good.K }
    expect(cloudHopShape(v1)).toBe('v1')
    expect(verifyCloudHop(v1 as unknown as CloudHopResult, HOP)).toEqual(['shape:v1'])
    expect(cloudHopShape(good)).toBe('v2')
    expect(cloudHopShape(null)).toBe('junk')
    expect(verifyCloudHop(null as unknown as CloudHopResult, HOP)).toEqual(['result'])
  })

  it('rejects a K that is not ours, and does without one', () => {
    expect(verifyCloudHop({ ...good, K: (good.K ?? 0) + 1 }, HOP)).toEqual(['K'])
    const { K: _K, ...noK } = good
    expect(verifyCloudHop(noK, HOP)).toEqual([])
  })

  it('rejects a region key whose secret does not hash to its lookup id', () => {
    expect(verifyCloudHop({ ...good, region_n: { ...good.region_n, secret_key: 'ff'.repeat(32) } }, HOP)).toEqual(['envelope:region_n'])
    expect(verifyCloudHop({ ...good, region_n: undefined as unknown as CloudHopResult['region_n'] }, HOP)).toEqual(['envelope:region_n'])
  })

  it('never builds a hop above the verify ceiling, before any Level 1 work', () => {
    const tall: CloudMove = { ...HOP, to: { x: 1n << BigInt(CLOUD_VERIFY_MAX_HEIGHT), y: 5n, z: 0n } }
    expect(hopMaxHeight(tall)).toBe(CLOUD_VERIFY_MAX_HEIGHT + 1)
    expect(cloudVerifyIssue(tall)).toContain(`h${CLOUD_VERIFY_MAX_HEIGHT + 1}`)
    expect(verifyCloudHop(good, tall)).toEqual(['height'])
    expect(cloudVerifyIssue(HOP)).toBeNull()
  })

  it('the temporal root of a sidestep still recomputes exactly', () => {
    const p = computeHopProof(0n, 0n, 0n, 4104n, 5n, 0n, PLANE, PREV, 20)
    expect(temporalCantor(PREV, p.terrainK)).toBe(p.cantorT)
    expect(doubleSha256Hex(p.hopN)).toBe(p.proofHash)
  })
})

function sidestepResult(move: CloudMove): CloudSidestepResult {
  const p = computeSidestepProof(move.from.x, move.from.y, move.from.z, move.to.x, move.to.y, move.to.z, move.plane, move.prevEventId)
  const hex = (paths: Uint8Array[][]): string[][] => paths.map((q) => q.map(bytesToHex))
  return {
    proof_hash: p.proofHash,
    merkle_x: bytesToHex(p.merkleX),
    merkle_y: bytesToHex(p.merkleY),
    merkle_z: bytesToHex(p.merkleZ),
    openings: { x: hex(p.openings.x), y: hex(p.openings.y), z: hex(p.openings.z) },
    mn: encodeNonce(p.nonce),
    lca_heights: p.lcaHeights,
    previous_event_id: move.prevEventId,
    terrain_k: p.terrainK,
    region_m_hex: p.regionM.toString(16),
    compute_msats: 300,
  }
}

// Two walls at once: x toward 5000 crosses h13 and lands on 4096, y toward
// 300 crosses h9 and lands on 256; z does not move.
const SIDESTEP: CloudMove = {
  from: { x: 0n, y: 0n, z: 0n },
  to: { x: sidestepLanding(0n, 5000n), y: sidestepLanding(0n, 300n), z: 0n },
  plane: PLANE,
  prevEventId: PREV,
}

describe('verifyCloudSidestep', () => {
  const good = sidestepResult(SIDESTEP)

  it('lands where the spec says and passes an honest result', () => {
    expect(SIDESTEP.to).toEqual({ x: 4096n, y: 256n, z: 0n })
    expect(good.lca_heights).toEqual([13, 9, 0])
    // Nine openings of thirteen siblings on x (6.10), none on the still axis.
    expect(good.openings.x).toHaveLength(9)
    expect(good.openings.x[0]).toHaveLength(13)
    expect(good.openings.z).toHaveLength(0)
    expect(verifyCloudSidestep(good, SIDESTEP)).toEqual([])
  })

  it('rejects one flipped sibling on one axis, and nothing else', () => {
    const paths = good.openings.x.map((q) => [...q])
    paths[3][4] = paths[3][4].startsWith('0') ? '1' + paths[3][4].slice(1) : '0' + paths[3][4].slice(1)
    expect(verifyCloudSidestep({ ...good, openings: { ...good.openings, x: paths } }, SIDESTEP)).toEqual(['openings:x'])
  })

  it('rejects a v1 result, one path per axis, and a tree built under another seed', () => {
    // A v1 server returned the destination path alone; 6.15 says reject it.
    expect(verifyCloudSidestep({ ...good, openings: { ...good.openings, x: [good.openings.x[0]] } }, SIDESTEP)).toEqual(['openings:x'])
    // A tree seeded by someone else's chain position: its roots and openings
    // are consistent with each other, and wrong for us on every moving axis.
    const theirs = sidestepResult({ ...SIDESTEP, prevEventId: 'cd'.repeat(32) })
    const failed = verifyCloudSidestep({ ...theirs, previous_event_id: PREV }, SIDESTEP)
    expect(failed).toContain('openings:x')
    expect(failed).toContain('openings:y')
  })

  it('rejects a changed root through the path, the region and the proof hash', () => {
    const failed = verifyCloudSidestep({ ...good, merkle_y: 'ee'.repeat(32) }, SIDESTEP)
    expect(failed).toContain('openings:y')
    expect(failed).toContain('region_m')
    expect(failed).toContain('proof_hash')
  })

  it('rejects a wrong terrain K and a wrong proof hash on their own', () => {
    expect(verifyCloudSidestep({ ...good, terrain_k: good.terrain_k + 1 }, SIDESTEP)).toEqual(['terrain_k'])
    expect(verifyCloudSidestep({ ...good, proof_hash: 'ff'.repeat(32) }, SIDESTEP)).toEqual(['proof_hash'])
  })

  it('rejects heights and a previous event id that disagree with the move', () => {
    expect(verifyCloudSidestep({ ...good, lca_heights: [12, 9, 0] }, SIDESTEP)).toEqual(['lca_heights:x'])
    expect(verifyCloudSidestep({ ...good, previous_event_id: 'cd'.repeat(32) }, SIDESTEP)).toEqual(['previous_event_id'])
  })

  it('rejects a landing that is not 1 gibson past the wall', () => {
    const off: CloudMove = { ...SIDESTEP, to: { ...SIDESTEP.to, x: 4097n } }
    const result = sidestepResult(off)
    // The paths and hash are internally consistent for 4097; the geometry is what fails.
    expect(verifyCloudSidestep(result, off)).toEqual(['geometry:x'])
  })

  it('rejects a missing or malformed mn, and checks no opening without one', () => {
    const noNonce: Partial<CloudSidestepResult> = { ...good }
    delete noNonce.mn
    expect(verifyCloudSidestep(noNonce as CloudSidestepResult, SIDESTEP)).toEqual(['mn'])
    expect(verifyCloudSidestep({ ...good, mn: '1' }, SIDESTEP)).toEqual(['mn'])
    expect(verifyCloudSidestep({ ...good, mn: 'ABCDEF0123456789' }, SIDESTEP)).toEqual(['mn'])
  })

  it('rejects a nonce that misses the price, whose samples then miss too', () => {
    // A = ceil((2^13 + 2^9) / 8) = 1088: almost any other nonce misses.
    const roots = [good.merkle_x, good.merkle_y, good.merkle_z].map(hexToBytes)
    const attempts = sidestepAttempts(good.lca_heights)
    expect(attempts).toBe(1088n)
    let miss = 0n
    while (meetsPrice(sidestepGrindHash(hexToBytes(PREV), roots, miss), attempts)) miss++
    const failed = verifyCloudSidestep({ ...good, mn: encodeNonce(miss) }, SIDESTEP)
    expect(failed).toContain('price')
  })

  it('rejects openings drawn anywhere but G, as version 2 drew them from the roots', () => {
    // The trees are honest; only the sample positions are not the ones G draws.
    const elsewhere = new Uint8Array(32).fill(7)
    const hex = (paths: Uint8Array[][]): string[][] => paths.map((q) => q.map(bytesToHex))
    const axis = (a: 'x' | 'y') => hex(computeAxisMerkleRoot(seedPrefix(hexToBytes(PREV), AXIS_BYTE[a]), AXIS_BYTE[a], SIDESTEP.from[a], SIDESTEP.to[a]).openingsFor(elsewhere))
    expect(verifyCloudSidestep({ ...good, openings: { ...good.openings, x: axis('x'), y: axis('y') } }, SIDESTEP)).toEqual(['openings:x', 'openings:y'])
  })

  it('rejects malformed roots and paths without throwing', () => {
    expect(verifyCloudSidestep({ ...good, merkle_x: 'zz' }, SIDESTEP)).toContain('merkle_x')
    expect(verifyCloudSidestep({ ...good, openings: { ...good.openings, y: [['nope']] } }, SIDESTEP)).toEqual(['openings:y'])
    expect(verifyCloudSidestep(undefined as unknown as CloudSidestepResult, SIDESTEP)).toEqual(['result'])
  })
})
