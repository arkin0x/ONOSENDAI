/**
 * rescan.test.ts: RESCAN ALL asks about every kept key once, in batches, and
 * opens each answer with the key it is filed under (arkinox, 2026-10-04).
 *
 * The relay and the decryption are stand-ins: a "bag" here opens only with
 * the key written in its content, so opening one with the wrong key finds
 * nothing, as it would for real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const relay = vi.hoisted(() => ({ events: [] as Array<{ id: string; content: string; tags: string[][] }> }))

vi.mock('../../relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  relaySet: () => ['wss://relay.test'],
  // Answers with the events filed under the ids asked about, as a relay does.
  query: vi.fn(async (filter: { '#d'?: string[] }) => relay.events.filter((e) => filter['#d']?.includes(e.tags[0][1]))),
}))

vi.mock('../../hidden', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hidden')>()
  const { bytesToHex } = await import('../../events')
  return {
    ...actual,
    // Opens only with the key the bag names; one item per bag.
    unbag: vi.fn(async (ev: { id: string; content: string; tags: string[][] }, key: Uint8Array) =>
      bytesToHex(key) === ev.content
        ? [{ eventId: ev.id, type: 'message', text: 'hi', at: { x: 1n, y: 2n, z: 3n }, plane: 0, height: 4, author: 'ab'.repeat(32), lookupId: ev.tags[0][1], createdAt: 1 }]
        : []),
  }
})

import type { NostrEvent } from 'nostr-tools'
import { query } from '../../relay'
import { RESCAN_BATCH, allEntries, askAndOpen, chunk, placeEntries, rescanAll, rescanPlace, type RescanEntry } from '../rescan'
import type { Place, PlaceKey } from '../places'
import { useSecrets, type HeldKey } from '../../../store/useSecrets'
import { useShards } from '../../../store/useShards'

const lookup = (n: number): string => n.toString(16).padStart(64, '0')
const keyOf = (n: number): string => (n + 1_000_000).toString(16).padStart(64, '0')

const heldKey = (n: number, over: Partial<HeldKey> = {}): HeldKey => ({
  lookupId: lookup(n), keyHex: keyOf(n), height: 4, base: { x: '0', y: '0', z: '0' }, plane: 0, source: 'hop', at: 1, ...over,
})
const placeKey = (n: number): PlaceKey => ({ lookupId: lookup(n), keyHex: keyOf(n), height: 3, base: { x: '8', y: '16', z: '24' } })
const place = (id: string, ids: number[], plane: 0 | 1 = 1): Place => ({
  id, position: { x: '9', y: '17', z: '25' }, plane, keys: ids.map(lookup), first: 1, at: 1,
})
/** A bag filed under lookup id `n`, opening with key `n`. */
const bag = (n: number): { id: string; content: string; tags: string[][] } => ({ id: `e${n.toString(16).padStart(63, '0')}`, content: keyOf(n), tags: [['d', lookup(n)]] })

beforeEach(() => {
  relay.events = []
  vi.mocked(query).mockClear()
  useSecrets.setState({ keys: {}, places: {}, placeKeys: {}, rescan: null })
  useShards.setState({ mine: [], deleted: {}, discovered: {} })
  localStorage.clear()
})

describe('batching', () => {
  it('asks about each lookup id once, at most RESCAN_BATCH to a request', async () => {
    const entries: RescanEntry[] = Array.from({ length: 2 * RESCAN_BATCH + 20 }, (_, i) => ({ lookupId: lookup(i), keyHex: keyOf(i) }))
    // The same ids again, as a held key and a place key that are one key would be.
    const doubled = [...entries, ...entries.slice(0, 50)]
    const asked: string[][] = []
    const result = await askAndOpen(doubled, async (ids) => { asked.push(ids); return [] }, async () => [])
    expect(asked).toHaveLength(3)
    expect(result.requests).toBe(3)
    for (const ids of asked) expect(ids.length).toBeLessThanOrEqual(RESCAN_BATCH)
    const all = asked.flat()
    expect(new Set(all).size).toBe(all.length)
    expect(new Set(all)).toEqual(new Set(entries.map((e) => e.lookupId)))
  })

  it('opens each answer with the entry it is filed under', async () => {
    const entries: RescanEntry[] = [0, 1, 2].map((i) => ({ lookupId: lookup(i), keyHex: keyOf(i) }))
    const seen: Array<[string, string]> = []
    await askAndOpen(entries, async () => [bag(2), bag(0)] as unknown as NostrEvent[], async (ev, entry) => {
      seen.push([ev.tags[0][1], entry.keyHex])
      return []
    })
    expect(seen).toEqual([[lookup(2), keyOf(2)], [lookup(0), keyOf(0)]])
  })

  it('a batch the relays fail on does not stop the others', async () => {
    const entries: RescanEntry[] = Array.from({ length: 3 }, (_, i) => ({ lookupId: lookup(i), keyHex: keyOf(i) }))
    let n = 0
    const result = await askAndOpen(entries, async (ids) => {
      if (n++ === 0) throw new Error('relay down')
      return ids.map((id) => bag(parseInt(id, 16))) as unknown as NostrEvent[]
    }, async (ev) => [{ eventId: ev.id } as never], undefined, 1, 1)
    expect(result.requests).toBe(3)
    expect(result.opened.size).toBe(2)
  })

  it('chunks to the size, the last one short', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})

describe('what is asked about', () => {
  it('every held key and every place key, a key that is both read as the held one', () => {
    const keys = { [lookup(1)]: heldKey(1), [lookup(2)]: heldKey(2, { source: 'cloud' }) }
    const placeKeys = { [lookup(2)]: placeKey(2), [lookup(3)]: placeKey(3) }
    const places = { p: place('p', [2, 3]) }
    const entries = allEntries(keys, places, placeKeys, 50)
    expect(entries.map((e) => e.lookupId)).toEqual([lookup(1), lookup(2), lookup(3)])
    expect(entries[1].promote).toBeUndefined()
    // A place key carries the held key it would become, in its place's plane.
    expect(entries[2].promote).toMatchObject({ lookupId: lookup(3), source: 'scan', plane: 1, at: 50, height: 3 })
    // And the corner a reference with no point of its own is drawn at.
    expect(entries[2].origin).toEqual({ at: { x: 8n, y: 16n, z: 24n }, plane: 1 })
  })

  it('a hop box is asked about with no height or corner, as SCAN on its row does', () => {
    const box = heldKey(4, { heights: { x: 9, y: 2, z: 0 }, height: 9 })
    const [entry] = allEntries({ [box.lookupId]: box }, {}, {})
    expect(entry.height).toBeUndefined()
    expect(entry.origin).toBeUndefined()
  })

  it('one place: its own keys only', () => {
    const placeKeys = { [lookup(3)]: placeKey(3), [lookup(4)]: placeKey(4), [lookup(5)]: placeKey(5) }
    const entries = placeEntries(place('p', [3, 4], 0), {}, placeKeys)
    expect(entries.map((e) => e.lookupId)).toEqual([lookup(3), lookup(4)])
  })
})

describe('RESCAN ALL', () => {
  it('sends the relays every id in batches, files what opens, and holds the place keys that opened something', async () => {
    const n = RESCAN_BATCH * 2 + 20
    const placeKeys: Record<string, PlaceKey> = {}
    for (let i = 0; i < n; i++) placeKeys[lookup(i)] = placeKey(i)
    useSecrets.setState({
      keys: { [lookup(0)]: heldKey(0) },
      places: { p: place('p', Array.from({ length: n }, (_, i) => i)) },
      placeKeys,
    })
    // Something under a held key, and something under two place keys.
    relay.events = [bag(0), bag(5), bag(n - 1)]

    const status = await rescanAll()

    const calls = vi.mocked(query).mock.calls.map(([f]) => (f as { '#d': string[] })['#d'])
    expect(calls).toHaveLength(3)
    expect(calls.map((ids) => ids.length).sort((a, b) => b - a)).toEqual([RESCAN_BATCH, RESCAN_BATCH, 20])
    expect(new Set(calls.flat()).size).toBe(n)

    expect(status).toMatchObject({ running: false, asked: n, requests: 3, found: 3, fresh: 3, held: 2 })
    expect(useSecrets.getState().rescan).toEqual(status)
    expect(Object.keys(useShards.getState().discovered)).toHaveLength(3)
    // The two place keys are held now, as opened keys; the held one is as it was.
    const keys = useSecrets.getState().keys
    expect(keys[lookup(5)]).toMatchObject({ source: 'scan', plane: 1 })
    expect(keys[lookup(n - 1)]).toMatchObject({ source: 'scan' })
    expect(keys[lookup(0)].source).toBe('hop')
    expect(Object.keys(keys)).toHaveLength(3)
  })

  it('a second run finds the same things and none of them is new', async () => {
    // An id no other test opens: what counts as seen is kept for the session.
    useSecrets.setState({ placeKeys: { [lookup(77)]: placeKey(77) }, places: { p: place('p', [77]) } })
    relay.events = [bag(77)]
    expect((await rescanAll()).fresh).toBe(1)
    expect(await rescanAll()).toMatchObject({ found: 1, fresh: 0, held: 0 })
  })

  it('a bag filed under a key but sealed with another opens nothing', async () => {
    useSecrets.setState({ placeKeys: { [lookup(5)]: placeKey(5) }, places: { p: place('p', [5]) } })
    relay.events = [{ ...bag(5), content: keyOf(6) }]
    expect(await rescanAll()).toMatchObject({ found: 0, held: 0 })
    expect(useSecrets.getState().keys).toEqual({})
  })

  it('SCAN on a place asks about that place\'s keys and no others', async () => {
    useSecrets.setState({
      placeKeys: { [lookup(1)]: placeKey(1), [lookup(2)]: placeKey(2), [lookup(3)]: placeKey(3) },
      places: { a: place('a', [1, 2]), b: place('b', [3]) },
    })
    relay.events = [bag(2), bag(3)]
    expect(await rescanPlace('a')).toBe(1)
    expect(vi.mocked(query).mock.calls[0][0]).toMatchObject({ '#d': [lookup(1), lookup(2)] })
    expect(useSecrets.getState().keys[lookup(2)]).toMatchObject({ source: 'scan' })
    expect(useSecrets.getState().keys[lookup(3)]).toBeUndefined()
  })
})
