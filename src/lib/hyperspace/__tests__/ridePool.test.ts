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
import { K_LINE, be32, be64, buildRideProof, computeRideLeaf, lineTerrainK, rideBlocks, verifyRideLevel1 } from '../ride'
import {
  RIDE_CHUNK_SIZE,
  assembleLeaves,
  calibrate,
  computeRideProof,
  grindCheckpoint,
  grindKey,
  leafBenchmarkMs,
  leafKey,
  pendingBlocks,
  planChunks,
  rideFraction,
} from '../ridePool'
import type { RideJob, RideProgress } from '../ridePool'

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
    const proof = buildRideProof(PREV, assembleLeaves(blocks, byHeight))
    const direct = buildRideProof(PREV, blocks.map((b) => computeRideLeaf(PREV, b.height, b.blockHash)))
    expect(proof.rootHex).toBe(direct.rootHex)
    expect(proof.mp).toBe(direct.mp)
    const result = await verifyRideLevel1({
      previousEventIdHex: PREV,
      fromHeight: 6,
      toHeight: 12,
      rootHex: proof.rootHex,
      mp: proof.mp,
      mn: proof.mnHex,
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
    expect(proof).toEqual({ rootHex: '0'.repeat(64), mp: '', mnHex: '0'.repeat(16) })
    expect(seen[seen.length - 1]).toEqual({ done: 0, total: 0, etaMs: null, price: null })
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
      mn: proof.mnHex,
      blockHashFor: (h) => fakeHash(h),
    })
    expect(result.reason).toBeNull()
    expect(result.ok).toBe(true)
    // Final forced progress call reports completion, the price paid in one
    // attempt (A is 1 below 33 blocks); under 20 fresh leaves the ETA stays
    // null rather than extrapolating from noise.
    expect(seen[seen.length - 1]).toEqual({ done: 4, total: 4, etaMs: null, price: { attempts: 1, expected: 1 } })
  })

  it('searches past nonces that miss the price, and matches the one-thread proof', async () => {
    // A 40-block synthetic ride (decks/hyperjump-reference.py's line) under
    // 'ab' x 32: A is 2 and nonces 0 and 1 both miss, so the search has to
    // keep going, and it must land on the same proof the reference would.
    const domain = new TextEncoder().encode('CYBERSPACE_TEST_BLOCK')
    const synthetic = (b: number): string => {
      for (let j = 0; ; j++) {
        const hex = bytesToHex(sha256(new Uint8Array([...domain, ...be64(b), ...be32(j)])))
        if (lineTerrainK(hex) + K_LINE <= 10) return hex
      }
    }
    const blocks = rideBlocks(900000, 900040).map((height) => ({ height, blockHash: synthetic(height) }))
    const seen: RideProgress[] = []
    const proof = await computeRideProof({ previousEventIdHex: PREV, blocks }, (p) => seen.push(p))
    expect(proof.rootHex).toBe('d3a1d8de00558e8c31018c80b24e8cbf588941829f217fd1f01c9419c5dd2930')
    expect(proof.mnHex).toBe('0000000000000002')
    expect(proof).toEqual(buildRideProof(PREV, blocks.map((b) => computeRideLeaf(PREV, b.height, b.blockHash))))
    expect(seen[seen.length - 1].price).toEqual({ attempts: 3, expected: 2 })
    const result = await verifyRideLevel1({
      previousEventIdHex: PREV, fromHeight: 900000, toHeight: 900040, rootHex: proof.rootHex, mp: proof.mp, mn: proof.mnHex,
      blockHashFor: synthetic,
    })
    expect(result.ok).toBe(true)
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

describe('the price search checkpoint', () => {
  it('is the lowest range still in flight, else the next range to hand out', () => {
    expect(grindCheckpoint([], 24)).toBe(24)
    expect(grindCheckpoint([16, 8, 32], 40)).toBe(8)
    expect(grindCheckpoint([40], 48)).toBe(40)
  })

  it('is keyed by chain position and root, never shared across either', () => {
    expect(grindKey(PREV, '11'.repeat(32))).not.toBe(grindKey(OTHER_PREV, '11'.repeat(32)))
    expect(grindKey(PREV, '11'.repeat(32))).not.toBe(grindKey(PREV, '22'.repeat(32)))
    // Inside the ride's key range, so a proven ride's cleanup takes it too.
    expect(grindKey(PREV, '11'.repeat(32)).startsWith(`${PREV}:`)).toBe(true)
  })
})

describe('rideFraction: one bar over the leaves and the price', () => {
  it('weighs the price as A blocks at the end, and never pins at full while searching', () => {
    expect(rideFraction({ done: 0, total: 0, etaMs: null, price: null })).toBe(1)
    expect(rideFraction({ done: 0, total: 64, etaMs: null, price: null })).toBe(0)
    // 64 blocks, A = 2: every leaf done is 64 of 66.
    expect(rideFraction({ done: 64, total: 64, etaMs: null, price: null })).toBeCloseTo(64 / 66)
    const searching = rideFraction({ done: 64, total: 64, etaMs: null, price: { attempts: 2, expected: 2 } })
    expect(searching).toBeGreaterThan(64 / 66)
    expect(searching).toBeLessThan(1)
    expect(rideFraction({ done: 64, total: 64, etaMs: null, price: { attempts: 50, expected: 2 } })).toBeLessThan(1)
  })
})

describe('calibrate (no workers under node)', () => {
  it('measures once, shares the measurement, and publishes it', async () => {
    const first = calibrate()
    expect(calibrate()).toBe(first)
    const ms = await first
    expect(Number.isFinite(ms) && ms > 0).toBe(true)
    expect(leafBenchmarkMs()).toBe(ms)
    expect(await calibrate()).toBe(ms)
  })
})
