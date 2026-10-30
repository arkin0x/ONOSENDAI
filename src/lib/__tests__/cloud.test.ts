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
import { computeSidestepProof, bytesToHex, encodeNonce, terrainK } from 'cyberspace-core'
import {
  CloudFlowError,
  balanceLabel,
  clearCloudJob,
  cloudProofResponse,
  describeCloudError,
  hopPausedWords,
  straddlingV1Hop,
  defaultCloudPrefs,
  depositSettled,
  driveCloudJob,
  formatClock,
  jobInProgress,
  hosakaComputing,
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
  formatWait,
  jobPatienceMs } from '../cloud'
import { HosakaError, cloudHopPause, cloudHopsSold, type HosakaClient, type HosakaDeposit, type HosakaJob, type HosakaLimits } from '../hosaka'

const LIMITS: HosakaLimits = { max_hop_height: 25, max_sidestep_height: 29, hop_min_msats: 1000, deposit_min_msats: 1000, deposit_max_msats: 5_000_000_000, invoice_ttl_seconds: 3600, hop_proof_version: 2 }

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
    // A HOSAKA that does not say hop_proof_version 2 sells no hop this client can sign.
    [18, 17, 'auto', { ...LIMITS, hop_proof_version: undefined }, 'cloud-sidestep'],
    [18, 17, 'auto', { ...LIMITS, hop_proof_version: 1 }, 'cloud-sidestep'],
  ] as const)('h%d, ceiling %d, mode %s -> %s', (maxHeight, ceiling, mode, limits, route) => {
    expect(routeCommit({ maxHeight, ceiling, mode, limits })).toBe(route)
  })
})

describe('formatWait', () => {
  it('reads coarse, the way the server words one step', () => {
    expect(formatWait(3)).toBe('under 10 sec')
    expect(formatWait(30)).toBe('about 30 sec')
    expect(formatWait(31)).toBe('about 40 sec')
    expect(formatWait(60)).toBe('about 1 min')
    expect(formatWait(61)).toBe('about 2 min')
    expect(formatWait(5400)).toBe('about 1.5 hr')
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
    saveCloudPrefs({ mode: 'ask', autoMaxSats: 21, apiUrl: 'http://127.0.0.1:8765/', profile: 'cost' })
    // A trailing slash is dropped on the way back in, so paths never double it.
    expect(loadCloudPrefs()).toEqual({ mode: 'ask', autoMaxSats: 21, apiUrl: 'http://127.0.0.1:8765', profile: 'cost' })
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
    limits: reject, quote: reject, submitHop: reject, submitSidestep: reject, submitRegionKey: reject, rideQuote: reject, submitRide: reject, getJob: reject, balance: reject, deposit: reject,
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
    // The second computing record is the driver stamping when computing began.
    expect(records).toEqual(['paid', 'computing', 'computing'])
    expect(out.job.status).toBe('completed')
    expect(out.record.stage).toBe('computing')
    expect(out.record.deposit).toBeNull()
    expect(typeof out.record.computingAt).toBe('number')
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
  it('shapes a version 2 hop like the worker would: the seal is proof, mn and mp ride along, K is ours', () => {
    const result = {
      seal: 'aa'.repeat(32), mn: '0123456789abcdef', mp: 'ef'.repeat(64),
      // HOSAKA's K and max_height are bookkeeping: the message carries this machine's own.
      K: 99, max_height: 99, compute_msats: 1000,
      region_n: { public_proof: 'cc'.repeat(32), secret_key: 'dd'.repeat(32) },
    }
    const msg = cloudProofResponse(7, base, job('completed', { result, cost_msats: 1234 }), 5000)
    expect(msg).toEqual({
      type: 'done', id: 7, mode: 'hop', elapsedMs: 5000, proofHash: 'aa'.repeat(32), terrainK: terrainK(4104n, 0n, 0n, 0),
      lca: { x: 13, y: 0, z: 0 }, totalOps: 0, source: 'cloud', jobId: 'job-1', costMsats: 1234, lookupId: 'cc'.repeat(32),
      hop: { sealHex: 'aa'.repeat(32), mnHex: '0123456789abcdef', mpHex: 'ef'.repeat(64) },
      // The head the job was seeded by: the store signs onto no other.
      prevEventId: base.prevEventId,
    })
  })

  it('shapes a sidestep with the 8.5 tags joined per axis', () => {
    const p = computeSidestepProof(0n, 0n, 0n, 4096n, 0n, 0n, 0, 'ab'.repeat(32))
    const result = {
      proof_hash: p.proofHash, merkle_x: bytesToHex(p.merkleX), merkle_y: bytesToHex(p.merkleY), merkle_z: bytesToHex(p.merkleZ),
      openings: { x: p.openings.x.map((q) => q.map(bytesToHex)), y: [], z: [] }, mn: encodeNonce(p.nonce), lca_heights: p.lcaHeights,
      previous_event_id: 'ab'.repeat(32), terrain_k: p.terrainK, region_m_hex: p.regionM.toString(16), compute_msats: 300,
    }
    const record: PendingCloudJob = { ...base, action: 'sidestep', to: wirePosition({ x: 4096n, y: 0n, z: 0n }), stage: 'computing', deposit: null }
    const msg = cloudProofResponse(3, record, job('completed', { result }), 10)
    expect(msg.type).toBe('done')
    if (msg.type !== 'done') return
    expect(msg.mode).toBe('sidestep')
    expect(msg.proofHash).toBe(p.proofHash)
    expect(msg.lca).toEqual({ x: 13, y: 0, z: 0 })
    expect(msg.sidestep).toEqual({
      merkleRoots: [bytesToHex(p.merkleX), bytesToHex(p.merkleY), bytesToHex(p.merkleZ)],
      openings: [p.openings.x.map((q) => q.map(bytesToHex).join('')).join(''), '', ''],
      // The nonce comes through exactly as HOSAKA sent it, the `mn` tag's value.
      mnHex: encodeNonce(p.nonce),
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

describe('jobPatienceMs', () => {
  it('waits three times the quote plus ten minutes, between twenty minutes and six hours', () => {
    const min = 60_000
    // A two minute hop: the floor, since three times two minutes is under it.
    expect(jobPatienceMs(103)).toBe(20 * min)
    // A ten minute hop: 3 x 565 s is 28.25 min, plus 10.
    expect(jobPatienceMs(565)).toBe(565 * 3_000 + 10 * min)
    // An h30 hop sold at about 4.2 hours: the cap, which is still longer
    // than the quote, so it is not abandoned while it could still land.
    expect(jobPatienceMs(15_120)).toBe(6 * 60 * min)
    expect(jobPatienceMs(15_120)).toBeGreaterThan(15_120 * 1000)
    // No quote on the record, and nonsense on it, both get the floor.
    expect(jobPatienceMs(undefined)).toBe(20 * min)
    expect(jobPatienceMs(0)).toBe(20 * min)
    expect(jobPatienceMs(Number.NaN)).toBe(20 * min)
    expect(jobPatienceMs(-5)).toBe(20 * min)
  })
})

describe('hosakaComputing', () => {
  it('is computing alone: a funded route between local steps is not HOSAKA working', () => {
    expect(hosakaComputing('computing')).toBe(true)
    for (const st of ['paid', 'verifying', 'idle', 'quoting', 'confirm', 'funding', 'awaiting_payment', 'error'] as const) {
      expect(hosakaComputing(st), st).toBe(false)
    }
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

describe('the strategy names people saved before', () => {
  it('reads UNLOCK as TIME, since that was the measured crossover, and BYPASS as COST', () => {
    localStorage.setItem('onosendai:cloud', JSON.stringify({ mode: 'ask', autoMaxSats: 0, apiUrl: 'http://127.0.0.1:8765', profile: 'unlock' }))
    expect(loadCloudPrefs().profile).toBe('time')
    localStorage.setItem('onosendai:cloud', JSON.stringify({ mode: 'ask', autoMaxSats: 0, apiUrl: 'http://127.0.0.1:8765', profile: 'bypass' }))
    expect(loadCloudPrefs().profile).toBe('cost')
    localStorage.setItem('onosendai:cloud', JSON.stringify({ mode: 'ask', autoMaxSats: 0, apiUrl: 'http://127.0.0.1:8765', profile: 'loot' }))
    expect(loadCloudPrefs().profile).toBe('loot')
  })

  it('defaults to LOOT', () => {
    localStorage.removeItem('onosendai:cloud')
    expect(loadCloudPrefs().profile).toBe('loot')
  })
})

describe('hop proof version 2 at the HOSAKA boundary', () => {
  it('buys hops only from a HOSAKA that makes version 2, and says when they are paused', () => {
    expect(cloudHopsSold(LIMITS)).toBe(25)
    expect(cloudHopsSold({ ...LIMITS, hop_proof_version: undefined })).toBe(0)
    expect(cloudHopsSold(null)).toBe(0)
    expect(cloudHopPause(LIMITS)).toBeNull()
    expect(cloudHopPause({ ...LIMITS, hop_paused: true, hop_paused_reason: 'Switching hops.' })).toBe('Switching hops.')
    // The caps stay: a pause is not a lower hop cap.
    const paused: HosakaLimits = { ...LIMITS, hop_paused: true }
    expect(cloudHopsSold(paused)).toBe(25)
  })

  it('a 503 hop_paused is an answer, kept for RESUME, and said in HOSAKA\'s words', () => {
    const paused = HosakaError.fromResponse(503, { detail: { error: 'hop_paused', hint: 'HOSAKA is switching hops. Nothing was charged.', retry_after_seconds: 300, charged: false } })
    expect(paused.hopPaused).toBe(true)
    expect(paused.answerLost).toBe(false)
    expect(paused.retryAfterSeconds).toBe(300)
    expect(retainsRecord(paused)).toBe(true)
    expect(describeCloudError(paused)).toBe('HOSAKA is switching hops. Nothing was charged. RESUME tries again once HOSAKA reopens (HOSAKA says about 5 min).')
    // The header wins when a browser lets it be read.
    expect(HosakaError.fromResponse(503, { detail: { error: 'hop_paused' } }, '120').retryAfterSeconds).toBe(120)
    expect(hopPausedWords(null)).toContain('Nothing was charged')
    // Any other 5xx is still a lost answer.
    expect(HosakaError.fromResponse(503, { detail: { error: 'payments_unavailable' } }).answerLost).toBe(true)
  })

  it('a 400 job_not_runnable shows HOSAKA\'s hint and drops the record', () => {
    const err = HosakaError.fromResponse(400, { detail: { error: 'job_not_runnable', job_id: 'job-1', status: 'failed', refunded_msats: 0, current_balance_msats: 5000, hint: 'This hop was priced before hop proof version 2. Nothing was charged for it.' } })
    expect(err.jobNotRunnable).toBe(true)
    expect(retainsRecord(err)).toBe(false)
    expect(describeCloudError(err)).toBe('HOSAKA will not run this job: This hop was priced before hop proof version 2. Nothing was charged for it. The job was dropped.')
  })

  it('refuses a hop that finished in the old hop_n shape (D-A, recommended default), and only that', () => {
    const v1 = { hop_n: { public_proof: 'aa'.repeat(32), secret_key: 'bb'.repeat(32) }, region_n: { public_proof: 'cc'.repeat(32), secret_key: 'dd'.repeat(32) }, K: 11 }
    const words = straddlingV1Hop('hop', v1, 'job-1234567890')
    expect(words).toContain('old proof format')
    expect(words).toContain('refund')
    expect(words).toContain('job-1234')
    expect(straddlingV1Hop('hop', { seal: 'aa'.repeat(32), mn: '0'.repeat(16), mp: '00', region_n: v1.region_n }, 'job-1')).toBeNull()
    expect(straddlingV1Hop('sidestep', v1, 'job-1')).toBeNull()
    expect(straddlingV1Hop('hop', null, 'job-1')).toBeNull()
  })
})
