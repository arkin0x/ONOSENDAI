/**
 * cloudVerify.test.ts - the verifier against cyberspace-core as the oracle.
 *
 * A remote result is built exactly the way HOSAKA builds one (content
 * addressed envelopes, hex roots, hex sibling paths) from proofs
 * cyberspace-core computes at small heights, then one field at a time is
 * corrupted. Every corruption must name its check; the untouched result must
 * pass with nothing to say. The one thing that must NOT be caught, a
 * self-consistent forged cloud axis root above the local ceiling, is pinned
 * too, because that is the trust boundary the contract draws.
 */

import { describe, expect, it } from 'vitest'
import {
  bytesToHex,
  cantorPair,
  computeAxisMerkleRoot,
  computeHopProof,
  computeSidestepProof,
  deriveRegionKeys,
  hexToBytes,
  intToBytesBE,
  sha256Hex,
  sidestepLanding,
  type Plane,
} from 'cyberspace-core'
import { doubleSha256Hex, temporalCantor, verifyCloudHop, verifyCloudSidestep, type CloudMove } from './cloudVerify'
import type { CloudHopResult, CloudSidestepResult, HopEnvelope } from './hosaka'

const PREV = 'ab'.repeat(32)
const PLANE: Plane = 0

/** HOSAKA's save_cantor_root: secret_key = sha256(bytes), public_proof = sha256(secret_key). */
function envelope(n: bigint): HopEnvelope {
  const secret = sha256Hex(intToBytesBE(n))
  return { public_proof: sha256Hex(hexToBytes(secret)), secret_key: secret, size_bytes: intToBytesBE(n).length }
}

function hopResult(move: CloudMove): CloudHopResult {
  const p = computeHopProof(move.from.x, move.from.y, move.from.z, move.to.x, move.to.y, move.to.z, move.plane, move.prevEventId, 20)
  const h = (a: bigint, b: bigint): number => (a === b ? 0 : (a ^ b).toString(2).length)
  return {
    hop_n: envelope(p.hopN),
    region_n: envelope(p.regionN),
    region_xy: envelope(cantorPair(p.cantorX, p.cantorY)),
    cantor_x: envelope(p.cantorX),
    cantor_y: envelope(p.cantorY),
    cantor_z: envelope(p.cantorZ),
    cantor_t: envelope(p.cantorT),
    K: p.terrainK,
    max_height: Math.max(h(move.from.x, move.to.x), h(move.from.y, move.to.y), h(move.from.z, move.to.z)),
    compute_msats: 1000,
  }
}

// x crosses h13 (beyond a ceiling of 12), y crosses h3, z stays put.
const HOP: CloudMove = { from: { x: 0n, y: 0n, z: 0n }, to: { x: 4104n, y: 5n, z: 0n }, plane: PLANE, prevEventId: PREV }

describe('verifyCloudHop', () => {
  const good = hopResult(HOP)

  it('models the server: hop_n is the proof hash and region_n is the region key', () => {
    const p = computeHopProof(0n, 0n, 0n, 4104n, 5n, 0n, PLANE, PREV, 20)
    expect(good.hop_n.public_proof).toBe(p.proofHash)
    const keys = deriveRegionKeys(p.regionN)
    expect(good.region_n.public_proof).toBe(keys.lookupIdHex)
    expect(good.region_n.secret_key).toBe(bytesToHex(keys.locationDecryptionKey))
  })

  it('passes an honest result, with and without the cloud axis inside the ceiling', () => {
    expect(verifyCloudHop(good, HOP, 12)).toEqual([])
    expect(verifyCloudHop(good, HOP, 13)).toEqual([])
  })

  it('recomputes the temporal root exactly', () => {
    const p = computeHopProof(0n, 0n, 0n, 4104n, 5n, 0n, PLANE, PREV, 20)
    expect(temporalCantor(PREV, p.terrainK)).toBe(p.cantorT)
    expect(doubleSha256Hex(p.hopN)).toBe(p.proofHash)
  })

  it('rejects a wrong K field on its own, and a temporal root built at that K with it', () => {
    // The temporal check uses the LOCAL K, so a lying K field cannot steer it.
    expect(verifyCloudHop({ ...good, K: good.K + 1 }, HOP, 12)).toEqual(['K'])
    const atWrongK = envelope(temporalCantor(PREV, good.K + 1))
    const failed = verifyCloudHop({ ...good, K: good.K + 1, cantor_t: atWrongK }, HOP, 12)
    expect(failed).toContain('K')
    expect(failed).toContain('cantor_t')
  })

  it('rejects a temporal root computed for another chain head', () => {
    const other = hopResult({ ...HOP, prevEventId: 'cd'.repeat(32) })
    const failed = verifyCloudHop({ ...good, cantor_t: other.cantor_t }, HOP, 12)
    expect(failed).toEqual(['cantor_t'])
  })

  it('rejects a trivial axis whose root is not the axis value', () => {
    expect(verifyCloudHop({ ...good, cantor_z: envelope(1n) }, HOP, 12)).toEqual(['axis:z'])
  })

  it('rejects an axis within the ceiling whose root does not recompute', () => {
    const p = computeHopProof(0n, 0n, 0n, 4104n, 5n, 0n, PLANE, PREV, 20)
    expect(verifyCloudHop({ ...good, cantor_y: envelope(p.cantorY + 1n) }, HOP, 12)).toEqual(['axis:y'])
  })

  it('takes the cloud axis on trust above the ceiling, and checks it below', () => {
    const p = computeHopProof(0n, 0n, 0n, 4104n, 5n, 0n, PLANE, PREV, 20)
    const forged = { ...good, cantor_x: envelope(p.cantorX + 1n) }
    // The trust boundary: a self-consistent envelope for an h13 axis passes a
    // client whose ceiling is 12. Detectable later by anyone redoing the work.
    expect(verifyCloudHop(forged, HOP, 12)).toEqual([])
    expect(verifyCloudHop(forged, HOP, 13)).toEqual(['axis:x'])
  })

  it('rejects an envelope whose secret does not hash to its proof', () => {
    const bad = { ...good.region_n, secret_key: 'ff'.repeat(32) }
    expect(verifyCloudHop({ ...good, region_n: bad }, HOP, 12)).toEqual(['envelope:region_n'])
    const malformed = { ...good.hop_n, public_proof: 'not hex' }
    expect(verifyCloudHop({ ...good, hop_n: malformed }, HOP, 12)).toEqual(['envelope:hop_n'])
  })

  it('rejects a max_height that disagrees with the move', () => {
    expect(verifyCloudHop({ ...good, max_height: 14 }, HOP, 12)).toEqual(['max_height'])
  })

  it('rejects a result that is not one', () => {
    expect(verifyCloudHop(null as unknown as CloudHopResult, HOP, 12)).toEqual(['result'])
  })
})

function sidestepResult(move: CloudMove): CloudSidestepResult {
  const p = computeSidestepProof(move.from.x, move.from.y, move.from.z, move.to.x, move.to.y, move.to.z, move.plane, move.prevEventId)
  const hex = (b: Uint8Array[]): string[] => b.map(bytesToHex)
  return {
    proof_hash: p.proofHash,
    merkle_x: bytesToHex(p.merkleX),
    merkle_y: bytesToHex(p.merkleY),
    merkle_z: bytesToHex(p.merkleZ),
    inclusion_proofs: { x: hex(p.inclusionProofs.x), y: hex(p.inclusionProofs.y), z: hex(p.inclusionProofs.z) },
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
    expect(good.inclusion_proofs.x).toHaveLength(13)
    expect(good.inclusion_proofs.z).toHaveLength(0)
    expect(verifyCloudSidestep(good, SIDESTEP)).toEqual([])
  })

  it('rejects one flipped sibling on one axis, and nothing else', () => {
    const path = [...good.inclusion_proofs.x]
    path[4] = path[4].startsWith('0') ? '1' + path[4].slice(1) : '0' + path[4].slice(1)
    expect(verifyCloudSidestep({ ...good, inclusion_proofs: { ...good.inclusion_proofs, x: path } }, SIDESTEP)).toEqual(['inclusion:x'])
  })

  it('rejects the leaf-0 path HOSAKA used to return instead of the destination path', () => {
    // From 4096 toward 0 the destination IS leaf 0 of the same subtree, so its
    // path is the old server's output for a 0 -> 4096 crossing.
    const leafZero = computeAxisMerkleRoot(4096n, 0n)
    expect(bytesToHex(leafZero.root)).toBe(good.merkle_x)
    const failed = verifyCloudSidestep({ ...good, inclusion_proofs: { ...good.inclusion_proofs, x: leafZero.siblings.map(bytesToHex) } }, SIDESTEP)
    expect(failed).toEqual(['inclusion:x'])
  })

  it('rejects a changed root through the path, the region and the proof hash', () => {
    const failed = verifyCloudSidestep({ ...good, merkle_y: 'ee'.repeat(32) }, SIDESTEP)
    expect(failed).toContain('inclusion:y')
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

  it('rejects malformed roots and paths without throwing', () => {
    expect(verifyCloudSidestep({ ...good, merkle_x: 'zz' }, SIDESTEP)).toContain('merkle_x')
    expect(verifyCloudSidestep({ ...good, inclusion_proofs: { ...good.inclusion_proofs, y: ['nope'] } }, SIDESTEP)).toEqual(['inclusion:y'])
    expect(verifyCloudSidestep(undefined as unknown as CloudSidestepResult, SIDESTEP)).toEqual(['result'])
  })
})
