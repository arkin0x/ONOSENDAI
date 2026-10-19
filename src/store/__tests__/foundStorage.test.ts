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
let discovered: Record<string, Hidden> = {}
const added: Hidden[][] = []
/** How each addDiscovered was asked: watched (by Cyberspace TV) or played. */
const addedHow: Array<{ watched?: boolean } | undefined> = []
let relayAnswers: (filter: unknown) => NostrEvent[] = () => []
let held: Record<string, { id: string }> = {}
let starred: Array<{ input: string; plane: number }> = []

vi.mock('../useCyberspace', () => ({
  useCyberspace: {
    getState: () => ({ identity: { pubkey: identity, npub: '' } }),
    subscribe: () => () => undefined,
  },
}))
vi.mock('../useShards', () => ({
  useShards: {
    getState: () => ({
      discovered,
      addDiscovered: (items: Hidden[], how?: { watched?: boolean }) => { added.push(items); addedHow.push(how); for (const h of items) discovered[h.eventId] = h },
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
})

