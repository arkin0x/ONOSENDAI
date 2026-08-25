/**
 * enter.ts: DECK-0001 v3 §3.2, the entry proof.
 *
 * The base protocol's temporal axis at the identity's current coordinate,
 * with no spatial component: K from terrain at C, the seeded Cantor root from
 * the previous event id, enter_n = pi(0, cantor_t), double SHA-256. Worst case
 * K = 16 is about a tenth of a second; this is a freshness binding, not a
 * fare (the toll is reserved, §7).
 */
import {
  alignedBase,
  cantorPair,
  computeSubtreeCantor,
  coordToXyz,
  hexToBytes,
  bytesToHex,
  intToBytesBE,
  sha256,
  terrainK,
  TEMPORAL_MAX_COMPUTE_HEIGHT,
} from 'cyberspace-core'

const AXIS_MASK = (1n << 85n) - 1n

export function computeEnterProof(coord: bigint, previousEventIdHex: string): string {
  if (previousEventIdHex.length !== 64) throw new Error('previousEventIdHex must be 64 hex chars')
  const { x, y, z, plane } = coordToXyz(coord)
  const k = terrainK(x, y, z, plane)
  let t = 0n
  for (const b of hexToBytes(previousEventIdHex)) t = (t << 8n) | BigInt(b)
  t &= AXIS_MASK
  const cantorT = computeSubtreeCantor(alignedBase(t, k), k, TEMPORAL_MAX_COMPUTE_HEIGHT)
  const enterN = cantorPair(0n, cantorT)
  return bytesToHex(sha256(sha256(intToBytesBE(enterN))))
}

/** A verifier's check is the same computation. */
export function verifyEnterProof(coord: bigint, previousEventIdHex: string, proofHash: string): boolean {
  return computeEnterProof(coord, previousEventIdHex) === proofHash.toLowerCase()
}
