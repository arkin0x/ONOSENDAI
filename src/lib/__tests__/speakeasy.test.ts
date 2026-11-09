/**
 * speakeasy.test.ts: the speakeasy lookup (speakeasy step 7). The relay's
 * discovery endpoint is faked here; the real one is never fetched.
 *
 * The contract: GET <base>/.well-known/cyberspace-speakeasies?coord=<64 hex>
 * answers 200 {"speakeasies":[{region, name, url, created_at}]}, longest
 * prefix first; a bad coord answers 400.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANSWER_TTL_MS,
  CACHE_PREFIX_HEX,
  DEBOUNCE_MS,
  FAILURE_TTL_MS,
  createSpeakeasyLookup,
  dashboardUrl,
  fetchSpeakeasies,
  lookupUrl,
  parseSpeakeasies,
  speakeasyBase,
  speakeasyLabel,
} from '../speakeasy'
import { DEFAULT_RELAY } from '../../store/useRelays'

const BASE = 'https://relay.onosendai.tech'
/** A head, and the same cell with its last character changed. */
const A = '0fe6b3deeb67e952f852e8c1df15' + 'a'.repeat(36)
const A_SAME_CELL = A.slice(0, 63) + 'b'
/** Another cell: a character before CACHE_PREFIX_HEX differs. */
const B = A.slice(0, 30) + 'f' + A.slice(31)
const REGION = '0fe6b3deeb67e952f852e8c1df15'

function entry(region: string, name: string | null = null, path = region): Record<string, unknown> {
  return { region, name, url: `wss://relay.onosendai.tech/${path}`, created_at: 1762300000 }
}

function answering(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
}

describe('the relay base and the URLs', () => {
  it('derives the https base from DEFAULT_RELAY', () => {
    expect(DEFAULT_RELAY).toBe('wss://relay.onosendai.tech')
    expect(speakeasyBase()).toBe(BASE)
    expect(speakeasyBase('ws://localhost:7777/')).toBe('http://localhost:7777')
  })

  it('asks the well-known path with the coordinate, and links the region page', () => {
    expect(lookupUrl(A)).toBe(`${BASE}/.well-known/cyberspace-speakeasies?coord=${A}`)
    expect(dashboardUrl(REGION)).toBe(`${BASE}/${REGION}`)
  })

  it('labels by name, else by a short region', () => {
    expect(speakeasyLabel({ region: REGION, name: 'fiatjafs-speakeasy', url: '', created_at: 0 })).toBe('fiatjafs-speakeasy')
    expect(speakeasyLabel({ region: REGION, name: null, url: '', created_at: 0 })).toBe('0fe6b3…df15')
    expect(speakeasyLabel({ region: '0fe6', name: null, url: '', created_at: 0 })).toBe('0fe6')
  })
})

describe('reading the answer', () => {
  it('reads the contract, longest region first', () => {
    const got = parseSpeakeasies({ speakeasies: [entry('0f'), entry(REGION, 'fiatjafs-speakeasy', 'fiatjafs-speakeasy'), entry('0fe6')] }, A, BASE)
    expect(got?.map((s) => s.region)).toEqual([REGION, '0fe6', '0f'])
    expect(got?.[0]).toEqual({ region: REGION, name: 'fiatjafs-speakeasy', url: 'wss://relay.onosendai.tech/fiatjafs-speakeasy', created_at: 1762300000 })
  })

  it('takes an empty list as none here', () => {
    expect(parseSpeakeasies({ speakeasies: [] }, A, BASE)).toEqual([])
  })

  it('refuses a payload that is not the contract', () => {
    for (const bad of [null, 'nope', 42, [], {}, { speakeasies: 'x' }, { speakeasies: null }]) {
      expect(parseSpeakeasies(bad, A, BASE)).toBeNull()
    }
  })

  it('drops the entries that do not hold up, and keeps the rest', () => {
    const got = parseSpeakeasies({
      speakeasies: [
        entry(REGION),
        { ...entry('0fe6'), region: '0FE6' }, // not normalized
        entry('ff'), // does not hold the coordinate
        { ...entry('0f'), url: 'wss://evil.example/0f' }, // another host
        { ...entry('0f'), url: 'https://relay.onosendai.tech/0f' }, // not a relay address
        { ...entry('0f'), name: 7 },
        { ...entry('0f'), created_at: 'yesterday' },
        null,
        'x',
      ],
    }, A, BASE)
    expect(got?.map((s) => s.region)).toEqual([REGION])
  })

  it('answers null for a 400, a 500, bad JSON, a bad payload and a failed fetch', async () => {
    expect(await fetchSpeakeasies(A, answering({ error: 'bad coord' }, 400) as unknown as typeof fetch, BASE)).toBeNull()
    expect(await fetchSpeakeasies(A, answering({}, 500) as unknown as typeof fetch, BASE)).toBeNull()
    expect(await fetchSpeakeasies(A, (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch, BASE)).toBeNull()
    expect(await fetchSpeakeasies(A, answering({ list: [] }) as unknown as typeof fetch, BASE)).toBeNull()
    expect(await fetchSpeakeasies(A, (async () => { throw new TypeError('offline') }) as unknown as typeof fetch, BASE)).toBeNull()
  })

  it('reads a good answer from the endpoint', async () => {
    const fetchFn = answering({ speakeasies: [entry(REGION)] })
    expect(await fetchSpeakeasies(A, fetchFn as unknown as typeof fetch, BASE)).toHaveLength(1)
    expect(fetchFn).toHaveBeenCalledWith(`${BASE}/.well-known/cyberspace-speakeasies?coord=${A}`, expect.anything())
  })
})

describe('the lookup: debounced, cached per cell', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const make = (fetchFn: ReturnType<typeof vi.fn>) => createSpeakeasyLookup({ fetchFn: fetchFn as unknown as typeof fetch, base: BASE })

  it('asks nothing until the head has settled, then once', async () => {
    const fetchFn = answering({ speakeasies: [entry(REGION)] })
    const lookup = make(fetchFn)
    const heard = vi.fn()
    lookup.subscribe(heard)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1)
    expect(fetchFn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(lookup.current().map((s) => s.region)).toEqual([REGION])
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('a burst of moves asks once, for where the head came to rest', async () => {
    const fetchFn = answering({ speakeasies: [] })
    const lookup = make(fetchFn)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(500)
    lookup.update(B)
    await vi.advanceTimersByTimeAsync(500)
    lookup.update(A_SAME_CELL)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(String(fetchFn.mock.calls[0][0])).toContain(`coord=${A_SAME_CELL}`)
  })

  it('the same coordinate again asks nothing', async () => {
    const fetchFn = answering({ speakeasies: [] })
    const lookup = make(fetchFn)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    for (let i = 0; i < 50; i++) lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('a move inside the cell uses the cached answer, and a move back to a cell asked before does too', async () => {
    expect(A.slice(0, CACHE_PREFIX_HEX)).toBe(A_SAME_CELL.slice(0, CACHE_PREFIX_HEX))
    expect(A.slice(0, CACHE_PREFIX_HEX)).not.toBe(B.slice(0, CACHE_PREFIX_HEX))
    const fetchFn = vi.fn(async (url: string) => new Response(JSON.stringify({ speakeasies: url.includes(`coord=${B}`) ? [] : [entry(REGION)] }), { status: 200 }))
    const lookup = make(fetchFn)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    lookup.update(A_SAME_CELL)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(lookup.current()).toHaveLength(1)
    lookup.update(B)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    lookup.update(A)
    // Shown at once, from the cache, with no wait.
    expect(lookup.current().map((s) => s.region)).toEqual([REGION])
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('leaving a small region inside the cell drops it at once, without asking', async () => {
    // A speakeasy for the full coordinate A: A_SAME_CELL is outside it.
    const fetchFn = answering({ speakeasies: [entry(A), entry(REGION)] })
    const lookup = make(fetchFn)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(lookup.current()).toHaveLength(2)
    lookup.update(A_SAME_CELL)
    expect(lookup.current().map((s) => s.region)).toEqual([REGION])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('while a new cell waits to be asked, a region that still holds the head stays shown', async () => {
    const fetchFn = answering({ speakeasies: [entry('0f')] })
    const lookup = make(fetchFn)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    lookup.update(B)
    expect(lookup.current().map((s) => s.region)).toEqual(['0f'])
  })

  it('asks a cell again once its answer has expired', async () => {
    const fetchFn = answering({ speakeasies: [] })
    const lookup = make(fetchFn)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    lookup.update(B)
    await vi.advanceTimersByTimeAsync(ANSWER_TTL_MS)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('a failure shows nothing, throws nothing, and is asked again only after a short while', async () => {
    const fetchFn = answering({ error: 'bad coord' }, 400)
    const lookup = make(fetchFn)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(lookup.current()).toEqual([])
    lookup.update(B)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    // B's failure is still kept here, so B asks nothing; A's has expired by the end.
    lookup.update(B)
    await vi.advanceTimersByTimeAsync(FAILURE_TTL_MS)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('a rejected fetch is a failure like any other', async () => {
    const fetchFn = vi.fn(async () => { throw new TypeError('offline') })
    const lookup = make(fetchFn)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(lookup.current()).toEqual([])
  })

  it('no head, or not a coordinate: nothing shown and nothing asked', async () => {
    const fetchFn = answering({ speakeasies: [entry(REGION)] })
    const lookup = make(fetchFn)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(lookup.current()).toHaveLength(1)
    lookup.update(null)
    expect(lookup.current()).toEqual([])
    lookup.update('not hex')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('an answer that comes after the head left the cell is kept, not shown', async () => {
    let release: (r: Response) => void = () => undefined
    const fetchFn = vi.fn(() => new Promise<Response>((r) => { release = r }))
    const lookup = make(fetchFn)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    lookup.update(B)
    release(new Response(JSON.stringify({ speakeasies: [entry(REGION)] }), { status: 200 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(lookup.current()).toEqual([])
    lookup.update(A)
    expect(lookup.current()).toHaveLength(1)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
