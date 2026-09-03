/**
 * hosaka.test.ts - the wire protocol, against a scripted fetch.
 *
 * What would fail silently in production: a request signed for a different
 * URL than the one sent (the server answers 401 and the move never starts), a
 * replayed token (two submits in one second sharing an event id), a bigint
 * coordinate rounded through a Number, a poll that reads the job with a
 * signature instead of the token (a bunker prompt every 5 s), or a poll loop
 * that stops on the first 404 or never stops at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import type { EventTemplate, NostrEvent } from './events'
import {
  CLAIM_INTERVAL_MS,
  HosakaError,
  JOB_POLL_MIN_MS,
  createHosaka,
  createWaker,
  jsonWithBigints,
  type HosakaDeposit,
  type HosakaJob,
} from './hosaka'

const sk = generateSecretKey()
const pubkey = getPublicKey(sk)
const sign = (t: EventTemplate): Promise<NostrEvent> => Promise.resolve(finalizeEvent(t, sk) as unknown as NostrEvent)
const API = 'https://hosaka.test'

interface Call { method: string; url: string; headers: Record<string, string>; body: string | undefined }
type Handler = (call: Call) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>

/** A fetch that answers by "METHOD /path" and records every call. */
function scripted(routes: Record<string, Handler>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) headers[k.toLowerCase()] = v
    const call: Call = { method: init?.method ?? 'GET', url: url.toString(), headers, body: typeof init?.body === 'string' ? init.body : undefined }
    calls.push(call)
    const handler = routes[`${call.method} ${url.pathname}`]
    if (!handler) return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 })
    const r = await handler(call)
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status ?? 200 })
  })
  return { fetch: fetchFn as unknown as typeof fetch, calls }
}

/** The rejection of a promise that must reject, typed. */
async function rejection(p: Promise<unknown>): Promise<HosakaError> {
  return p.then(
    () => { throw new Error('expected a rejection') },
    (e: unknown) => { expect(e).toBeInstanceOf(HosakaError); return e as HosakaError },
  )
}

function decodeToken(header: string): NostrEvent {
  expect(header.startsWith('Nostr ')).toBe(true)
  return JSON.parse(Buffer.from(header.slice(6), 'base64').toString('utf8')) as NostrEvent
}

const V1 = { x: 0n, y: 0n, z: 0n, plane: 0 as const }
const V2 = { x: (1n << 84n) + 5n, y: 0n, z: 0n, plane: 0 as const }
const PREV = 'ab'.repeat(32)

const funded: HosakaJob = { id: 'job-1', status: 'computing', cost_msats: 1000, poll_token: 'tok', result: null, error: null, payment_required: false }

describe('jsonWithBigints', () => {
  it('writes bigints as bare integers and leaves everything else alone', () => {
    expect(jsonWithBigints({ v: { x: (1n << 84n) + 5n, plane: 0 }, id: 'ab' })).toBe(
      `{"v":{"x":${((1n << 84n) + 5n).toString()},"plane":0},"id":"ab"}`,
    )
  })
})

describe('createHosaka requests', () => {
  it('reads limits and quotes without any signature, with coordinates as integers', async () => {
    const { fetch, calls } = scripted({
      'GET /api/v1/limits': () => ({ body: { max_hop_height: 25, max_sidestep_height: 29 } }),
      'POST /api/v1/quote': () => ({ body: { action: 'hop', cost_msats: 1000, within_cap: true } }),
    })
    const c = createHosaka({ apiUrl: API + '/', sign, fetch })
    expect((await c.limits()).max_hop_height).toBe(25)
    expect((await c.quote('hop', V1, V2)).cost_msats).toBe(1000)
    expect(calls[0].headers.authorization).toBeUndefined()
    expect(calls[1].headers.authorization).toBeUndefined()
    expect(calls[1].url).toBe(`${API}/api/v1/quote`)
    expect(calls[1].body).toContain(`"x":${V2.x.toString()},`)
    expect(calls[1].body).not.toContain(`"${V2.x.toString()}"`)
  })

  it('signs submits with a fresh NIP-98 event naming the exact URL, the method and a nonce', async () => {
    const { fetch, calls } = scripted({ 'POST /api/v1/hop': () => ({ status: 201, body: funded }) })
    const c = createHosaka({ apiUrl: API, sign, fetch })
    await c.submitHop(V1, V2, PREV)
    await c.submitHop(V1, V2, PREV)

    const events = calls.map((call) => decodeToken(call.headers.authorization))
    for (const ev of events) {
      expect(ev.kind).toBe(27235)
      expect(ev.pubkey).toBe(pubkey)
      expect(ev.tags.find((t) => t[0] === 'u')?.[1]).toBe(`${API}/api/v1/hop`)
      expect(ev.tags.find((t) => t[0] === 'method')?.[1]).toBe('POST')
      expect(ev.tags.find((t) => t[0] === 'nonce')?.[1]).toMatch(/^[0-9a-f]{16}$/)
      expect(verifyEvent(ev as never)).toBe(true)
    }
    // Same second, same URL: still two different events, so the replay cache
    // cannot mistake the second for the first.
    expect(events[0].id).not.toBe(events[1].id)
    expect(JSON.parse(calls[0].body!)).toEqual({ v1: { x: 0, y: 0, z: 0, plane: 0 }, v2: expect.objectContaining({ plane: 0 }), previous_event_id: PREV })
  })

  it('reads a job with the poll token and no signature', async () => {
    const { fetch, calls } = scripted({ 'GET /api/v1/jobs/job-1': () => ({ body: funded }) })
    const c = createHosaka({ apiUrl: API, sign, fetch })
    expect((await c.getJob('job-1', 'tok')).id).toBe('job-1')
    expect(calls[0].headers['x-job-token']).toBe('tok')
    expect(calls[0].headers.authorization).toBeUndefined()
  })

  it('signs start, claim, balance and deposit', async () => {
    const dep: HosakaDeposit = { deposit_id: 'd1', status: 'pending', amount_msats: 1000, bolt11: 'lnbc1', payment_hash: 'h', created_at: 1, expires_at: 3601, settled_at: null, settled_msats: null, preimage: null }
    const { fetch, calls } = scripted({
      'POST /api/v1/jobs/job-1/start': () => ({ body: funded }),
      'POST /api/v1/deposit/d1/claim': () => ({ body: dep }),
      'GET /api/v1/balance': () => ({ body: { pubkey, balance_msats: 0, ledger: [] } }),
      'POST /api/v1/deposit': () => ({ status: 201, body: dep }),
    })
    const c = createHosaka({ apiUrl: API, sign, fetch })
    await c.startJob('job-1')
    await c.claimDeposit('d1')
    await c.balance()
    await c.deposit(5000)
    expect(calls.map((x) => `${x.method} ${new URL(x.url).pathname}`)).toEqual([
      'POST /api/v1/jobs/job-1/start', 'POST /api/v1/deposit/d1/claim', 'GET /api/v1/balance', 'POST /api/v1/deposit',
    ])
    for (const call of calls) {
      const ev = decodeToken(call.headers.authorization)
      expect(ev.tags.find((t) => t[0] === 'u')?.[1]).toBe(call.url)
      expect(ev.tags.find((t) => t[0] === 'method')?.[1]).toBe(call.method)
    }
    expect(calls[3].body).toBe('{"amount_msats":5000}')
  })

  it('maps server refusals to HosakaError with the machine code', async () => {
    const { fetch } = scripted({
      'POST /api/v1/hop': () => ({ status: 400, body: { detail: { error: 'height_exceeds_hosaka_cap', hint: 'quote a sidestep' } } }),
      'GET /api/v1/balance': () => ({ status: 401, body: { detail: 'Authentication failed: Auth event already used' } }),
      'POST /api/v1/sidestep': () => ({ status: 429, body: { detail: { error: 'service_busy', hint: 'retry' } } }),
    })
    const c = createHosaka({ apiUrl: API, sign, fetch })
    const capped = await rejection(c.submitHop(V1, V2, PREV))
    expect(capped.status).toBe(400)
    expect(capped.code).toBe('height_exceeds_hosaka_cap')
    expect(capped.message).toBe('height_exceeds_hosaka_cap: quote a sidestep')
    expect(capped.transient).toBe(false)

    const replayed = await rejection(c.balance())
    expect(replayed.status).toBe(401)
    expect(replayed.message).toBe('Authentication failed: Auth event already used')

    const busy = await rejection(c.submitSidestep(V1, V2, PREV))
    expect(busy.code).toBe('service_busy')
    expect(busy.transient).toBe(true)
  })

  it('wraps a dead connection as a transient network error', async () => {
    const dead = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    const c = createHosaka({ apiUrl: API, sign, fetch: dead })
    const err = await rejection(c.limits())
    expect(err.code).toBe('network')
    expect(err.status).toBe(0)
    expect(err.transient).toBe(true)
  })
})

describe('polling', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const pending: HosakaDeposit = { deposit_id: 'd1', status: 'pending', amount_msats: 1000, bolt11: 'lnbc1', payment_hash: 'h', created_at: 1, expires_at: 3601, settled_at: null, settled_msats: null, preimage: null }

  it('claim-polls a deposit on the contract interval until it settles', async () => {
    let n = 0
    const { fetch, calls } = scripted({
      'POST /api/v1/deposit/d1/claim': () => ({ body: ++n < 3 ? pending : { ...pending, status: 'settled', settled_msats: 1000 } }),
    })
    const c = createHosaka({ apiUrl: API, sign, fetch })
    const done = c.waitForDeposit('d1', { expiresAt: Math.floor(Date.now() / 1000) + 3600 })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(CLAIM_INTERVAL_MS - 1)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(CLAIM_INTERVAL_MS)
    expect((await done).status).toBe('settled')
    expect(calls).toHaveLength(3)
  })

  it('a wake cuts the claim interval short, and an expired invoice ends the wait', async () => {
    let n = 0
    const { fetch, calls } = scripted({
      'POST /api/v1/deposit/d1/claim': () => ({ body: ++n < 2 ? pending : { ...pending, status: 'expired' } }),
    })
    const c = createHosaka({ apiUrl: API, sign, fetch })
    const waker = createWaker()
    const done = c.waitForDeposit('d1', { waker })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    waker.wake()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(2)
    expect((await done).status).toBe('expired')
  })

  it('a signer that never answers does not hang the claim poll: the poll times out, is reported, and the next one goes out', async () => {
    let hang = true
    const flaky = (template: Parameters<typeof sign>[0]): ReturnType<typeof sign> => (hang ? new Promise(() => { /* the bunker never answers */ }) : sign(template))
    const { fetch, calls } = scripted({ 'POST /api/v1/deposit/d1/claim': () => ({ body: { ...pending, status: 'settled', settled_msats: 1000 } }) })
    const c = createHosaka({ apiUrl: API, sign: flaky, fetch })
    const errors: unknown[] = []
    const done = c.waitForDeposit('d1', { onPollError: (e) => errors.push(e) })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(19_999)
    expect(errors).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(errors).toHaveLength(1)
    expect((errors[0] as HosakaError).code).toBe('sign_timeout')
    hang = false
    await vi.advanceTimersByTimeAsync(CLAIM_INTERVAL_MS)
    expect(calls).toHaveLength(1)
    expect((await done).status).toBe('settled')
  })

  it('a failed poll is reported and the wait goes on', async () => {
    let n = 0
    const { fetch, calls } = scripted({
      'POST /api/v1/deposit/d1/claim': () => (++n === 1 ? { status: 503, body: { detail: { error: 'payments_unavailable' } } } : { body: { ...pending, status: 'settled', settled_msats: 1000 } }),
    })
    const c = createHosaka({ apiUrl: API, sign, fetch })
    const errors: unknown[] = []
    const done = c.waitForDeposit('d1', { onPollError: (e) => errors.push(e) })
    await vi.advanceTimersByTimeAsync(0)
    expect(errors).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(CLAIM_INTERVAL_MS)
    expect(calls).toHaveLength(2)
    expect((await done).status).toBe('settled')
  })

  it('an abort stops a claim poll with code aborted', async () => {
    const { fetch } = scripted({ 'POST /api/v1/deposit/d1/claim': () => ({ body: pending }) })
    const c = createHosaka({ apiUrl: API, sign, fetch })
    const ctl = new AbortController()
    const done = rejection(c.waitForDeposit('d1', { signal: ctl.signal }))
    await vi.advanceTimersByTimeAsync(0)
    ctl.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect((await done).code).toBe('aborted')
  })

  it('polls a job with the token, 5 s first then longer, until it completes', async () => {
    let n = 0
    const { fetch, calls } = scripted({
      'GET /api/v1/jobs/job-1': () => ({ body: ++n < 3 ? funded : { ...funded, status: 'completed', result: { ok: true } } }),
    })
    const c = createHosaka({ apiUrl: API, sign, fetch })
    const seen: string[] = []
    const done = c.waitForJob('job-1', 'tok', { onPoll: (j) => seen.push(j.status) })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(JOB_POLL_MIN_MS)
    expect(calls).toHaveLength(2)
    // The second wait is longer than the first.
    await vi.advanceTimersByTimeAsync(JOB_POLL_MIN_MS)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(2_500)
    expect(calls).toHaveLength(3)
    expect((await done).status).toBe('completed')
    expect(seen).toEqual(['computing', 'computing', 'completed'])
    for (const call of calls) expect(call.headers['x-job-token']).toBe('tok')
  })

  it('tolerates two 404s while the volume syncs, gives up on the third', async () => {
    let n = 0
    const { fetch } = scripted({
      'GET /api/v1/jobs/job-1': () => (++n < 3 ? { status: 404, body: { detail: 'Job not found' } } : { body: { ...funded, status: 'failed', error: 'boom' } }),
    })
    const c = createHosaka({ apiUrl: API, sign, fetch })
    const done = c.waitForJob('job-1', 'tok')
    await vi.advanceTimersByTimeAsync(60_000)
    const job = await done
    expect(job.status).toBe('failed')
    expect(job.error).toBe('boom')

    const { fetch: always404 } = scripted({ 'GET /api/v1/jobs/job-2': () => ({ status: 404, body: { detail: 'Job not found' } }) })
    const c2 = createHosaka({ apiUrl: API, sign, fetch: always404 })
    const failed = rejection(c2.waitForJob('job-2', 'tok'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect((await failed).status).toBe(404)
  })

  it('stops actively waiting after the budget and reports a timeout', async () => {
    const { fetch } = scripted({ 'GET /api/v1/jobs/job-1': () => ({ body: funded }) })
    const c = createHosaka({ apiUrl: API, sign, fetch })
    const failed = rejection(c.waitForJob('job-1', 'tok', { maxWaitMs: 30_000 }))
    await vi.advanceTimersByTimeAsync(60_000)
    expect((await failed).code).toBe('timeout')
  })
})
