/**
 * cloud.ts - a move this machine cannot compute, bought from HOSAKA instead.
 *
 * The store decides WHEN to go to the cloud (commit routing) and owns the
 * state the HUD reads; this module is everything between: the routing rule
 * itself, the preferences and the pending job record in localStorage, the
 * payment state machine (invoice, claim, start, poll), the verification hand
 * off to a worker, and the translation of a finished job into the same
 * ProofResponse the local worker would have produced. That last step is what
 * keeps signing in one place: applyProofMessage never learns where a proof
 * came from beyond a `source` field.
 *
 * The record is written BEFORE the invoice is shown. A reload mid-payment
 * finds it and resumes; a chain whose head has moved since discards it,
 * because the temporal binding (5.3) makes the proof worthless anyway.
 */

import { findLcaHeight, type Plane } from 'cyberspace-core'
import type { ProofResponse } from '../workers/proof.worker'
import type { VerifyRequest, VerifyResponse } from '../workers/verify.worker'
import { verifyCloud, type CloudMove } from './cloudVerify'
import {
  HosakaError,
  defaultHosakaUrl,
  type CloudHopResult,
  type CloudSidestepResult,
  type HosakaAction,
  type HosakaClient,
  type HosakaCoord,
  type HosakaDeposit,
  type HosakaJob,
  type HosakaLimits,
  type Waker,
} from './hosaka'
import type { Position } from './space'

export type CloudMode = 'auto' | 'ask' | 'off'

/**
 * `auto` submits without asking up to `autoMaxSats` and asks above it (0
 * means ask every time); `ask` always asks; `off` never leaves the machine.
 * Auto never means auto-pay: the client has no wallet, so it means the
 * invoice is shown at once.
 */
export interface CloudPrefs {
  mode: CloudMode
  autoMaxSats: number
  apiUrl: string
}

export function defaultCloudPrefs(): CloudPrefs {
  return { mode: 'auto', autoMaxSats: 0, apiUrl: defaultHosakaUrl() }
}

const PREFS_KEY = 'onosendai:cloud'
const JOB_KEY = 'onosendai:cloudJob'
const REGION_KEYS_KEY = 'onosendai:cloudRegionKeys'

export function loadCloudPrefs(): CloudPrefs {
  const d = defaultCloudPrefs()
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return d
    const p = JSON.parse(raw) as Partial<CloudPrefs>
    return {
      mode: p.mode === 'auto' || p.mode === 'ask' || p.mode === 'off' ? p.mode : d.mode,
      autoMaxSats: typeof p.autoMaxSats === 'number' && Number.isFinite(p.autoMaxSats) && p.autoMaxSats >= 0
        ? Math.floor(p.autoMaxSats)
        : d.autoMaxSats,
      apiUrl: typeof p.apiUrl === 'string' && /^https?:\/\/\S+$/.test(p.apiUrl) ? p.apiUrl.replace(/\/+$/, '') : d.apiUrl,
    }
  } catch {
    return d
  }
}

export function saveCloudPrefs(prefs: CloudPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
}

/** Where a pending job is in the payment flow; what RESUME picks up from. */
export type CloudStage = 'awaiting_payment' | 'paid' | 'computing'

/** The invoice as the HUD shows it. `expiresAt` is seconds since the epoch. */
export interface CloudInvoice {
  depositId: string
  bolt11: string
  amountMsats: number
  expiresAt: number
  paymentHash: string
}

export function invoiceOf(dep: HosakaDeposit): CloudInvoice {
  return {
    depositId: dep.deposit_id,
    bolt11: dep.bolt11,
    amountMsats: dep.amount_msats,
    expiresAt: dep.expires_at,
    paymentHash: dep.payment_hash,
  }
}

/** Positions as JSON can hold them: 85-bit axes do not survive a Number. */
export interface WirePosition { x: string; y: string; z: string }

export function wirePosition(p: Position): WirePosition {
  return { x: p.x.toString(), y: p.y.toString(), z: p.z.toString() }
}

export function positionFromWire(w: WirePosition): Position {
  return { x: BigInt(w.x), y: BigInt(w.y), z: BigInt(w.z) }
}

export function hosakaCoord(p: Position, plane: Plane): HosakaCoord {
  return { x: p.x, y: p.y, z: p.z, plane }
}

/**
 * The pending job, persisted before the invoice is shown. Everything a
 * restart needs to finish the move: how to read the job (poll token), what
 * to pay (deposit), and what the proof is FOR (the move and the chain head
 * it binds to), so a stale one can be recognised and dropped.
 */
export interface PendingCloudJob {
  version: 1
  jobId: string
  pollToken: string
  action: HosakaAction
  pubkey: string
  from: WirePosition
  to: WirePosition
  plane: Plane
  prevEventId: string
  costMsats: number
  /** Date.now() at submit. */
  createdAt: number
  stage: CloudStage
  deposit: CloudInvoice | null
}

export function loadCloudJob(): PendingCloudJob | null {
  try {
    const raw = localStorage.getItem(JOB_KEY)
    if (!raw) return null
    const r = JSON.parse(raw) as Partial<PendingCloudJob>
    if (r.version !== 1 || typeof r.jobId !== 'string' || typeof r.pollToken !== 'string') return null
    if (r.action !== 'hop' && r.action !== 'sidestep') return null
    if (r.stage !== 'awaiting_payment' && r.stage !== 'paid' && r.stage !== 'computing') return null
    if (typeof r.pubkey !== 'string' || typeof r.prevEventId !== 'string') return null
    if (!r.from || !r.to || (r.plane !== 0 && r.plane !== 1)) return null
    // A round trip through BigInt proves the positions are integers.
    positionFromWire(r.from); positionFromWire(r.to)
    return {
      version: 1,
      jobId: r.jobId,
      pollToken: r.pollToken,
      action: r.action,
      pubkey: r.pubkey,
      from: r.from,
      to: r.to,
      plane: r.plane,
      prevEventId: r.prevEventId,
      costMsats: typeof r.costMsats === 'number' ? r.costMsats : 0,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
      stage: r.stage,
      deposit: r.deposit ?? null,
    }
  } catch {
    return null
  }
}

export function saveCloudJob(record: PendingCloudJob): void {
  try { localStorage.setItem(JOB_KEY, JSON.stringify(record)) } catch { /* private mode */ }
}

export function clearCloudJob(): void {
  try { localStorage.removeItem(JOB_KEY) } catch { /* private mode */ }
}

/**
 * A region key a cloud hop returned (7.2): the region's lookup id and its
 * location decryption key, which this machine could not derive itself
 * (that would need the cloud root). Kept so discovery can one day open bags
 * hidden at heights only the cloud reaches; nothing reads it yet.
 */
export interface CloudRegionKey {
  lookupId: string
  keyHex: string
  height: number
  /** The destination coordinate, 64 hex. */
  coordHex: string
  jobId: string
  /** Seconds since the epoch. */
  at: number
}

const REGION_KEYS_MAX = 200

export function loadCloudRegionKeys(): CloudRegionKey[] {
  try {
    const raw = localStorage.getItem(REGION_KEYS_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? (list as CloudRegionKey[]) : []
  } catch {
    return []
  }
}

export function saveCloudRegionKey(entry: CloudRegionKey): void {
  try {
    const list = loadCloudRegionKeys().filter((k) => k.lookupId !== entry.lookupId)
    list.push(entry)
    localStorage.setItem(REGION_KEYS_KEY, JSON.stringify(list.slice(-REGION_KEYS_MAX)))
  } catch { /* private mode */ }
}

/**
 * What a commit beyond the cursor does. Local first, cloud second, sidestep
 * third (contract, "Deciding local versus cloud"): a hop this machine can
 * finish is computed here; otherwise a cloud hop when HOSAKA sells the
 * height, since one paid action lands at the cursor and returns the region
 * key; otherwise a cloud sidestep across the wall; otherwise the local
 * sidestep the client always had.
 */
export type CloudRoute = 'local-hop' | 'cloud-hop' | 'cloud-sidestep' | 'local-sidestep'

export interface RouteInput {
  /** max(hx, hy, hz) of the lined-up move. */
  maxHeight: number
  /** This machine's hop ceiling: the hard cap lowered by calibration. */
  ceiling: number
  mode: CloudMode
  /** null until GET /limits has answered; no limits means no cloud. */
  limits: HosakaLimits | null
}

export function routeCommit(i: RouteInput): CloudRoute {
  if (i.maxHeight <= i.ceiling) return 'local-hop'
  if (i.mode === 'off' || i.limits === null) return 'local-sidestep'
  if (i.maxHeight <= i.limits.max_hop_height) return 'cloud-hop'
  if (i.maxHeight <= i.limits.max_sidestep_height) return 'cloud-sidestep'
  return 'local-sidestep'
}

/** Whole sats, rounded up: the only unit a person is asked to pay in. */
export function satsOf(msats: number): number {
  return Math.ceil(msats / 1000)
}

/** Whether a quote at this price stops for a PAY button first. */
export function needsApproval(costMsats: number, prefs: CloudPrefs): boolean {
  if (prefs.mode === 'ask') return true
  return satsOf(costMsats) > prefs.autoMaxSats
}

/** mm:ss, for countdowns and elapsed lines. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export type CloudFlowCode = 'invoice_expired' | 'no_invoice' | 'payment_loop' | 'job_failed' | 'head_moved' | 'verification' | 'over_cap' | 'signing'

/** A failure of the flow itself rather than of one request. */
export class CloudFlowError extends Error {
  readonly code: CloudFlowCode
  constructor(code: CloudFlowCode, message: string) {
    super(message)
    this.name = 'CloudFlowError'
    this.code = code
  }
}

/** Whether the pending record should survive this failure for RESUME. A
 * dropped connection or a slow job can be picked up again; an expired
 * invoice, a failed job or a refused signature cannot. */
export function retainsRecord(err: unknown): boolean {
  if (err instanceof HosakaError) return err.transient || err.code === 'timeout'
  return false
}

/** One line for the HUD. */
export function describeCloudError(err: unknown): string {
  if (err instanceof HosakaError) {
    if (err.code === 'aborted') return 'Cancelled.'
    if (err.code === 'network') return `HOSAKA unreachable: ${err.message}`
    if (err.code === 'timeout') return 'HOSAKA is still computing. The job is kept; RESUME when it is done.'
    if (err.status === 401) return `HOSAKA refused the signature: ${err.message}`
    return `HOSAKA ${err.status}: ${err.message}`
  }
  if (err instanceof CloudFlowError) return err.message
  return err instanceof Error ? err.message : String(err)
}

export interface CloudStageDetail {
  invoice?: CloudInvoice | null
  /** 0..1 from the server's estimate while computing; null when unknown. */
  progress?: number | null
  message?: string | null
}

export interface CloudDriverHooks {
  /** The record changed (a stage or a new invoice): persist and show it. */
  onRecord: (record: PendingCloudJob) => void
  /** A stage began, with what the HUD needs for it. */
  onStage: (stage: CloudStage, detail: CloudStageDetail) => void
  /** Claim polls are signed; a bunker user wants fewer of them. */
  claimIntervalMs?: number
}

/** Rounds of "pay, start" tolerated: a short payment can ask once more. */
const PAYMENT_ROUNDS = 3

function progressOf(job: HosakaJob): number | null {
  const r = job.result as { progress_percent?: unknown } | null
  return r && typeof r.progress_percent === 'number' ? Math.min(1, Math.max(0, r.progress_percent / 100)) : null
}

/**
 * Take a pending job from wherever it stands to a final answer. The contract's
 * steps 1 to 4: show the invoice and claim-poll until it settles, start the
 * job (which charges the estimate and enqueues once), then poll the job with
 * its token until it completes or fails. Every stage change goes back through
 * the hooks so the record on disk always says where to resume from.
 */
export async function driveCloudJob(
  client: HosakaClient,
  start: PendingCloudJob,
  hooks: CloudDriverHooks,
  signal?: AbortSignal,
  waker?: Waker,
): Promise<{ job: HosakaJob; record: PendingCloudJob }> {
  let record = start
  for (let round = 0; round < PAYMENT_ROUNDS; round++) {
    if (record.stage === 'awaiting_payment') {
      if (!record.deposit) throw new CloudFlowError('no_invoice', 'HOSAKA wants payment but issued no invoice.')
      hooks.onStage('awaiting_payment', { invoice: record.deposit, message: null })
      const dep = await client.waitForDeposit(record.deposit.depositId, {
        signal,
        expiresAt: record.deposit.expiresAt,
        intervalMs: hooks.claimIntervalMs,
        waker,
      })
      if (dep.status !== 'settled') throw new CloudFlowError('invoice_expired', 'The invoice expired unpaid. Commit again for a fresh quote.')
      record = { ...record, stage: 'paid' }
      hooks.onRecord(record)
    }

    if (record.stage === 'paid') {
      hooks.onStage('paid', { invoice: null, message: 'Payment settled. Starting the job.' })
      const started = await client.startJob(record.jobId)
      if (started.payment_required && started.deposit) {
        // Settled short: HOSAKA credited what arrived and asks for the rest.
        record = { ...record, stage: 'awaiting_payment', deposit: invoiceOf(started.deposit) }
        hooks.onRecord(record)
        continue
      }
      if (started.status === 'completed' || started.status === 'failed') return { job: started, record }
      record = { ...record, stage: 'computing', deposit: null }
      hooks.onRecord(record)
    }

    hooks.onStage('computing', { invoice: null, progress: null, message: null })
    const job = await client.waitForJob(record.jobId, record.pollToken, {
      signal,
      onPoll: (j) => hooks.onStage('computing', { progress: progressOf(j) }),
    })
    return { job, record }
  }
  throw new CloudFlowError('payment_loop', 'HOSAKA kept asking for payment after it was paid.')
}

let verifyId = 0

/**
 * Run the contract's checks on a finished job, in a worker when there is one
 * (a browser), inline otherwise (tests). A worker that cannot be created falls
 * back inline too: a frozen frame is better than an unverified proof.
 */
export function verifyCloudResult(action: HosakaAction, result: unknown, move: CloudMove, localCeiling: number): Promise<string[]> {
  const request: VerifyRequest = { id: ++verifyId, action, result, move, localCeiling }
  if (typeof Worker === 'undefined') return Promise.resolve(verifyCloud(action, result, move, localCeiling))
  return new Promise<string[]>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('../workers/verify.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      resolve(verifyCloud(action, result, move, localCeiling))
      return
    }
    worker.onmessage = (event: MessageEvent<VerifyResponse>) => {
      worker.terminate()
      const msg = event.data
      if (msg.id !== request.id) return
      if ('error' in msg) reject(new Error(msg.error))
      else resolve(msg.failed)
    }
    worker.onerror = () => {
      worker.terminate()
      try { resolve(verifyCloud(action, result, move, localCeiling)) } catch (err) { reject(err) }
    }
    worker.postMessage(request)
  })
}

/**
 * A completed job as the proof worker would have reported it, so the store
 * signs it through the one path it has. totalOps is 0: this machine did no
 * pairing or hashing for it.
 */
export function cloudProofResponse(id: number, record: PendingCloudJob, job: HosakaJob, elapsedMs: number): ProofResponse {
  const from = positionFromWire(record.from)
  const to = positionFromWire(record.to)
  const lca = { x: findLcaHeight(from.x, to.x), y: findLcaHeight(from.y, to.y), z: findLcaHeight(from.z, to.z) }
  const costMsats = typeof job.cost_msats === 'number' ? job.cost_msats : record.costMsats
  if (record.action === 'hop') {
    const r = job.result as CloudHopResult
    return {
      type: 'done',
      id,
      mode: 'hop',
      elapsedMs,
      proofHash: r.hop_n.public_proof,
      // The region integer never left the cloud; its lookup id did.
      regionN: null,
      terrainK: r.K,
      lca,
      totalOps: 0,
      source: 'cloud',
      jobId: record.jobId,
      costMsats,
      lookupId: r.region_n.public_proof,
    }
  }
  const r = job.result as CloudSidestepResult
  return {
    type: 'done',
    id,
    mode: 'sidestep',
    elapsedMs,
    proofHash: r.proof_hash,
    regionN: /^[0-9a-f]+$/.test(r.region_m_hex ?? '') ? BigInt('0x' + r.region_m_hex).toString() : null,
    terrainK: r.terrain_k,
    lca,
    totalOps: 0,
    sidestep: {
      merkleRoots: [r.merkle_x, r.merkle_y, r.merkle_z],
      // 8.5: siblings concatenated leaf-first per axis, empty where the axis did not move.
      inclusionProofs: [r.inclusion_proofs.x.join(''), r.inclusion_proofs.y.join(''), r.inclusion_proofs.z.join('')],
      lcaHeights: r.lca_heights,
    },
    source: 'cloud',
    jobId: record.jobId,
    costMsats,
  }
}
