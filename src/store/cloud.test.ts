/**
 * cloud.test.ts - a commit beyond this machine becomes a route whose paid
 * steps go to HOSAKA, funded once, and come back as signed events.
 *
 * The HOSAKA client is faked; everything else is real: the route planner
 * with two ceilings, the route quote and PAY gate, the single deposit written
 * to disk before its invoice is shown, the verifier (cyberspace-core computes
 * the "cloud" result at h13 so the checks are exact), the refusal when the
 * chain head moved, one step per commit of a mixed way, and finishProof signing
 * hops and sidesteps exactly as it would local ones. What would fail silently
 * otherwise: a cloud proof appended to a chain whose head moved, a deposit
 * paid but never claimed after a reload, or a cancelled flow landing late.
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

import { cantorPair, computeHopProof, computeSidestepProof, bytesToHex, hexToBytes, intToBytesBE, sha256Hex } from 'cyberspace-core'
import { useCalibration } from '../lib/calibration'
import { saveCloudDeposit, saveCloudJob, type PendingCloudJob } from '../lib/cloud'
import { wallSource } from '../lib/movePlan'
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

const quote = (action: 'hop' | 'sidestep', cost = 1000) => ({ action, cost_msats: cost, within_cap: true, cap: 25, max_height: 13, per_axis_heights: { x: 13, y: 0, z: 0 }, K: 7, tier: 'trivial', est_time: 'about 30 sec', est_seconds: 30, hint: null })
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

/**
 * The cursor one h13 wall away from the avatar, on x. By default the avatar
 * is first stood on the leaf touching that wall: a step is HOSAKA's only
 * where this machine has none, so the crossing is the very next commit.
 * `atWall: false` stands it mid-block instead, an h12 hop short of the leaf.
 * (Earlier tests leave the avatar wherever their route ended, so both stand
 * it explicitly.)
 */
function lineUpH13(atWall = true): Position {
  const s = useCyberspace.getState()
  const block = (s.position.x >> 13n) << 13n
  const position = { ...s.position, x: atWall ? block + 4095n : block + 2053n }
  const cursor = { ...position, x: position.x ^ (1n << 12n) }
  useCyberspace.setState({ position, cursor })
  return cursor
}

const S = useCyberspace.getState
const idle = (): Promise<void> => vi.waitFor(() => { expect(S().cloud.status).toBe('idle') }, { timeout: 5000 })

describe('cloud routes', () => {
  beforeEach(() => {
    // This machine stops at h12 for hops AND sidesteps, so an h13 move has no local way and is
    // the cloud's (HOSAKA is used only when needed); the caps are already known.
    useCalibration.setState({ status: 'measured', hopHeight: 12, sidestepHeight: 12 })
    useCyberspace.setState({ cloud: { ...S().cloud, limits: LIMITS, status: 'idle', job: null, message: null }, cloudPrefs: { mode: 'auto', autoMaxSats: 100, apiUrl: 'http://fake' }, plan: null })
    for (const fn of Object.values(fake)) if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset()
    fake.limits.mockResolvedValue(LIMITS)
    fake.balance.mockResolvedValue({ pubkey: S().identity.pubkey, balance_msats: 5000, ledger: [] })
    vi.mocked(postProof).mockClear()
    storage.removeItem('onosendai:cloudJob')
    storage.removeItem('onosendai:cloudDeposit')
    storage.removeItem('onosendai:spent')
    storage.removeItem('onosendai:hosakaBalance')
    useCyberspace.setState({ cloud: { ...S().cloud, balance: null, balanceChecking: false, balanceError: null } })
    useCyberspace.setState({ spentMsats: 0 })
  })
  afterEach(() => {
    S().cancelPlan()
    S().cancelCloud()
    S().discardCloudJob()
  })

  it('a funded route of one cloud hop lands at the cursor as a signed hop event, verified first', async () => {
    const before = S().events.length
    const head = S().prevEventId
    const to = lineUpH13()
    const from = S().position
    fake.quote.mockResolvedValue(quote('hop'))
    fake.submitHop.mockResolvedValue(funded())
    fake.waitForJob.mockResolvedValue(completed(hopResult(from, to, S().plane, head)))

    await S().commit()
    await idle()

    const s = S()
    expect(fake.quote).toHaveBeenCalledWith('hop', { ...from, plane: s.headPlane }, { ...to, plane: s.headPlane })
    expect(fake.balance).toHaveBeenCalled()
    expect(fake.deposit).not.toHaveBeenCalled()          // the balance covered it
    expect(fake.submitHop).toHaveBeenCalledWith({ ...from, plane: s.headPlane }, { ...to, plane: s.headPlane }, head)
    expect(fake.waitForJob).toHaveBeenCalledWith('job-1', 'tok-job-1', expect.anything())
    expect(s.plan).toBeNull()
    expect(s.events).toHaveLength(before + 1)
    expect(s.position).toEqual(to)
    expect(s.proof.status).toBe('done')
    expect(s.proof.source).toBe('cloud')
    expect(s.proof.costMsats).toBe(1000)
    const event = parseAction(s.events[s.events.length - 1])!
    expect(event.type).toBe('hop')
    expect(event.previousId).toBe(head)
    const p = computeHopProof(from.x, from.y, from.z, to.x, to.y, to.z, s.headPlane, head, 20)
    expect(event.proofHash).toBe(p.proofHash)
    expect(s.proof.lookupId).toBe(sha256Hex(hexToBytes(sha256Hex(intToBytesBE(p.regionN)))))
    expect(s.cloud.last?.jobId).toBe('job-1')
    expect(storage.getItem('onosendai:cloudJob')).toBeNull()
    // spent on this chain, on this device
    expect(s.spentMsats).toBe(1000)
    expect(JSON.parse(storage.getItem('onosendai:spent')!)[s.genesisId]).toBe(1000)
    const keys = JSON.parse(storage.getItem('onosendai:cloudRegionKeys') ?? '[]') as Array<{ lookupId: string }>
    expect(keys.some((k) => k.lookupId === s.proof.lookupId)).toBe(true)
  })

  it('respawn starts the spent tally over for the new chain', async () => {
    useCyberspace.setState({ spentMsats: 4000 })
    await S().respawn()
    expect(S().spentMsats).toBe(0)
  })

  it('asks first in ask mode: CANCEL drops the route, PAY funds and runs it', async () => {
    useCyberspace.setState({ cloudPrefs: { ...S().cloudPrefs, mode: 'ask' } })
    const before = S().events.length
    const head = S().prevEventId
    const to = lineUpH13()
    const from = S().position
    fake.quote.mockResolvedValue(quote('hop', 2500))

    await S().commit()
    expect(S().cloud.status).toBe('confirm')
    expect(S().cloud.quote?.costMsats).toBe(2500)
    expect(S().cloud.quote?.route).toEqual({ steps: 1, cloudSteps: 1 })
    expect(S().plan?.status).toBe('funding')
    expect(fake.submitHop).not.toHaveBeenCalled()

    S().declineCloud()
    expect(S().cloud.status).toBe('idle')
    expect(S().plan).toBeNull()
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

  it('one invoice funds the route: the deposit is on disk before the invoice shows, then the step runs funded', async () => {
    const before = S().events.length
    const head = S().prevEventId
    const to = lineUpH13()
    const from = S().position
    fake.quote.mockResolvedValue(quote('hop'))
    // 95 msats short of a sat: the invoice is still for whole sats.
    fake.balance.mockResolvedValue({ pubkey: S().identity.pubkey, balance_msats: 95, ledger: [] })
    fake.deposit.mockResolvedValue(deposit('d1'))
    const settle = deferred<HosakaDeposit>()
    let onDiskAtInvoice: string | null = null
    fake.waitForDeposit.mockImplementation(() => {
      onDiskAtInvoice = storage.getItem('onosendai:cloudDeposit')
      return settle.promise
    })
    fake.submitHop.mockResolvedValue(funded())
    fake.waitForJob.mockResolvedValue(completed(hopResult(from, to, S().plane, head)))

    const committed = S().commit()
    await vi.waitFor(() => { expect(S().cloud.status).toBe('awaiting_payment') })
    expect(fake.deposit).toHaveBeenCalledWith(1000, expect.anything())
    expect(S().cloud.invoice?.bolt11).toBe('lnbc-d1')
    expect(S().cloud.invoiceOpen).toBe(true)
    expect(S().plan?.status).toBe('funding')
    expect(onDiskAtInvoice).not.toBeNull()
    expect(JSON.parse(onDiskAtInvoice!).depositId).toBe('d1')
    expect(fake.submitHop).not.toHaveBeenCalled()

    S().setInvoiceOpen(false)
    expect(S().cloud.invoiceOpen).toBe(false)

    settle.resolve(deposit('d1', 'settled'))
    await committed
    await idle()
    expect(fake.submitHop).toHaveBeenCalledWith(expect.anything(), expect.anything(), head)
    expect(fake.startJob).not.toHaveBeenCalled()         // funded from the balance: it started at once
    expect(S().events).toHaveLength(before + 1)
    expect(S().position).toEqual(to)
    expect(storage.getItem('onosendai:cloudDeposit')).toBeNull()
    expect(storage.getItem('onosendai:cloudJob')).toBeNull()
    expect(S().spentMsats).toBe(1000)
  })

  it('refuses to append when the chain head moved while HOSAKA computed', async () => {
    const before = S().events.length
    const head = S().prevEventId
    const to = lineUpH13()
    const from = S().position
    fake.quote.mockResolvedValue(quote('hop'))
    fake.submitHop.mockResolvedValue(funded())
    const finish = deferred<HosakaJob>()
    fake.waitForJob.mockReturnValue(finish.promise)

    const committed = S().commit()
    await vi.waitFor(() => { expect(S().cloud.status).toBe('computing') })
    useCyberspace.setState({ prevEventId: 'ff'.repeat(32) })
    finish.resolve(completed(hopResult(from, to, S().plane, head)))
    await committed
    await vi.waitFor(() => { expect(S().cloud.status).toBe('error') })

    expect(S().events).toHaveLength(before)
    expect(S().cloud.message).toMatch(/chain head moved/)
    expect(S().plan?.status).toBe('failed')
    expect(S().proof.status).toBe('infeasible')
    expect(S().spentMsats).toBe(0)
    expect(storage.getItem('onosendai:cloudJob')).toBeNull()
    useCyberspace.setState({ prevEventId: head })
  })

  it('refuses a result that fails verification, and signs nothing', async () => {
    const before = S().events.length
    const head = S().prevEventId
    const to = lineUpH13()
    const from = S().position
    fake.quote.mockResolvedValue(quote('hop'))
    fake.submitHop.mockResolvedValue(funded())
    const result = hopResult(from, to, S().plane, head)
    fake.waitForJob.mockResolvedValue(completed({ ...result, K: (result.K as number) + 1 }))

    await S().commit()
    await vi.waitFor(() => { expect(S().cloud.status).toBe('error') })
    expect(S().events).toHaveLength(before)
    expect(S().cloud.message).toMatch(/Cloud proof rejected: K\. Nothing was signed/)
    expect(S().position).toEqual(from)
    expect(S().plan?.status).toBe('failed')
  })

  it('X while the route waits for its invoice abandons it; X while a step computes keeps the job for RESUME', async () => {
    const head = S().prevEventId
    const to = lineUpH13()
    const from = S().position
    fake.quote.mockResolvedValue(quote('hop'))
    fake.balance.mockResolvedValue({ pubkey: S().identity.pubkey, balance_msats: 0, ledger: [] })
    fake.deposit.mockResolvedValue(deposit('d1'))
    fake.waitForDeposit.mockImplementation((_id: string, o: { signal?: AbortSignal }) => new Promise((_, reject) => {
      o.signal?.addEventListener('abort', () => reject(new HosakaError(0, 'aborted', 'cancelled')))
    }))
    const committed = S().commit()
    await vi.waitFor(() => { expect(S().cloud.status).toBe('awaiting_payment') })
    S().cancel()
    await committed
    expect(S().plan).toBeNull()
    expect(S().cloud.status).toBe('idle')
    expect(S().proof.status).toBe('idle')
    expect(S().pendingTarget).toBeNull()
    // The deposit record stays: if the wallet paid anyway, the next load claims it.
    expect(JSON.parse(storage.getItem('onosendai:cloudDeposit')!).depositId).toBe('d1')
    storage.removeItem('onosendai:cloudDeposit')

    fake.balance.mockResolvedValue({ pubkey: S().identity.pubkey, balance_msats: 5000, ledger: [] })
    fake.submitHop.mockResolvedValue(funded('job-3'))
    fake.waitForJob.mockImplementation((_id: string, _tok: string, o: { signal?: AbortSignal }) => new Promise((_, reject) => {
      o.signal?.addEventListener('abort', () => reject(new HosakaError(0, 'aborted', 'cancelled')))
    }))
    const committed2 = S().commit()
    await vi.waitFor(() => { expect(S().cloud.status).toBe('computing') })
    S().cancel()
    await committed2
    expect(S().plan).toBeNull()
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

  it('a paid route deposit left by an interrupted commit is claimed on load', async () => {
    saveCloudDeposit({ depositId: 'd9', pubkey: S().identity.pubkey, amountMsats: 1000, expiresAt: Math.floor(Date.now() / 1000) + 600, bolt11: 'lnbc-d9' })
    fake.claimDeposit.mockResolvedValue({ ...deposit('d9', 'settled'), settled_msats: 1000 })
    await S().resumeCloudJob()
    expect(fake.claimDeposit).toHaveBeenCalledWith('d9')
    expect(storage.getItem('onosendai:cloudDeposit')).toBeNull()
    expect(S().cloud.message).toMatch(/1 sat route deposit .* credited/)
  })

  it('beyond the cloud hop cap: a local hop to the boundary, a cloud sidestep through it, a local hop on, one commit each', async () => {
    // This machine hashes sidesteps only to h12 here, so the h13 crossing is HOSAKA's.
    useCalibration.setState({ status: 'measured', hopHeight: 12, sidestepHeight: 12 })
    useCyberspace.setState({ cloud: { ...S().cloud, limits: { ...LIMITS, max_hop_height: 12 } } })
    const before = S().events.length
    const cursor = lineUpH13(false)
    const from = S().position
    const edge = wallSource(from.x, cursor.x, 13)
    const landing = cursor.x > from.x ? edge + 1n : edge - 1n
    expect(edge).not.toBe(from.x)                       // this identity spawned away from the wall
    fake.quote.mockResolvedValue(quote('sidestep', 300))
    fake.submitSidestep.mockResolvedValue(funded('job-4'))
    fake.waitForJob.mockImplementation(async () => completed(sidestepResult({ ...from, x: edge }, { ...from, x: landing }, S().plane, S().prevEventId), 'job-4'))

    await S().commit()
    // Only the first step of the way is committed, and it is this machine's: the hop to the boundary's edge. Nothing quoted yet.
    const s0 = S()
    expect(s0.plan?.summary).toMatchObject({ steps: 1, hops: 1, cloudSteps: 0 })
    expect(fake.quote).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(vi.mocked(postProof)).toHaveBeenCalledTimes(1) })
    const req1 = vi.mocked(postProof).mock.calls[0][0]
    expect(req1).toMatchObject({ mode: 'hop', from, to: { ...from, x: edge }, maxComputeHeight: 12 })
    expect(S().plan?.step.source).toBe('local')

    // The local hop lands (the worker's answer, fed by hand). That commit is done; the cursor stays.
    await S().applyProofMessage({ type: 'done', id: req1.id, mode: 'hop', elapsedMs: 5, proofHash: 'dd'.repeat(32), terrainK: 3, lca: { x: 12, y: 0, z: 0 }, totalOps: 4 })
    expect(S().position.x).toBe(edge)
    expect(S().plan).toBeNull()
    expect(S().cursor).toEqual(cursor)

    // The next commit is the sidestep through the boundary, HOSAKA's here: quoted, funded, landed.
    await S().commit()
    expect(fake.quote).toHaveBeenCalledTimes(1)
    expect(fake.quote).toHaveBeenCalledWith('sidestep', { ...from, x: edge, plane: s0.headPlane }, { ...from, x: landing, plane: s0.headPlane })
    await vi.waitFor(() => { expect(S().position.x).toBe(landing) }, { timeout: 5000 })
    expect(fake.submitSidestep).toHaveBeenCalledWith({ ...from, x: edge, plane: s0.headPlane }, { ...from, x: landing, plane: s0.headPlane }, expect.any(String))
    const ev = S().events[S().events.length - 1]
    const p = computeSidestepProof(edge, from.y, from.z, landing, from.y, from.z, s0.headPlane, ev.tags.find((t) => t[0] === 'e' && t[3] === 'previous')![1])
    expect(ev.tags.find((t) => t[0] === 'A')?.[1]).toBe('sidestep')
    expect(ev.tags.find((t) => t[0] === 'proof')?.[1]).toBe(p.proofHash)
    expect(ev.tags.find((t) => t[0] === 'mr')?.[1]).toBe([p.merkleX, p.merkleY, p.merkleZ].map(bytesToHex).join(':'))
    expect(ev.tags.find((t) => t[0] === 'mp')?.[1]).toBe([p.inclusionProofs.x.map(bytesToHex).join(''), '', ''].join(':'))
    expect(ev.tags.find((t) => t[0] === 'hx')?.[1]).toBe('13')
    await vi.waitFor(() => { expect(S().plan).toBeNull() })

    // Then the last commit hops on to the cursor.
    await S().commit()
    await vi.waitFor(() => { expect(vi.mocked(postProof)).toHaveBeenCalledTimes(2) })
    const req2 = vi.mocked(postProof).mock.calls[1][0]
    expect(req2).toMatchObject({ mode: 'hop', to: cursor })
    await S().applyProofMessage({ type: 'done', id: req2.id, mode: 'hop', elapsedMs: 5, proofHash: 'ee'.repeat(32), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 })
    expect(S().plan).toBeNull()
    expect(S().position).toEqual(cursor)
    expect(S().events).toHaveLength(before + 3)
    expect(S().spentMsats).toBe(1000)
  })

  it('with cloud OFF the same move is a local route; with no caps yet the commit fetches them first', async () => {
    // A machine that sidesteps to h24 has a local way across the h13 boundary.
    useCalibration.setState({ status: 'measured', hopHeight: 12, sidestepHeight: 24 })
    useCyberspace.setState({ cloudPrefs: { ...S().cloudPrefs, mode: 'off' } })
    const cursor = lineUpH13(false)
    const from = S().position
    await S().commit()
    expect(fake.quote).not.toHaveBeenCalled()
    expect(fake.limits).not.toHaveBeenCalled()
    expect(S().plan).not.toBeNull()
    expect(S().plan?.summary.cloudSteps).toBe(0)
    expect(S().proof.status).toBe('computing')
    expect(S().proof.mode).toBe('hop')
    expect(S().proof.source).toBe('local')
    expect(vi.mocked(postProof)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(postProof).mock.calls[0][0]).toMatchObject({ mode: 'hop', from, to: { ...from, x: wallSource(from.x, cursor.x, 13) }, maxComputeHeight: 12 })
    S().cancel()
    expect(S().plan).toBeNull()
    expect(S().proof.status).toBe('idle')

    // Now a machine with no local way across (sidesteps stop at h12): the move is the cloud's, whose caps are not known yet.
    useCalibration.setState({ status: 'measured', hopHeight: 12, sidestepHeight: 12 })
    useCyberspace.setState({ cloudPrefs: { ...S().cloudPrefs, mode: 'auto' }, cloud: { ...S().cloud, limits: null } })
    lineUpH13()   // on the leaf touching the wall: the crossing is the next commit
    fake.quote.mockResolvedValue(quote('hop'))
    fake.submitHop.mockResolvedValue(funded('job-5'))
    fake.waitForJob.mockImplementation((_id: string, _tok: string, o: { signal?: AbortSignal }) => new Promise((_, reject) => {
      o.signal?.addEventListener('abort', () => reject(new HosakaError(0, 'aborted', 'cancelled')))
    }))
    await S().commit()
    // The caps were fetched before planning, so this commit already used the cloud.
    expect(fake.limits).toHaveBeenCalled()
    expect(fake.quote).toHaveBeenCalledTimes(1)
    expect(S().plan?.summary.cloudSteps).toBe(1)
    S().cancel()
  })

  // ---- the prepaid balance ----

  it('refreshBalance asks HOSAKA once, keeps the figure, and remembers it per identity', async () => {
    fake.balance.mockResolvedValue({ pubkey: S().identity.pubkey, balance_msats: 7000, ledger: [] })
    await S().refreshBalance()
    expect(fake.balance).toHaveBeenCalledTimes(1)
    expect(S().cloud.balance?.msats).toBe(7000)
    expect(S().cloud.balanceChecking).toBe(false)
    expect(JSON.parse(storage.getItem('onosendai:hosakaBalance') ?? '{}')[S().identity.pubkey].msats).toBe(7000)
    useCyberspace.setState({ cloud: { ...S().cloud, balance: null } })
    S().ensureBalance()
    expect(S().cloud.balance?.msats).toBe(7000)
  })
  it('a failed check keeps the last figure and says why', async () => {
    fake.balance.mockResolvedValue({ pubkey: S().identity.pubkey, balance_msats: 3000, ledger: [] })
    await S().refreshBalance()
    fake.balance.mockRejectedValue(new HosakaError(503, 'payments_unavailable', 'no wallet'))
    await S().refreshBalance()
    expect(S().cloud.balance?.msats).toBe(3000)
    expect(S().cloud.balanceError).toMatch(/503|payments_unavailable|wallet/)
  })
  it('a funded route notes the balance it read on the way', async () => {
    lineUpH13()
    fake.quote.mockResolvedValue(quote('hop'))
    fake.submitHop.mockResolvedValue(funded())
    fake.waitForJob.mockResolvedValue(completed(hopResult(S().position, S().cursor, S().plane, S().prevEventId)))
    await S().commit()
    await idle()
    expect(S().cloud.balance?.msats).toBe(5000)
  })

  it('a deposit paid while the tab was away is claimed at startup, credited and announced once', async () => {
    saveCloudDeposit({ depositId: 'dep-away', pubkey: S().identity.pubkey, amountMsats: 15000, expiresAt: Math.floor(Date.now() / 1000) + 3600, bolt11: 'lnbc-dep-away' })
    fake.claimDeposit.mockResolvedValue({ ...deposit('dep-away', 'settled'), settled_msats: 15000 })
    await S().resumeCloudJob()
    expect(fake.claimDeposit).toHaveBeenCalledWith('dep-away')
    expect(S().cloud.credited?.msats).toBe(15000)
    expect(S().cloud.message).toMatch(/15 sat/)
    S().dismissCredited()
    expect(S().cloud.credited).toBeNull()
    expect(storage.getItem('onosendai:cloudDeposit')).toBeNull()
  })

  it('a caps request out for another API URL is not reused: the current URL gets its own (#69)', async () => {
    const old = deferred<HosakaLimits>()
    fake.limits.mockReturnValueOnce(old.promise).mockResolvedValueOnce(LIMITS)
    useCyberspace.setState({ cloud: { ...S().cloud, limits: null }, cloudPrefs: { mode: 'auto', autoMaxSats: 100, apiUrl: 'http://old' } })
    const first = S().resumeCloudJob()
    await vi.waitFor(() => expect(fake.limits).toHaveBeenCalledTimes(1))
    useCyberspace.setState({ cloudPrefs: { ...S().cloudPrefs, apiUrl: 'http://fake' } })
    await S().resumeCloudJob()
    expect(fake.limits).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(S().cloud.limits).toEqual(LIMITS))
    old.resolve({ ...LIMITS, max_hop_height: 3 })
    await first
    // The answer for the old URL arrived late and was dropped.
    expect(S().cloud.limits).toEqual(LIMITS)
  })

  it('with the cloud on but HOSAKA unreachable, a short walk still goes ahead locally', async () => {
    // A machine that sidesteps to h24 has a local way across the h13 boundary.
    useCalibration.setState({ status: 'measured', hopHeight: 12, sidestepHeight: 24 })
    useCyberspace.setState({ cloud: { ...S().cloud, limits: null } })
    fake.limits.mockRejectedValue(new Error('down'))
    lineUpH13()
    await S().commit()
    expect(S().proof.status).not.toBe('infeasible')
    expect(vi.mocked(postProof)).toHaveBeenCalledTimes(1)
    S().cancel()
  })
})
