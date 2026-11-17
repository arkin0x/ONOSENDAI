/**
 * foundStorage.test.ts: bags you have opened, kept in IndexedDB per identity
 * and brought back on the next load before any relay answers (arkinox,
 * 2026-10-13). A page load is a fresh copy of the store module over the
 * same database. The shard store, the inventory, the stars and the relay are
 * stand-ins: what is checked is what reaches addDiscovered, and when.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, type NostrEvent } from 'nostr-tools/pure'
import { regionKeyAt } from '../../lib/shardCrypto'
import { bagTemplate, messageInnerTemplate, type Hidden } from '../../lib/hidden'

const ME = 'ee'.repeat(32)
const OTHER = 'dd'.repeat(32)
let identity = ME
/** Runs once, right after the next addDiscovered: a test's way to act exactly between two hand-overs. */
let onAdd: (() => void) | null = null
/** Where the player stands, for the nearest-first load (undefined: not known). */
let standing: { x: bigint; y: bigint; z: bigint } | undefined
let discovered: Record<string, Hidden> = {}
const added: Hidden[][] = []
/** How each addDiscovered was asked: watched (by Cyberspace TV) or played. */
const addedHow: Array<{ watched?: boolean } | undefined> = []
let relayAnswers: (filter: unknown) => NostrEvent[] = () => []
let held: Record<string, { id: string }> = {}
let starred: Array<{ input: string; plane: number }> = []

/** What the store subscribed to useCyberspace, so a test can switch identity under it. */
type IdentityListener = (s: { identity: { pubkey: string } }, prev: { identity: { pubkey: string } }) => void
let identityListeners: IdentityListener[] = []
vi.mock('../useCyberspace', () => ({
  useCyberspace: {
    getState: () => ({ identity: { pubkey: identity, npub: '' }, position: standing, headPlane: 0 }),
    subscribe: (fn: IdentityListener) => { identityListeners.push(fn); return () => undefined },
  },
}))
vi.mock('../useShards', () => ({
  useShards: {
    getState: () => ({
      discovered,
      addDiscovered: (items: Hidden[], how?: { watched?: boolean }) => { added.push(items); addedHow.push(how); for (const h of items) discovered[h.eventId] = h; const hook = onAdd; onAdd = null; hook?.() },
    }),
    setState: (s: { discovered: Record<string, Hidden> }) => { discovered = s.discovered },
  },
}))
vi.mock('../useInventory', () => ({ useInventory: { getState: () => ({ items: held }) } }))
vi.mock('../useStarred', () => ({ useStarred: { getState: () => ({ places: starred }) } }))
vi.mock('../../lib/relay', () => ({ query: async (f: unknown) => relayAnswers(f) }))

type Mod = typeof import('../useFound')
type Cache = typeof import('../../lib/foundCache')

/** A page load: the modules fresh, then the store's load for the identity. */
async function boot(owner = identity): Promise<{ found: Mod; cache: Cache }> {
  vi.resetModules()
  identityListeners = []
  const found = await import('../useFound')
  const cache = await import('../../lib/foundCache')
  await found.useFound.getState().load(owner)
  return { found, cache }
}

const hider = generateSecretKey()
const at = { x: 90_000n, y: 4_000n, z: 71n }
const rk = regionKeyAt(at, 6, 20)

async function bagOf(text: string, createdAt = 100): Promise<NostrEvent> {
  const m = finalizeEvent(messageInnerTemplate(text, at, 0, 5), hider)
  return finalizeEvent(await bagTemplate([m], rk.key, rk.lookupId, 6, createdAt), hider)
}

/** A scan opens this bag in the current page. */
async function find(cache: Cache, found: Mod, outer: NostrEvent): Promise<Hidden[]> {
  const items = await cache.unbagRemembered(outer, rk.key, undefined, undefined, 6)
  await found.flushFound()
  return items
}

const texts = (): string[] => Object.values(discovered).map((h) => h.text ?? '').sort()

beforeEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  identity = ME
  onAdd = null
  standing = undefined
  discovered = {}
  added.length = 0
  addedHow.length = 0
  relayAnswers = () => []
  held = {}
  starred = []
  vi.spyOn(console, 'warn').mockImplementation(() => { /* the tests check what happened */ })
})

afterEach(() => { vi.restoreAllMocks() })

describe('a find survives the reload', () => {
  it('is back on the next load with no relay answering', async () => {
    const a = await boot()
    await find(a.cache, a.found, await bagOf('under the arch'))
    discovered = {}
    await boot()
    expect(texts()).toEqual(['under the arch'])
  })

  it('a relay that is silent removes nothing, load after load', async () => {
    const a = await boot()
    await find(a.cache, a.found, await bagOf('still here'))
    for (let i = 0; i < 3; i++) { discovered = {}; const b = await boot(); await b.found.flushFound() }
    expect(texts()).toEqual(['still here'])
  })

  it('a newer version of the bag replaces the row, and an older one never brings it back', async () => {
    const a = await boot()
    await find(a.cache, a.found, await bagOf('v2', 200))
    await find(a.cache, a.found, await bagOf('v1', 100))
    discovered = {}
    const b = await boot()
    expect(texts()).toEqual(['v2'])
    expect(b.found.loadedRows()).toHaveLength(1)
  })
})

describe('what is dropped', () => {
  it('a row edited in storage does not open, is never shown, and is deleted', async () => {
    const a = await boot()
    await find(a.cache, a.found, await bagOf('genuine'))
    const db = await (await import('../../lib/foundDb')).openFoundDb()
    const { readFound, writeFound } = await import('../../lib/foundDb')
    const [row] = await readFound(db, ME)
    await writeFound(db, [{ ...row, outer: { ...row.outer, content: row.outer.content.slice(0, -4) + 'AAAA' } }])
    db.close()
    discovered = {}
    const b = await boot()
    await b.found.flushFound()
    expect(texts()).toEqual([])
    const db2 = await (await import('../../lib/foundDb')).openFoundDb()
    expect(await readFound(db2, ME)).toEqual([])
    db2.close()
  })

  it('the bag author\'s deletion (kind 5) takes it off the screen and out of storage', async () => {
    const a = await boot()
    const outer = await bagOf('deleted later')
    await find(a.cache, a.found, outer)
    relayAnswers = (f) => ((f as { '#e'?: string[] })['#e']?.includes(outer.id)
      ? [finalizeEvent({ kind: 5, created_at: 300, tags: [['e', outer.id]], content: '' }, hider)]
      : [])
    discovered = {}
    const b = await boot()
    await vi.waitFor(() => expect(b.found.loadedRows()).toHaveLength(0))
    await b.found.flushFound()
    expect(texts()).toEqual([])
    relayAnswers = () => []
    discovered = {}
    await boot()
    expect(texts()).toEqual([])
  })
})

describe('one identity\'s finds are its own', () => {
  it('another identity loads none of them, and its own come back for it', async () => {
    const a = await boot()
    await find(a.cache, a.found, await bagOf('mine'))
    identity = OTHER
    discovered = {}
    const b = await boot(OTHER)
    await find(b.cache, b.found, await bagOf('theirs', 150))
    discovered = {}
    await boot(OTHER)
    expect(texts()).toEqual(['theirs'])
    identity = ME
    discovered = {}
    await boot(ME)
    expect(texts()).toEqual(['mine'])
  })
})

describe('what scans opened belongs to the identity they opened it for', () => {
  it('a change of identity forgets every bag a scan kept, so none is handed back', async () => {
    const a = await boot()
    const outer = await bagOf('under the old key')
    const first = await find(a.cache, a.found, outer)
    expect((await find(a.cache, a.found, outer))[0]).toBe(first[0])
    for (const fn of identityListeners) fn({ identity: { pubkey: OTHER } }, { identity: { pubkey: ME } })
    expect(a.cache.forgetOpened()).toBe(0)
  })
})

describe('the budget', () => {
  it('keeps a bag holding something in ITEMS, or in a starred place, and evicts the oldest other', async () => {
    const a = await boot()
    const lookupB = regionKeyAt({ ...at, x: at.x + 10_000n }, 6, 20)
    const lookupC = regionKeyAt({ ...at, x: at.x + 20_000n }, 6, 20)
    const mk = async (text: string, where: { x: bigint; y: bigint; z: bigint }, key: typeof rk, seen: number): Promise<Hidden[]> => {
      const m = finalizeEvent(messageInnerTemplate(text, where, 0, 5), hider)
      const outer = finalizeEvent(await bagTemplate([m], key.key, key.lookupId, 6, 100), hider)
      vi.spyOn(Date, 'now').mockReturnValue(seen * 1000)
      const items = await a.cache.unbagRemembered(outer, key.key, undefined, undefined, 6)
      vi.mocked(Date.now).mockRestore()
      await a.found.flushFound()
      return items
    }
    const heldItems = await mk('held', at, rk, 1_000)
    await mk('starred', { ...at, x: at.x + 10_000n }, lookupB, 2_000)
    await mk('plain', { ...at, x: at.x + 20_000n }, lookupC, 3_000)
    held = { k: { id: heldItems[0].eventId } }
    starred = [{ input: `${at.x + 10_000n} ${at.y} ${at.z}`, plane: 0 }]
    await a.found.enforceBudgetForTests(0)
    await a.found.flushFound()
    discovered = {}
    await boot()
    expect(texts()).toEqual(['held', 'starred'])
  })
})

describe('a bag Cyberspace TV kept', () => {
  /** TV shows this bag whole, and keeps it as watched (store/useTv reveal). */
  async function watch(cache: Cache, found: Mod, outer: NostrEvent): Promise<void> {
    const { items, refs } = await cache.unbagRecording(outer, rk.key, undefined, undefined, 6)
    cache.rememberBag(outer, rk.key, items, refs, 6, undefined, true)
    await found.flushFound()
  }

  it('comes back on the next load as watched, so no chest in it opens by itself', async () => {
    const a = await boot()
    await watch(a.cache, a.found, await bagOf('seen on TV'))
    discovered = {}
    addedHow.length = 0
    const b = await boot()
    expect(texts()).toEqual(['seen on TV'])
    expect(addedHow).toEqual([{ watched: true }])
    expect(b.found.loadedRows()[0].watched).toBe(true)
  })

  it('is played from the moment the same bag is found in play, at once', async () => {
    const a = await boot()
    const outer = await bagOf('then walked to')
    await watch(a.cache, a.found, outer)
    await find(a.cache, a.found, outer)
    discovered = {}
    addedHow.length = 0
    const b = await boot()
    expect(addedHow).toEqual([undefined])
    expect(b.found.loadedRows()[0].watched).toBeUndefined()
  })

  it('never makes a bag found in play watched', async () => {
    const a = await boot()
    const outer = await bagOf('walked to first')
    await find(a.cache, a.found, outer)
    await watch(a.cache, a.found, outer)
    discovered = {}
    addedHow.length = 0
    await boot()
    expect(addedHow).toEqual([undefined])
  })

  it('waits for the rows to be read, so a played row is never made watched', async () => {
    const a = await boot()
    const outer = await bagOf('walked to, then on TV')
    await find(a.cache, a.found, outer)
    // A new page: TV keeps the same bag before the rows have been read.
    vi.resetModules()
    const found = await import('../useFound')
    const cache = await import('../../lib/foundCache')
    const loading = found.useFound.getState().load(ME)
    const { items, refs } = await cache.unbagRecording(outer, rk.key, undefined, undefined, 6)
    cache.rememberBag(outer, rk.key, items, refs, 6, undefined, true)
    await loading
    await found.flushFound()
    discovered = {}
    addedHow.length = 0
    await boot()
    expect(addedHow).toEqual([undefined])
  })
})


describe('on load, the nearest first and handed over as they open', () => {
  const row = (key: string, seenAt: number, origin?: { x: string; y: string; z: string }, plane: 0 | 1 = 0, height?: number) =>
    ({ rowKey: key, owner: ME, outer: {} as NostrEvent, keyHex: '', refs: {}, itemIds: [], seenAt, ...(origin ? { origin: { at: origin, plane } } : {}), ...(height !== undefined ? { height } : {}) })

  it('orders rows in your plane by distance from where you stand to their region, then the rest most recently seen first', async () => {
    const { nearFirst } = await import('../useFound')
    const here = { x: 1000n, y: 1000n, z: 1000n }
    const rows = [
      row('far', 5, { x: '9000', y: '1000', z: '1000' }),
      row('none-old', 1),
      row('near', 2, { x: '1001', y: '1000', z: '999' }),
      // A big region whose corner is far but which you stand inside: distance 0.
      row('around-you', 3, { x: '0', y: '0', z: '0' }, 0, 12),
      row('other-plane', 9, { x: '1000', y: '1000', z: '1000' }, 1),
      row('none-new', 7),
    ]
    expect(nearFirst(rows, here, 0).map((r) => r.rowKey)).toEqual(['around-you', 'near', 'far', 'other-plane', 'none-new', 'none-old'])
    // Not known where you stand: most recently seen first.
    expect(nearFirst(rows, null, 0).map((r) => r.rowKey)).toEqual(['other-plane', 'none-new', 'far', 'around-you', 'near', 'none-old'])
  })

  it('batches end after 8 rows, then each twice the last', async () => {
    const { endsBatch } = await import('../useFound')
    const ends = Array.from({ length: 130 }, (_, i) => i + 1).filter(endsBatch)
    expect(ends).toEqual([8, 24, 56, 120])
  })

  /** Kept bags in n regions along x, each `step` apart, as earlier scans left them; returns the bag texts by region. */
  async function keepBags(n: number, step = 4_000_000n): Promise<void> {
    const a = await boot()
    for (let i = 0; i < n; i++) {
      const p = { x: 90_000n + BigInt(i) * step, y: 4_000n, z: 71n }
      const k = regionKeyAt(p, 6, 20)
      const m = finalizeEvent(messageInnerTemplate(`bag ${i}`, p, 0, 5), hider)
      const outer = finalizeEvent(await bagTemplate([m], k.key, k.lookupId, 6, 100), hider)
      await a.cache.unbagRemembered(outer, k.key, undefined, { at: { x: (p.x >> 6n) << 6n, y: (p.y >> 6n) << 6n, z: (p.z >> 6n) << 6n }, plane: 0 }, 6)
    }
    await a.found.flushFound()
    discovered = {}
    added.length = 0
  }

  it('a long list reaches the world in pieces: 8, then 16, then the rest', async () => {
    const { FIRST_ROWS } = await import('../useFound')
    const n = FIRST_ROWS + 2 * FIRST_ROWS + 1
    await keepBags(n)
    const b = await boot()
    expect(b.found.loadedRows()).toHaveLength(n)
    expect(added.map((x) => x.length)).toEqual([8, 16, 1])
    expect(texts()).toHaveLength(n)
  })

  it('the bags nearest where you stand are in the first piece', async () => {
    await keepBags(12)
    // Standing at the last bag's place: bags 11 down to 4 are the nearest eight.
    standing = { x: 90_000n + 11n * 4_000_000n, y: 4_000n, z: 71n }
    await boot()
    expect(added[0].map((h) => h.text).sort()).toEqual([4, 5, 6, 7, 8, 9, 10, 11].map((i) => `bag ${i}`).sort())
  })

  it('switching identity mid-load leaves none of the last identity\'s finds, and the old load hands over nothing more', async () => {
    await keepBags(12)
    vi.resetModules()
    identityListeners = []
    const found = await import('../useFound')
    // The switch lands right after the first piece is handed over, before the next row opens.
    onAdd = () => {
      identity = OTHER
      for (const l of identityListeners) l({ identity: { pubkey: OTHER } }, { identity: { pubkey: ME } })
    }
    await found.useFound.getState().load(ME)
    await found.useFound.getState().load(OTHER)
    expect(added.length).toBe(1)
    expect(texts()).toEqual([])
  })
})
