/**
 * cloudRide.test.ts - the pieces of a ride bought from HOSAKA that are pure
 * (onosendai-launch #35 P5; arkinox, 2026-10-11).
 *
 * What would go wrong silently: a HOSAKA price shown for a ride HOSAKA
 * cannot sell (past its newest verifiable block, or longer than it sells),
 * a forged or misdirected proof judged good, a lost submit answer asked
 * again under a different key (a second charge), or a paid ride's record
 * not surviving a reload.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) }, clear: () => { mem.clear() },
  }
})

import { sha256 } from 'cyberspace-core'
import { rideChoice, rideFits, rideOfferOf, rideServiceOf, verifyCloudRide } from '../cloudRide'
import { buildRideProof, computeRideLeaf, rideBlocks } from '../hyperspace/ride'
import { createHosaka, idempotencyKeyFor, rideBody, type HosakaJob, type HosakaProvider } from '../hosaka'
import { clearCloudJob, loadCloudJob, saveCloudJob, wirePosition, type PendingCloudJob } from '../cloud'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'

const PREV = 'ab'.repeat(32)

function fakeHash(height: number): string {
  const bytes = new TextEncoder().encode(`fake-block-${height}`)
  return Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** HOSAKA's completed job for a ride, computed here the way HOSAKA computes it. */
function completedRide(prev: string, from: number, to: number, over: Record<string, unknown> = {}): HosakaJob {
  const leaves = rideBlocks(from, to).map((h) => computeRideLeaf(prev, h, fakeHash(h)))
  const p = buildRideProof(prev, leaves)
  return {
    id: 'job-ride', status: 'completed', cost_msats: 944_000, error: null,
    result: { root: p.rootHex, mp: p.mp, mn: p.mnHex, previous_event_id: prev, from_height: from, to_height: to, blocks: leaves.length, openings_version: 2, proof_type: 'ride', ...over },
  }
}

const RIDE_PROVIDER: HosakaProvider = {
  version: 1, name: 'HOSAKA',
  services: [{ type: 'hop', max_height: 27 }, { type: 'ride', max_blocks: 950_000, max_block_height: 949_999, min_msats: 1000 }],
  idempotency: { body_field: 'idempotency_key' },
}

describe('whether HOSAKA is offered for a ride', () => {
  it('only when the provider lists a ride service', () => {
    expect(rideServiceOf(null)).toBeNull()
    expect(rideServiceOf({ version: 1, name: 'old', services: [{ type: 'hop', max_height: 27 }] })).toBeNull()
    expect(rideServiceOf(RIDE_PROVIDER)).toEqual({ maxBlocks: 950_000, maxBlockHeight: 949_999, minMsats: 1000 })
    expect(rideFits(rideServiceOf({ version: 1, name: 'old' }), 690_936, 29_898)).toBe(false)
  })

  it('only when the ride fits max_blocks and max_block_height, and is not zero-length', () => {
    const s = rideServiceOf(RIDE_PROVIDER)
    expect(rideFits(s, 690_936, 29_898)).toBe(true) // the live quote's ride, 661,038 blocks
    expect(rideFits(s, 949_000, 949_999)).toBe(true)
    expect(rideFits(s, 949_000, 950_000)).toBe(false) // past the newest block HOSAKA verifies
    expect(rideFits(s, 950_001, 10)).toBe(false)
    expect(rideFits({ maxBlocks: 1000, maxBlockHeight: null, minMsats: null }, 0, 1001)).toBe(false)
    expect(rideFits({ maxBlocks: 1000, maxBlockHeight: null, minMsats: null }, 0, 1000)).toBe(true)
    expect(rideFits(s, 5, 5)).toBe(false)
  })

  it('a quote is shown only as a price HOSAKA would sell this ride at', () => {
    const live = { action: 'ride', from_height: 690_936, to_height: 29_898, blocks: 661_038, attempts: 20_658, cost_msats: 944_000, within_cap: true, est_seconds: 571, est_time: '~10 min', refusal: null }
    expect(rideOfferOf(live, 690_936, 29_898)).toEqual({ fromHeight: 690_936, toHeight: 29_898, costMsats: 944_000, estSeconds: 571, estTime: '~10 min' })
    expect(rideOfferOf(live, 690_936, 29_899)).toBeNull() // a quote for another ride
    expect(rideOfferOf({ ...live, within_cap: false, cost_msats: null, refusal: { error: 'height_beyond_line' } }, 690_936, 29_898)).toBeNull()
    expect(rideOfferOf({ ...live, cost_msats: null }, 690_936, 29_898)).toBeNull()
    expect(rideOfferOf('nope', 1, 2)).toBeNull()
  })
})

describe('which way to ride is highlighted', () => {
  const offer = { fromHeight: 1, toHeight: 2, costMsats: 944_000, estSeconds: 571, estTime: null }
  it('COST rides here; TIME and LOOT take the faster, counting the payment', () => {
    expect(rideChoice('cost', 3600 * 17, offer)).toBe('local')
    expect(rideChoice('time', 3600 * 17, offer)).toBe('hosaka')
    expect(rideChoice('loot', 3600 * 17, offer)).toBe('hosaka')
    expect(rideChoice('time', 120, offer)).toBe('local')
    expect(rideChoice('time', 590, offer)).toBe('local') // 571 s + 30 s of paying is not faster than 590 s
    expect(rideChoice('time', null, offer)).toBe('hosaka') // still calibrating: rides are long
    expect(rideChoice('time', 3600, null)).toBe('local')
    expect(rideChoice('time', 3600, { ...offer, estSeconds: null })).toBe('local')
  })
})

describe('a finished HOSAKA ride is checked here before anything is signed', () => {
  const asked = { previousId: PREV, fromHeight: 100, toHeight: 105 }

  it('a true proof passes Level 1 against this device\'s own block hashes', async () => {
    expect(await verifyCloudRide(completedRide(PREV, 100, 105), asked, fakeHash)).toEqual([])
  })

  it('a forged proof is refused: a tampered opening, a wrong root, a nonce under the price', async () => {
    const good = completedRide(PREV, 100, 105)
    const r = good.result as { mp: string; root: string; mn: string }
    const flip = (hex: string): string => (hex[0] === '0' ? '1' : '0') + hex.slice(1)
    expect(await verifyCloudRide({ ...good, result: { ...r, mp: flip(r.mp) } }, asked, fakeHash)).not.toEqual([])
    expect(await verifyCloudRide({ ...good, result: { ...r, root: flip(r.root) } }, asked, fakeHash)).not.toEqual([])
    expect(await verifyCloudRide({ ...good, result: { ...r, mn: 'f'.repeat(16) } }, asked, fakeHash)).not.toEqual([])
    expect(await verifyCloudRide({ ...good, result: { ...r, mn: 'nope' } }, asked, fakeHash)).not.toEqual([])
  })

  it('a proof over other block hashes is refused: HOSAKA cannot invent the line', async () => {
    const otherLine = (h: number): string => fakeHash(h + 1)
    expect(await verifyCloudRide(completedRide(PREV, 100, 105), asked, otherLine)).not.toEqual([])
  })

  it('a valid proof for another head or other blocks is refused', async () => {
    expect(await verifyCloudRide(completedRide('cd'.repeat(32), 100, 105), asked, fakeHash)).toEqual(['the proof is bound to another chain head'])
    const elsewhere = await verifyCloudRide(completedRide(PREV, 100, 106), asked, fakeHash)
    expect(elsewhere[0]).toMatch(/from block 100 to block 106/)
    // Lying about which ride it is does not help: the leaves are seeded by the head.
    const relabeled = completedRide('cd'.repeat(32), 100, 105, { previous_event_id: PREV })
    expect(await verifyCloudRide(relabeled, asked, fakeHash)).not.toEqual([])
  })

  it('a job without a ride result is refused', async () => {
    expect(await verifyCloudRide({ id: 'j', status: 'completed', cost_msats: 1, result: null, error: null }, asked, fakeHash)).toEqual(['the job carries no result'])
  })

  it('a sampled block this device has not synced rejects instead of judging', async () => {
    await expect(verifyCloudRide(completedRide(PREV, 100, 105), asked, () => { throw new Error('not synced') })).rejects.toThrow(/not synced/)
  })
})

describe('the ride record survives a reload', () => {
  beforeEach(() => clearCloudJob())
  const record: PendingCloudJob = {
    version: 1, jobId: 'job-ride', pollToken: 'tok', action: 'ride', pubkey: 'p',
    from: wirePosition({ x: 1n, y: 2n, z: 3n }), to: wirePosition({ x: 1n << 84n, y: 5n, z: 6n }), plane: 1,
    prevEventId: PREV, costMsats: 944_000, createdAt: 10, stage: 'computing', deposit: null, estSeconds: 571, computingAt: 20,
    ride: { fromHeight: 690_936, toHeight: 29_898, asOf: 949_000, toCoordHex: 'cd'.repeat(32) },
  }

  it('round trips with the ride, its patience and its start', () => {
    saveCloudJob(record)
    expect(loadCloudJob()).toEqual(record)
  })

  it('a ride record without its ride is dropped, never followed blind', () => {
    const { ride: _ride, ...bare } = record
    void _ride
    saveCloudJob(bare as PendingCloudJob)
    expect(loadCloudJob()).toBeNull()
    saveCloudJob({ ...record, ride: { fromHeight: 7, toHeight: 7, toCoordHex: 'cd'.repeat(32) } })
    expect(loadCloudJob()).toBeNull()
  })
})

describe('the client speaks the ride contract', () => {
  const sk = generateSecretKey()
  const sign = async (t: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(t, sk)
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('quotes in public, with no signature', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetch = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return json({ within_cap: true, cost_msats: 1000, blocks: 5 }) })
    const client = createHosaka({ apiUrl: 'http://h', sign, fetch: fetch as unknown as typeof globalThis.fetch })
    await client.rideQuote(100, 105)
    expect(calls[0].url).toBe('http://h/api/v1/ride/quote')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ from_height: 100, to_height: 105 })
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('a lost submit answer is asked again with the same key, so it is one job and one charge', async () => {
    const bodies: Array<Record<string, unknown>> = []
    let rides = 0
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/api/v1/provider')) return json(RIDE_PROVIDER)
      expect(url).toBe('http://h/api/v1/ride')
      expect((init.headers as Record<string, string>).authorization).toMatch(/^Nostr /)
      bodies.push(JSON.parse(String(init.body)))
      if (++rides === 1) throw new TypeError('connection reset')
      const key = bodies[bodies.length - 1].idempotency_key
      return json({ id: 'job-ride', status: 'computing', cost_msats: 944_000, poll_token: 't', result: null, error: null, idempotency_key: key, idempotent_replay: true, balance_debited: true }, 200)
    })
    const client = createHosaka({ apiUrl: 'http://h', sign, fetch: fetch as unknown as typeof globalThis.fetch, lostAnswerDelaysMs: [0, 0] })
    const job = await client.submitRide(PREV, 100, 105)
    expect(job.id).toBe('job-ride')
    expect(bodies).toHaveLength(2)
    const key = idempotencyKeyFor('ride', rideBody(PREV, 100, 105))
    expect(bodies[0]).toEqual({ previous_event_id: PREV, from_height: 100, to_height: 105, idempotency_key: key })
    expect(bodies[1].idempotency_key).toBe(key)
    // Another head or other blocks is another job.
    expect(idempotencyKeyFor('ride', rideBody('cd'.repeat(32), 100, 105))).not.toBe(key)
    expect(idempotencyKeyFor('ride', rideBody(PREV, 100, 106))).not.toBe(key)
  })
})
