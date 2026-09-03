/**
 * cloud.test.ts - the routing rule, the approval rule, the payment state
 * machine and the persistence the store leans on.
 *
 * The routing table is the contract's "local first, cloud second, sidestep
 * third" written out; a wrong row sends a paid move to a local sidestep or a
 * free one to an invoice. The driver is exercised against a fake client so
 * every station (invoice, short payment, start, poll) is seen in order and
 * the record on disk always says where to resume from.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeSidestepProof, bytesToHex } from 'cyberspace-core'
import {
  CloudFlowError,
  balanceLabel,
  clearCloudJob,
  cloudProofResponse,
  defaultCloudPrefs,
  depositSettled,
  driveCloudJob,
  formatClock,
  jobInProgress,
  loadBalance,
  loadCloudJob,
  loadCloudPrefs,
  needsApproval,
  positionFromWire,
  retainsRecord,
  routeCommit,
  satsLabel,
  satsOf,
  saveBalance,
  saveCloudJob,
  saveCloudPrefs,
  sinceLabel,
  type PendingCloudJob,
  wirePosition,
} from './cloud'
import { HosakaError, type HosakaClient, type HosakaDeposit, type HosakaJob, type HosakaLimits } from './hosaka'

const LIMITS: HosakaLimits = { max_hop_height: 25, max_sidestep_height: 29, hop_min_msats: 1000, deposit_min_msats: 1000, deposit_max_msats: 5_000_000_000, invoice_ttl_seconds: 3600 }

describe('routeCommit', () => {
  it.each([
    [15, 17, 'auto', LIMITS, 'local-hop'],
    [17, 17, 'off', LIMITS, 'local-hop'],
    [18, 17, 'off', LIMITS, 'local-sidestep'],
    [18, 17, 'auto', null, 'local-sidestep'],
    [18, 17, 'auto', LIMITS, 'cloud-hop'],
    [25, 17, 'ask', LIMITS, 'cloud-hop'],
    [26, 17, 'auto', LIMITS, 'cloud-sidestep'],
    [29, 17, 'ask', LIMITS, 'cloud-sidestep'],
    [30, 17, 'auto', LIMITS, 'local-sidestep'],
    [18, 12, 'auto', { ...LIMITS, max_hop_height: 12 }, 'cloud-sidestep'],
  ] as const)('h%d, ceiling %d, mode %s -> %s', (maxHeight, ceiling, mode, limits, route) => {
    expect(routeCommit({ maxHeight, ceiling, mode, limits })).toBe(route)
  })
})

describe('needsApproval and sats', () => {
  it('asks always in ask mode, and above the budget in auto mode', () => {
    expect(needsApproval(1000, { ...defaultCloudPrefs(), mode: 'ask', autoMaxSats: 100 })).toBe(true)
    expect(needsApproval(1000, { ...defaultCloudPrefs(), mode: 'auto', autoMaxSats: 0 })).toBe(true)
    expect(needsApproval(5000, { ...defaultCloudPrefs(), mode: 'auto', autoMaxSats: 5 })).toBe(false)
    expect(needsApproval(5001, { ...defaultCloudPrefs(), mode: 'auto', autoMaxSats: 5 })).toBe(true)
  })

  it('rounds msats up to whole sats and formats clocks', () => {
    expect(satsOf(1000)).toBe(1)
    expect(satsOf(1001)).toBe(2)
    expect(satsOf(0)).toBe(0)
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(61_500)).toBe('1:01')
    expect(formatClock(-5)).toBe('0:00')
  })
})

/** A localStorage for node. */
function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k) },
    setItem: (k, v) => { m.set(k, String(v)) },
  }
}

describe('persistence', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('defaults prefs, round-trips them, and refuses junk', () => {
    expect(loadCloudPrefs()).toEqual(defaultCloudPrefs())
    saveCloudPrefs({ mode: 'ask', autoMaxSats: 21, apiUrl: 'http://127.0.0.1:8765/' })
    // A trailing slash is dropped on the way back in, so paths never double it.
    expect(loadCloudPrefs()).toEqual({ mode: 'ask', autoMaxSats: 21, apiUrl: 'http://127.0.0.1:8765' })
    localStorage.setItem('onosendai:cloud', JSON.stringify({ mode: 'yes', autoMaxSats: -4, apiUrl: 'ftp://x' }))
    expect(loadCloudPrefs()).toEqual(defaultCloudPrefs())
    localStorage.setItem('onosendai:cloud', '{not json')
    expect(loadCloudPrefs()).toEqual(defaultCloudPrefs())
  })

  it('round-trips a pending job with 85-bit positions intact', () => {
    const big = { x: (1n << 84n) + 7n, y: 3n, z: (1n << 60n) }
    const record: PendingCloudJob = {
      version: 1, jobId: 'j', pollToken: 't', action: 'hop', pubkey: 'p', from: wirePosition(big), to: wirePosition({ ...big, x: big.x + 1n }),
      plane: 1, prevEventId: 'ab'.repeat(32), costMsats: 1000, createdAt: 5, stage: 'awaiting_payment',
      deposit: { depositId: 'd', bolt11: 'lnbc', amountMsats: 1000, expiresAt: 9, paymentHash: 'h' },
    }
    expect(loadCloudJob()).toBeNull()
    saveCloudJob(record)
    const back = loadCloudJob()
    expect(back).toEqual(record)
    expect(positionFromWire(back!.from)).toEqual(big)
    clearCloudJob()
    expect(loadCloudJob()).toBeNull()
    localStorage.setItem('onosendai:cloudJob', JSON.stringify({ version: 1, jobId: 'j', stage: 'flying' }))
    expect(loadCloudJob()).toBeNull()
  })
})

const deposit = (id: string, status: HosakaDeposit['status'] = 'pending'): HosakaDeposit => ({
  deposit_id: id, status, amount_msats: 1000, bolt11: `lnbc-${id}`, payment_hash: 'h', created_at: 1, expires_at: 3601, settled_at: null, settled_msats: null, preimage: null,
})
const job = (status: HosakaJob['status'], extra: Partial<HosakaJob> = {}): HosakaJob => ({ id: 'job-1', status, cost_msats: 1000, result: null, error: null, ...extra })

function fakeClient(over: Partial<HosakaClient>): HosakaClient {
  const reject = (): never => { throw new Error('unexpected call') }
  return {
    apiUrl: 'http://fake',
    limits: reject, quote: reject, submitHop: reject, submitSidestep: reject, getJob: reject, balance: reject, deposit: reject,
    startJob: reject, claimDeposit: reject, waitForDeposit: reject, waitForJob: reject,
    ...over,
  }
}

const base: PendingCloudJob = {
  version: 1, jobId: 'job-1', pollToken: 'tok', action: 'hop', pubkey: 'p', from: wirePosition({ x: 0n, y: 0n, z: 0n }), to: wirePosition({ x: 4104n, y: 0n, z: 0n }),
  plane: 0, prevEventId: 'ab'.repeat(32), costMsats: 1000, createdAt: 0, stage: 'awaiting_payment',
  deposit: { depositId: 'd1', bolt11: 'lnbc-d1', amountMsats: 1000, expiresAt: 3601, paymentHash: 'h' },
}

describe('driveCloudJob', () => {
  it('walks invoice, claim, start, poll and reports every stage in order', async () => {
    const calls: string[] = []
    const client = fakeClient({
      waitForDeposit: async (id) => { calls.push(`wait:${id}`); return deposit(id, 'settled') },
      startJob: async (id) => { calls.push(`start:${id}`); return job('computing') },
      waitForJob: async (id, tok) => { calls.push(`poll:${id}:${tok}`); return job('completed', { result: { ok: 1 } }) },
    })
    const stages: string[] = []
    const records: string[] = []
    const out = await driveCloudJob(client, base, {
      onStage: (s, d) => stages.push(`${s}${d.invoice ? ':' + d.invoice.depositId : ''}`),
      onRecord: (r) => records.push(r.stage),
    })
    expect(calls).toEqual(['wait:d1', 'start:job-1', 'poll:job-1:tok'])
    expect(stages).toEqual(['awaiting_payment:d1', 'paid', 'computing'])
    expect(records).toEqual(['paid', 'computing'])
    expect(out.job.status).toBe('completed')
    expect(out.record.stage).toBe('computing')
    expect(out.record.deposit).toBeNull()
  })

  it('a short payment gets a second invoice, then proceeds', async () => {
    let starts = 0
    const client = fakeClient({
      waitForDeposit: async (id) => deposit(id, 'settled'),
      startJob: async () => (++starts === 1 ? job('pending', { payment_required: true, deposit: deposit('d2') }) : job('computing')),
      waitForJob: async () => job('completed'),
    })
    const stages: string[] = []
    const out = await driveCloudJob(client, base, { onStage: (s, d) => stages.push(`${s}${d.invoice ? ':' + d.invoice.depositId : ''}`), onRecord: () => {} })
    expect(stages).toEqual(['awaiting_payment:d1', 'paid', 'awaiting_payment:d2', 'paid', 'computing'])
    expect(out.job.status).toBe('completed')
  })

  it('an expired invoice is a flow error, not a job', async () => {
    const client = fakeClient({ waitForDeposit: async (id) => deposit(id, 'expired') })
    const err = await driveCloudJob(client, base, { onStage: () => {}, onRecord: () => {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CloudFlowError)
    expect((err as CloudFlowError).code).toBe('invoice_expired')
    expect(retainsRecord(err)).toBe(false)
  })

  it('a funded job skips straight to polling; a start that already finished returns at once', async () => {
    const client = fakeClient({ waitForJob: async () => job('completed') })
    const out = await driveCloudJob(client, { ...base, stage: 'computing', deposit: null }, { onStage: () => {}, onRecord: () => {} })
    expect(out.job.status).toBe('completed')

    const client2 = fakeClient({ startJob: async () => job('failed', { error: 'boom' }) })
    const out2 = await driveCloudJob(client2, { ...base, stage: 'paid' }, { onStage: () => {}, onRecord: () => {} })
    expect(out2.job.status).toBe('failed')
  })

  it('keeps the record for transient failures only', () => {
    expect(retainsRecord(new HosakaError(0, 'network', 'down'))).toBe(true)
    expect(retainsRecord(new HosakaError(0, 'timeout', 'slow'))).toBe(true)
    expect(retainsRecord(new HosakaError(503, 'payments_unavailable', 'node'))).toBe(true)
    expect(retainsRecord(new HosakaError(0, 'aborted', 'cancelled'))).toBe(false)
    expect(retainsRecord(new HosakaError(404, null, 'Job not found'))).toBe(false)
    expect(retainsRecord(new Error('x'))).toBe(false)
  })
})

describe('cloudProofResponse', () => {
  it('shapes a hop like the worker would, with the cloud fields', () => {
    const result = {
      hop_n: { public_proof: 'aa'.repeat(32), secret_key: 'bb'.repeat(32) },
      region_n: { public_proof: 'cc'.repeat(32), secret_key: 'dd'.repeat(32) },
      K: 11, max_height: 13, compute_msats: 1000,
    }
    const msg = cloudProofResponse(7, base, job('completed', { result, cost_msats: 1234 }), 5000)
    expect(msg).toEqual({
      type: 'done', id: 7, mode: 'hop', elapsedMs: 5000, proofHash: 'aa'.repeat(32), regionN: null, terrainK: 11,
      lca: { x: 13, y: 0, z: 0 }, totalOps: 0, source: 'cloud', jobId: 'job-1', costMsats: 1234, lookupId: 'cc'.repeat(32),
    })
  })

  it('shapes a sidestep with the 8.5 tags joined per axis', () => {
    const p = computeSidestepProof(0n, 0n, 0n, 4096n, 0n, 0n, 0, 'ab'.repeat(32))
    const result = {
      proof_hash: p.proofHash, merkle_x: bytesToHex(p.merkleX), merkle_y: bytesToHex(p.merkleY), merkle_z: bytesToHex(p.merkleZ),
      inclusion_proofs: { x: p.inclusionProofs.x.map(bytesToHex), y: [], z: [] }, lca_heights: p.lcaHeights,
      previous_event_id: 'ab'.repeat(32), terrain_k: p.terrainK, region_m_hex: p.regionM.toString(16), compute_msats: 300,
    }
    const record: PendingCloudJob = { ...base, action: 'sidestep', to: wirePosition({ x: 4096n, y: 0n, z: 0n }), stage: 'computing', deposit: null }
    const msg = cloudProofResponse(3, record, job('completed', { result }), 10)
    expect(msg.type).toBe('done')
    if (msg.type !== 'done') return
    expect(msg.mode).toBe('sidestep')
    expect(msg.proofHash).toBe(p.proofHash)
    expect(msg.regionN).toBe(p.regionM.toString())
    expect(msg.lca).toEqual({ x: 13, y: 0, z: 0 })
    expect(msg.sidestep).toEqual({
      merkleRoots: [bytesToHex(p.merkleX), bytesToHex(p.merkleY), bytesToHex(p.merkleZ)],
      inclusionProofs: [p.inclusionProofs.x.map(bytesToHex).join(''), '', ''],
      lcaHeights: [13, 0, 0],
    })
    expect(msg.source).toBe('cloud')
  })
})

describe('depositSettled', () => {
  it('is the invoice wait ending in a paid deposit, and nothing else', () => {
    expect(depositSettled('awaiting_payment', 'paid')).toBe(true)
    expect(depositSettled('awaiting_payment', 'computing')).toBe(true)
    expect(depositSettled('awaiting_payment', 'verifying')).toBe(true)
    expect(depositSettled('awaiting_payment', 'idle')).toBe(false)
    expect(depositSettled('awaiting_payment', 'error')).toBe(false)
    expect(depositSettled('awaiting_payment', 'awaiting_payment')).toBe(false)
    expect(depositSettled('paid', 'computing')).toBe(false)
    expect(depositSettled('funding', 'awaiting_payment')).toBe(false)
  })
})

describe('jobInProgress', () => {
  it('is paid, computing or verifying, and no other status', () => {
    for (const st of ['paid', 'computing', 'verifying'] as const) expect(jobInProgress(st)).toBe(true)
    for (const st of ['idle', 'quoting', 'confirm', 'funding', 'awaiting_payment', 'error'] as const) expect(jobInProgress(st)).toBe(false)
  })
})

describe('remembered balance', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()) })
  it('sinceLabel picks the coarsest non-zero unit', () => {
    const t = 1_700_000_000_000
    expect(sinceLabel(t, t + 30_000)).toBe('just now')
    expect(sinceLabel(t, t + 4 * 60_000)).toBe('4 min ago')
    expect(sinceLabel(t, t + 3 * 3_600_000)).toBe('3 h ago')
    expect(sinceLabel(t, t + 5 * 86_400_000)).toBe('5 d ago')
  })
  it('balanceLabel rounds down, satsLabel rounds up', () => {
    expect(balanceLabel(4200)).toBe('4 sats')
    expect(balanceLabel(1000)).toBe('1 sat')
    expect(balanceLabel(-5)).toBe('0 sats')
    expect(satsLabel(4200)).toBe('5 sats')
  })
  it('saveBalance rounds, floors at zero and loads back per pubkey', () => {
    const rec = saveBalance('pk-a', 1234.6, 42)
    expect(rec).toEqual({ msats: 1235, at: 42 })
    expect(loadBalance('pk-a')).toEqual({ msats: 1235, at: 42 })
    expect(loadBalance('pk-b')).toBeNull()
    expect(saveBalance('pk-b', -5, 1).msats).toBe(0)
  })
})
