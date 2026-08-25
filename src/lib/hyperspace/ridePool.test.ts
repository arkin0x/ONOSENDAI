/**
 * What would fail silently: a chunk planner that drops or reorders a block, a
 * resume that trusts leaves from another chain position, or an assembly that
 * follows completion order instead of height order would each produce a proof
 * that is internally consistent and Level-1-verifies against nothing. The
 * assembly test closes the loop through verifyRideLevel1 so prover-side
 * bookkeeping is checked by the real verifier, not by itself.
 *
 * Workers do not exist under vitest/node, so the pure planning, resume and
 * assembly parts are tested directly, and computeRideProof itself is tested
 * end to end through its sequential fallback path.
 *
 * Block heights: a ride from 6 to 12 passes heights 7..12 whose fakeHash
 * terrain K is at most 9 (verified offline), so no test rolls a 2^22 block.
 */
import { describe, expect, it } from 'vitest'
import { bytesToHex, sha256 } from 'cyberspace-core'
import { buildRideProof, computeRideLeaf, rideBlocks, verifyRideLevel1 } from './ride'
import {
  RIDE_CHUNK_SIZE,
  assembleLeaves,
  computeRideProof,
  leafKey,
  pendingBlocks,
  planChunks,
} from './ridePool'
import type { RideJob, RideProgress } from './ridePool'

const PREV = 'ab'.repeat(32)
const OTHER_PREV = 'cd'.repeat(32)

/** Deterministic fake block hashes, same construction as ride.test.ts. */
function fakeHash(height: number): string {
  const bytes = new TextEncoder().encode(`fake-block-${height}`)
  return Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

function syntheticBlocks(fromHeight: number, toHeight: number): RideJob['blocks'] {
  return rideBlocks(fromHeight, toHeight).map((height) => ({ height, blockHash: fakeHash(height) }))
}

/** Cheap placeholder blocks for planner tests that never compute a leaf. */
function junkBlocks(count: number): RideJob['blocks'] {
  return Array.from({ length: count }, (_, i) => ({ height: 1000 + i, blockHash: '00'.repeat(32) }))
}

describe('chunk planner', () => {
  it('splits into chunks of RIDE_CHUNK_SIZE, ascending, pull-order stable', () => {
    const blocks = junkBlocks(150)
    const chunks = planChunks(blocks)
    expect(chunks.map((c) => c.length)).toEqual([64, 64, 22])
    // Workers pull chunks in index order, so the flattened plan must be the
    // input verbatim: any drop or reorder here is a wrong proof later.
    expect(chunks.flat()).toEqual(blocks)
    expect(RIDE_CHUNK_SIZE).toBe(64)
  })

  it('handles empty and sub-chunk inputs', () => {
    expect(planChunks([])).toEqual([])
    const five = junkBlocks(5)
    expect(planChunks(five)).toEqual([five])
  })
})

describe('resume skip logic', () => {
  it('skips exactly the cached heights keyed to this ride', () => {
    const job: RideJob = { previousEventIdHex: PREV, blocks: junkBlocks(6) }
    const heights = job.blocks.map((b) => b.height)
    const cached = new Set([
      leafKey(PREV, heights[1]),
      leafKey(PREV, heights[4]),
      // A leaf from another chain position must NOT be trusted: its seed
      // differs, so counting it as done would poison the proof.
      leafKey(OTHER_PREV, heights[2]),
    ])
    const pending = pendingBlocks(job, cached)
    expect(pending.map((b) => b.height)).toEqual([heights[0], heights[2], heights[3], heights[5]])
  })

  it('skips nothing when the cache is empty and everything when it is full', () => {
    const job: RideJob = { previousEventIdHex: PREV, blocks: junkBlocks(4) }
    expect(pendingBlocks(job, new Set())).toEqual(job.blocks)
    const all = new Set(job.blocks.map((b) => leafKey(PREV, b.height)))
    expect(pendingBlocks(job, all)).toEqual([])
  })
})

describe('assembly order', () => {
  it('completion-ordered leaves assemble ascending and Level-1-verify', async () => {
    const blocks = syntheticBlocks(6, 12)
    // Simulate arrival in completion order: reversed, with the middle first.
    const arrival = [blocks[3], ...blocks.slice().reverse().filter((b) => b !== blocks[3])]
    const byHeight = new Map<number, string>()
    for (const b of arrival) {
      byHeight.set(b.height, bytesToHex(computeRideLeaf(PREV, b.height, b.blockHash)))
    }
    const proof = buildRideProof(assembleLeaves(blocks, byHeight))
    const direct = buildRideProof(blocks.map((b) => computeRideLeaf(PREV, b.height, b.blockHash)))
    expect(proof.rootHex).toBe(direct.rootHex)
    expect(proof.mp).toBe(direct.mp)
    const result = await verifyRideLevel1({
      previousEventIdHex: PREV,
      fromHeight: 6,
      toHeight: 12,
      rootHex: proof.rootHex,
      mp: proof.mp,
      blockHashFor: (h) => fakeHash(h),
    })
    expect(result.reason).toBeNull()
    expect(result.ok).toBe(true)
  })

  it('throws on a missing leaf instead of assembling a short proof', () => {
    const blocks = junkBlocks(3)
    const byHeight = new Map<number, string>([[blocks[0].height, '11'.repeat(32)]])
    expect(() => assembleLeaves(blocks, byHeight)).toThrow('missing ride leaf')
  })
})

describe('computeRideProof (sequential fallback under node)', () => {
  it('empty job resolves immediately to the zero-length proof', async () => {
    const seen: RideProgress[] = []
    const proof = await computeRideProof({ previousEventIdHex: PREV, blocks: [] }, (p) => seen.push(p))
    expect(proof.rootHex).toBe('0'.repeat(64))
    expect(proof.mp).toBe('')
    expect(seen[seen.length - 1]).toEqual({ done: 0, total: 0, etaMs: null })
  })

  it('a 4-block job runs end to end and Level-1-verifies', async () => {
    const blocks = syntheticBlocks(6, 10)
    const seen: RideProgress[] = []
    const proof = await computeRideProof({ previousEventIdHex: PREV, blocks }, (p) => seen.push(p))
    const result = await verifyRideLevel1({
      previousEventIdHex: PREV,
      fromHeight: 6,
      toHeight: 10,
      rootHex: proof.rootHex,
      mp: proof.mp,
      blockHashFor: (h) => fakeHash(h),
    })
    expect(result.reason).toBeNull()
    expect(result.ok).toBe(true)
    // Final forced progress call reports completion; under 20 fresh leaves
    // the ETA stays null rather than extrapolating from noise.
    expect(seen[seen.length - 1]).toEqual({ done: 4, total: 4, etaMs: null })
  })

  it('rejects a second concurrent call', async () => {
    const first = computeRideProof({ previousEventIdHex: PREV, blocks: syntheticBlocks(6, 10) }, () => {})
    await expect(
      computeRideProof({ previousEventIdHex: PREV, blocks: [] }, () => {}),
    ).rejects.toThrow('ride already computing')
    await first
  })

  it('rejects with aborted when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      computeRideProof({ previousEventIdHex: PREV, blocks: syntheticBlocks(6, 10) }, () => {}, controller.signal),
    ).rejects.toThrow('aborted')
  })
})
