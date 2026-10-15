/**
 * hosakaRide.test.ts - RIDE VIA HOSAKA, end to end against a fake HOSAKA
 * (onosendai-launch #35 P5; arkinox, 2026-10-11).
 *
 * The HOSAKA client is faked and answers with a ride proof computed here the
 * way HOSAKA computes it; everything else is real: the ride planned by the
 * same planRide RIDE HERE uses, the submit, the invoice and claim, the
 * poll, this device's Level 1 check, the head held while it runs, and the
 * hyperjump signed through completeRide. What would go wrong silently: a
 * forged proof signed, a paid ride lost on a reload, a second charge, or a
 * hop signed from the head while HOSAKA computes a ride bound to it.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) }, clear: () => { mem.clear() },
  }
})

/** The fake line: block hashes by height, filled before the tests with light terrain so proofs are quick. */
const line = vi.hoisted(() => new Map<number, string>())
const hashOf = (height: number): string => {
  const h = line.get(height)
  if (!h) throw new Error(`no fake hash for block ${height}`)
  return h
}

const fake = vi.hoisted(() => ({
  apiUrl: 'http://fake',
  limits: vi.fn(), provider: vi.fn(), quote: vi.fn(), submitHop: vi.fn(), submitSidestep: vi.fn(), submitRegionKey: vi.fn(),
  rideQuote: vi.fn(), submitRide: vi.fn(), getJob: vi.fn(), startJob: vi.fn(), claimDeposit: vi.fn(), balance: vi.fn(), deposit: vi.fn(),
  waitForDeposit: vi.fn(), waitForJob: vi.fn(),
}))

vi.mock('../../lib/hosaka', async (o) => ({ ...(await o() as object), createHosaka: () => fake }))
vi.mock('../../lib/workers', async (o) => ({ ...(await o() as object), postProof: vi.fn(), cancelProof: vi.fn() }))
// The station is block 100 and the line holds every block's hash.
vi.mock('../../lib/hyperspace/station', async (o) => ({ ...(await o() as object), findStation: () => ({ stop: { height: 100 }, distance: 3 }) }))
vi.mock('../../store/useHyperspace', async (o) => ({
  ...(await o() as object),
  getStopByHeight: (height: number) => ({ height, kind: 'port', merkleRoot: 'ab'.repeat(32), blockHash: line.get(height), coordExact: (5n << 200n) + 1n, coordApprox: (5n << 200n) + 1n }),
}))
vi.mock('../../lib/chains', async (o) => ({ ...(await o() as object), fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => []) }))


import { bytesToHex, coordToXyz, hexToCoord, sha256 } from 'cyberspace-core'
import { enterHyperspaceTemplate, type NostrEvent } from '../../lib/events'
import { buildRideProof, computeRideLeaf, lineTerrainK, rideBlocks } from '../../lib/hyperspace/ride'
import { clearCloudJob, loadCloudJob, saveCloudJob, wirePosition, type PendingCloudJob } from '../../lib/cloud'
import type { HosakaDeposit, HosakaJob } from '../../lib/hosaka'
import { useCyberspace } from '../../store/useCyberspace'
import { useHyperspace } from '../../store/useHyperspace'
import { startHosakaRide, startRide, useRideRun } from '../HyperspacePanel'
import { placeSpawn } from '../../store/fixtures/placeSpawn'

const OFFER = { fromHeight: 100, toHeight: 105, costMsats: 6_000, estSeconds: 60, estTime: '~1 min' }

/** HOSAKA's completed ride, computed here as HOSAKA computes it. */
function completed(prev: string, over: Record<string, unknown> = {}): HosakaJob {
  const leaves = rideBlocks(100, 105).map((h) => computeRideLeaf(prev, h, hashOf(h)))
  const p = buildRideProof(prev, leaves)
  return {
    id: 'job-ride', status: 'completed', cost_msats: 6_000, error: null, poll_token: 'tok',
    result: { root: p.rootHex, mp: p.mp, mn: p.mnHex, previous_event_id: prev, from_height: 100, to_height: 105, blocks: 5, attempts: 1, openings_version: 2, proof_type: 'ride', compute_msats: 5_000, ...over },
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

/** A fresh chain boarded at its spawn, block 105 chosen. Returns the boarding's id: the ride's previous. */
async function boarded(): Promise<string> {
  useCyberspace.setState({ events: [] })
  await placeSpawn()
  const s = useCyberspace.getState()
  const pk = s.identity.pubkey
  const enter = await s.signEvent(enterHyperspaceTemplate({ createdAt: s.events[0].created_at + 1, genesisId: s.genesisId, previousId: s.prevEventId, coordHex: pk, proofHash: 'a'.repeat(64) })) as NostrEvent
  const { x, y, z, plane } = coordToXyz(hexToCoord(pk))
  useCyberspace.setState({ events: [...s.events, enter], prevEventId: enter.id, position: { x, y, z }, headPlane: plane, plane, transit: { stage: 'boarded', enterEventId: enter.id, enterCoordHex: pk }, chainConflict: null })
  useHyperspace.setState({ destination: 105, tipHeight: 110 })
  return enter.id
}

const head = (): NostrEvent => { const e = useCyberspace.getState().events; return e[e.length - 1] }
const tag = (e: NostrEvent, name: string): string | undefined => e.tags.find((t) => t[0] === name)?.[1]

beforeAll(() => {
  // Real-looking hashes, each with terrain K of 2 or less: a leaf is then a
  // Cantor tree of at most 2^8 pairings, so a five-block proof is instant.
  let n = 0
  for (let height = 95; height <= 115; height++) {
    for (;;) {
      const hash = bytesToHex(sha256(new TextEncoder().encode(`fake-block-${height}-${n++}`)))
      if (lineTerrainK(hash) <= 2) { line.set(height, hash); break }
    }
  }
})

beforeEach(() => {
  for (const f of Object.values(fake)) if (typeof f === 'function') f.mockReset()
  clearCloudJob()
  useRideRun.setState({ error: null, progress: null, hosaka: false, path: null })
  useCyberspace.setState({
    cloudPrefs: { mode: 'auto', autoMaxSats: 0, apiUrl: 'http://fake', profile: 'time' },
    plan: null,
    proof: { ...useCyberspace.getState().proof, status: 'idle', message: null },
    cloud: { ...useCyberspace.getState().cloud, status: 'idle', job: null, invoice: null, invoiceOpen: false, message: null, rideError: null },
  })
})
afterEach(() => { useCyberspace.getState().cancelCloud() })

describe('RIDE VIA HOSAKA', () => {
  it('from the balance: submit with the ride, poll, check here, sign the hyperjump with HOSAKA\'s proof', async () => {
    const prev = await boarded()
    const before = useCyberspace.getState().events.length
    const done = completed(prev)
    fake.submitRide.mockResolvedValue({ id: 'job-ride', status: 'computing', cost_msats: 6_000, poll_token: 'tok', result: null, error: null, balance_debited: true, new_balance_msats: 94_000 })
    fake.waitForJob.mockResolvedValue(done)

    await startHosakaRide(OFFER)

    expect(fake.submitRide).toHaveBeenCalledTimes(1)
    expect(fake.submitRide.mock.calls[0].slice(0, 3)).toEqual([prev, 100, 105])
    expect(fake.waitForJob.mock.calls[0].slice(0, 2)).toEqual(['job-ride', 'tok'])
    const s = useCyberspace.getState()
    expect(s.events).toHaveLength(before + 1)
    const e = head()
    expect(tag(e, 'A')).toBe('hyperjump')
    expect(tag(e, 'from_height')).toBe('100')
    expect(tag(e, 'B')).toBe('105')
    expect(tag(e, 'as_of')).toBe('110')
    const r = done.result as { root: string; mp: string; mn: string }
    expect(tag(e, 'proof')).toBe(r.root)
    expect(tag(e, 'mp')).toBe(r.mp)
    expect(tag(e, 'mn')).toBe(r.mn)
    expect(s.transit).toBeNull()
    expect(s.cloud.status).toBe('idle')
    expect(s.cloud.last?.action).toBe('ride')
    expect(s.cloud.balance?.msats).toBe(94_000)
    expect(s.proof.status).toBe('idle')
    expect(loadCloudJob()).toBeNull()
    expect(useHyperspace.getState().destination).toBeNull()
  })

  it('by invoice: the invoice modal opens, the job is on disk first, and it starts once the node says paid', async () => {
    const prev = await boarded()
    const deposit: HosakaDeposit = { deposit_id: 'dep-1', status: 'pending', amount_msats: 6_000, bolt11: 'lnbc60n1fake', payment_hash: 'h', created_at: 1, expires_at: Math.floor(Date.now() / 1000) + 3600, settled_at: null, settled_msats: null, preimage: null }
    fake.submitRide.mockResolvedValue({ id: 'job-ride', status: 'pending', cost_msats: 6_000, poll_token: 'tok', result: null, error: null, payment_required: true, amount_due_msats: 6_000, deposit })
    const paid = deferred<HosakaDeposit>()
    fake.waitForDeposit.mockReturnValue(paid.promise)
    fake.startJob.mockResolvedValue({ id: 'job-ride', status: 'computing', cost_msats: 6_000, result: null, error: null })
    fake.waitForJob.mockResolvedValue(completed(prev))

    const run = startHosakaRide(OFFER)
    await vi.waitFor(() => expect(useCyberspace.getState().cloud.status).toBe('awaiting_payment'))
    const c = useCyberspace.getState().cloud
    expect(c.invoiceOpen).toBe(true)
    expect(c.invoice?.bolt11).toBe('lnbc60n1fake')
    expect(loadCloudJob()?.stage).toBe('awaiting_payment')
    expect(loadCloudJob()?.ride).toEqual({ fromHeight: 100, toHeight: 105, asOf: 110, toCoordHex: expect.stringMatching(/^[0-9a-f]{64}$/) })
    // The head is held: a commit is refused while it computes.
    expect(useCyberspace.getState().proof.status).toBe('computing')
    expect(fake.startJob).not.toHaveBeenCalled()

    paid.resolve({ ...deposit, status: 'settled', settled_msats: 6_000 })
    await run
    expect(fake.waitForDeposit.mock.calls[0][0]).toBe('dep-1')
    expect(fake.startJob).toHaveBeenCalledWith('job-ride')
    expect(tag(head(), 'A')).toBe('hyperjump')
    expect(fake.submitRide).toHaveBeenCalledTimes(1)
  })

  it('a forged proof is never signed, and the person is told', async () => {
    const prev = await boarded()
    const before = useCyberspace.getState().events.length
    const good = completed(prev)
    const r = good.result as { mp: string }
    const forged = { ...good, result: { ...(good.result as object), mp: (r.mp[0] === '0' ? '1' : '0') + r.mp.slice(1) } }
    fake.submitRide.mockResolvedValue({ id: 'job-ride', status: 'computing', cost_msats: 6_000, poll_token: 'tok', result: null, error: null, balance_debited: true })
    fake.waitForJob.mockResolvedValue(forged)

    await startHosakaRide(OFFER)

    const s = useCyberspace.getState()
    expect(s.events).toHaveLength(before)
    expect(s.cloud.status).toBe('error')
    expect(s.cloud.rideError).toMatch(/failed this device's check/)
    expect(s.cloud.rideError).toMatch(/nothing was signed/)
    expect(s.cloud.rideError).toMatch(/job-ride|job-rid/)
    expect(s.proof.status).toBe('idle')
    expect(loadCloudJob()).toBeNull()
    expect(useHyperspace.getState().destination).toBe(105)
  })

  it('a proof for another head is never signed, however valid it is', async () => {
    await boarded()
    const before = useCyberspace.getState().events.length
    fake.submitRide.mockResolvedValue({ id: 'job-ride', status: 'computing', cost_msats: 6_000, poll_token: 'tok', result: null, error: null, balance_debited: true })
    fake.waitForJob.mockResolvedValue(completed('cd'.repeat(32)))
    await startHosakaRide(OFFER)
    expect(useCyberspace.getState().events).toHaveLength(before)
    expect(useCyberspace.getState().cloud.rideError).toMatch(/another chain head/)
  })

  it('a job HOSAKA could not finish says the charge was refunded', async () => {
    await boarded()
    fake.submitRide.mockResolvedValue({ id: 'job-ride', status: 'computing', cost_msats: 6_000, poll_token: 'tok', result: null, error: null, balance_debited: true })
    fake.waitForJob.mockResolvedValue({ id: 'job-ride', status: 'failed', cost_msats: 6_000, result: null, error: 'ride_leaves timed out' })
    await startHosakaRide(OFFER)
    expect(useCyberspace.getState().cloud.rideError).toMatch(/ride_leaves timed out.*refunded to your HOSAKA balance/)
    expect(loadCloudJob()).toBeNull()
  })

  it('while HOSAKA computes, nothing else takes the head: no second ride of either kind', async () => {
    const prev = await boarded()
    fake.submitRide.mockResolvedValue({ id: 'job-ride', status: 'computing', cost_msats: 6_000, poll_token: 'tok', result: null, error: null, balance_debited: true })
    const job = deferred<HosakaJob>()
    fake.waitForJob.mockReturnValue(job.promise)
    const run = startHosakaRide(OFFER)
    await vi.waitFor(() => expect(useCyberspace.getState().cloud.status).toBe('computing'))
    expect(useCyberspace.getState().proof.status).toBe('computing')

    // A second HOSAKA ride is refused before any submit.
    expect(await useCyberspace.getState().rideViaHosaka({ previousId: prev, fromHeight: 100, toHeight: 105, toCoordHex: 'cd'.repeat(32), estSeconds: 60 })).toBe(false)
    expect(fake.submitRide).toHaveBeenCalledTimes(1)
    // A local ride is refused too.
    useRideRun.setState({ hosaka: false })
    await startRide()
    expect(useRideRun.getState().error).toMatch(/A move is computing/)
    expect(useRideRun.getState().progress).toBeNull()

    job.resolve(completed(prev))
    await run
    expect(tag(head(), 'A')).toBe('hyperjump')
  })

  it('a head that moved while HOSAKA computed refuses the proof', async () => {
    const prev = await boarded()
    const before = useCyberspace.getState().events.length
    fake.submitRide.mockResolvedValue({ id: 'job-ride', status: 'computing', cost_msats: 6_000, poll_token: 'tok', result: null, error: null, balance_debited: true })
    const job = deferred<HosakaJob>()
    fake.waitForJob.mockReturnValue(job.promise)
    const run = startHosakaRide(OFFER)
    await vi.waitFor(() => expect(useCyberspace.getState().cloud.status).toBe('computing'))
    useCyberspace.setState({ prevEventId: 'ee'.repeat(32) })
    job.resolve(completed(prev))
    await run
    expect(useCyberspace.getState().events).toHaveLength(before)
    expect(useCyberspace.getState().cloud.rideError).toMatch(/chain moved/)
  })

  it('a quote for another ride than the one planned now is refused before anything is bought', async () => {
    await boarded()
    await startHosakaRide({ ...OFFER, toHeight: 106 })
    expect(fake.submitRide).not.toHaveBeenCalled()
    expect(useRideRun.getState().error).toMatch(/changed since HOSAKA priced it/)
  })

  it('off in the Cloud compute panel: nothing is submitted', async () => {
    await boarded()
    useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' } })
    await startHosakaRide(OFFER)
    expect(fake.submitRide).not.toHaveBeenCalled()
    expect(useCyberspace.getState().cloud.rideError).toMatch(/off/)
  })
})

describe('a reload while HOSAKA computes', () => {
  it('resumes the same job by its id and token, holds the head, and signs it when it lands', async () => {
    const prev = await boarded()
    const before = useCyberspace.getState().events.length
    const record: PendingCloudJob = {
      version: 1, jobId: 'job-ride', pollToken: 'tok', action: 'ride', pubkey: useCyberspace.getState().identity.pubkey,
      from: wirePosition(useCyberspace.getState().position), to: wirePosition({ x: 1n, y: 2n, z: 3n }), plane: 1,
      prevEventId: prev, costMsats: 6_000, createdAt: Date.now() - 30_000, stage: 'computing', deposit: null, estSeconds: 60, computingAt: Date.now() - 20_000,
      ride: { fromHeight: 100, toHeight: 105, asOf: 110, toCoordHex: 'cd'.repeat(32) },
    }
    saveCloudJob(record)
    const job = deferred<HosakaJob>()
    fake.waitForJob.mockReturnValue(job.promise)
    fake.limits.mockResolvedValue({ max_hop_height: 25, max_sidestep_height: 29, hop_min_msats: 1000, deposit_min_msats: 1000, deposit_max_msats: 5e9, invoice_ttl_seconds: 3600 })
    fake.provider.mockResolvedValue({ version: 1, name: 'HOSAKA' })

    const resumed = useCyberspace.getState().resumeCloudJob()
    await vi.waitFor(() => expect(fake.waitForJob).toHaveBeenCalled())
    expect(fake.waitForJob.mock.calls[0].slice(0, 2)).toEqual(['job-ride', 'tok'])
    expect(useCyberspace.getState().proof.status).toBe('computing')
    expect(useCyberspace.getState().cloud.job?.action).toBe('ride')
    expect(fake.submitRide).not.toHaveBeenCalled()

    job.resolve(completed(prev))
    await resumed
    const e = head()
    expect(useCyberspace.getState().events).toHaveLength(before + 1)
    expect(tag(e, 'A')).toBe('hyperjump')
    expect(tag(e, 'C')).toBe('cd'.repeat(32))
    expect(tag(e, 'as_of')).toBe('110')
    expect(loadCloudJob()).toBeNull()
  })

  it('a record whose head has moved is dropped, never signed', async () => {
    await boarded()
    const before = useCyberspace.getState().events.length
    saveCloudJob({
      version: 1, jobId: 'job-ride', pollToken: 'tok', action: 'ride', pubkey: useCyberspace.getState().identity.pubkey,
      from: wirePosition({ x: 0n, y: 0n, z: 0n }), to: wirePosition({ x: 1n, y: 2n, z: 3n }), plane: 1,
      prevEventId: 'ee'.repeat(32), costMsats: 6_000, createdAt: Date.now(), stage: 'computing', deposit: null,
      ride: { fromHeight: 100, toHeight: 105, toCoordHex: 'cd'.repeat(32) },
    })
    await useCyberspace.getState().resumeCloudJob()
    expect(fake.waitForJob).not.toHaveBeenCalled()
    expect(useCyberspace.getState().events).toHaveLength(before)
    expect(loadCloudJob()).toBeNull()
  })
})
