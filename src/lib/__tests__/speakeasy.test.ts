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
  FETCH_TIMEOUT_MS,
  createSpeakeasyLookup,
  dashboardUrl,
  fetchSpeakeasies,
  lookupUrl,
  parseSpeakeasies,
  publishedHeadHex,
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

/** An entry as the relay lists one: its url is always public_url/C/<region>, named or not (the owner, 2026-11-09). */
function entry(region: string, name: string | null = null): Record<string, unknown> {
  return { region, name, url: `wss://relay.onosendai.tech/C/${region}`, created_at: 1762300000 }
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
    expect(dashboardUrl(REGION)).toBe(`${BASE}/C/${REGION}`)
  })

  it('labels by name, else by a short region', () => {
    expect(speakeasyLabel({ region: REGION, name: 'fiatjafs-speakeasy', url: '', created_at: 0 })).toBe('fiatjafs-speakeasy')
    expect(speakeasyLabel({ region: REGION, name: null, url: '', created_at: 0 })).toBe('0fe6b3…df15')
    expect(speakeasyLabel({ region: '0fe6', name: null, url: '', created_at: 0 })).toBe('0fe6')
  })
})

describe('reading the answer', () => {
  it('reads the contract, longest region first', () => {
    const got = parseSpeakeasies({ speakeasies: [entry('0f'), entry(REGION, 'fiatjafs-speakeasy'), entry('0fe6')] }, A, BASE)
    expect(got?.map((s) => s.region)).toEqual([REGION, '0fe6', '0f'])
    expect(got?.[0]).toEqual({ region: REGION, name: 'fiatjafs-speakeasy', url: `wss://relay.onosendai.tech/C/${REGION}`, created_at: 1762300000 })
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
        { ...entry('0f'), url: 'wss://evil.example/C/0f' }, // another host
        { ...entry('0f'), url: 'https://relay.onosendai.tech/C/0f' }, // not a relay address
        { ...entry('0f'), name: 7 },
        { ...entry('0f'), created_at: 'yesterday' },
        null,
        'x',
      ],
    }, A, BASE)
    expect(got?.map((s) => s.region)).toEqual([REGION])
  })

  it('takes only the url wss://<relay host>/C/<region>: not a name path, a bare region path, a lowercase c, the bare host or another path', () => {
    const got = parseSpeakeasies({
      speakeasies: [
        { ...entry(REGION, 'fiatjafs-speakeasy'), url: 'wss://relay.onosendai.tech/fiatjafs-speakeasy' }, // a name path: the relay never lists it as the url
        { ...entry('0fe6'), url: 'wss://relay.onosendai.tech' }, // the bare host: the default relay
        { ...entry('0fe6'), url: 'wss://relay.onosendai.tech/' },
        { ...entry('0fe6'), url: 'wss://relay.onosendai.tech/0fe6' }, // the bare /<region>, before the 2026-11-09 ruling
        { ...entry('0fe6'), url: 'wss://relay.onosendai.tech/c/0fe6' }, // the C is case-exact
        { ...entry(REGION, 'fiatjafs-speakeasy'), url: 'wss://relay.onosendai.tech/C/fiatjafs-speakeasy' }, // a name under /C/
        { ...entry('0f'), url: 'wss://relay.onosendai.tech/C/0fe6' }, // another region's path
        { ...entry('0f'), url: 'ws://relay.onosendai.tech/C/0f' }, // not wss
        { ...entry('0f'), url: 'wss://relay.onosendai.tech/C/0f/x' },
        { ...entry('0fe6'), url: 'wss://relay.onosendai.tech/C/0FE6' }, // the region hex is lowercase, as the relay serves it
      ],
    }, A, BASE)
    expect(got).toEqual([])
    // Written a little differently, the same address is still taken, in its normal form.
    expect(parseSpeakeasies({ speakeasies: [{ ...entry('0fe6'), url: 'WSS://Relay.Onosendai.Tech/C/0fe6/' }] }, A, BASE)?.map((s) => s.url)).toEqual(['wss://relay.onosendai.tech/C/0fe6'])
  })

  it('shows a name only in ruling D3\'s form, else the short region', () => {
    const names = ['fiatjafs-speakeasy', 'ab', 'x'.repeat(41), 'Fiatjaf', 'has space', 'émoji', 'a'.repeat(40), 'abc']
    const got = names.map((name) => parseSpeakeasies({ speakeasies: [entry(REGION, name)] }, A, BASE)?.[0]?.name)
    expect(got).toEqual(['fiatjafs-speakeasy', null, null, null, null, null, 'a'.repeat(40), 'abc'])
    const plain = parseSpeakeasies({ speakeasies: [entry(REGION, 'Bad Name')] }, A, BASE)?.[0]
    expect(plain && speakeasyLabel(plain)).toBe('0fe6b3…df15')
  })

  it('lists each url once', () => {
    const got = parseSpeakeasies({ speakeasies: [entry(REGION, 'first-one'), entry(REGION, 'second-one'), entry('0f')] }, A, BASE)
    expect(got?.map((s) => [s.region, s.name])).toEqual([[REGION, 'first-one'], ['0f', null]])
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

describe('the head that is asked about', () => {
  const chain = [{ id: 's', coordHex: 'c0' }, { id: 'h1', coordHex: 'c1' }, { id: 'h2', coordHex: 'c2' }]

  it('is the last action of the published run from the spawn', () => {
    expect(publishedHeadHex(chain, { s: 'ok', h1: 'ok', h2: 'ok' })).toBe('c2')
    expect(publishedHeadHex(chain, { s: 'ok', h1: 'ok', h2: 'sending' })).toBe('c1')
    expect(publishedHeadHex(chain, { s: 'ok', h1: 'ok' })).toBe('c1')
  })

  it('stops at the first event not on the relays, whatever comes after it', () => {
    expect(publishedHeadHex(chain, { s: 'ok', h1: 'queued', h2: 'ok' })).toBe('c0')
  })

  it('is nothing when nothing is published', () => {
    expect(publishedHeadHex(chain, {})).toBeNull()
    expect(publishedHeadHex([], {})).toBeNull()
  })
})

describe('a hung answer', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('is aborted and given up on after FETCH_TIMEOUT_MS', async () => {
    let signal: AbortSignal | undefined
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Promise<Response>(() => undefined) })
    const got = fetchSpeakeasies(A, fetchFn as unknown as typeof fetch, BASE)
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS)
    expect(await got).toBeNull()
    expect(signal?.aborted).toBe(true)
  })

  it('does not hold its cell: the lookup counts it a failure and asks again later', async () => {
    const fetchFn = vi.fn(() => new Promise<Response>(() => undefined))
    const lookup = createSpeakeasyLookup({ fetchFn: fetchFn as unknown as typeof fetch, base: BASE })
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + FETCH_TIMEOUT_MS)
    expect(lookup.current()).toEqual([])
    lookup.update(B)
    await vi.advanceTimersByTimeAsync(FAILURE_TTL_MS)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(fetchFn.mock.calls.filter((c) => String((c as unknown[])[0]).includes(`coord=${A}`))).toHaveLength(2)
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
  it('a head that stays put is asked again when its answer expires, while watched', async () => {
    const fetchFn = answering({ speakeasies: [] })
    const lookup = make(fetchFn)
    const release = lookup.watch()
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(ANSWER_TTL_MS - 1)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(ANSWER_TTL_MS)
    expect(fetchFn).toHaveBeenCalledTimes(3)
    release()
    await vi.advanceTimersByTimeAsync(ANSWER_TTL_MS * 3)
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('nobody watching: a head that stays put asks nothing more', async () => {
    const fetchFn = answering({ speakeasies: [] })
    const lookup = make(fetchFn)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + ANSWER_TTL_MS * 3)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('a watch with no head asks nothing, and a head gone stops the refresh', async () => {
    const fetchFn = answering({ speakeasies: [] })
    const lookup = make(fetchFn)
    lookup.watch()
    await vi.advanceTimersByTimeAsync(ANSWER_TTL_MS)
    expect(fetchFn).not.toHaveBeenCalled()
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    lookup.update(null)
    await vi.advanceTimersByTimeAsync(ANSWER_TTL_MS * 2)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('watching again after the answer expired asks at once', async () => {
    const fetchFn = answering({ speakeasies: [] })
    const lookup = make(fetchFn)
    lookup.update(A)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + ANSWER_TTL_MS)
    lookup.watch()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
