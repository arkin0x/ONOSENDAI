/**
 * hosaka.ts - the HOSAKA cloud-compute API, as this client speaks it.
 *
 * HOSAKA sells the proofs this machine cannot finish: a Cantor hop above the
 * calibrated ceiling, or a Merkle sidestep across a wall taller than a minute
 * of local hashing. This file is the whole wire protocol in one place (the
 * contract is hosaka-audit/client-contract.md): public quotes and limits,
 * NIP-98 signed submits, a poll token for reading a job without signing, and
 * the deposit rail that turns a Lightning invoice into a prepaid balance.
 *
 * Money never touches this file. HOSAKA issues the invoice, any wallet pays
 * it, and the node's own answer is the payment: the client only shows the
 * invoice and asks whether it settled.
 *
 * Pure I/O. Nothing here knows about the store; the caller supplies the
 * signer (a local key, an extension or a bunker, all through one shape) and,
 * in tests, the fetch.
 */

import * as nip98 from 'nostr-tools/nip98'
import type { Plane } from 'cyberspace-core'
import type { EventTemplate, NostrEvent } from './events'

/** The production API. VITE_HOSAKA_URL overrides it (a local HOSAKA is
 * `HOSAKA_LOCAL_COMPUTE=1` on 127.0.0.1:8765). */
export const HOSAKA_DEFAULT_URL = 'https://arkin0x--hosaka-api-api-server.modal.run'

export function defaultHosakaUrl(): string {
  const fromEnv = (import.meta.env?.VITE_HOSAKA_URL as string | undefined)?.trim()
  return fromEnv ? fromEnv.replace(/\/+$/, '') : HOSAKA_DEFAULT_URL
}

/** One request outstanding longer than this is a dead connection, not a slow one. */
const REQUEST_TIMEOUT_MS = 20_000
/**
 * How long a signer gets to sign one request. An extension or a bunker
 * answers over a channel the phone can drop while the tab is in the wallet
 * app; a request that never comes back must not hang the claim poll, which
 * is what left an invoice unrecognised after payment (the spinner stuck,
 * no further polls) until a reload claimed it.
 */
export const SIGN_TIMEOUT_MS = 45_000 // outlasts the store's own patience, one rebuild of the signer, and a second try
/** A poll that has not settled by then is abandoned and the next one goes out. */
export const POLL_HANG_MS = SIGN_TIMEOUT_MS + REQUEST_TIMEOUT_MS + 5_000
/** Contract: claim polls every 3 to 5 s. */
export const CLAIM_INTERVAL_MS = 4_000
/** Contract: job polls every 5 to 15 s; this ramps from the first to the second. */
export const JOB_POLL_MIN_MS = 5_000
export const JOB_POLL_MAX_MS = 15_000
/** Consecutive poll failures (network, 5xx, a 404 while the volume syncs) tolerated before giving up. */
const POLL_FAILURE_LIMIT = 3
/** Past the invoice expiry by this much with the server still saying pending, stop asking. */
const EXPIRY_GRACE_MS = 30_000
/** A job watched longer than this keeps its record for RESUME instead of holding the tab. */
const DEFAULT_JOB_WAIT_MS = 60 * 60 * 1000

export type HosakaAction = 'hop' | 'sidestep'

/** A coordinate as the API takes it: per-axis integers plus the plane. */
export interface HosakaCoord {
  x: bigint
  y: bigint
  z: bigint
  plane: Plane
}

/** GET /api/v1/limits. Clients never hardcode a cap. */
export interface HosakaLimits {
  max_hop_height: number
  max_sidestep_height: number
  hop_min_msats: number
  deposit_min_msats: number
  deposit_max_msats: number
  invoice_ttl_seconds: number
  local_compute?: boolean
}

/** POST /api/v1/quote: the price the submit route would charge, without submitting. */
export interface HosakaQuote {
  action: HosakaAction
  /** null when the move is over the cap. */
  cost_msats: number | null
  within_cap: boolean
  cap: number
  max_height: number
  per_axis_heights: { x: number; y: number; z: number }
  K: number
  tier: string | null
  est_time: string | null
  /** The wait in seconds, so a route's steps can be added up; older servers omit it. */
  est_seconds?: number | null
  hint: string | null
}

export type HosakaDepositStatus = 'pending' | 'settled' | 'expired'

/** A deposit: an invoice HOSAKA's own node issued for the caller's pubkey. */
export interface HosakaDeposit {
  deposit_id: string
  status: HosakaDepositStatus
  amount_msats: number
  bolt11: string
  payment_hash: string
  /** Seconds since the epoch. */
  created_at: number
  expires_at: number
  settled_at: number | null
  settled_msats: number | null
  preimage: string | null
  /** Present on a claim: the balance after crediting. */
  balance_msats?: number
}

export type HosakaJobStatus = 'pending' | 'computing' | 'completed' | 'failed'

/** One content-addressed root the hop pipeline stored: `public_proof` is the
 * double SHA-256 of the root's bytes, `secret_key` the single one. */
export interface HopEnvelope {
  public_proof: string
  secret_key: string
  file_id?: string
  size_bytes?: number
  download_url?: string
  /** h = 0 axes: the root is the axis value itself. */
  trivial?: boolean
  height?: number
  /** A JSON number; unusable above 2^53 in JS, so never read, only recomputed. */
  base?: number
}

/** `result` of a completed hop job. The event's proof tag is hop_n.public_proof;
 * region_n.public_proof is the region's lookup id and region_n.secret_key its
 * location decryption key (spec 7.2). */
export interface CloudHopResult {
  hop_n: HopEnvelope
  region_n: HopEnvelope
  region_xy: HopEnvelope
  cantor_x: HopEnvelope
  cantor_y: HopEnvelope
  cantor_z: HopEnvelope
  cantor_t: HopEnvelope
  K: number
  max_height: number
  compute_msats: number
  storage_msats_24h?: number
}

/** `result` of a completed sidestep job (spec 6.8 and 6.10). */
export interface CloudSidestepResult {
  proof_hash: string
  merkle_x: string
  merkle_y: string
  merkle_z: string
  /** Per axis, the destination leaf's sibling hashes leaf-first; empty where the axis did not move. */
  inclusion_proofs: { x: string[]; y: string[]; z: string[] }
  lca_heights: [number, number, number]
  /** JSON numbers above 2^53: never read, only recomputed. */
  bases?: unknown
  v1?: unknown
  v2?: unknown
  previous_event_id: string
  terrain_k: number
  region_m_hex: string
  compute_msats: number
}

/** A job as the API returns it: the row, plus the payment fields a submit or a start adds. */
export interface HosakaJob {
  id: string
  status: HosakaJobStatus
  job_type?: string
  cost_msats: number
  /** Shown once, in the creation response. */
  poll_token?: string
  result: unknown
  error: string | null
  created_at?: number
  payment_required?: boolean
  amount_due_msats?: number
  current_balance_msats?: number
  balance_debited?: boolean
  previous_balance_msats?: number
  new_balance_msats?: number
  deposit?: HosakaDeposit
  next?: string
}

export interface HosakaBalance {
  pubkey: string
  balance_msats: number
  ledger: unknown[]
}

/**
 * What the API said no to, or what stopped the request. `code` is the server's
 * machine-readable `error` when it sent one (`height_exceeds_hosaka_cap`,
 * `too_many_active_jobs`, `service_busy`, `payments_unavailable`), `network`
 * when the request never got an answer, `aborted` when the caller cancelled.
 */
export class HosakaError extends Error {
  readonly status: number
  readonly code: string | null
  readonly detail: unknown

  constructor(status: number, code: string | null, message: string, detail?: unknown) {
    super(message)
    this.name = 'HosakaError'
    this.status = status
    this.code = code
    this.detail = detail
  }

  static fromResponse(status: number, body: unknown): HosakaError {
    const detail = body !== null && typeof body === 'object' && 'detail' in body
      ? (body as { detail: unknown }).detail
      : body
    let code: string | null = null
    let message = `HOSAKA answered ${status}`
    if (typeof detail === 'string') {
      message = detail
    } else if (detail !== null && typeof detail === 'object' && !Array.isArray(detail)) {
      const d = detail as Record<string, unknown>
      if (typeof d.error === 'string') code = d.error
      const text = typeof d.hint === 'string' ? d.hint : typeof d.message === 'string' ? d.message : null
      message = [code, text].filter((s): s is string => !!s).join(': ') || message
    }
    return new HosakaError(status, code, message, detail)
  }

  /** A failure the caller may retry later without losing anything. */
  get transient(): boolean {
    return this.status === 0 && this.code !== 'aborted' || this.status >= 500 || this.status === 429
  }
}

/**
 * A sleep that a button can cut short: the invoice modal's CHECK PAYMENT
 * wakes the claim poll instead of waiting out the interval.
 */
export interface Waker {
  wait: (ms: number, signal?: AbortSignal) => Promise<void>
  wake: () => void
}

export function createWaker(): Waker {
  let pending: (() => void) | null = null
  return {
    wait: (ms, signal) =>
      new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', done)
          if (pending === done) pending = null
          resolve()
        }
        const timer = setTimeout(done, ms)
        pending = done
        if (signal?.aborted) done()
        else signal?.addEventListener('abort', done, { once: true })
      }),
    wake: () => { pending?.() },
  }
}

/**
 * JSON with bigints written as bare integer literals. Coordinates are 85-bit
 * and the API takes them as integers, which JSON.stringify refuses and a
 * Number would round.
 */
export function jsonWithBigints(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? `__big:${v.toString()}` : v))
    .replace(/"__big:(\d+)"/g, '$1')
}

function randomNonce(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

function abortError(): HosakaError {
  return new HosakaError(0, 'aborted', 'cancelled')
}

export interface WaitForDepositOptions {
  signal?: AbortSignal
  /** Seconds since the epoch; polling stops a little after it. */
  expiresAt?: number
  intervalMs?: number
  waker?: Waker
  /** Every answer from the node, settled or not, so a manual check can show it landed. */
  onPoll?: (dep: HosakaDeposit) => void  /** A poll that failed (timed out, 5xx, dropped socket); the wait goes on, the UI can stop spinning. */
  onPollError?: (err: unknown) => void
}

export interface WaitForJobOptions {
  signal?: AbortSignal
  /** Every poll's answer, for progress. */
  onPoll?: (job: HosakaJob) => void
  maxWaitMs?: number
}

export interface HosakaClientOptions {
  apiUrl: string
  /** Signs the kind 27235 auth event: the store's signer, whatever kind it is. */
  sign: (template: EventTemplate) => Promise<NostrEvent>
  /** Tests inject one; the app uses the global. */
  fetch?: typeof fetch
}

export interface HosakaClient {
  readonly apiUrl: string
  limits: (signal?: AbortSignal) => Promise<HosakaLimits>
  quote: (action: HosakaAction, v1: HosakaCoord, v2: HosakaCoord, signal?: AbortSignal) => Promise<HosakaQuote>
  submitHop: (v1: HosakaCoord, v2: HosakaCoord, previousEventId: string, signal?: AbortSignal) => Promise<HosakaJob>
  submitSidestep: (v1: HosakaCoord, v2: HosakaCoord, previousEventId: string, signal?: AbortSignal) => Promise<HosakaJob>
  /** Reads with the poll token; no signature, so a bunker is never prompted per poll. */
  getJob: (jobId: string, pollToken: string, signal?: AbortSignal) => Promise<HosakaJob>
  startJob: (jobId: string, signal?: AbortSignal) => Promise<HosakaJob>
  claimDeposit: (depositId: string, signal?: AbortSignal) => Promise<HosakaDeposit>
  balance: (signal?: AbortSignal) => Promise<HosakaBalance>
  deposit: (amountMsats: number, signal?: AbortSignal) => Promise<HosakaDeposit>
  /** Claim-poll until settled or expired. Resolves with the final deposit. */
  waitForDeposit: (depositId: string, opts?: WaitForDepositOptions) => Promise<HosakaDeposit>
  /** Poll until completed or failed. Resolves with the final job. */
  waitForJob: (jobId: string, pollToken: string, opts?: WaitForJobOptions) => Promise<HosakaJob>
}

interface RequestInit {
  method: 'GET' | 'POST'
  body?: unknown
  /** Sign a fresh NIP-98 event for this request. */
  auth?: boolean
  headers?: Record<string, string>
  signal?: AbortSignal
}

export function createHosaka(opts: HosakaClientOptions): HosakaClient {
  const apiUrl = opts.apiUrl.replace(/\/+$/, '')
  // Looked up per call so a test that stubs the global after construction still wins.
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init))

  /**
   * A fresh kind 27235 event per request. The server remembers every event id
   * it has accepted for the freshness window, so the same token can never be
   * sent twice; the nonce tag makes two requests signed in the same second
   * distinct events, which nostr-tools' template alone would not.
   */
  const authorization = async (url: string, method: string): Promise<string> => {
    const token = nip98.getToken(
      url,
      method,
      (template) => opts.sign({ ...template, tags: [...template.tags, ['nonce', randomNonce()]] }),
      true,
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HosakaError(0, 'sign_timeout', 'the signer did not answer in time')), SIGN_TIMEOUT_MS)
    })
    try {
      return await Promise.race([token, late])
    } catch (err) {
      // Whatever the signer's failure, a poll must not die of it: as a
      // transient HosakaError the loop asks again.
      if (err instanceof HosakaError) throw err
      throw new HosakaError(0, 'sign_failed', err instanceof Error ? err.message : String(err))
    } finally {
      clearTimeout(timer)
    }
  }

  /** The promise, or a poll_timeout once POLL_HANG_MS has passed without it settling. */
  const guarded = async <T>(work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HosakaError(0, 'poll_timeout', 'HOSAKA did not answer in time')), POLL_HANG_MS)
    })
    try {
      return await Promise.race([work, late])
    } finally {
      clearTimeout(timer)
    }
  }

  const request = async <T>(path: string, init: RequestInit): Promise<T> => {
    const url = apiUrl + path
    const headers: Record<string, string> = { accept: 'application/json', ...(init.headers ?? {}) }
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (init.auth) headers.authorization = await authorization(url, init.method)

    if (init.signal?.aborted) throw abortError()
    const timeout = new AbortController()
    const onOuterAbort = (): void => timeout.abort()
    init.signal?.addEventListener('abort', onOuterAbort, { once: true })
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS)

    let res: Response
    try {
      res = await doFetch(url, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : jsonWithBigints(init.body),
        signal: timeout.signal,
      })
    } catch (err) {
      if (init.signal?.aborted) throw abortError()
      throw new HosakaError(0, 'network', err instanceof Error ? err.message : String(err))
    } finally {
      clearTimeout(timer)
      init.signal?.removeEventListener('abort', onOuterAbort)
    }

    const text = await res.text()
    let data: unknown = null
    if (text) {
      try { data = JSON.parse(text) } catch { data = text }
    }
    if (!res.ok) throw HosakaError.fromResponse(res.status, data)
    return data as T
  }

  const submit = (action: HosakaAction, v1: HosakaCoord, v2: HosakaCoord, previousEventId: string, signal?: AbortSignal): Promise<HosakaJob> =>
    request<HosakaJob>(`/api/v1/${action}`, {
      method: 'POST',
      auth: true,
      body: { v1, v2, previous_event_id: previousEventId },
      signal,
    })

  const claimDeposit = (depositId: string, signal?: AbortSignal): Promise<HosakaDeposit> =>
    request<HosakaDeposit>(`/api/v1/deposit/${depositId}/claim`, { method: 'POST', auth: true, signal })

  const getJob = (jobId: string, pollToken: string, signal?: AbortSignal): Promise<HosakaJob> =>
    request<HosakaJob>(`/api/v1/jobs/${jobId}`, { method: 'GET', headers: { 'X-Job-Token': pollToken }, signal })

  const client: HosakaClient = {
    apiUrl,
    limits: (signal) => request<HosakaLimits>('/api/v1/limits', { method: 'GET', signal }),
    quote: (action, v1, v2, signal) =>
      request<HosakaQuote>('/api/v1/quote', { method: 'POST', body: { action, v1, v2 }, signal }),
    submitHop: (v1, v2, previousEventId, signal) => submit('hop', v1, v2, previousEventId, signal),
    submitSidestep: (v1, v2, previousEventId, signal) => submit('sidestep', v1, v2, previousEventId, signal),
    getJob,
    startJob: (jobId, signal) => request<HosakaJob>(`/api/v1/jobs/${jobId}/start`, { method: 'POST', auth: true, signal }),
    claimDeposit,
    balance: (signal) => request<HosakaBalance>('/api/v1/balance', { method: 'GET', auth: true, signal }),
    deposit: (amountMsats, signal) =>
      request<HosakaDeposit>('/api/v1/deposit', { method: 'POST', auth: true, body: { amount_msats: amountMsats }, signal }),

    waitForDeposit: async (depositId, o = {}) => {
      const waker = o.waker ?? createWaker()
      const interval = o.intervalMs ?? CLAIM_INTERVAL_MS
      const deadline = o.expiresAt !== undefined ? o.expiresAt * 1000 + EXPIRY_GRACE_MS : Infinity
      let failures = 0
      let last: HosakaDeposit | null = null
      for (;;) {
        if (o.signal?.aborted) throw abortError()
        try {
          last = await guarded(claimDeposit(depositId, o.signal))
          failures = 0
          o.onPoll?.(last)
          if (last.status === 'settled' || last.status === 'expired') return last
        } catch (err) {
          if (err instanceof HosakaError && err.code === 'aborted') throw err
          o.onPollError?.(err)
          // The node blinking (503 payments_unavailable) or a dropped socket
          // is not the payer's problem; keep asking for a while.
          if (!(err instanceof HosakaError && err.transient) || ++failures >= POLL_FAILURE_LIMIT + 2) throw err
        }
        if (Date.now() > deadline) {
          // The server never flipped it; treat the invoice as gone.
          return last ? { ...last, status: 'expired' } : new Promise<HosakaDeposit>((_, reject) =>
            reject(new HosakaError(0, 'invoice_expired', 'the invoice expired before HOSAKA could be asked about it')))
        }
        await waker.wait(interval, o.signal)
      }
    },

    waitForJob: async (jobId, pollToken, o = {}) => {
      const started = Date.now()
      const maxWait = o.maxWaitMs ?? DEFAULT_JOB_WAIT_MS
      let failures = 0
      let polls = 0
      for (;;) {
        if (o.signal?.aborted) throw abortError()
        try {
          const job = await guarded(getJob(jobId, pollToken, o.signal))
          failures = 0
          o.onPoll?.(job)
          if (job.status === 'completed' || job.status === 'failed') return job
        } catch (err) {
          if (err instanceof HosakaError && err.code === 'aborted') throw err
          // A 404 right after completion is the volume syncing (contract);
          // three in a row is a job that is really gone.
          const tolerable = err instanceof HosakaError && (err.transient || err.status === 404)
          if (!tolerable || ++failures >= POLL_FAILURE_LIMIT) throw err
        }
        if (Date.now() - started > maxWait) {
          throw new HosakaError(0, 'timeout', 'still computing; the job is kept for RESUME')
        }
        // 5 s, then a little longer each time, up to 15 s.
        const interval = Math.min(JOB_POLL_MAX_MS, JOB_POLL_MIN_MS + polls * 2_500)
        polls++
        await sleep(interval, o.signal)
      }
    },
  }
  return client
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return createWaker().wait(ms, signal)
}
