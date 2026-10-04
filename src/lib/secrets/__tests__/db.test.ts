/**
 * db.test.ts: the IndexedDB side of region keys and places.
 *
 * - The one-time copy of the localStorage keys (arkinox, 2026-10-03): every
 *   key arrives, the localStorage entry is left exactly as it was, and the
 *   copy happens once, so a key forgotten later is not copied back.
 * - The totals every write keeps in its own transaction match a full count.
 * - Places keep their keys once, and forgetting or evicting a place takes
 *   only the keys no remaining place uses.
 * - A connection that opens after the app gave up waiting is closed, not
 *   leaked (review of #219, finding 1d).
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAllPaged, getMeta } from '../../idb'
import { bytesOf } from '../budget'
import {
  KEYS_STORE, LEGACY_KEY, MIGRATED_META, describeError, PLACES_STORE, PLACE_KEYS_STORE, TOTALS_META, evictPlaces, forgetPlace, forgetPlacesUpTo,
  migrateFromLocalStorage, openSecretsDb, pagePlaces, parseLegacy, readTotals, recordPlace, writeKeys, type Totals,
} from '../db'
import { placeOf, type ScanKey } from '../places'
import type { HeldKey } from '../../../store/useSecrets'

const key = (id: string, over: Partial<HeldKey> = {}): HeldKey => ({
  lookupId: id.repeat(32),
  keyHex: 'bb'.repeat(32),
  height: 8,
  base: { x: '256', y: '512', z: '768' },
  plane: 0,
  source: 'scan',
  at: 1_800_000_000,
  ...over,
})

/** A localStorage that records every write, so "untouched" can be checked, not assumed. */
function storage(initial: Record<string, string>): Storage & { writes: string[] } {
  const mem = new Map(Object.entries(initial))
  const writes: string[] = []
  return {
    writes,
    get length() { return mem.size },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { writes.push(k); mem.set(k, String(v)) },
    removeItem: (k: string) => { writes.push(k); mem.delete(k) },
    clear: () => { writes.push('*'); mem.clear() },
  }
}

async function rows<T>(db: IDBDatabase, store: string, keyOf: (r: T) => IDBValidKey): Promise<T[]> {
  const out: T[] = []
  await getAllPaged<T>(db, store, 100, keyOf, (r) => { out.push(...r) })
  return out
}

/** Everything measured from scratch, to hold the running totals to. */
async function measured(db: IDBDatabase): Promise<Totals> {
  const keys = await rows<HeldKey>(db, KEYS_STORE, (r) => r.lookupId)
  const places = await rows<{ id: string }>(db, PLACES_STORE, (r) => r.id)
  const placeKeys = await rows<{ lookupId: string }>(db, PLACE_KEYS_STORE, (r) => r.lookupId)
  const bytes = [...keys, ...places, ...placeKeys].reduce((n, r) => n + bytesOf(r), 0)
  return { bytes, places: places.length, placeKeys: placeKeys.length }
}

const totalsOf = async (db: IDBDatabase): Promise<Totals | undefined> => await getMeta(db, TOTALS_META) as Totals | undefined

function scanAt(p: { x: bigint; y: bigint; z: bigint }): ScanKey[] {
  return Array.from({ length: 13 }, (_, h) => {
    const b = (v: bigint): bigint => (v >> BigInt(h)) << BigInt(h)
    return { lookupId: `h${h}:${b(p.x)},${b(p.y)},${b(p.z)}`, keyHex: 'cc'.repeat(32), height: h }
  })
}
const at = (i: number): { x: bigint; y: bigint; z: bigint } => ({ x: (1n << 40n) + BigInt(i), y: 1n << 40n, z: 1n << 40n })
const stand = (db: IDBDatabase, i: number, now: number): Promise<Totals> => {
  const p = placeOf(at(i), 0, scanAt(at(i)), now)!
  return recordPlace(db, p.place, p.keys)
}

beforeEach(() => {
  // A fresh browser profile for every test: no databases at all.
  ;(globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory()
})

describe('copying the localStorage keys into IndexedDB', () => {
  it('copies every key and leaves the localStorage entry exactly as it was', async () => {
    const legacy = { ['aa'.repeat(32)]: key('aa'), ['cc'.repeat(32)]: key('cc', { source: 'cloud', height: 20 }) }
    const raw = JSON.stringify(legacy)
    const ls = storage({ [LEGACY_KEY]: raw })
    const db = await openSecretsDb()

    expect(await migrateFromLocalStorage(db, ls)).toBe(2)

    const copied = await rows<HeldKey>(db, KEYS_STORE, (r) => r.lookupId)
    expect(copied.map((k) => k.lookupId).sort()).toEqual(Object.keys(legacy).sort())
    expect(copied.find((k) => k.source === 'cloud')?.height).toBe(20)
    // Untouched: the same string, and not one write or delete against storage.
    expect(ls.getItem(LEGACY_KEY)).toBe(raw)
    expect(ls.writes).toEqual([])
    expect(await totalsOf(db)).toEqual(await measured(db))
  })

  it('runs once: the second load copies nothing', async () => {
    const ls = storage({ [LEGACY_KEY]: JSON.stringify({ ['aa'.repeat(32)]: key('aa') }) })
    const db = await openSecretsDb()
    expect(await migrateFromLocalStorage(db, ls)).toBe(1)
    expect(await getMeta(db, MIGRATED_META)).toMatchObject({ copied: 1 })

    // A key that turns up in localStorage afterwards is not copied: the copy
    // is done, and a key forgotten in IndexedDB must not come back from here.
    ls.setItem(LEGACY_KEY, JSON.stringify({ ['aa'.repeat(32)]: key('aa'), ['dd'.repeat(32)]: key('dd') }))
    expect(await migrateFromLocalStorage(db, ls)).toBeNull()
    expect((await rows<HeldKey>(db, KEYS_STORE, (r) => r.lookupId)).map((k) => k.lookupId)).toEqual(['aa'.repeat(32)])
  })

  it('keeps a key IndexedDB already holds rather than overwriting it', async () => {
    const db = await openSecretsDb()
    await writeKeys(db, [key('aa', { at: 1_700_000_000 })], [])
    await migrateFromLocalStorage(db, storage({ [LEGACY_KEY]: JSON.stringify({ ['aa'.repeat(32)]: key('aa', { at: 1_800_000_000 }) }) }))
    expect((await rows<HeldKey>(db, KEYS_STORE, (r) => r.lookupId))[0].at).toBe(1_700_000_000)
  })

  it('marks the copy done when there was nothing to copy, and survives storage that throws', async () => {
    const db = await openSecretsDb()
    const throwing = { getItem: () => { throw new Error('SecurityError') } }
    expect(await migrateFromLocalStorage(db, throwing)).toBe(0)
    expect(await migrateFromLocalStorage(db, null)).toBeNull()
  })
})

describe('writing held keys', () => {
  it('never replaces a row already there: another tab may have written it between a load\'s read and its merge', async () => {
    const db = await openSecretsDb()
    await writeKeys(db, [key('aa', { source: 'cloud', eventId: 'NEW' })], [])
    await writeKeys(db, [key('aa', { source: 'cloud', eventId: 'OLD' })], [])
    expect((await rows<HeldKey>(db, KEYS_STORE, (r) => r.lookupId))[0].eventId).toBe('NEW')
    expect(await totalsOf(db)).toEqual(await measured(db))
  })
})

describe('the running totals', () => {
  it('match a full count after keys, places, a forget and an eviction', async () => {
    const db = await openSecretsDb()
    await writeKeys(db, [key('aa'), key('bb', { source: 'cloud' })], [])
    for (let i = 0; i < 20; i++) await stand(db, i, 1_000 + i)
    await stand(db, 3, 2_000)
    await writeKeys(db, [], ['aa'.repeat(32)])
    await forgetPlace(db, placeOf(at(7), 0, scanAt(at(7)), 0)!.place.id)
    await evictPlaces(db, 1, 3)
    expect(await totalsOf(db)).toEqual(await measured(db))
  })

  it('are measured once when the record is missing, and then kept', async () => {
    const db = await openSecretsDb()
    await stand(db, 0, 1)
    const tx = db.transaction('meta', 'readwrite')
    tx.objectStore('meta').delete(TOTALS_META)
    await new Promise((r) => { tx.oncomplete = r })
    expect(await readTotals(db)).toEqual(await measured(db))
    expect(await totalsOf(db)).toEqual(await measured(db))
  })
})

describe('places in IndexedDB', () => {
  it('standing on the same spot again moves its time and adds no rows', async () => {
    const db = await openSecretsDb()
    await stand(db, 0, 100)
    const once = await totalsOf(db)
    await stand(db, 0, 250)
    expect(await totalsOf(db)).toMatchObject({ places: 1, placeKeys: once!.placeKeys })
    expect((await pagePlaces(db, null, 10))[0]).toMatchObject({ first: 100, at: 250 })
  })

  it('neighbors store the keys they share once', async () => {
    const db = await openSecretsDb()
    await stand(db, 0, 100)
    await stand(db, 1, 200)
    // at(0).x is a multiple of 2^40 and at(1).x one past it: only the 2^0 cube differs.
    expect(await totalsOf(db)).toMatchObject({ places: 2, placeKeys: 14 })
  })

  it('forgetting a place takes only the keys no remaining place uses', async () => {
    const db = await openSecretsDb()
    await stand(db, 0, 100)
    await stand(db, 1, 200)
    await forgetPlace(db, placeOf(at(0), 0, scanAt(at(0)), 0)!.place.id)
    const left = await rows<{ lookupId: string }>(db, PLACE_KEYS_STORE, (r) => r.lookupId)
    expect(left).toHaveLength(13)
    expect(left.map((k) => k.lookupId)).not.toContain(scanAt(at(0))[0].lookupId)
  })

  it('pages newest first, each page starting past the last', async () => {
    const db = await openSecretsDb()
    for (let i = 0; i < 7; i++) await stand(db, i, 100 + (i % 3))
    const first = await pagePlaces(db, null, 4)
    const rest = await pagePlaces(db, { at: first[3].at, id: first[3].id }, 4)
    const all = [...first, ...rest]
    expect(all).toHaveLength(7)
    expect(new Set(all.map((p) => p.id)).size).toBe(7)
    expect(all.map((p) => p.at)).toEqual([...all.map((p) => p.at)].sort((a, b) => b - a))
  })

  it('eviction takes the places stood on longest ago, and the keys only they used', async () => {
    const db = await openSecretsDb()
    for (let i = 0; i < 6; i++) await stand(db, i * 4, 100 + i)
    const { removed } = await evictPlaces(db, Number.MAX_SAFE_INTEGER, 2)
    expect(removed).toBe(2)
    expect((await pagePlaces(db, null, 10)).map((p) => p.at)).toEqual([105, 104, 103, 102])
    expect(await totalsOf(db)).toEqual(await measured(db))
  })

  it('forgetting up to a time leaves what was stood on after it', async () => {
    const db = await openSecretsDb()
    await stand(db, 0, 100)
    await stand(db, 1, 200)
    await forgetPlacesUpTo(db, 150)
    expect((await pagePlaces(db, null, 10)).map((p) => p.at)).toEqual([200])
    expect(await totalsOf(db)).toEqual(await measured(db))
  })
})

describe('opening', () => {
  it('closes a connection that arrives after the app stopped waiting for it', async () => {
    const close = vi.fn()
    const req: { result?: unknown; onsuccess?: () => void } = {}
    ;(globalThis as { indexedDB: unknown }).indexedDB = {
      open: () => { setTimeout(() => { req.result = { close }; req.onsuccess?.() }, 30); return req },
    }
    await expect(openSecretsDb(5)).rejects.toThrow(/in time/)
    await new Promise((r) => setTimeout(r, 60))
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('saying what failed', () => {
  it('uses the message, and the name when IndexedDB leaves the message empty', () => {
    expect(describeError(new DOMException('The quota has been exceeded.', 'QuotaExceededError'))).toBe('The quota has been exceeded.')
    expect(describeError(new DOMException('', 'NotFoundError'))).toBe('NotFoundError')
    expect(describeError('plain')).toBe('plain')
    expect(describeError(undefined)).toBe('unknown error')
  })
})

describe('reading a localStorage list', () => {
  it('skips rows that are not keys and keeps the rest', () => {
    const raw = JSON.stringify({ ['aa'.repeat(32)]: key('aa'), bad: { keyHex: 1 }, nul: null })
    expect(Object.keys(parseLegacy(raw))).toEqual(['aa'.repeat(32)])
  })

  it('takes the map key as the lookup id for a row that lacks one', () => {
    const { lookupId: _, ...rest } = key('ee')
    expect(parseLegacy(JSON.stringify({ ['ee'.repeat(32)]: rest }))['ee'.repeat(32)].lookupId).toBe('ee'.repeat(32))
  })

  it('is empty for nothing and for garbage', () => {
    expect(parseLegacy(null)).toEqual({})
    expect(parseLegacy('{not json')).toEqual({})
  })
})
