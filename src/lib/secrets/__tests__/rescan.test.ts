/**
 * rescan.test.ts: RESCAN ALL asks about every kept key once, in batches read
 * from storage a batch at a time, opens each answer with the key it is filed
 * under (arkinox, 2026-10-04), does not lose what a relay's cap cuts off
 * (review of #219, finding 5), never has more than RESCAN_PARALLEL requests
 * open however it splits and pages, and says what it could not finish
 * (second review, S3).
 *
 * The relays are stand-ins answered one by one, as queryEach answers. By
 * default one relay that, like strfry, answers one filter with at most
 * RELAY_CAP events, newest first, and honors `until`; a test can swap in
 * relays that cap lower, refuse, or ignore `until`. A "bag" opens only with
 * the key written in its content, so opening one with the wrong key finds
 * nothing, as it would for real.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
}

type Ev = { id: string; content: string; created_at: number; tags: string[][] }
/** How one stand-in relay behaves. */
type Behavior = { url: string; cap: number; refuse?: boolean; ignoresUntil?: boolean }
const relay = vi.hoisted(() => ({
  events: [] as Array<{ id: string; content: string; created_at: number; tags: string[][] }>,
  calls: [] as Array<{ ids: string[]; until?: number; limit?: number }>,
  relays: [] as Array<{ url: string; cap: number; refuse?: boolean; ignoresUntil?: boolean }>,
  inFlight: 0,
  peak: 0,
  delayMs: 0,
}))
const RELAY_CAP = 500
const DEFAULT_RELAY: Behavior = { url: 'wss://relay.test', cap: RELAY_CAP }

/** What a relay with this cap answers: the newest events under these ids, at or before `until` unless it ignores it. */
function answer(ids: string[], until: number | undefined, cap: number, ignoresUntil = false): Ev[] {
  const wanted = new Set(ids)
  return relay.events
    .filter((e) => wanted.has(e.tags[0][1]) && (ignoresUntil || until === undefined || e.created_at <= until))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, cap)
}

/** Every stand-in relay's answer to one filter, as queryEach gives them. */
function answers(ids: string[], until: number | undefined, limit: number | undefined): Array<{ url: string; outcome: string; reason?: string; events: Ev[] }> {
  return relay.relays.map((r) => r.refuse
    ? { url: r.url, outcome: 'refused', reason: 'rate-limited: too many subscriptions', events: [] }
    : { url: r.url, outcome: 'answered', events: answer(ids, until, Math.min(r.cap, limit ?? Infinity), r.ignoresUntil) })
}

vi.mock('../../relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  relaySet: () => relay.relays.map((r) => r.url),
  queryEach: vi.fn(async (filter: { '#d': string[]; until?: number; limit?: number }) => {
    relay.calls.push({ ids: filter['#d'], until: filter.until, limit: filter.limit })
    relay.inFlight++
    relay.peak = Math.max(relay.peak, relay.inFlight)
    if (relay.delayMs > 0) await new Promise((r) => setTimeout(r, relay.delayMs))
    relay.inFlight--
    return answers(filter['#d'], filter.until, filter.limit)
  }),
}))

vi.mock('../../hidden', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hidden')>()
  const { bytesToHex } = await import('../../events')
  return {
    ...actual,
    // Opens only with the key the bag names; one item per bag.
    unbag: vi.fn(async (ev: Ev, key: Uint8Array) =>
      bytesToHex(key) === ev.content
        ? [{ eventId: ev.id, type: 'message', text: 'hi', at: { x: 1n, y: 2n, z: 3n }, plane: 0, height: 4, author: 'ab'.repeat(32), lookupId: ev.tags[0][1], createdAt: 1 }]
        : []),
  }
})

import type { RelayAnswer } from '../../relayOutcome'
import {
  CAP_SUSPECT, MAX_PAGES, RESCAN_BATCH, RESCAN_LIMIT, RESCAN_PARALLEL, allBatches, askAll, askAndOpen, limited, placeEntries,
  type Ask, type RescanEntry,
} from '../rescan'
import type { HeldKey } from '../../../store/useSecrets'
import type { Place, PlaceKey } from '../places'

const lookup = (n: number): string => n.toString(16).padStart(64, '0')
const keyOf = (n: number): string => (n + 1_000_000).toString(16).padStart(64, '0')
let serial = 0
/** A bag filed under lookup id `n`, opening with key `n`. */
const bag = (n: number, createdAt = 1_000): Ev => ({ id: `e${(serial++).toString(16).padStart(63, '0')}`, content: keyOf(n), created_at: createdAt, tags: [['d', lookup(n)]] })

const heldKey = (n: number, over: Partial<HeldKey> = {}): HeldKey => ({
  lookupId: lookup(n), keyHex: keyOf(n), height: 4, base: { x: '0', y: '0', z: '0' }, plane: 0, source: 'hop', at: 1, ...over,
})
const placeKey = (n: number, plane: 0 | 1 = 1): PlaceKey => ({ lookupId: lookup(n), keyHex: keyOf(n), height: 3, base: { x: '8', y: '16', z: '24' }, plane })

async function* pages(...p: PlaceKey[][]): AsyncGenerator<PlaceKey[]> { for (const page of p) yield page }
async function collect<T>(it: AsyncIterable<T>): Promise<T[]> { const out: T[] = []; for await (const x of it) out.push(x); return out }

/** Thirteen keys for one place, ids `from` to `from + 12`, so places share nothing. */
const scanFrom = (from: number): Array<{ lookupId: string; keyHex: string; height: number }> =>
  Array.from({ length: 13 }, (_, h) => ({ lookupId: lookup(from + h), keyHex: keyOf(from + h), height: h }))

/** An Ask over the stand-in relays, without the mock's bookkeeping of concurrency. */
const ask: Ask = async (ids, { until, limit }) => {
  relay.calls.push({ ids, until, limit })
  return answers(ids, until, limit) as unknown as RelayAnswer[]
}

beforeEach(() => {
  relay.events = []
  relay.calls = []
  relay.relays = [DEFAULT_RELAY]
  relay.inFlight = 0
  relay.peak = 0
  relay.delayMs = 0
  mem.clear()
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
})

afterEach(() => { vi.restoreAllMocks() })

describe('what is asked about, and in what batches', () => {
  it('held keys first, then place keys a page at a time, a key that is both asked as the held one', async () => {
    const keys = { [lookup(1)]: heldKey(1), [lookup(2)]: heldKey(2, { source: 'cloud' }) }
    const batches = await collect(allBatches(keys, pages([placeKey(2), placeKey(3)], [placeKey(4)]), 2, 50))
    expect(batches.map((b) => b.map((e) => e.lookupId))).toEqual([[lookup(1), lookup(2)], [lookup(3), lookup(4)]])
    expect(batches[0][1].promote).toBeUndefined()
    // A place key carries the held key it would become, in the plane it was last stood in.
    expect(batches[1][0].promote).toMatchObject({ lookupId: lookup(3), source: 'scan', plane: 1, at: 50, height: 3 })
    expect(batches[1][0].origin).toEqual({ at: { x: 8n, y: 16n, z: 24n }, plane: 1 })
  })

  it('reads storage only as far as the batches being asked need', async () => {
    let read = 0
    async function* counted(): AsyncGenerator<PlaceKey[]> {
      for (let p = 0; p < 100; p++) { read++; yield Array.from({ length: 10 }, (_, i) => placeKey(p * 10 + i)) }
    }
    const it = allBatches({}, counted(), 20)[Symbol.asyncIterator]()
    await it.next()
    expect(read).toBe(2)
  })

  it('a hop box is asked about with no height or corner, as SCAN on its row does', async () => {
    const box = heldKey(4, { heights: { x: 9, y: 2, z: 0 }, height: 9 })
    const [[entry]] = await collect(allBatches({ [box.lookupId]: box }, pages()))
    expect(entry.height).toBeUndefined()
    expect(entry.origin).toBeUndefined()
  })

  it('one place: its own keys, in its own plane', () => {
    const place: Place = { id: 'p', position: { x: '9', y: '17', z: '25' }, plane: 0, keys: [lookup(3), lookup(4)], first: 1, at: 1 }
    const entries = placeEntries(place, {}, [placeKey(3, 1), placeKey(4, 1)])
    expect(entries.map((e) => [e.lookupId, e.promote?.plane])).toEqual([[lookup(3), 0], [lookup(4), 0]])
  })
})

describe('a relay that caps its answers', () => {
  it('a batch whose answer could be cut off is split until nothing is', async () => {
    // 150 ids, two of them busy: 300 and 350 bags. Asked whole, the relay
    // returns 500 of the 650 and drops the rest without a word.
    const ids = Array.from({ length: 150 }, (_, i) => lookup(i))
    for (let i = 0; i < 300; i++) relay.events.push(bag(7, 1_000 + i))
    for (let i = 0; i < 350; i++) relay.events.push(bag(90, 2_000 + i))
    relay.events.push(bag(140))
    const got = await askAll(ids, ask)
    expect(got.events).toHaveLength(651)
    expect(new Set(got.events.map((e) => e.id)).size).toBe(651)
    expect(got.skipped).toEqual([])
  })

  it('a single id with more than a relay returns is paged back with until', async () => {
    for (let i = 0; i < 1_234; i++) relay.events.push(bag(5, 10_000 + Math.floor(i / 3)))
    const got = await askAll([lookup(5)], ask)
    expect(got.events).toHaveLength(1_234)
    expect(relay.calls[0].until).toBeUndefined()
    expect(relay.calls.slice(1).every((c) => typeof c.until === 'number')).toBe(true)
  })

  it('every request carries an explicit limit', async () => {
    for (let i = 0; i < 700; i++) relay.events.push(bag(i % 2, 1_000 + i))
    await askAll([lookup(0), lookup(1)], ask)
    expect(relay.calls.length).toBeGreaterThan(1)
    expect(relay.calls.every((c) => c.limit === RESCAN_LIMIT)).toBe(true)
  })

  it('a relay that caps well below 400 is caught too', async () => {
    // The review's probe: 600 events, a relay that returns at most 300.
    relay.relays = [{ url: 'wss://short.test', cap: 300 }]
    for (let i = 0; i < 300; i++) { relay.events.push(bag(1, 1_000 + i)); relay.events.push(bag(2, 1_000 + i)) }
    const got = await askAll([lookup(1), lookup(2)], ask)
    expect(got.events).toHaveLength(600)
    expect(got.skipped).toEqual([])
  })

  it('an answer under the threshold is taken as it is', async () => {
    for (let i = 0; i < CAP_SUSPECT - 1; i++) relay.events.push(bag(i % 3))
    const got = await askAll([lookup(0), lookup(1), lookup(2)], ask)
    expect(got.events).toHaveLength(CAP_SUSPECT - 1)
    expect(relay.calls).toHaveLength(1)
  })
})

describe('what a rescan could not finish is said, not dropped', () => {
  it('a relay that refuses is reported for the ids it was asked about, while the others still answer', async () => {
    relay.relays = [DEFAULT_RELAY, { url: 'wss://busy.test', cap: 500, refuse: true }]
    relay.events = [bag(3)]
    const got = await askAll([lookup(3), lookup(4)], ask)
    expect(got.events).toHaveLength(1)
    expect(got.skipped).toEqual([{ relay: 'wss://busy.test', why: 'refused the request (rate-limited: too many subscriptions)', ids: 2 }])
  })

  it('a relay that ignores until is reported rather than paged forever', async () => {
    relay.relays = [{ url: 'wss://stubborn.test', cap: 500, ignoresUntil: true }]
    for (let i = 0; i < 1_000; i++) relay.events.push(bag(8, 1_000 + i))
    const got = await askAll([lookup(8)], ask)
    expect(relay.calls.length).toBeLessThanOrEqual(3)
    expect(got.skipped.map((s) => s.relay)).toEqual(['wss://stubborn.test'])
    expect(got.skipped[0].why).toMatch(/ignores `until`/)
  })

  it('a region past the page cap is reported, with everything up to it kept', async () => {
    for (let i = 0; i < (MAX_PAGES + 1) * RESCAN_LIMIT + 10; i++) relay.events.push(bag(9, 1_000_000 + i))
    const got = await askAll([lookup(9)], ask)
    expect(got.events.length).toBeGreaterThanOrEqual(MAX_PAGES * RESCAN_LIMIT)
    expect(got.skipped).toEqual([{ relay: 'wss://relay.test', why: `has more than ${MAX_PAGES} pages of ${RESCAN_LIMIT} events in one region`, ids: 1 }])
  }, 60_000)
})

describe('one limiter for every request', () => {
  it('never runs more than its number at once, and runs every call', async () => {
    let active = 0
    let peak = 0
    const slow = limited(3, async (n: number) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 2)); active--; return n * 2 })
    const out = await Promise.all(Array.from({ length: 40 }, (_, i) => slow(i)))
    expect(peak).toBe(3)
    expect(out).toEqual(Array.from({ length: 40 }, (_, i) => i * 2))
  })
})

describe('asking and opening', () => {
  it('opens each answer with the entry it is filed under, and a failed batch is reported, not taken as empty', async () => {
    const entries: RescanEntry[] = [0, 1, 2].map((i) => ({ lookupId: lookup(i), keyHex: keyOf(i) }))
    async function* oneEach(): AsyncGenerator<RescanEntry[]> { for (const e of entries) yield [e] }
    relay.events = [bag(0), bag(1), bag(2)]
    let n = 0
    const seen: string[] = []
    const result = await askAndOpen(oneEach(), async (ids, opts) => {
      if (n++ === 0) throw new Error('relay down')
      return ask(ids, opts)
    }, async (ev, entry) => { seen.push(`${ev.tags[0][1]}=${entry.keyHex}`); return [{ eventId: ev.id } as never] }, undefined, 1)
    expect(result.batches).toBe(3)
    expect(result.opened.map((e) => e.lookupId)).toEqual([lookup(1), lookup(2)])
    expect(seen).toEqual([`${lookup(1)}=${keyOf(1)}`, `${lookup(2)}=${keyOf(2)}`])
    expect(result.skipped).toEqual([{ relay: 'every relay', why: 'did not answer (relay down)', ids: 1 }])
  })
})

describe('RESCAN ALL, over IndexedDB', () => {
  async function boot(): Promise<{ secrets: typeof import('../../../store/useSecrets'); rescan: typeof import('../rescan'); shards: typeof import('../../../store/useShards') }> {
    vi.resetModules()
    const secrets = await import('../../../store/useSecrets')
    const rescan = await import('../rescan')
    const shards = await import('../../../store/useShards')
    await secrets.useSecrets.getState().load()
    shards.useShards.setState({ mine: [], deleted: {}, discovered: {} })
    return { secrets, rescan, shards }
  }

  it('asks every id once, at most RESCAN_BATCH to a request, files what opens, and holds the place keys that opened', async () => {
    const { secrets, rescan, shards } = await boot()
    const s = secrets.useSecrets.getState
    s().hold([heldKey(0)])
    // 25 places of 13 keys each: 325 place keys, plus the held one.
    for (let p = 0; p < 25; p++) await s().recordPlace({ x: BigInt(p), y: 0n, z: 0n }, 1, scanFrom(1 + p * 13))
    relay.events = [bag(0), bag(5), bag(325)]

    const status = await rescan.rescanAll()

    expect(relay.calls.every((c) => c.ids.length <= RESCAN_BATCH)).toBe(true)
    // The filter the relays get says how many events it wants.
    expect(relay.calls.every((c) => c.limit === RESCAN_LIMIT)).toBe(true)
    const all = relay.calls.flatMap((c) => c.ids)
    expect(all).toHaveLength(326)
    expect(new Set(all).size).toBe(326)
    expect(status).toMatchObject({ running: false, asked: 326, requests: 3, found: 3, fresh: 3, held: 2, error: null, skipped: [] })
    expect(s().rescan).toEqual(status)
    expect(Object.keys(shards.useShards.getState().discovered)).toHaveLength(3)
    // The two place keys are held now, as opened keys in their place's plane.
    expect(s().keys[lookup(5)]).toMatchObject({ source: 'scan', plane: 1 })
    expect(s().keys[lookup(325)]).toMatchObject({ source: 'scan' })
    expect(s().keys[lookup(0)].source).toBe('hop')
  })

  it('never has more than RESCAN_PARALLEL requests open, across batches, split halves and pages', async () => {
    const { secrets, rescan } = await boot()
    // 160 held keys: two batches. Every id busy enough to be split down to
    // itself and paged once, which is where the first version fanned out to
    // 150 requests at once a batch, 450 across its workers.
    secrets.useSecrets.getState().hold(Array.from({ length: 160 }, (_, i) => heldKey(i)))
    for (let i = 0; i < 160; i++) for (let j = 0; j < CAP_SUSPECT + 20; j++) relay.events.push({ ...bag(i, 5_000 + j), content: 'sealed with another key' })
    relay.delayMs = 1
    const opener = vi.mocked((await import('../../hidden')).unbag)
    opener.mockClear()
    const status = await rescan.rescanAll()
    expect(relay.peak).toBeLessThanOrEqual(RESCAN_PARALLEL)
    expect(relay.calls.length).toBeGreaterThan(160)
    // Every event reached the opener, none cut off.
    expect(new Set(opener.mock.calls.map(([ev]) => (ev as unknown as Ev).id)).size).toBe(160 * (CAP_SUSPECT + 20))
    expect(status.skipped).toEqual([])
  }, 60_000)

  it('reports itself incomplete when a relay refuses, naming the relay', async () => {
    relay.relays = [DEFAULT_RELAY, { url: 'wss://busy.test', cap: 500, refuse: true }]
    const { secrets, rescan } = await boot()
    secrets.useSecrets.getState().hold([heldKey(1), heldKey(2)])
    const status = await rescan.rescanAll()
    expect(status.error).toBeNull()
    expect(status.skipped).toEqual([{ relay: 'wss://busy.test', why: 'refused the request (rate-limited: too many subscriptions)', ids: 2 }])
    expect(rescan.describeSkips(status.skipped)).toBe('wss://busy.test refused the request (rate-limited: too many subscriptions) for 2 lookup ids')
  })

  it('counts a key that is both held and a place key once in what it expects to ask', async () => {
    const { secrets, rescan } = await boot()
    const s = secrets.useSecrets.getState
    // 156 held keys that are also the keys of 12 places: 156 distinct ids,
    // two requests. Counted twice, it would expect 312 and three.
    for (let p = 0; p < 12; p++) {
      const scan = scanFrom(2_000 + p * 13)
      s().hold(scan.map((k) => heldKey(0, { lookupId: k.lookupId, keyHex: k.keyHex })))
      await s().recordPlace({ x: BigInt(p), y: 0n, z: 0n }, 0, scan)
    }
    const first: number[] = []
    const stop = secrets.useSecrets.subscribe((st) => { if (st.rescan?.running && first.length === 0) first.push(st.rescan.requests) })
    const status = await rescan.rescanAll()
    stop()
    expect(status.asked).toBe(156)
    expect(first).toEqual([Math.ceil(156 / RESCAN_BATCH)])
  })

  it('a connection dropped while reading the place keys is opened again, and the rescan finishes', async () => {
    const { secrets, rescan } = await boot()
    for (let p = 0; p < 25; p++) await secrets.useSecrets.getState().recordPlace({ x: BigInt(p), y: 0n, z: 0n }, 1, scanFrom(5_000 + p * 13))
    // The first read of a page of place keys fails as a dropped connection does.
    const real = IDBDatabase.prototype.transaction
    let dropped = false
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
      if (!dropped && args[0] === 'placeKeys' && (args[1] ?? 'readonly') === 'readonly') {
        dropped = true
        throw new DOMException('The database connection is closing.', 'InvalidStateError')
      }
      return real.apply(this, args)
    })
    const status = await rescan.rescanAll()
    expect(dropped).toBe(true)
    expect(status).toMatchObject({ error: null, asked: 325 })
  })

  it('a second run finds the same things and none of them is new', async () => {
    const { secrets, rescan } = await boot()
    await secrets.useSecrets.getState().recordPlace({ x: 0n, y: 0n, z: 0n }, 0, scanFrom(700))
    relay.events = [bag(705)]
    expect((await rescan.rescanAll()).fresh).toBe(1)
    expect(await rescan.rescanAll()).toMatchObject({ found: 1, fresh: 0, held: 0 })
  })

  it('a bag filed under a key but sealed with another opens nothing', async () => {
    const { secrets, rescan } = await boot()
    await secrets.useSecrets.getState().recordPlace({ x: 0n, y: 0n, z: 0n }, 0, scanFrom(800))
    relay.events = [{ ...bag(805), content: keyOf(806) }]
    expect(await rescan.rescanAll()).toMatchObject({ found: 0, held: 0 })
    expect(secrets.useSecrets.getState().keys).toEqual({})
  })

  it('SCAN on a place asks about that place\'s keys and no others', async () => {
    const { secrets, rescan } = await boot()
    const s = secrets.useSecrets.getState
    await s().recordPlace({ x: 0n, y: 0n, z: 0n }, 0, scanFrom(900))
    await s().recordPlace({ x: 1n, y: 0n, z: 0n }, 0, scanFrom(950))
    const placeA = (await (await import('../vault')).pagePlaces(null, 10)).find((p) => p.keys[0] === lookup(900))!
    relay.events = [bag(903), bag(955)]
    expect(await rescan.rescanPlace(placeA.id)).toEqual({ found: 1, skipped: [] })
    expect(relay.calls).toHaveLength(1)
    expect(new Set(relay.calls[0].ids)).toEqual(new Set(scanFrom(900).map((k) => k.lookupId)))
    expect(s().keys[lookup(903)]).toMatchObject({ source: 'scan' })
    expect(s().keys[lookup(955)]).toBeUndefined()
  })
})
