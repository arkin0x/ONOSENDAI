/**
 * routeCloudWaits.test.ts - what a route with HOSAKA steps does after it has
 * waited: for a quote, PAY, a deposit, RESUME, or a signature (review of
 * #581; arkinox ruled the fixes 2026-11-02). HOSAKA is faked; the planner,
 * the funding, the cloud verifier and finishProof are real.
 *
 * A route step is computed from where the chain stands when it starts, never
 * from where it stood when the route was planned. Another device or tab of
 * yours can move the chain while the route waits. The step planned before
 * that names the old position, and the head it is proved under is the new
 * one, so a local sidestep computed as planned was signed and queued with a
 * c it was never proved from, which no reader verifies (N1). Both waits
 * before the first step are driven end to end here.
 *
 * And two ends that went quiet: a funded route whose replan finds it already
 * at its end left the cloud reading PAID until X, and a cloud error dismissed
 * on a step paused for its signature left SIGN AND CONTINUE doing nothing,
 * the route reading running until STOP ROUTE.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { fake, storage } = vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  const fake = {
    apiUrl: 'http://fake',
    limits: vi.fn(), quote: vi.fn(), submitHop: vi.fn(), submitSidestep: vi.fn(), getJob: vi.fn(), startJob: vi.fn(),
    claimDeposit: vi.fn(), balance: vi.fn(), deposit: vi.fn(), waitForDeposit: vi.fn(), waitForJob: vi.fn(),
  }
  return { fake, storage }
})

vi.mock('../../lib/hosaka', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/hosaka')>()
  return { ...actual, createHosaka: () => fake }
})
vi.mock('../../lib/workers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/workers')>()
  return { ...actual, postProof: vi.fn(), cancelProof: vi.fn() }
})

import { bytesToHex, computeHopProofV2, deriveRegionKeys } from 'cyberspace-core'
import { useCalibration } from '../../lib/calibration'
import { hopTemplate } from '../../lib/events'
import type { HosakaJob, HosakaLimits } from '../../lib/hosaka'
import type { Position } from '../../lib/space'
import { postProof } from '../../lib/workers'
import { useCyberspace } from '../useCyberspace'
import { placeSpawn } from '../fixtures/placeSpawn'
import { provedFor } from '../fixtures/provedHop'

const S = useCyberspace.getState
const LIMITS: HosakaLimits = { max_hop_height: 25, max_sidestep_height: 29, hop_min_msats: 1000, deposit_min_msats: 1000, deposit_max_msats: 5e9, invoice_ttl_seconds: 3600, hop_proof_version: 2, hop_paused: false, hop_paused_reason: null }
const quote = (action: 'hop' | 'sidestep') => ({ action, cost_msats: 1000, within_cap: true, cap: 25, max_height: 13, per_axis_heights: { x: 13, y: 0, z: 0 }, K: 7, tier: 'trivial', est_time: 'about 30 sec', est_seconds: 30, hint: null })

/** A move of this identity's chain to `to`, signed as another device of its would have, already on the relays. */
async function moved(to: Position): Promise<string> {
  const s = S()
  const last = s.events[s.events.length - 1]
  const ev = await s.signEvent(hopTemplate({
    createdAt: last.created_at + 1, genesisId: s.genesisId, previousId: s.prevEventId, prevCoordHex: s.coordHex(),
    to, plane: s.headPlane, proofHash: '0'.repeat(64), mn: '0'.repeat(16), mp: '00',
  }))
  useCyberspace.setState({ events: [...S().events, ev], prevEventId: ev.id, published: { ...S().published, [ev.id]: 'ok' }, position: to })
  return ev.id
}

/**
 * The avatar on the leaf touching an h4 wall, the cursor across the h13 wall
 * past it. This machine hops to h2 and sidesteps to h12, so the route starts
 * with a local sidestep and crosses h13 on HOSAKA: a route with a paid step,
 * which waits for its quote and funding before the local first step starts.
 */
async function lineUp(): Promise<{ from: Position; cursor: Position }> {
  const s = S()
  const block = (s.position.x >> 13n) << 13n
  const from = { ...s.position, x: block + 7n }
  if (from.x !== s.position.x) await moved(from)
  const cursor = { ...from, x: block + 4096n + 2n }
  useCyberspace.setState({ cursor })
  return { from, cursor }
}

/** A promise the test resolves by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

const lastPosted = () => vi.mocked(postProof).mock.calls[vi.mocked(postProof).mock.calls.length - 1]?.[0]

describe('a route step whose position moved while the route waited', () => {
  beforeAll(placeSpawn)
  beforeEach(() => {
    useCalibration.setState({ status: 'measured', hopHeight: 2, sidestepHeight: 12 })
    useCyberspace.setState({
      cloud: { ...S().cloud, limits: LIMITS, status: 'idle', job: null, message: null, balance: null },
      cloudPrefs: { mode: 'auto', autoMaxSats: 100, apiUrl: 'http://fake', profile: 'cost' },
      plan: null,
      proof: { ...S().proof, status: 'idle', message: null },
    })
    S().setMoveMode('auto')
    for (const fn of Object.values(fake)) if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset()
    fake.limits.mockResolvedValue(LIMITS)
    fake.quote.mockImplementation(async (kind: 'hop' | 'sidestep') => quote(kind))
    vi.mocked(postProof).mockClear()
    storage.removeItem('onosendai:cloudJob')
    storage.removeItem('onosendai:cloudDeposit')
  })

  it('funding: the local first step starts from where the chain stands after the deposit, under the new head', async () => {
    const { from } = await lineUp()
    const balance = deferred<{ pubkey: string; balance_msats: number; ledger: never[] }>()
    fake.balance.mockReturnValue(balance.promise)
    const committed = S().commit()
    await vi.waitFor(() => { expect(S().cloud.status).toBe('funding') })
    expect(S().plan?.status).toBe('funding')
    expect(S().plan?.step).toMatchObject({ source: 'local', kind: 'sidestep', from })
    expect(postProof).not.toHaveBeenCalled()

    // Another device moves the chain while the balance is checked.
    const there = { ...from, y: from.y + 1n }
    const head = await moved(there)
    balance.resolve({ pubkey: S().identity.pubkey, balance_msats: 5000, ledger: [] })
    await committed

    expect(postProof).toHaveBeenCalledTimes(1)
    expect(lastPosted()).toMatchObject({ from: there, prevEventId: head })
    expect(S().plan?.step.from).toEqual(there)
    expect(S().plan?.message).toMatch(/^Your chain moved while this route waited/)
  })

  it('requote: RESUME after HOSAKA paused starts the local step from where the chain stands, under the new head', async () => {
    const { from } = await lineUp()
    fake.quote.mockResolvedValueOnce({ ...quote('hop'), cost_msats: null, within_cap: false, paused: true, hint: 'Back in a few minutes.' })
    await S().commit()
    expect(S().plan?.status).toBe('paused')
    expect(S().plan?.requote).toBe(true)
    expect(S().plan?.step).toMatchObject({ source: 'local', from })

    const there = { ...from, y: from.y + 1n }
    const head = await moved(there)
    fake.balance.mockResolvedValue({ pubkey: S().identity.pubkey, balance_msats: 5000, ledger: [] })
    S().resumePlan()
    await vi.waitFor(() => { expect(postProof).toHaveBeenCalledTimes(1) })

    expect(lastPosted()).toMatchObject({ from: there, prevEventId: head })
    expect(S().plan?.step.from).toEqual(there)
  })

  it('funding: a HOSAKA first step is not bought for the old position; it is planned again from where the chain stands', async () => {
    useCalibration.setState({ status: 'measured', hopHeight: 12, sidestepHeight: 12 })
    // On the leaf touching an h13 wall: one HOSAKA hop across it is the whole route.
    const s = S()
    const block = (s.position.x >> 13n) << 13n
    const from = { ...s.position, x: block + 4095n }
    if (from.x !== s.position.x) await moved(from)
    useCyberspace.setState({ cursor: { ...from, x: from.x ^ (1n << 12n) } })
    const balance = deferred<{ pubkey: string; balance_msats: number; ledger: never[] }>()
    fake.balance.mockReturnValue(balance.promise)
    fake.submitHop.mockResolvedValue({ id: 'job-s', status: 'computing', cost_msats: 1000, poll_token: 'tok', result: null, error: null, payment_required: false, balance_debited: true })
    fake.waitForJob.mockReturnValue(new Promise(() => {}))
    const committed = S().commit()
    await vi.waitFor(() => { expect(S().cloud.status).toBe('funding') })
    expect(S().plan?.step).toMatchObject({ source: 'cloud', from })

    const there = { ...from, y: from.y + 1n }
    await moved(there)
    balance.resolve({ pubkey: S().identity.pubkey, balance_msats: 5000, ledger: [] })
    await committed

    // Nothing is bought for the old position: whatever HOSAKA is asked for starts where the chain stands.
    for (const call of fake.submitHop.mock.calls) expect(call[0]).toMatchObject({ x: there.x, y: there.y, z: there.z })
    expect(S().plan?.step.from).toEqual(there)
    expect(S().plan?.message).toMatch(/^Your chain moved while this route waited/)
  })
})

/** What HOSAKA's completed hop job carries for this move (hop proof version 2), proved here by core at h13. */
function hopResult(from: Position, to: Position, plane: 0 | 1, prev: string): Record<string, unknown> {
  const p = computeHopProofV2(from.x, from.y, from.z, to.x, to.y, to.z, plane, prev)
  const keys = deriveRegionKeys(p.regionN)
  return {
    seal: p.tags.proof, mn: p.tags.mn, mp: p.tags.mp, K: p.terrainK,
    region_n: { public_proof: keys.lookupIdHex, secret_key: bytesToHex(keys.locationDecryptionKey) },
    max_height: 13, compute_msats: 1000,
  }
}
const funded = (): HosakaJob => ({ id: 'job-1', status: 'computing', cost_msats: 1000, poll_token: 'tok-job-1', result: null, error: null, payment_required: false, balance_debited: true })
const completed = (result: unknown): HosakaJob => ({ id: 'job-1', status: 'completed', cost_msats: 1000, result, error: null })

/** After a cloud step signed by SIGN AND CONTINUE: what runCloud does for one that signed at once. */
async function signedAndCleaned(spentBefore: number): Promise<void> {
  await vi.waitFor(() => { expect(storage.getItem('onosendai:cloudJob')).toBeNull() })
  expect(S().cloud.job).toBeNull()
  expect(S().cloud.status).toBe('idle')
  expect(S().cloud.message).toBeNull()
  expect(S().cloud.last).toMatchObject({ jobId: 'job-1', action: 'hop', costMsats: 1000 })
  expect(S().spentMsats).toBe(spentBefore + 1000)
}

describe('a funded route that ends or pauses', () => {
  beforeAll(placeSpawn)
  beforeEach(() => {
    useCalibration.setState({ status: 'measured', hopHeight: 2, sidestepHeight: 12 })
    useCyberspace.setState({
      cloud: { ...S().cloud, limits: LIMITS, status: 'idle', job: null, message: null, balance: null },
      cloudPrefs: { mode: 'auto', autoMaxSats: 100, apiUrl: 'http://fake', profile: 'cost' },
      plan: null,
      proof: { ...S().proof, status: 'idle', message: null },
    })
    S().setMoveMode('auto')
    for (const fn of Object.values(fake)) if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset()
    fake.limits.mockResolvedValue(LIMITS)
    fake.quote.mockImplementation(async (kind: 'hop' | 'sidestep') => quote(kind))
    fake.balance.mockResolvedValue({ pubkey: S().identity.pubkey, balance_msats: 5000, ledger: [] })
    vi.mocked(postProof).mockClear()
    storage.removeItem('onosendai:cloudJob')
    storage.removeItem('onosendai:cloudDeposit')
  })

  it('its replan, finding the chain already at the end, ends the cloud flow too: nothing reads PAID until X', async () => {
    const { cursor } = await lineUp()
    await S().commit()
    expect(S().cloud.status).toBe('paid')
    expect(postProof).toHaveBeenCalledTimes(1)
    const req = lastPosted()
    // While the first step computes, another device takes the chain to the route's end.
    await moved(cursor)
    await S().applyProofMessage({ type: 'done', id: req.id, mode: 'sidestep', elapsedMs: 5, ...provedFor(req), terrainK: 3, lca: { x: 4, y: 0, z: 0 }, totalOps: 1, prevEventId: req.prevEventId })
    expect(S().plan).toBeNull()
    expect(S().proof.message).toMatch(/already the end of the route\.$/)
    expect(S().cloud.status).toBe('idle')
    expect(S().cloud.message).toBeNull()
  })

  it('SIGN AND CONTINUE after a dismissed cloud error signs the kept proof and the route goes on', async () => {
    useCalibration.setState({ status: 'measured', hopHeight: 12, sidestepHeight: 12 })
    // On the leaf touching an h13 wall: one HOSAKA hop across it is the whole route.
    const s = S()
    const block = (s.position.x >> 13n) << 13n
    const from = { ...s.position, x: block + 4095n }
    if (from.x !== s.position.x) await moved(from)
    const to = { ...from, x: from.x ^ (1n << 12n) }
    useCyberspace.setState({ cursor: to })
    const head = S().prevEventId
    const before = S().events.length
    const spent = S().spentMsats
    fake.submitHop.mockResolvedValue(funded())
    fake.waitForJob.mockResolvedValue(completed(hopResult(from, to, S().plane, head)))
    const sign = S().signEvent
    useCyberspace.setState({ signEvent: async () => { throw new Error('user declined') } })
    try {
      await S().commit()
      await vi.waitFor(() => { expect(S().cloud.status).toBe('error') })
    } finally {
      useCyberspace.setState({ signEvent: sign })
    }
    expect(S().plan).toMatchObject({ status: 'paused' })
    expect(S().plan?.awaiting).not.toBeNull()

    // The error is dismissed; the route still offers SIGN AND CONTINUE.
    S().cancelCloud()
    expect(S().plan).toMatchObject({ status: 'paused' })
    expect(S().plan?.awaiting).not.toBeNull()

    S().resumePlan()
    await vi.waitFor(() => { expect(S().events).toHaveLength(before + 1) })
    expect(S().position).toEqual(to)
    expect(S().plan).toBeNull()
    expect(fake.submitHop).toHaveBeenCalledTimes(1)
    await signedAndCleaned(spent)
  })

  it('SIGN AND CONTINUE on a cloud step cleans up as a cloud step that signed at once does: no kept job, no kept words, the cost counted', async () => {
    useCalibration.setState({ status: 'measured', hopHeight: 12, sidestepHeight: 12 })
    const s = S()
    const block = (s.position.x >> 13n) << 13n
    const from = { ...s.position, x: block + 4095n }
    if (from.x !== s.position.x) await moved(from)
    const to = { ...from, x: from.x ^ (1n << 12n) }
    useCyberspace.setState({ cursor: to })
    const before = S().events.length
    const spent = S().spentMsats
    fake.submitHop.mockResolvedValue(funded())
    fake.waitForJob.mockResolvedValue(completed(hopResult(from, to, S().plane, S().prevEventId)))
    const sign = S().signEvent
    useCyberspace.setState({ signEvent: async () => { throw new Error('user declined') } })
    try {
      await S().commit()
      await vi.waitFor(() => { expect(S().cloud.status).toBe('error') })
    } finally {
      useCyberspace.setState({ signEvent: sign })
    }
    expect(storage.getItem('onosendai:cloudJob')).not.toBeNull()
    expect(S().cloud.message).toMatch(/The verified cloud result is kept\.$/)
    expect(S().spentMsats).toBe(spent)

    S().resumePlan()
    await vi.waitFor(() => { expect(S().events).toHaveLength(before + 1) })
    expect(S().position).toEqual(to)
    await signedAndCleaned(spent)
  })
})
