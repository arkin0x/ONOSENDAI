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
import type { EventTemplate, NostrEvent } from '../events'
import {
  CLAIM_INTERVAL_MS,
  HosakaError,
  JOB_POLL_MIN_MS,
  createHosaka,
  createWaker,
  idempotencyKeyFor,
  jsonWithBigints,
  moveBody,
  moveIdentity,
  regionKeyBody,
  regionKeyIdentity,
  type HosakaDeposit,
  type HosakaJob,
  SIGN_TIMEOUT_MS, keysPending } from '../hosaka'

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

describe('a staged hop', () => {
  it('is pending cubes only while computing, never once completed', () => {
    const job = (status: string, result: unknown): never => ({ id: 'j', status, cost_msats: 1, result, error: null } as never)
    expect(keysPending(job('computing', { keys_pending: true }))).toBe(true)
    expect(keysPending(job('pending', { keys_pending: true }))).toBe(true)
    expect(keysPending(job('computing', { keys_pending: false }))).toBe(false)
    expect(keysPending(job('computing', null))).toBe(false)
    expect(keysPending(job('completed', { keys_pending: true }))).toBe(false)
    expect(keysPending(job('failed', null))).toBe(false)
  })

  it('ends waitForJob at the staged answer, and without stopWhen waits for completed', async () => {
    const staged = { id: 'job-1', status: 'computing', cost_msats: 1000, result: { keys_pending: true, destination_keys: null }, error: null }
    const done = { id: 'job-1', status: 'completed', cost_msats: 1000, result: { keys_pending: false, destination_keys: [{ height: 13, secret_key: 'ab', lookup_id: 'cd' }] }, error: null }
    let polls = 0
    const { fetch } = scripted({ 'GET /api/v1/jobs/job-1': () => ({ body: ++polls === 1 ? staged : done }) })
    const c = createHosaka({ apiUrl: API, sign, fetch })
    const first = await c.waitForJob('job-1', 'tok', { stopWhen: keysPending })
    expect(first.status).toBe('computing')
    expect((first.result as { keys_pending?: boolean }).keys_pending).toBe(true)
    expect(polls).toBe(1)

    // The same client with no stopWhen returns the finished job, not the
    // staged one: the early stop is the caller's to ask for.
    polls = 1
    const whole = await c.waitForJob('job-1', 'tok')
    expect(whole.status).toBe('completed')
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

  it('asks for the destination cubes only when told to, on the quote and on the hop', async () => {
    const { fetch, calls } = scripted({
      'POST /api/v1/quote': () => ({ body: { action: 'hop', cost_msats: 1000, within_cap: true } }),
      'POST /api/v1/hop': () => ({ status: 201, body: funded }),
    })
    const c = createHosaka({ apiUrl: API, sign, fetch })
    await c.quote('hop', V1, V2)
    await c.quote('hop', V1, V2, undefined, { destinationKeys: true })
    await c.submitHop(V1, V2, PREV)
    await c.submitHop(V1, V2, PREV, undefined, { destinationKeys: true })
    expect(calls[0].body).not.toContain('destination_keys')
    expect(calls[1].body).toContain('"destination_keys":true')
    expect(calls[2].body).not.toContain('destination_keys')
    expect(calls[3].body).toContain('"destination_keys":true')
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
    expect(JSON.parse(calls[0].body!)).toEqual({
      v1: { x: 0, y: 0, z: 0, plane: 0 }, v2: expect.objectContaining({ plane: 0 }), previous_event_id: PREV,
      idempotency_key: expect.stringMatching(/^onosendai-[0-9a-f]{64}$/),
    })
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
    await vi.advanceTimersByTimeAsync(SIGN_TIMEOUT_MS - 1)
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

/**
 * A HOSAKA that honors idempotency keys, the way hosaka-api does: one job per
 * key and pubkey, charged once, and the same job back (200, idempotent_replay)
 * for a retry. `loseNext` makes the next answer vanish after the job was made,
 * which is exactly the case that used to charge twice.
 */
function idempotentServer(opts: { advertise?: boolean; echo?: boolean; dedupe?: boolean } = {}) {
  let advertise = opts.advertise !== false
  let providerDown = 0
  const jobs = new Map<string, HosakaJob>()
  let debits = 0
  let made = 0
  let loseNext: 'drop' | 502 | null = null
  const submitted: Array<{ key: string; authId: string }> = []
  const answer = (call: Call): { status?: number; body?: unknown } => {
    const body = JSON.parse(call.body!) as { idempotency_key?: string }
    const authId = decodeToken(call.headers.authorization).id
    const key = body.idempotency_key ?? `none-${authId}`
    submitted.push({ key, authId })
    // A server without keys (an older build, a rollback) makes a job every time and echoes nothing.
    const dedupe = opts.dedupe !== false
    const echoed = opts.echo === false || !dedupe ? {} : { idempotency_key: key }
    const existing = dedupe ? jobs.get(key) : undefined
    if (existing) return { status: 200, body: { ...existing, ...echoed, idempotent_replay: true } }
    made++
    debits++
    const job: HosakaJob = { id: `job-${made}`, status: 'computing', cost_msats: 1000, poll_token: `tok-${made}`, result: null, error: null, payment_required: false, balance_debited: true }
    jobs.set(dedupe ? key : `${key}-${made}`, job)
    return { status: 201, body: { ...job, ...echoed, ...(dedupe ? { idempotent_replay: false } : {}) } }
  }
  const routes: Record<string, Handler> = {
    'GET /api/v1/provider': () => {
      if (providerDown > 0) { providerDown--; throw new TypeError('Failed to fetch') }
      return { body: { version: 1, name: 'HOSAKA', ...(advertise ? { idempotency: { header: 'Idempotency-Key', body_field: 'idempotency_key', retention_seconds: 86400 } } : {}) } }
    },
  }
  for (const action of ['hop', 'sidestep', 'region_key']) {
    routes[`POST /api/v1/${action}`] = (call) => {
      const r = answer(call)
      const lost = loseNext
      loseNext = null
      if (lost === 'drop') throw new TypeError('Failed to fetch')
      if (lost === 502) return { status: 502, body: 'Bad Gateway' }
      return r
    }
  }
  const { fetch, calls } = scripted(routes)
  return {
    fetch, calls, submitted,
    loseNext: (how: 'drop' | 502 = 'drop') => { loseNext = how },
    advertise: (on: boolean) => { advertise = on },
    providerDownFor: (reads: number) => { providerDown = reads },
    get jobCount() { return jobs.size },
    get debits() { return debits },
    get made() { return made },
  }
}

describe('idempotency keys', () => {
  const NO_WAIT = [0, 0] as const

  it('one logical job is one key; any change to what is asked is another', () => {
    const hop = idempotencyKeyFor('hop', moveBody(V1, V2, PREV))
    expect(hop).toMatch(/^onosendai-[0-9a-f]{64}$/)
    expect(hop.length).toBeLessThanOrEqual(255)
    // Rebuilt from equal values, not the same objects: still the same key.
    expect(idempotencyKeyFor('hop', moveBody({ ...V1 }, { ...V2 }, PREV, {}))).toBe(hop)
    const others = [
      idempotencyKeyFor('sidestep', moveBody(V1, V2, PREV)),
      idempotencyKeyFor('hop', moveBody(V1, V2, 'cd'.repeat(32))),
      idempotencyKeyFor('hop', moveBody(V1, { ...V2, x: V2.x + 1n }, PREV)),
      idempotencyKeyFor('hop', moveBody(V1, { ...V2, plane: 1 }, PREV)),
    ]
    expect(new Set([hop, ...others]).size).toBe(others.length + 1)
    // The cube setting is not part of what a move is: one proof, one key, as
    // the server's own derived key has it.
    expect(moveIdentity(V1, V2, PREV)).toEqual(moveBody(V1, V2, PREV))

    // A region key is its cube: two points inside one 2^13 cube are one key,
    // the cube next door or another height is another.
    const cube = { x: 1n << 80n, y: 5n, z: 9n }
    const key13 = idempotencyKeyFor('region_key', regionKeyIdentity(cube, 13))
    expect(idempotencyKeyFor('region_key', regionKeyIdentity({ ...cube }, 13))).toBe(key13)
    expect(idempotencyKeyFor('region_key', regionKeyIdentity({ x: cube.x + 8191n, y: 4000n, z: 0n }, 13))).toBe(key13)
    expect(idempotencyKeyFor('region_key', regionKeyIdentity({ ...cube, x: cube.x + 8192n }, 13))).not.toBe(key13)
    expect(idempotencyKeyFor('region_key', regionKeyIdentity(cube, 14))).not.toBe(key13)
    expect(regionKeyBody(cube, 13)).toEqual({ x: cube.x.toString(), y: '5', z: '9', height: 13 }) // the body still names the point
  })

  it('the same cube bought from two points is one job and one debit', async () => {
    const server = idempotentServer()
    const c = createHosaka({ apiUrl: API, sign, fetch: server.fetch })
    const a = await c.submitRegionKey({ x: (1n << 20n) + 1n, y: 2n << 20n, z: 3n << 20n }, 14)
    const b = await c.submitRegionKey({ x: (1n << 20n) + 2n, y: (2n << 20n) + 7n, z: 3n << 20n }, 14)
    expect(b.id).toBe(a.id)
    expect(server.debits).toBe(1)
    expect(JSON.parse(server.calls[1].body!).x).toBe(((1n << 20n) + 2n).toString())
  })

  it('travels in the body, never as a header a provider might not allow', async () => {
    const server = idempotentServer()
    const c = createHosaka({ apiUrl: API, sign, fetch: server.fetch })
    await c.submitHop(V1, V2, PREV)
    await c.submitRegionKey({ x: 1n, y: 2n, z: 3n }, 13)
    for (const call of server.calls) {
      expect(Object.keys(call.headers)).not.toContain('idempotency-key')
      expect(JSON.parse(call.body!).idempotency_key).toMatch(/^onosendai-/)
    }
    expect(JSON.parse(server.calls[0].body!).idempotency_key).toBe(idempotencyKeyFor('hop', moveBody(V1, V2, PREV)))
  })

  it('a lost answer is asked again with the same key: one job, one debit', async () => {
    const server = idempotentServer()
    const c = createHosaka({ apiUrl: API, sign, fetch: server.fetch, lostAnswerDelaysMs: NO_WAIT })
    await c.provider!()
    server.loseNext('drop')

    const job = await c.submitHop(V1, V2, PREV)

    expect(server.jobCount).toBe(1)
    expect(server.debits).toBe(1)
    expect(job.id).toBe('job-1')
    expect(job.poll_token).toBe('tok-1')
    expect(job.idempotent_replay).toBe(true)
    // Two attempts, each freshly signed (the server refuses a reused auth
    // event), both naming the same job.
    expect(server.submitted).toHaveLength(2)
    expect(server.submitted[0].key).toBe(server.submitted[1].key)
    expect(server.submitted[0].authId).not.toBe(server.submitted[1].authId)
  })

  it('a server that failed after making the job is asked again the same way', async () => {
    const server = idempotentServer()
    const c = createHosaka({ apiUrl: API, sign, fetch: server.fetch, lostAnswerDelaysMs: NO_WAIT })
    await c.provider!()
    server.loseNext(502)
    const job = await c.submitSidestep(V1, V2, PREV)
    expect(job.id).toBe('job-1')
    expect(server.debits).toBe(1)
  })

  it('a different job gets a different key, and a job of its own', async () => {
    const server = idempotentServer()
    const c = createHosaka({ apiUrl: API, sign, fetch: server.fetch })
    const a = await c.submitHop(V1, V2, PREV)
    const b = await c.submitHop(V1, V2, 'cd'.repeat(32))
    expect(a.id).not.toBe(b.id)
    expect(server.submitted[0].key).not.toBe(server.submitted[1].key)
    expect(server.debits).toBe(2)
  })

  it('without the provider saying it honors keys, a lost answer is reported, not retried', async () => {
    const server = idempotentServer({ advertise: false })
    const c = createHosaka({ apiUrl: API, sign, fetch: server.fetch, lostAnswerDelaysMs: NO_WAIT })
    await c.provider!()
    server.loseNext('drop')
    const err = await rejection(c.submitHop(V1, V2, PREV))
    expect(err.code).toBe('network')
    expect(err.answerLost).toBe(true)
    expect(server.submitted).toHaveLength(1)

    // The person commits the same step again: the same key, so a server that
    // dedupes on it hands back the job the lost attempt made.
    const again = await c.submitHop(V1, V2, PREV)
    expect(again.id).toBe('job-1')
    expect(again.idempotent_replay).toBe(true)
    expect(server.debits).toBe(1)
  })

  it('a server rolled back since the tab opened is not asked again: /provider is read fresh before a retry', async () => {
    // The reviewer's case: the tab read /provider against the new build, then
    // hosaka-api was rolled back to one without keys and the tab stayed open.
    const server = idempotentServer({ dedupe: true })
    const c = createHosaka({ apiUrl: API, sign, fetch: server.fetch, lostAnswerDelaysMs: NO_WAIT })
    await c.provider!()
    server.advertise(false)
    server.loseNext('drop')
    const err = await rejection(c.submitHop(V1, V2, PREV))
    expect(err.code).toBe('network')
    expect(server.submitted).toHaveLength(1)
    expect(server.made).toBe(1)
  })

  it('a submit answered without its key echoed ends automatic retries, whatever /provider says', async () => {
    // A server that ignores keys makes a second job for every retry; the
    // answer it gave is the evidence, and a stale /provider cannot outvote it.
    const server = idempotentServer({ dedupe: false })
    const c = createHosaka({ apiUrl: API, sign, fetch: server.fetch, lostAnswerDelaysMs: NO_WAIT })
    await c.submitHop(V1, V2, PREV)          // answered, but no key came back
    server.loseNext('drop')
    const err = await rejection(c.submitHop(V1, V2, 'cd'.repeat(32)))
    expect(err.code).toBe('network')
    expect(server.made).toBe(2)               // the lost one, never a third
    expect(server.calls.filter((x) => x.url.endsWith('/api/v1/provider'))).toHaveLength(0)
  })

  it('a /provider that cannot be read yet uses up one wait, and the next one retries', async () => {
    const server = idempotentServer()
    const c = createHosaka({ apiUrl: API, sign, fetch: server.fetch, lostAnswerDelaysMs: NO_WAIT })
    server.loseNext('drop')
    server.providerDownFor(1)
    const job = await c.submitHop(V1, V2, PREV)
    expect(job.id).toBe('job-1')
    expect(job.idempotent_replay).toBe(true)
    expect(server.debits).toBe(1)
    expect(server.submitted).toHaveLength(2)
  })

  it('a refusal is an answer and is never asked again', async () => {
    let posts = 0
    const { fetch } = scripted({
      'GET /api/v1/provider': () => ({ body: { version: 1, name: 'H', idempotency: {} } }),
      'POST /api/v1/hop': () => { posts++; return { status: 429, body: { detail: { error: 'too_many_active_jobs' } } } },
    })
    const c = createHosaka({ apiUrl: API, sign, fetch, lostAnswerDelaysMs: NO_WAIT })
    await c.provider!()
    const err = await rejection(c.submitHop(V1, V2, PREV))
    expect(err.status).toBe(429)
    expect(err.answerLost).toBe(false)
    expect(posts).toBe(1)
  })

  it('gives up after its retries, and a cancel during the wait stops it', async () => {
    let posts = 0
    const { fetch } = scripted({
      'GET /api/v1/provider': () => ({ body: { version: 1, name: 'H', idempotency: {} } }),
      'POST /api/v1/hop': () => { posts++; throw new TypeError('Failed to fetch') },
    })
    const c = createHosaka({ apiUrl: API, sign, fetch, lostAnswerDelaysMs: NO_WAIT })
    await c.provider!()
    expect((await rejection(c.submitHop(V1, V2, PREV))).code).toBe('network')
    expect(posts).toBe(1 + NO_WAIT.length)

    const slow = createHosaka({ apiUrl: API, sign, fetch, lostAnswerDelaysMs: [60_000] })
    await slow.provider!()
    const abort = new AbortController()
    const pending = slow.submitHop(V1, V2, PREV, abort.signal)
    await vi.waitFor(() => { expect(posts).toBe(1 + NO_WAIT.length + 1) })
    abort.abort()
    expect((await rejection(pending)).code).toBe('aborted')
  })
})

describe('a changed cube setting is the same job', () => {
  /** A HOSAKA with keys: one job per key; the same key with other options is 409 naming that job. */
  function keyedServer(existing: Partial<HosakaJob> = {}) {
    const byKey = new Map<string, { fp: string; job: HosakaJob }>()
    let made = 0
    let starts = 0
    const { fetch, calls } = scripted({
      'POST /api/v1/hop': (call) => {
        const { idempotency_key: key, ...rest } = JSON.parse(call.body!) as Record<string, unknown> & { idempotency_key: string }
        const fp = JSON.stringify(rest)
        const held = byKey.get(key)
        if (held && held.fp !== fp) {
          return { status: 409, body: { detail: { error: 'idempotency_key_reused', existing_job_id: held.job.id, existing_poll_token: held.job.poll_token, hint: 'other options' } } }
        }
        if (held) return { status: 200, body: { ...held.job, idempotency_key: key, idempotent_replay: true } }
        made++
        const job: HosakaJob = { id: `job-${made}`, status: 'computing', cost_msats: 1000, poll_token: `tok-${made}`, result: null, error: null, payment_required: false, ...existing }
        byKey.set(key, { fp, job })
        return { status: 201, body: { ...job, idempotency_key: key } }
      },
      'POST /api/v1/jobs/job-1/start': () => {
        starts++
        const job = [...byKey.values()][0].job
        return { body: { id: job.id, status: job.status, cost_msats: job.cost_msats, result: null, error: null, ...(job.status === 'pending' ? { payment_required: true, deposit: job.deposit } : { payment_required: false, balance_debited: true }) } }
      },
    })
    return { fetch, calls, get made() { return made }, get starts() { return starts } }
  }

  it('the cubes asked for after the move was sent: the same key, the job already running is followed, one charge', async () => {
    const server = keyedServer()
    const c = createHosaka({ apiUrl: API, sign, fetch: server.fetch })
    const plain = await c.submitHop(V1, V2, PREV)
    const cubes = await c.submitHop(V1, V2, PREV, undefined, { destinationKeys: true })

    const hops = server.calls.filter((x) => x.url.endsWith('/api/v1/hop'))
    expect(JSON.parse(hops[1].body!).idempotency_key).toBe(JSON.parse(hops[0].body!).idempotency_key)
    expect(JSON.parse(hops[1].body!).destination_keys).toBe(true) // the request still says what was wanted
    expect(server.made).toBe(1)
    expect(server.starts).toBe(1)
    expect(cubes.id).toBe(plain.id)
    expect(cubes.poll_token).toBe(plain.poll_token)
    expect(cubes.followed_existing).toBe(true)
    expect(cubes.status).toBe('computing')
  })

  it('a followed job still waiting for payment comes back with its own invoice, not a new job', async () => {
    const deposit: HosakaDeposit = { deposit_id: 'd1', status: 'pending', amount_msats: 1000, bolt11: 'lnbc-one', payment_hash: 'h', created_at: 1, expires_at: 3601, settled_at: null, settled_msats: null, preimage: null }
    const server = keyedServer({ status: 'pending', payment_required: true, deposit })
    const c = createHosaka({ apiUrl: API, sign, fetch: server.fetch })
    await c.submitHop(V1, V2, PREV, undefined, { destinationKeys: true })
    const followed = await c.submitHop(V1, V2, PREV)
    expect(followed.followed_existing).toBe(true)
    expect(followed.payment_required).toBe(true)
    expect(followed.deposit?.bolt11).toBe('lnbc-one')
    expect(server.made).toBe(1)
  })

  it('a 409 that does not name the job is reported as it was, never retried into a new job', async () => {
    const { fetch, calls } = scripted({
      'POST /api/v1/hop': () => ({ status: 409, body: { detail: { error: 'idempotency_key_reused', hint: 'other options' } } }),
    })
    const c = createHosaka({ apiUrl: API, sign, fetch })
    const err = await rejection(c.submitHop(V1, V2, PREV))
    expect(err.status).toBe(409)
    expect(calls).toHaveLength(1)
  })
})
