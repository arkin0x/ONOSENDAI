/**
 * cloudVerify.ts - what this client checks before it signs a cloud proof.
 *
 * A remote prover hands back numbers; signing them into the chain makes them
 * ours. So before the store builds the kind:3333 event, every check the
 * contract lists (hosaka-audit/client-contract.md, "What the client must
 * verify before signing") runs here, and a single failure refuses the move.
 *
 * Hop results are checked for everything that is cheap: the terrain K, the
 * temporal root (K is at most 16, so it is recomputed exactly), every h = 0
 * axis, every axis this machine can recompute within its ceiling, and the
 * transport consistency of each envelope. The cloud axis root itself is
 * operator trust: it is deterministic, so a wrong one is detectable later by
 * anyone willing to redo the work (the spec's Level 2 argument, 6.11).
 *
 * Sidestep results are checked completely at Level 1 (6.11): the destination
 * leaf's inclusion path on every crossing axis, and the proof hash rebuilt
 * from the roots, the terrain and the temporal root.
 *
 * Every function returns the list of failed checks; empty means pass. Pure,
 * synchronous and O(h) apart from the temporal root and any axis recompute,
 * so it can run on a worker or, in tests, inline.
 */

import {
  AXIS_BITS,
  TEMPORAL_MAX_COMPUTE_HEIGHT,
  alignedBase,
  cantorPair,
  computeAxisCantor,
  computeSubtreeCantor,
  findLcaHeight,
  hexToBytes,
  intToBytesBE,
  sha256,
  sha256Hex,
  sidestepLanding,
  terrainK,
  verifyMerkleInclusion,
  type Plane,
} from 'cyberspace-core'
import type { CloudHopResult, CloudSidestepResult, HopEnvelope, HosakaAction } from './hosaka'
import type { Position } from './space'

/** The move a cloud job was asked to prove. */
export interface CloudMove {
  from: Position
  to: Position
  plane: Plane
  prevEventId: string
}

const HEX64 = /^[0-9a-f]{64}$/
const AXES = ['x', 'y', 'z'] as const
type Axis = (typeof AXES)[number]

/** sha256(sha256(int_to_bytes_be_min(n))) as lowercase hex: the proof hash
 * shape (5.6, 6.8) and HOSAKA's `public_proof` of a stored root. */
export function doubleSha256Hex(n: bigint): string {
  return sha256Hex(sha256(intToBytesBE(n)))
}

/**
 * The temporal root (5.3): the previous event id reduced into the axis,
 * aligned at the terrain height, and the Cantor root of that subtree.
 * Identical for hops and sidesteps (6.7).
 */
export function temporalCantor(prevEventId: string, K: number): bigint {
  if (!HEX64.test(prevEventId)) throw new Error('prevEventId must be 64 lowercase hex chars')
  let t = 0n
  for (const b of hexToBytes(prevEventId)) t = (t << 8n) | BigInt(b)
  t &= (1n << BigInt(AXIS_BITS)) - 1n
  return computeSubtreeCantor(alignedBase(t, K), K, TEMPORAL_MAX_COMPUTE_HEIGHT)
}

/** An envelope is internally consistent when sha256(secret_key) is its public_proof. */
function envelopeConsistent(env: HopEnvelope | undefined): boolean {
  if (!env || typeof env.public_proof !== 'string' || typeof env.secret_key !== 'string') return false
  if (!HEX64.test(env.public_proof) || !HEX64.test(env.secret_key)) return false
  return sha256Hex(hexToBytes(env.secret_key)) === env.public_proof
}

/**
 * The cheap hop checks. `localCeiling` is the height up to which an axis root
 * is recomputed here and compared; axes above it are the cloud's work and are
 * taken on trust.
 */
export function verifyCloudHop(result: CloudHopResult, move: CloudMove, localCeiling: number): string[] {
  const failed: string[] = []
  if (!result || typeof result !== 'object') return ['result']
  const { from, to, plane, prevEventId } = move

  const K = terrainK(to.x, to.y, to.z, plane)
  if (result.K !== K) failed.push('K')

  const envelopes: Array<[string, HopEnvelope | undefined]> = [
    ['hop_n', result.hop_n],
    ['region_n', result.region_n],
    ['region_xy', result.region_xy],
    ['cantor_x', result.cantor_x],
    ['cantor_y', result.cantor_y],
    ['cantor_z', result.cantor_z],
    ['cantor_t', result.cantor_t],
  ]
  for (const [name, env] of envelopes) {
    if (!envelopeConsistent(env)) failed.push(`envelope:${name}`)
  }

  // The temporal root is fully recomputable: K <= 16 caps it at 65,536 pairs.
  // The LOCAL K is used, so a wrong K fails here too rather than steering the
  // recompute to an arbitrary height.
  if (result.cantor_t?.public_proof !== doubleSha256Hex(temporalCantor(prevEventId, K))) failed.push('cantor_t')

  const heights: Record<Axis, number> = { x: 0, y: 0, z: 0 }
  for (const axis of AXES) {
    const h = findLcaHeight(from[axis], to[axis])
    heights[axis] = h
    const env = result[`cantor_${axis}` as const]
    if (!env || typeof env.public_proof !== 'string') continue
    // h = 0: the root is the axis value itself (4.6), so the envelope must be
    // its double hash. Within the ceiling: the whole axis tree is recomputed.
    // Either way computeAxisCantor gives the root; above the ceiling it is the
    // cloud's word.
    if (h > localCeiling) continue
    if (env.public_proof !== doubleSha256Hex(computeAxisCantor(from[axis], to[axis], localCeiling))) failed.push(`axis:${axis}`)
  }

  if (result.max_height !== Math.max(heights.x, heights.y, heights.z)) failed.push('max_height')
  return failed
}

/**
 * Level 1 sidestep verification (6.11), all of it: geometry, inclusion paths
 * for the destination leaf, and the proof hash rebuilt from the roots.
 */
export function verifyCloudSidestep(result: CloudSidestepResult, move: CloudMove): string[] {
  const failed: string[] = []
  if (!result || typeof result !== 'object') return ['result']
  const { from, to, plane, prevEventId } = move

  const roots: bigint[] = []
  AXES.forEach((axis, i) => {
    const h = findLcaHeight(from[axis], to[axis])
    if (!Array.isArray(result.lca_heights) || result.lca_heights[i] !== h) failed.push(`lca_heights:${axis}`)

    const rootHex = result[`merkle_${axis}` as const]
    if (typeof rootHex !== 'string' || !HEX64.test(rootHex)) {
      failed.push(`merkle_${axis}`)
      roots.push(0n)
      return
    }
    roots.push(BigInt('0x' + rootHex))

    // 6.3: a crossing lands exactly 1 gibson past the boundary.
    if (h > 0 && sidestepLanding(from[axis], to[axis]) !== to[axis]) failed.push(`geometry:${axis}`)

    const path = result.inclusion_proofs?.[axis]
    if (!Array.isArray(path) || !path.every((s) => typeof s === 'string' && HEX64.test(s))) {
      failed.push(`inclusion:${axis}`)
      return
    }
    // The base is recomputed from our own coordinate (6.4), never read from
    // the result, where it is a JSON number too wide for a double.
    const ok = verifyMerkleInclusion(to[axis], path.map(hexToBytes), hexToBytes(rootHex), h, alignedBase(from[axis], h))
    if (!ok) failed.push(`inclusion:${axis}`)
  })

  const K = terrainK(to.x, to.y, to.z, plane)
  if (result.terrain_k !== K) failed.push('terrain_k')
  if (typeof result.previous_event_id === 'string' && result.previous_event_id !== prevEventId) failed.push('previous_event_id')

  const regionM = cantorPair(cantorPair(roots[0], roots[1]), roots[2])
  if (typeof result.region_m_hex === 'string' && /^[0-9a-f]+$/.test(result.region_m_hex) && BigInt('0x' + result.region_m_hex) !== regionM) {
    failed.push('region_m')
  }

  const proofHash = doubleSha256Hex(cantorPair(regionM, temporalCantor(prevEventId, K)))
  if (result.proof_hash !== proofHash) failed.push('proof_hash')
  return failed
}

/** One entry point for the verify worker and for tests. */
export function verifyCloud(action: HosakaAction, result: unknown, move: CloudMove, localCeiling: number): string[] {
  return action === 'hop'
    ? verifyCloudHop(result as CloudHopResult, move, localCeiling)
    : verifyCloudSidestep(result as CloudSidestepResult, move)
}
