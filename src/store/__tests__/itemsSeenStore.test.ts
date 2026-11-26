/**
 * itemsSeenStore.test.ts: what an identity has looked at in ITEMS is its own,
 * in IndexedDB under its pubkey (owner ruling, 2026-11-19): a new identity
 * sees its own items NEW, switching back brings the first identity's record
 * back, a reload keeps it, and no NEW is drawn before the record is read.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SEEN_SINCE, isNewItem } from '../../lib/itemsSeen'

const A = 'aa'.repeat(32)
const B = 'bb'.repeat(32)

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
}

type Store = typeof import('../useItemsSeen')

/** A page load: fresh modules over the same database. */
async function load(): Promise<Store> {
  const lists = await import('../personalLists')
  lists.stopHearingOtherTabs()
  vi.resetModules()
  return import('../useItemsSeen')
}

/** Until the record shown is `owner`'s, read. */
async function readyFor(S: Store, owner: string): Promise<void> {
  for (let i = 0; i < 200 && !(S.useItemsSeen.getState().ready && S.useItemsSeen.getState().owner === owner); i++) await new Promise((r) => setTimeout(r, 1))
  expect(S.useItemsSeen.getState()).toMatchObject({ owner, ready: true })
}

const coin = { id: 'coin', type: 'message' as const, at: SEEN_SINCE + 50 }
const key = { id: 'key', type: 'key' as const, at: SEEN_SINCE + 60 }

beforeEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  mem.clear()
})

describe('NEW is kept per identity', () => {
  it('A sees an item; B starts with it NEW; A gets its record back on switching and on a reload', async () => {
    let S = await load()
    const asA = S.itemsSeenList.setOwner(A)
    // Not ready until A's record is read: the grids draw no NEW meanwhile.
    expect(S.useItemsSeen.getState().ready).toBe(false)
    await asA
    await readyFor(S, A)
    S.useItemsSeen.getState().markItem(coin)
    S.useItemsSeen.getState().markKind('keys', [key])
    await S.itemsSeenList.flush()
    expect(isNewItem(S.useItemsSeen.getState().seen, coin)).toBe(false)
    expect(isNewItem(S.useItemsSeen.getState().seen, key)).toBe(false)

    await S.itemsSeenList.setOwner(B)
    await readyFor(S, B)
    expect(isNewItem(S.useItemsSeen.getState().seen, coin)).toBe(true)
    expect(isNewItem(S.useItemsSeen.getState().seen, key)).toBe(true)

    await S.itemsSeenList.setOwner(A)
    await readyFor(S, A)
    expect(isNewItem(S.useItemsSeen.getState().seen, coin)).toBe(false)
    expect(isNewItem(S.useItemsSeen.getState().seen, key)).toBe(false)

    S = await load()
    await S.itemsSeenList.setOwner(A)
    await readyFor(S, A)
    expect(isNewItem(S.useItemsSeen.getState().seen, coin)).toBe(false)
    // In IndexedDB, not localStorage.
    expect([...mem.keys()].filter((k) => k.includes('items-seen') && !k.includes('adopted'))).toEqual([])
  })

  it('a card opened before the record was read is kept, merged into what is read', async () => {
    let S = await load()
    await S.itemsSeenList.setOwner(A)
    await readyFor(S, A)
    S.useItemsSeen.getState().markItem(key)
    await S.itemsSeenList.flush()

    S = await load()
    const reading = S.itemsSeenList.setOwner(A)
    S.useItemsSeen.getState().markItem(coin)
    await reading
    await readyFor(S, A)
    const seen = S.useItemsSeen.getState().seen
    expect(isNewItem(seen, coin)).toBe(false)
    expect(isNewItem(seen, key)).toBe(false)
  })
})
