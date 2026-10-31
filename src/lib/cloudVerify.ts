import { movementCapabilityIssue } from './proofCapability'
/**
 * cloudVerify.ts - what this client checks before it signs a cloud proof.
 *
 * A remote prover hands back numbers; signing them into the chain makes them
 * ours. So before the store builds the kind:3333 event, every check the
 * contract lists (hosaka-audit/client-contract.md, "What the client must
 * verify before signing") runs here, and a single failure refuses the move.
 *
 * Hop results are hop proof version 2 (spec 5.9 to 5.13) and are checked at
 * Level 1 (5.11) with cyberspace-core, exactly as any verifier will check the
 * signed event: the form and width of `proof`, `mn` and `mp`, the price of
 * the nonce, the 16 sampled openings' paths to the seal and their residues
 * recomputed in word arithmetic. Every input but the three tags is this
 * client's own: the geometry from the move, K from the destination, the
 * previous event id from the chain. Then the region key HOSAKA sent must be
 * consistent (sha256(secret_key) is its lookup id). Level 1 builds no root,
 * so it needs no big numbers and no ceiling of this machine's; its cost
 * grows with the hop's height, so a hop is never bought above
 * CLOUD_VERIFY_MAX_HEIGHT (cloudVerifyIssue, asked before any quote).

 * Sidestep results are checked completely at Level 1 (6.11, 8.7.2): the
 * re-roll price of the `mn` nonce, the destination leaf's path and the eight
 * paths sampled from G on every crossing axis, and the proof hash rebuilt
 * from the roots, the terrain and the temporal root.
 *
 * Every function returns the list of failed checks; empty means pass. Pure,
 * synchronous and O(h) apart from the temporal root and any axis recompute,
 * so it can run on a worker or, in tests, inline.
 */

import {
  AXIS_BITS,
  AXIS_BYTE,
  TEMPORAL_MAX_COMPUTE_HEIGHT,
  alignedBase,
  cantorPair,
  computeSubtreeCantor,
  decodeNonce,
  findLcaHeight,
  hexToBytes,
  intToBytesBE,
  meetsPrice,
  seedPrefix,
  sha256,
  sha256Hex,
  sidestepAttempts,
  sidestepGrindHash,
  sidestepLanding,
  terrainK,
  type Plane,
  verifyAxisOpenings,
  verifyHopLevel1,
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
 * The tallest hop this client buys and verifies (h_max: the largest of the
 * three axis heights and K). Level 1 recomputes 16 residues of each root in
 * word arithmetic, and that grows with the height: measured in Node on a
 * desktop for one tall axis, h24 0.6 s, h26 2.1 s, h28 9.8 s, h30 30 s, h32
 * 66 s, about three times that when all three axes are tall, and about five
 * times on a phone. 30 is the tallest hop HOSAKA sells (MAX_HOSAKA_HEIGHT),
 * so nothing it sells is refused, and the check stays bounded if a provider
 * ever offers more. It runs in the verify worker either way.
 */
export const CLOUD_VERIFY_MAX_HEIGHT = 30

/** h_max of a hop (5.9): the three axis heights and the destination's K. */
export function hopMaxHeight(move: Pick<CloudMove, 'from' | 'to' | 'plane'>): number {
  const { from, to, plane } = move
  return Math.max(findLcaHeight(from.x, to.x), findLcaHeight(from.y, to.y), findLcaHeight(from.z, to.z), terrainK(to.x, to.y, to.z, plane))
}

/** Why a cloud hop must not be bought: one this client could not verify before signing. Null when it can. */
export function cloudVerifyIssue(move: Pick<CloudMove, 'from' | 'to' | 'plane'>): string | null {
  const h = hopMaxHeight(move)
  return h > CLOUD_VERIFY_MAX_HEIGHT
    ? `This hop reaches h${h}, above the h${CLOUD_VERIFY_MAX_HEIGHT} this client can check before signing, so it is not bought. Line up a nearer cursor.`
    : null
}

/**
 * The shape of a completed hop job: `v2` when it carries any of seal, mn and
 * mp (all three are then required), `v1` for the old hop_n shape, which this
 * client never signs (straddlingV1Hop in lib/cloud.ts), `junk` otherwise.
 */
export function cloudHopShape(result: unknown): 'v2' | 'v1' | 'junk' {
  if (!result || typeof result !== 'object') return 'junk'
  const r = result as Record<string, unknown>
  if ('seal' in r || 'mn' in r || 'mp' in r) return 'v2'
  return 'hop_n' in r ? 'v1' : 'junk'
}

/** An id no event has, for a hop nobody has signed yet: never on the exemption list (5.13), and the list is passed empty besides. */
const UNSIGNED_EVENT_ID = '0'.repeat(64)

/**
 * Level 1 of a cloud hop (5.11), before it is signed. Returns the failed
 * checks: `shape:v1` or `result` for a result that is not version 2, `seal`,
 * `mn`, `mp` for a missing or non-string tag, `height` above
 * CLOUD_VERIFY_MAX_HEIGHT, `K` when HOSAKA's K is not ours, `envelope:region_n`
 * for an inconsistent region key, and `level1:<step>` for core's verdict
 * (`level1:form:mp`, `level1:price`, `level1:path:3`, `level1:residue:7`).
 */
export function verifyCloudHop(result: CloudHopResult, move: CloudMove): string[] {
  const shape = cloudHopShape(result)
  if (shape === 'v1') return ['shape:v1']
  if (shape === 'junk') return ['result']
  const failed: string[] = []
  const { from, to, plane, prevEventId } = move
  if (typeof result.seal !== 'string') failed.push('seal')
  if (typeof result.mn !== 'string') failed.push('mn')
  if (typeof result.mp !== 'string') failed.push('mp')
  if (failed.length > 0) return failed
  if (cloudVerifyIssue(move)) return ['height']

  // K is ours (5.2): HOSAKA's is bookkeeping, and a disagreement means it
  // proved another hop. Absent is fine; a non-integer is not.
  const K = terrainK(to.x, to.y, to.z, plane)
  if (result.K !== undefined && result.K !== K) failed.push('K')
  if (!envelopeConsistent(result.region_n)) failed.push('envelope:region_n')

  // Level 1 from our own geometry and previous event; nothing but the three
  // tags comes from HOSAKA. 'cost' order: a junk tree is rejected on its
  // paths before any residue is computed, with the same verdict.
  const level1 = verifyHopLevel1(
    {
      from: { x: from.x, y: from.y, z: from.z, plane },
      to: { x: to.x, y: to.y, z: to.z, plane },
      previousEventIdHex: prevEventId,
      proof: result.seal,
      nonce: result.mn,
      openings: result.mp,
      eventId: UNSIGNED_EVENT_ID,
      grandfathered: new Set(),
    },
    { order: 'cost' },
  )
  for (const f of level1) failed.push(`level1:${f}`)
  return failed
}

/**
 * Level 1 sidestep verification (6.11, 8.7.2), all of it: geometry, the
 * re-roll price, the paths at the positions G draws, and the proof hash
 * rebuilt from the roots. What this client signs is always version 3, so a
 * result without a valid `mn` is refused; the exemption of 6.16 is for events
 * already published, never for a new one.
 */
export function verifyCloudSidestep(result: CloudSidestepResult, move: CloudMove): string[] {
  const failed: string[] = []
  if (!result || typeof result !== 'object') return ['result']
  const { from, to, plane, prevEventId } = move
  const issue = movementCapabilityIssue('sidestep', from, to, plane, 'cloud')
  if (issue) throw new Error(issue)
  const prevId = hexToBytes(prevEventId)

  const heights: number[] = []
  const roots: bigint[] = []
  const rootBytes: Array<Uint8Array | null> = []
  AXES.forEach((axis, i) => {
    const h = findLcaHeight(from[axis], to[axis])
    heights.push(h)
    if (!Array.isArray(result.lca_heights) || result.lca_heights[i] !== h) failed.push(`lca_heights:${axis}`)

    const rootHex = result[`merkle_${axis}` as const]
    if (typeof rootHex !== 'string' || !HEX64.test(rootHex)) {
      failed.push(`merkle_${axis}`)
      roots.push(0n)
      rootBytes.push(null)
      return
    }
    roots.push(BigInt('0x' + rootHex))
    rootBytes.push(hexToBytes(rootHex))

    // 6.3: a crossing lands exactly 1 gibson past the boundary.
    if (h > 0 && sidestepLanding(from[axis], to[axis]) !== to[axis]) failed.push(`geometry:${axis}`)
  })

  // 6.10: G from our own previous event id, the three claimed roots and the
  // nonce, and the price in attempts from our own heights. The samples below
  // come from this G, so a nonce that misses the price fails here and nowhere
  // else.
  const nonce = typeof result.mn === 'string' ? decodeNonce(result.mn) : null
  let G: Uint8Array | null = null
  if (nonce === null) failed.push('mn')
  else if (rootBytes.every((r) => r !== null)) {
    G = sidestepGrindHash(prevId, rootBytes as Uint8Array[], nonce)
    if (!meetsPrice(G, sidestepAttempts(heights))) failed.push('price')
  }

  // 6.10 and 6.11: the destination's path and the eight paths sampled from G,
  // each sampled leaf recomputed from our own seed (the previous event id and
  // the axis) and carried to the root. The base is recomputed from our own
  // coordinate, never read from the result.
  AXES.forEach((axis, i) => {
    const root = rootBytes[i]
    if (root === null) return
    const paths = result.openings?.[axis]
    if (!Array.isArray(paths) || !paths.every((p) => Array.isArray(p) && p.every((s) => typeof s === 'string' && HEX64.test(s)))) {
      failed.push(`openings:${axis}`)
      return
    }
    if (G === null) return
    const prefix = seedPrefix(prevId, AXIS_BYTE[axis])
    if (!verifyAxisOpenings(prefix, AXIS_BYTE[axis], from[axis], to[axis], root, paths.map((p) => p.map(hexToBytes)), G)) failed.push(`openings:${axis}`)
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
export function verifyCloud(action: HosakaAction, result: unknown, move: CloudMove): string[] {
  return action === 'hop'
    ? verifyCloudHop(result as CloudHopResult, move)
    : verifyCloudSidestep(result as CloudSidestepResult, move)
}
