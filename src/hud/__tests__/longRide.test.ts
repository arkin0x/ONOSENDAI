/**
 * longRide.test.ts - a ride of about 500,000 blocks (2026-11-16).
 *
 * A player at block 517,475 asked HOSAKA for a ride to block 121, 517,354
 * blocks, was quoted about 1,000 sats, pressed RIDE VIA HOSAKA, and the game
 * broke; HOSAKA never received the submit. Planning the ride read every
 * passed block through getStopByHeight, which materializes a Stop per block
 * and keeps it in the stop cache for good: two hex strings, a bigint and a
 * map entry for each of half a million blocks, on the main thread, before
 * anything was sent. Planning now checks the hashes on the index columns
 * and materializes nothing per block.
 *
 * Also here: a submit HOSAKA refuses is said in words, with nothing paid and
 * the head let go, and a job it cannot finish says the charge came back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) }, clear: () => { mem.clear() },
  }
})

const FROM = 517_475
const TO = 121
const TIP = 976_121

const fake = vi.hoisted(() => ({
  apiUrl: 'http://fake',
  limits: vi.fn(), provider: vi.fn(), quote: vi.fn(), submitHop: vi.fn(), submitSidestep: vi.fn(), submitRegionKey: vi.fn(),
  rideQuote: vi.fn(), submitRide: vi.fn(), getJob: vi.fn(), startJob: vi.fn(), claimDeposit: vi.fn(), balance: vi.fn(), deposit: vi.fn(),
  waitForDeposit: vi.fn(), waitForJob: vi.fn(),
}))
/** Every height planning asked a Stop for, and every span it checked for hashes. */
const reads = vi.hoisted(() => ({ stops: [] as number[], spans: [] as Array<[number, number]> }))

vi.mock('../../lib/hosaka', async (o) => ({ ...(await o() as object), createHosaka: () => fake }))
vi.mock('../../lib/workers', async (o) => ({ ...(await o() as object), postProof: vi.fn(), cancelProof: vi.fn() }))
vi.mock('../../lib/hyperspace/station', async (o) => ({ ...(await o() as object), findStation: () => ({ stop: { height: 517_475 }, distance: 3 }) }))
vi.mock('../../store/useHyperspace', async (o) => ({
  ...(await o() as object),
  getStopByHeight: (height: number) => {
    reads.stops.push(height)
    return { height, kind: 'port', merkleRoot: 'ab'.repeat(32), blockHash: 'cd'.repeat(32), coordExact: (5n << 200n) + 1n, coordApprox: (5n << 200n) + 1n }
  },
  getBlockHash: () => 'cd'.repeat(32),
  firstUnhashedHeight: (lo: number, hi: number) => { reads.spans.push([lo, hi]); return null },
}))
vi.mock('../../lib/chains', async (o) => ({ ...(await o() as object), fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => []) }))

import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { enterHyperspaceTemplate, type NostrEvent } from '../../lib/events'
import { HosakaError } from '../../lib/hosaka'
import { useCyberspace } from '../../store/useCyberspace'
import { useHyperspace } from '../../store/useHyperspace'
import { startHosakaRide, useRideRun } from '../HyperspacePanel'
import { placeSpawn } from '../../store/fixtures/placeSpawn'

const OFFER = { fromHeight: FROM, toHeight: TO, costMsats: 1_057_000, estSeconds: 469, estTime: 'about 8 min' }

/** A fresh chain boarded at its spawn, block 121 chosen, the line synced to 976,121. */
async function boarded(): Promise<string> {
  useCyberspace.setState({ events: [] })
  await placeSpawn()
  const s = useCyberspace.getState()
  const pk = s.identity.pubkey
  const enter = await s.signEvent(enterHyperspaceTemplate({ createdAt: s.events[0].created_at + 1, genesisId: s.genesisId, previousId: s.prevEventId, coordHex: pk, proofHash: 'a'.repeat(64) })) as NostrEvent
  const { x, y, z, plane } = coordToXyz(hexToCoord(pk))
  useCyberspace.setState({ events: [...s.events, enter], prevEventId: enter.id, position: { x, y, z }, headPlane: plane, plane, transit: { stage: 'boarded', enterEventId: enter.id, enterCoordHex: pk }, chainConflict: null })
  useHyperspace.setState({ destination: TO, tipHeight: TIP })
  return enter.id
}

beforeEach(() => {
  for (const f of Object.values(fake)) if (typeof f === 'function') f.mockReset()
  reads.stops.length = 0
  reads.spans.length = 0
  localStorage.removeItem('onosendai:cloudJob')
  useRideRun.setState({ error: null, progress: null, hosaka: false, path: null, boarding: false })
  useCyberspace.setState({
    cloudPrefs: { mode: 'auto', autoMaxSats: 0, apiUrl: 'http://fake', profile: 'time' },
    plan: null,
    proof: { ...useCyberspace.getState().proof, status: 'idle', message: null },
    cloud: { ...useCyberspace.getState().cloud, status: 'idle', job: null, invoice: null, invoiceOpen: false, message: null, rideError: null },
  })
})
afterEach(() => { useCyberspace.getState().cancelCloud() })

describe('RIDE VIA HOSAKA for 517,354 blocks', () => {
  it('reaches HOSAKA without materializing a Stop per block, and checks every block in one span', async () => {
    const prev = await boarded()
    fake.submitRide.mockResolvedValue({ id: 'job-long', status: 'computing', cost_msats: 1_057_000, poll_token: 'tok', result: null, error: null, balance_debited: true })
    fake.waitForJob.mockResolvedValue({ id: 'job-long', status: 'failed', cost_msats: 1_057_000, result: null, error: 'ride_work timed out' })
    const t0 = performance.now()
    await startHosakaRide(OFFER)
    expect(performance.now() - t0).toBeLessThan(5_000)
    expect(fake.submitRide).toHaveBeenCalledTimes(1)
    expect(fake.submitRide.mock.calls[0].slice(0, 3)).toEqual([prev, FROM, TO])
    // The destination's own Stop, for its coordinate; never one per passed block.
    expect(reads.stops.length).toBeLessThan(10)
    expect(reads.spans).toEqual([[TO + 1, FROM]])
  })

  it('a job HOSAKA could not finish says the charge was refunded, and lets the head go', async () => {
    await boarded()
    fake.submitRide.mockResolvedValue({ id: 'job-long', status: 'computing', cost_msats: 1_057_000, poll_token: 'tok', result: null, error: null, balance_debited: true })
    fake.waitForJob.mockResolvedValue({ id: 'job-long', status: 'failed', cost_msats: 1_057_000, result: null, error: 'ride_work timed out' })
    await startHosakaRide(OFFER)
    const s = useCyberspace.getState()
    expect(s.cloud.rideError).toMatch(/ride_work timed out.*refunded to your HOSAKA balance/)
    expect(s.proof.status).toBe('idle')
    expect(useRideRun.getState().hosaka).toBe(false)
  })

  it('a submit HOSAKA refuses (over its cap) is said in words: no invoice, nothing paid, the head let go', async () => {
    await boarded()
    fake.submitRide.mockRejectedValue(new HosakaError(400, 'ride_too_long', 'this ride passes more blocks than HOSAKA sells'))
    await startHosakaRide(OFFER)
    const s = useCyberspace.getState()
    expect(s.cloud.rideError).toBeTruthy()
    expect(s.cloud.invoice).toBeNull()
    expect(fake.waitForDeposit).not.toHaveBeenCalled()
    expect(s.proof.status).toBe('idle')
    expect(s.transit?.stage).toBe('boarded')
    expect(useRideRun.getState().hosaka).toBe(false)
  })
})
