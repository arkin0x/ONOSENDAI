/**
 * cloud.test.ts - a commit beyond this machine goes to HOSAKA and comes back
 * as a signed event, through the store.
 *
 * The HOSAKA client is faked; everything else is real: the routing in
 * commit(), the quote and PAY gate, the record written before the invoice,
 * the verifier (cyberspace-core computes the "cloud" result at h13 so the
 * checks are exact), the refusal when the chain head moved, and
 * applyProofMessage signing the hop or sidestep exactly as it would a local
 * one. What would fail silently otherwise: a cloud proof appended to a chain
 * whose head has moved on, a record written only after the invoice is shown
 * (a reload mid-payment loses the job), or a cancelled flow landing late.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../lib/hosaka', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/hosaka')>()
  return { ...actual, createHosaka: () => fake }
})

// No Worker under node: the local proof path is observed, not run.
vi.mock('../lib/workers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/workers')>()
  return { ...actual, postProof: vi.fn(), cancelProof: vi.fn() }
})

import { cantorPair, computeHopProof, computeSidestepProof, bytesToHex, hexToBytes, intToBytesBE, sha256Hex, sidestepLanding } from 'cyberspace-core'
import { useCalibration } from '../lib/calibration'
import { saveCloudJob, type PendingCloudJob } from '../lib/cloud'
import { parseAction } from '../lib/events'
import { HosakaError, type HosakaDeposit, type HosakaJob, type HosakaLimits } from '../lib/hosaka'
import type { Position } from '../lib/space'
import { postProof } from '../lib/workers'
import { useCyberspace } from './useCyberspace'

const LIMITS: HosakaLimits = { max_hop_height: 25, max_sidestep_height: 29, hop_min_msats: 1000, deposit_min_msats: 1000, deposit_max_msats: 5e9, invoice_ttl_seconds: 3600 }

function envelope(n: bigint): { public_proof: string; secret_key: string } {
  const secret = sha256Hex(intToBytesBE(n))
  return { public_proof: sha256Hex(hexToBytes(secret)), secret_key: secret }
}

/** What HOSAKA's completed hop job would carry for this move, computed here at h13. */
function hopResult(from: Position, to: Position, plane: 0 | 1, prev: string): Record<string, unknown> {
  const p = computeHopProof(from.x, from.y, from.z, to.x, to.y, to.z, plane, prev, 20)
  const h = (a: bigint, b: bigint): number => (a === b ? 0 : (a ^ b).toString(2).length)
  return {
    hop_n: envelope(p.hopN), region_n: envelope(p.regionN), region_xy: envelope(cantorPair(p.cantorX, p.cantorY)),
    cantor_x: envelope(p.cantorX), cantor_y: envelope(p.cantorY), cantor_z: envelope(p.cantorZ), cantor_t: envelope(p.cantorT),
    K: p.terrainK, max_height: Math.max(h(from.x, to.x), h(from.y, to.y), h(from.z, to.z)), compute_msats: 1000,
  }
}

function sidestepResult(from: Position, to: Position, plane: 0 | 1, prev: string): Record<string, unknown> {
  const p = computeSidestepProof(from.x, from.y, from.z, to.x, to.y, to.z, plane, prev)
  const hex = (b: Uint8Array[]): string[] => b.map(bytesToHex)
  return {
    proof_hash: p.proofHash, merkle_x: bytesToHex(p.merkleX), merkle_y: bytesToHex(p.merkleY), merkle_z: bytesToHex(p.merkleZ),
    inclusion_proofs: { x: hex(p.inclusionProofs.x), y: hex(p.inclusionProofs.y), z: hex(p.inclusionProofs.z) },
    lca_heights: p.lcaHeights, previous_event_id: prev, terrain_k: p.terrainK, region_m_hex: p.regionM.toString(16), compute_msats: 300,
  }
}

const quote = (action: 'hop' | 'sidestep', cost = 1000) => ({ action, cost_msats: cost, within_cap: true, cap: 25, max_height: 13, per_axis_heights: { x: 13, y: 0, z: 0 }, K: 7, tier: 'trivial', est_time: '<5 sec', hint: null })
const funded = (id = 'job-1'): HosakaJob => ({ id, status: 'computing', cost_msats: 1000, poll_token: `tok-${id}`, result: null, error: null, payment_required: false, balance_debited: true })
const deposit = (id: string, status: HosakaDeposit['status'] = 'pending'): HosakaDeposit => ({
  deposit_id: id, status, amount_msats: 1000, bolt11: `lnbc-${id}`, payment_hash: 'h', created_at: 1, expires_at: Math.floor(Date.now() / 1000) + 3600, settled_at: null, settled_msats: null, preimage: null,
})
const completed = (result: unknown, id = 'job-1'): HosakaJob => ({ id, status: 'completed', cost_msats: 1000, result, error: null })

/** A promise the test resolves by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** The cursor one h13 wall away from the avatar, on x. */
function lineUpH13(): Position {
  const s = useCyberspace.getState()
  const cursor = { ...s.position, x: s.position.x ^ (1n << 12n) }
  useCyberspace.setState({ cursor })
  return cursor
}

const S = useCyberspace.getState
const idle = (): Promise<void> => vi.waitFor(() => { expect(S().cloud.status).toBe('idle') }, { timeout: 5000 })

describe('cloud commits', () => {
  beforeEach(() => {
    // This machine stops at h12, so an h13 move is the cloud's, and the caps are already known.
    useCalibration.setState({ status: 'measured', hopHeight: 12, sidestepHeight: 24 })
    useCyberspace.setState({ cloud: { ...S().cloud, limits: LIMITS, status: 'idle', job: null, message: null }, cloudPrefs: { mode: 'auto', autoMaxSats: 100, apiUrl: 'http://fake' } })
    for (const fn of Object.values(fake)) if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset()
    fake.limits.mockResolvedValue(LIMITS)
    storage.removeItem('onosendai:cloudJob')
  })
  afterEach(() => {
    S().cancelCloud()
    S().discardCloudJob()
  })

  it('a funded cloud hop lands at the cursor as a signed hop event, verified first', async () => {
    const before = S().events.length
    const head = S().prevEventId
    const from = S().position
    const to = lineUpH13()
    fake.quote.mockResolvedValue(quote('hop'))
    fake.submitHop.mockResolvedValue(funded())
    fake.waitForJob.mockResolvedValue(completed(hopResult(from, to, S().plane, head)))

    await S().commit()

    const s = S()
    expect(fake.quote).toHaveBeenCalledWith('hop', { ...from, plane: s.headPlane }, { ...to, plane: s.headPlane })
    expect(fake.submitHop).toHaveBeenCalledWith({ ...from, plane: s.headPlane }, { ...to, plane: s.headPlane }, head)
    expect(fake.waitForJob).toHaveBeenCalledWith('job-1', 'tok-job-1', expect.anything())
    expect(s.events).toHaveLength(before + 1)
    expect(s.position).toEqual(to)
    expect(s.proof.status).toBe('done')
    expect(s.proof.source).toBe('cloud')
    expect(s.proof.costMsats).toBe(1000)
    expect(s.proof.totalOps).toBe(0)
    const event = parseAction(s.events[s.events.length - 1])!
    expect(event.type).toBe('hop')
    expect(event.previousId).toBe(head)
    expect(event.proofHash).toBe(s.proof.proofHash)
    const p = computeHopProof(from.x, from.y, from.z, to.x, to.y, to.z, s.headPlane, head, 20)
    expect(event.proofHash).toBe(p.proofHash)
    expect(s.proof.lookupId).toBe(sha256Hex(hexToBytes(sha256Hex(intToBytesBE(p.regionN)))))
    expect(s.cloud.status).toBe('idle')
    expect(s.cloud.last?.jobId).toBe('job-1')
    expect(storage.getItem('onosendai:cloudJob')).toBeNull()
    const keys = JSON.parse(storage.getItem('onosendai:cloudRegionKeys') ?? '[]') as Array<{ lookupId: string }>
    expect(keys.some((k) => k.lookupId === s.proof.lookupId)).toBe(true)
  })

  it('asks first in ask mode: CANCEL leaves the cursor lined up, PAY submits', async () => {
    useCyberspace.setState({ cloudPrefs: { ...S().cloudPrefs, mode: 'ask' } })
    const before = S().events.length
    const head = S().prevEventId
    const from = S().position
    const to = lineUpH13()
    fake.quote.mockResolvedValue(quote('hop', 2500))

    await S().commit()
    expect(S().cloud.status).toBe('confirm')
    expect(S().cloud.quote?.costMsats).toBe(2500)
    expect(S().proof.status).toBe('computing')
    expect(S().pendingTarget).toEqual(to)
    expect(fake.submitHop).not.toHaveBeenCalled()

    S().declineCloud()
    expect(S().cloud.status).toBe('idle')
    expect(S().proof.status).toBe('idle')
    expect(S().pendingTarget).toBeNull()
    expect(S().cursor).toEqual(to)
    expect(S().events).toHaveLength(before)

    fake.submitHop.mockResolvedValue(funded('job-2'))
    fake.waitForJob.mockResolvedValue(completed(hopResult(from, to, S().plane, head), 'job-2'))
    await S().commit()
    expect(S().cloud.status).toBe('confirm')
    S().approveCloud()
    await idle()
    expect(S().events).toHaveLength(before + 1)
    expect(S().position).toEqual(to)
  })

  it('writes the record before the invoice shows, then pays, starts and lands', async () => {
    const before = S().events.length
    const head = S().prevEventId
    const from = S().position
    const to = lineUpH13()
    fake.quote.mockResolvedValue(quote('hop'))
    fake.submitHop.mockResolvedValue({ ...funded(), status: 'pending', payment_required: true, amount_due_msats: 1000, deposit: deposit('d1') })
    const settle = deferred<HosakaDeposit>()
    let recordAtInvoice: PendingCloudJob | null = null
    fake.waitForDeposit.mockImplementation(() => {
      recordAtInvoice = JSON.parse(storage.getItem('onosendai:cloudJob') ?? 'null') as PendingCloudJob | null
      return settle.promise
    })
    fake.startJob.mockResolvedValue(funded())
    fake.waitForJob.mockResolvedValue(completed(hopResult(from, to, S().plane, head)))

    const committed = S().commit()
    await vi.waitFor(() => { expect(S().cloud.status).toBe('awaiting_payment') })
    expect(S().cloud.invoice?.bolt11).toBe('lnbc-d1')
    expect(S().cloud.invoiceOpen).toBe(true)
    expect(recordAtInvoice).not.toBeNull()
    expect(recordAtInvoice!.stage).toBe('awaiting_payment')
    expect(recordAtInvoice!.pollToken).toBe('tok-job-1')
    expect(recordAtInvoice!.deposit?.depositId).toBe('d1')
    expect(recordAtInvoice!.prevEventId).toBe(head)

    S().setInvoiceOpen(false)
    expect(S().cloud.invoiceOpen).toBe(false)

    settle.resolve(deposit('d1', 'settled'))
    await committed
    expect(fake.startJob).toHaveBeenCalledWith('job-1')
    expect(S().events).toHaveLength(before + 1)
    expect(S().position).toEqual(to)
    expect(storage.getItem('onosendai:cloudJob')).toBeNull()
  })

  it('refuses to append when the chain head moved while HOSAKA computed', async () => {
    const before = S().events.length
    const head = S().prevEventId
    const from = S().position
    const to = lineUpH13()
    fake.quote.mockResolvedValue(quote('hop'))
    fake.submitHop.mockResolvedValue(funded())
    const finish = deferred<HosakaJob>()
    fake.waitForJob.mockReturnValue(finish.promise)

    const committed = S().commit()
    await vi.waitFor(() => { expect(S().cloud.status).toBe('computing') })
    useCyberspace.setState({ prevEventId: 'ff'.repeat(32) })
    finish.resolve(completed(hopResult(from, to, S().plane, head)))
    await committed

    expect(S().events).toHaveLength(before)
    expect(S().cloud.status).toBe('error')
    expect(S().cloud.message).toMatch(/chain head moved/)
    expect(S().proof.status).toBe('infeasible')
    expect(storage.getItem('onosendai:cloudJob')).toBeNull()
    useCyberspace.setState({ prevEventId: head })
  })

  it('refuses a result that fails verification, and signs nothing', async () => {
    const before = S().events.length
    const head = S().prevEventId
    const from = S().position
    const to = lineUpH13()
    fake.quote.mockResolvedValue(quote('hop'))
    fake.submitHop.mockResolvedValue(funded())
    const result = hopResult(from, to, S().plane, head)
    fake.waitForJob.mockResolvedValue(completed({ ...result, K: (result.K as number) + 1 }))

    await S().commit()
    expect(S().events).toHaveLength(before)
    expect(S().cloud.status).toBe('error')
    expect(S().cloud.message).toMatch(/Cloud proof rejected: K\. Nothing was signed/)
    expect(S().position).toEqual(from)
  })

  it('X before payment abandons the job; X after payment keeps it for RESUME', async () => {
    const head = S().prevEventId
    const from = S().position
    const to = lineUpH13()
    fake.quote.mockResolvedValue(quote('hop'))
    fake.submitHop.mockResolvedValue({ ...funded(), status: 'pending', payment_required: true, deposit: deposit('d1') })
    fake.waitForDeposit.mockImplementation((_id: string, o: { signal?: AbortSignal }) => new Promise((_, reject) => {
      o.signal?.addEventListener('abort', () => reject(new HosakaError(0, 'aborted', 'cancelled')))
    }))
    const committed = S().commit()
    await vi.waitFor(() => { expect(S().cloud.status).toBe('awaiting_payment') })
    expect(storage.getItem('onosendai:cloudJob')).not.toBeNull()
    S().cancel()
    await committed
    expect(S().cloud.status).toBe('idle')
    expect(S().cloud.job).toBeNull()
    expect(S().proof.status).toBe('idle')
    expect(S().pendingTarget).toBeNull()
    expect(storage.getItem('onosendai:cloudJob')).toBeNull()

    fake.submitHop.mockResolvedValue(funded('job-3'))
    fake.waitForJob.mockImplementation((_id: string, _tok: string, o: { signal?: AbortSignal }) => new Promise((_, reject) => {
      o.signal?.addEventListener('abort', () => reject(new HosakaError(0, 'aborted', 'cancelled')))
    }))
    const committed2 = S().commit()
    await vi.waitFor(() => { expect(S().cloud.status).toBe('computing') })
    S().cancel()
    await committed2
    expect(S().cloud.status).toBe('idle')
    expect(S().cloud.job?.jobId).toBe('job-3')
    expect(S().cloud.job?.stage).toBe('computing')
    expect(JSON.parse(storage.getItem('onosendai:cloudJob')!).jobId).toBe('job-3')
    expect(S().position).toEqual(from)

    // RESUME picks the kept job up and lands it.
    fake.waitForJob.mockResolvedValue(completed(hopResult(from, to, S().plane, head), 'job-3'))
    await S().resumeCloudJob()
    expect(S().position).toEqual(to)
    expect(S().cloud.job).toBeNull()
  })

  it('a persisted job for a moved head is dropped on resume', async () => {
    const record: PendingCloudJob = {
      version: 1, jobId: 'stale', pollToken: 't', action: 'hop', pubkey: S().identity.pubkey,
      from: { x: '0', y: '0', z: '0' }, to: { x: '4104', y: '0', z: '0' }, plane: 0, prevEventId: 'ee'.repeat(32),
      costMsats: 1000, createdAt: Date.now(), stage: 'computing', deposit: null,
    }
    saveCloudJob(record)
    await S().resumeCloudJob()
    expect(S().cloud.status).toBe('idle')
    expect(S().cloud.job).toBeNull()
    expect(S().cloud.message).toMatch(/chain head moved/)
    expect(storage.getItem('onosendai:cloudJob')).toBeNull()
    expect(fake.waitForJob).not.toHaveBeenCalled()
  })

  it('beyond the cloud hop cap it commits a cloud sidestep past the wall, with the 8.5 tags', async () => {
    useCyberspace.setState({ cloud: { ...S().cloud, limits: { ...LIMITS, max_hop_height: 12 } } })
    const before = S().events.length
    const head = S().prevEventId
    const from = S().position
    const cursor = lineUpH13()
    const landing = { ...from, x: sidestepLanding(from.x, cursor.x) }
    fake.quote.mockResolvedValue(quote('sidestep', 300))
    fake.submitSidestep.mockResolvedValue(funded('job-4'))
    fake.waitForJob.mockResolvedValue(completed(sidestepResult(from, landing, S().plane, head), 'job-4'))

    await S().commit()

    const s = S()
    expect(fake.quote).toHaveBeenCalledWith('sidestep', expect.anything(), { ...landing, plane: s.headPlane })
    expect(fake.submitHop).not.toHaveBeenCalled()
    expect(s.events).toHaveLength(before + 1)
    expect(s.position).toEqual(landing)
    expect(s.cursor).toEqual(cursor)
    const ev = s.events[s.events.length - 1]
    const p = computeSidestepProof(from.x, from.y, from.z, landing.x, landing.y, landing.z, s.headPlane, head)
    expect(ev.tags.find((t) => t[0] === 'A')?.[1]).toBe('sidestep')
    expect(ev.tags.find((t) => t[0] === 'proof')?.[1]).toBe(p.proofHash)
    expect(ev.tags.find((t) => t[0] === 'mr')?.[1]).toBe([p.merkleX, p.merkleY, p.merkleZ].map(bytesToHex).join(':'))
    expect(ev.tags.find((t) => t[0] === 'mp')?.[1]).toBe([p.inclusionProofs.x.map(bytesToHex).join(''), '', ''].join(':'))
    expect(ev.tags.find((t) => t[0] === 'hx')?.[1]).toBe('13')
    expect(s.chain.sidesteps).toBeGreaterThan(0)
  })

  it('with cloud OFF, or no caps yet, the same move is a local sidestep', async () => {
    useCyberspace.setState({ cloudPrefs: { ...S().cloudPrefs, mode: 'off' } })
    const from = S().position
    const cursor = lineUpH13()
    await S().commit()
    expect(fake.quote).not.toHaveBeenCalled()
    expect(fake.limits).not.toHaveBeenCalled()
    expect(S().proof.status).toBe('computing')
    expect(S().proof.mode).toBe('sidestep')
    expect(S().proof.source).toBe('local')
    expect(vi.mocked(postProof)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(postProof).mock.calls[0][0]).toMatchObject({ mode: 'sidestep', from, to: { ...from, x: sidestepLanding(from.x, cursor.x) }, maxComputeHeight: 12 })
    S().cancel()
    expect(S().proof.status).toBe('idle')

    useCyberspace.setState({ cloudPrefs: { ...S().cloudPrefs, mode: 'auto' }, cloud: { ...S().cloud, limits: null } })
    await S().commit()
    expect(fake.quote).not.toHaveBeenCalled()
    // The caps are asked for, for next time; this commit does not wait for them.
    expect(fake.limits).toHaveBeenCalled()
    expect(S().proof.mode).toBe('sidestep')
    expect(S().proof.source).toBe('local')
    expect(vi.mocked(postProof)).toHaveBeenCalledTimes(2)
    S().cancel()
  })
})
