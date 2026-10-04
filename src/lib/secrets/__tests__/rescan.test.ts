/**
 * rescan.test.ts: RESCAN ALL asks about every kept key once, in batches read
 * from storage a batch at a time, opens each answer with the key it is filed
 * under (arkinox, 2026-10-04), and does not lose what a relay's cap cuts off
 * (review of #219, finding 5).
 *
 * The relay is a stand-in that, like strfry, answers one filter with at most
 * RELAY_CAP events, newest first, and honors `until`. A "bag" opens only with
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
const relay = vi.hoisted(() => ({ events: [] as Ev[], calls: [] as Array<{ ids: string[]; until?: number }> }))
const RELAY_CAP = 500

/** What a capped relay answers: the newest RELAY_CAP events under these ids, at or before `until`. */
function answer(ids: string[], until?: number): Ev[] {
  return relay.events
    .filter((e) => ids.includes(e.tags[0][1]) && (until === undefined || e.created_at <= until))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, RELAY_CAP)
}

vi.mock('../../relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  relaySet: () => ['wss://relay.test'],
  query: vi.fn(async (filter: { '#d': string[]; until?: number }) => {
    relay.calls.push({ ids: filter['#d'], until: filter.until })
    return answer(filter['#d'], filter.until)
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

import type { NostrEvent } from 'nostr-tools'
import { CAP_SUSPECT, RESCAN_BATCH, allBatches, askAll, askAndOpen, placeEntries, type RescanEntry } from '../rescan'
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

beforeEach(() => {
  relay.events = []
  relay.calls = []
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
  const ask = async (ids: string[], until?: number): Promise<NostrEvent[]> => answer(ids, until) as unknown as NostrEvent[]

  it('a batch whose answer could be cut off is split until nothing is', async () => {
    // 150 ids, two of them busy: 300 and 350 bags. Asked whole, the relay
    // returns 500 of the 650 and drops the rest without a word.
    const ids = Array.from({ length: 150 }, (_, i) => lookup(i))
    for (let i = 0; i < 300; i++) relay.events.push(bag(7, 1_000 + i))
    for (let i = 0; i < 350; i++) relay.events.push(bag(90, 2_000 + i))
    relay.events.push(bag(140))
    const got = await askAll(ids, ask)
    expect(got).toHaveLength(651)
    expect(new Set(got.map((e) => e.id)).size).toBe(651)
  })

  it('a single id with more than a relay returns is paged back with until', async () => {
    for (let i = 0; i < 1_234; i++) relay.events.push(bag(5, 10_000 + Math.floor(i / 3)))
    const asked: Array<number | undefined> = []
    const got = await askAll([lookup(5)], async (ids, until) => { asked.push(until); return ask(ids, until) })
    expect(got).toHaveLength(1_234)
    expect(asked[0]).toBeUndefined()
    expect(asked.slice(1).every((u) => typeof u === 'number')).toBe(true)
  })

  it('an answer under the threshold is taken as it is', async () => {
    for (let i = 0; i < CAP_SUSPECT - 1; i++) relay.events.push(bag(i % 3))
    let calls = 0
    const got = await askAll([lookup(0), lookup(1), lookup(2)], async (ids, until) => { calls++; return ask(ids, until) })
    expect(got).toHaveLength(CAP_SUSPECT - 1)
    expect(calls).toBe(1)
  })
})

describe('asking and opening', () => {
  it('opens each answer with the entry it is filed under, and a failed batch does not stop the others', async () => {
    const entries: RescanEntry[] = [0, 1, 2].map((i) => ({ lookupId: lookup(i), keyHex: keyOf(i) }))
    async function* oneEach(): AsyncGenerator<RescanEntry[]> { for (const e of entries) yield [e] }
    relay.events = [bag(0), bag(1), bag(2)]
    let n = 0
    const seen: string[] = []
    const result = await askAndOpen(oneEach(), async (ids) => {
      if (n++ === 0) throw new Error('relay down')
      return answer(ids) as unknown as NostrEvent[]
    }, async (ev, entry) => { seen.push(`${ev.tags[0][1]}=${entry.keyHex}`); return [{ eventId: ev.id } as never] }, undefined, 1)
    expect(result.batches).toBe(3)
    expect(result.opened.map((e) => e.lookupId)).toEqual([lookup(1), lookup(2)])
    expect(seen).toEqual([`${lookup(1)}=${keyOf(1)}`, `${lookup(2)}=${keyOf(2)}`])
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

    const sizes = relay.calls.map((c) => c.ids.length)
    expect(sizes.every((n) => n <= RESCAN_BATCH)).toBe(true)
    const all = relay.calls.flatMap((c) => c.ids)
    expect(all).toHaveLength(326)
    expect(new Set(all).size).toBe(326)
    expect(status).toMatchObject({ running: false, asked: 326, requests: 3, found: 3, fresh: 3, held: 2, error: null })
    expect(s().rescan).toEqual(status)
    expect(Object.keys(shards.useShards.getState().discovered)).toHaveLength(3)
    // The two place keys are held now, as opened keys in their place's plane.
    expect(s().keys[lookup(5)]).toMatchObject({ source: 'scan', plane: 1 })
    expect(s().keys[lookup(325)]).toMatchObject({ source: 'scan' })
    expect(s().keys[lookup(0)].source).toBe('hop')
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
    expect(await rescan.rescanPlace(placeA.id)).toBe(1)
    expect(relay.calls).toHaveLength(1)
    expect(new Set(relay.calls[0].ids)).toEqual(new Set(scanFrom(900).map((k) => k.lookupId)))
    expect(s().keys[lookup(903)]).toMatchObject({ source: 'scan' })
    expect(s().keys[lookup(955)]).toBeUndefined()
  })
})
