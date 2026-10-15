/**
 * feedStore.test.ts - the Shard Feed's store, the thumbnail queue, and which
 * tab PLACE OBJECT opens on.
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

/** Every filter each relay was asked. */
const asked: Record<string, Record<string, unknown>[]> = {}
const PK = 'ab'.repeat(32)
const payload = (name: string): string => JSON.stringify({ v: 2, name, unit: 0, extent: 8, mode: 'points', vertices: [[1, 0, 0]], colors: [229], faces: [] })
vi.mock('../../lib/relay', () => ({
  relaySet: () => ['wss://mine.test'],
  connectRelay: vi.fn(async (url: string) => url !== 'wss://nos.lol'),
  authForRead: vi.fn(async () => {}),
  subscribeOne: vi.fn((url: string, filter: Record<string, unknown>, h: { onevent: (e: unknown) => void; oneose: () => void }) => {
    ;(asked[url] ??= []).push(filter)
    setTimeout(() => {
      if (url === 'wss://mine.test') h.onevent({ id: '1'.repeat(64), pubkey: PK, created_at: 10, kind: 33331, tags: [['d', 'lamp']], content: payload('Lamp'), sig: '' })
      h.oneose()
    }, 0)
    return { close: () => {} }
  }),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
}))

import { FEED_RELAYS } from 'sno-core/feed'
import { newShard } from 'sno-core/shards'
import { feedRelays, useFeed } from '../useFeed'
import { MAX_THUMBS, useThumbs } from '../useThumbs'
import { defaultSource } from '../../hud/PlaceObjectPicker'

describe('the Shard Feed store', () => {
  it('reads your relays and the ones objects are published to, each once', () => {
    const relays = feedRelays()
    expect(relays[0]).toBe('wss://mine.test')
    for (const r of FEED_RELAYS) expect(relays).toContain(r)
    expect(new Set(relays).size).toBe(relays.length)
  })

  it('shows what the relays return; pages carry no tag filter and deletion reads one each (strfry allows at most three)', async () => {
    useFeed.getState().start()
    await vi.waitFor(() => expect(useFeed.getState().objects.map((o) => o.shard.name)).toEqual(['Lamp']))
    await vi.waitFor(() => expect(useFeed.getState().loading).toBe(false))
    const filters = Object.values(asked).flat()
    expect(filters.length).toBeGreaterThan(0)
    const pages = filters.filter((f) => (f.kinds as number[]).includes(33331))
    const deletions = filters.filter((f) => (f.kinds as number[]).includes(5))
    expect(pages.length).toBeGreaterThan(0)
    for (const f of pages) expect(Object.keys(f).filter((k) => k.startsWith('#'))).toEqual([])
    for (const f of deletions) expect(Object.keys(f).filter((k) => k.startsWith('#')).length).toBe(1)
    // An unreachable relay is not asked at all.
    expect(asked['wss://nos.lol']).toBeUndefined()
  })
})

describe('the thumbnail queue', () => {
  beforeEach(() => { useThumbs.setState({ urls: {}, queue: [], order: [] }) })

  it('asks for each picture once, and drops a drawn one from the queue', () => {
    const s = newShard('x')
    useThumbs.getState().request('a', s)
    useThumbs.getState().request('a', s)
    useThumbs.getState().request('b', s)
    expect(useThumbs.getState().queue.map((j) => j.key)).toEqual(['a', 'b'])
    useThumbs.getState().done('a', 'data:a')
    expect(useThumbs.getState().queue.map((j) => j.key)).toEqual(['b'])
    useThumbs.getState().request('a', s)
    expect(useThumbs.getState().queue.map((j) => j.key)).toEqual(['b'])
  })

  it('keeps at most MAX_THUMBS pictures, letting the oldest go', () => {
    for (let i = 0; i <= MAX_THUMBS; i++) useThumbs.getState().done(`k${i}`, `data:${i}`)
    expect(Object.keys(useThumbs.getState().urls)).toHaveLength(MAX_THUMBS)
    expect(useThumbs.getState().urls.k0).toBeUndefined()
    expect(useThumbs.getState().urls[`k${MAX_THUMBS}`]).toBe(`data:${MAX_THUMBS}`)
  })
})

describe('PLACE OBJECT', () => {
  it('opens on FEED when you have no models, and on MINE when you do', () => {
    expect(defaultSource([])).toBe('feed')
    expect(defaultSource([newShard('mine')])).toBe('mine')
  })
})
