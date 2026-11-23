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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bytesToHex, sha256 } from 'cyberspace-core'
import { K_LINE, attemptWork, attemptsRequired, be32, be64, buildRideProof, computeRideLeaf, expectedRidePairs, lineTerrainK, rideBlocks, verifyRideLevel1 } from '../ride'
import {
  RIDE_CHUNK_SIZE,
  assembleLeaves,
  calibrate,
  computeRideProof,
  grindCheckpoint,
  grindKey,
  leafKey,
  pendingBlocks,
  planChunks,
  poolMsPerBlock,
  rideBenchmark,
  rideEstimateMs,
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
  }, 60_000)

  it('throws on a missing leaf instead of assembling a short proof', () => {
    const blocks = junkBlocks(3)
    const byHeight = new Map<number, string>([[blocks[0].height, '11'.repeat(32)]])
    expect(() => assembleLeaves(blocks, byHeight)).toThrow('missing ride leaf')
  })
})

describe('computeRideProof (sequential fallback under node)', () => {
  it('an empty job is refused: there is no zero-length ride (arkinox, 2026-10-07, Q1)', async () => {
    const seen: RideProgress[] = []
    await expect(computeRideProof({ previousEventIdHex: PREV, blocks: [] }, (p) => seen.push(p))).rejects.toThrow(/zero-length/)
    expect(seen).toEqual([])
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
  }, 60_000)

  // Genuinely slow: a 40-block ride searched past two nonces, then Level-1-verified, about 3.7 s in a parallel run, past 5 s under load.
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
  }, 20_000)

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
    const bench = await first
    expect(Number.isFinite(bench.msPerBlock) && bench.msPerBlock > 0).toBe(true)
    // No workers: the main thread is a pool of one.
    expect(bench.workers).toBe(1)
    expect(rideBenchmark()).toBe(bench)
    expect(await calibrate()).toBe(bench)
  })
})

describe('the ride estimate uses the pool\'s measured throughput', () => {
  it('worker rates add up: two workers timed together are twice as fast as one', () => {
    const one = poolMsPerBlock([{ elapsedMs: 100, work: 1_000 }])
    expect(one).toBeCloseTo((100 / 1_000) * expectedRidePairs(1))
    expect(poolMsPerBlock([{ elapsedMs: 100, work: 1_000 }, { elapsedMs: 100, work: 1_000 }])).toBeCloseTo(one / 2)
    // A big core and a little one: the big one counts for what it does.
    expect(poolMsPerBlock([{ elapsedMs: 100, work: 3_000 }, { elapsedMs: 100, work: 1_000 }])).toBeCloseTo(one / 4)
  })

  it('a long ride takes its blocks and its price at the pool\'s rate, not one worker\'s', () => {
    // The owner's ride: 363,870 blocks. Five workers, 52 ms a mean block for the pool (260 for one).
    const n = 363_870
    const blocks = n + (attemptsRequired(n) * attemptWork()) / expectedRidePairs(1)
    const pool = rideEstimateMs(n, { msPerBlock: 52, workers: 5 })
    expect(pool).toBeCloseTo(blocks * 52)
    // The one-worker reading of the same device, which the panel used to show.
    expect(rideEstimateMs(n, { msPerBlock: 260, workers: 1 }) / pool).toBeCloseTo(5)
  })

  it('a ride too short to fill the pool runs on as many workers as it has chunks', () => {
    // 100 blocks are two chunks (64 and 36): two workers of eight, each at
    // the pool's mean rate (80 ms a block), done when the 64-block chunk is.
    // The price is four attempts, on four workers.
    const bench = { msPerBlock: 10, workers: 8 }
    expect(rideEstimateMs(100, bench)).toBeCloseTo(80 * (64 + (4 * attemptWork()) / expectedRidePairs(1) / 4))
    // 1,000 blocks are 16 chunks: all eight workers.
    expect(rideEstimateMs(1_000, bench)).toBeCloseTo(80 * (1_000 / 8 + (32 * attemptWork()) / expectedRidePairs(1) / 8))
    expect(rideEstimateMs(0, bench)).toBe(0)
  })
})

/** A localStorage stand-in holding `entries`. */
function storage(entries: Record<string, string>) {
  const mem = new Map(Object.entries(entries))
  return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) }, removeItem: (k: string) => { mem.delete(k) } }
}

describe('the stored calibration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('older numbers (one worker, then plain pairings) are ignored, never shown, and dropped', async () => {
    // Both were stored by earlier clients: the one-worker number, and a pool
    // number that priced every pairing like the sample's, a tenth short.
    const ls = storage({
      'onosendai:ride-bench-ms': '260',
      'onosendai:ride-pool-bench': JSON.stringify({ msPerBlock: 52, workers: 5 }),
    })
    vi.stubGlobal('navigator', { hardwareConcurrency: 6 })
    vi.stubGlobal('localStorage', ls)
    vi.resetModules()
    const fresh = await import('../ridePool')
    expect(fresh.rideBenchmark()).toBeNull()
    expect(ls.getItem('onosendai:ride-bench-ms')).toBeNull()
    expect(ls.getItem('onosendai:ride-pool-bench')).toBeNull()
  })

  it('a pool measurement on this pool\'s width is read back; one from another width is not', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 6 })
    vi.stubGlobal('localStorage', storage({ 'onosendai:ride-pool-bench-2': JSON.stringify({ msPerBlock: 52, workers: 5 }) }))
    vi.resetModules()
    expect((await import('../ridePool')).rideBenchmark()).toEqual({ msPerBlock: 52, workers: 5 })
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 })
    vi.resetModules()
    expect((await import('../ridePool')).rideBenchmark()).toBeNull()
  })
})

describe('calibrate on the pool (fake workers)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  /** Fake ride workers: `readyDelay(i)` ms before worker i says it loaded; `fail` makes the sample error. */
  function fakeWorkers(opts: { readyDelay: (i: number) => number; fail?: boolean }) {
    const log: string[] = []
    let made = 0
    let terminated = 0
    class FakeWorker {
      private listeners: Array<(e: { data: unknown }) => void> = []
      private readonly index = made++
      addEventListener(type: string, fn: (e: { data: unknown }) => void) { if (type === 'message') this.listeners.push(fn) }
      terminate() { terminated++ }
      private reply(data: unknown, ms: number) { setTimeout(() => { for (const fn of this.listeners) fn({ data }) }, ms) }
      postMessage(msg: { type: string; id: number }) {
        log.push(`${this.index}:${msg.type}`)
        if (msg.type === 'ready') {
          setTimeout(() => {
            log.push(`${this.index}:loaded`)
            for (const fn of this.listeners) fn({ data: { type: 'ready', id: msg.id } })
          }, opts.readyDelay(this.index))
        } else if (opts.fail) {
          this.reply({ type: 'error', id: msg.id, message: 'boom' }, 0)
        } else {
          // Worker 0 is a big core, the rest little: 4,000 and 1,000 pairs in 100 ms.
          this.reply({ type: 'calibrated', id: msg.id, elapsedMs: 100, work: this.index === 0 ? 4_000 : 1_000 }, 0)
        }
      }
    }
    return { FakeWorker, log, made: () => made, terminated: () => terminated }
  }

  it('starts no worker until all have loaded, sums their rates, and ends every worker', async () => {
    // Worker 1 loads last, well after the others.
    const fake = fakeWorkers({ readyDelay: (i) => (i === 1 ? 30 : 0) })
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
    vi.stubGlobal('Worker', fake.FakeWorker)
    vi.stubGlobal('localStorage', storage({}))
    vi.resetModules()
    const fresh = await import('../ridePool')
    const bench = await fresh.calibrate()
    // Three workers (four cores, one left for the page).
    expect(fake.made()).toBe(3)
    const lastLoaded = fake.log.indexOf('1:loaded')
    const firstStart = fake.log.findIndex((l) => l.endsWith(':calibrate'))
    expect(lastLoaded).toBeGreaterThan(-1)
    expect(firstStart).toBeGreaterThan(lastLoaded)
    expect(fake.log.filter((l) => l.endsWith(':calibrate')).sort()).toEqual(['0:calibrate', '1:calibrate', '2:calibrate'])
    expect(bench.workers).toBe(3)
    expect(bench.msPerBlock).toBeCloseTo(expectedRidePairs(1) / (40 + 10 + 10))
    expect(fresh.rideBenchmark()).toEqual(bench)
    expect(fake.terminated()).toBe(3)
  })

  it('a failing pool stores nothing, never falls back to one worker, and the next call measures again', async () => {
    const failing = fakeWorkers({ readyDelay: () => 0, fail: true })
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
    vi.stubGlobal('Worker', failing.FakeWorker)
    const ls = storage({})
    vi.stubGlobal('localStorage', ls)
    vi.resetModules()
    const fresh = await import('../ridePool')
    await expect(fresh.calibrate()).rejects.toThrow('boom')
    expect(fresh.rideBenchmark()).toBeNull()
    expect(ls.getItem('onosendai:ride-pool-bench-2')).toBeNull()
    expect(failing.terminated()).toBe(3)
    const working = fakeWorkers({ readyDelay: () => 0 })
    vi.stubGlobal('Worker', working.FakeWorker)
    expect((await fresh.calibrate()).workers).toBe(3)
  })
})
