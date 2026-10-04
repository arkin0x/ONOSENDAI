/**
 * secretsStorage.test.ts: region keys and places kept in IndexedDB, through the store.
 *
 * A page load is a fresh copy of the store module over the same database and
 * the same localStorage: memory gone, both stores still there. Two tabs are
 * two copies loaded side by side.
 *
 * The regressions from the reviews of #219 (2026-10-04) are named for their
 * findings. First review: 1, a key bought while IndexedDB was out was
 * stranded once it came back; 2, FORGET ALL in one tab wiped a key another
 * tab had bought; 3, a write that failed was never tried again. Second
 * review: S1, a key bought in a tab still on the build before this database
 * was never read; S2, a fallback session brought back keys forgotten since;
 * N1, a database the first build of this left behind; N2, a key forgotten
 * before the load settled came back; N3, a backstop write that failed said
 * nothing; N5, a load must never replace a row with an older copy. Final
 * review (Q1 to Q5): a re-bought key lost to a fallback forget; a forget that
 * outlived a failed write; an unreadable old list; a record cleared over a
 * hold added meanwhile; a database from f18c7f5 with no record of the list.
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

import type { HeldKey, ScanKey } from '../useSecrets'
import { BOUGHT_KEY, FALLBACK_KEY } from '../../lib/secrets/backstop'
import { DB_VERSION, KEYS_STORE, LEGACY_KEY, SECRETS_DB, TOTALS_META } from '../../lib/secrets/db'

type Mod = typeof import('../useSecrets')
type Vault = typeof import('../../lib/secrets/vault')

/** A page load: the modules fresh, then the store's load. */
async function boot(): Promise<Mod & { vault: Vault }> {
  vi.resetModules()
  const mod = await import('../useSecrets')
  const vault = await import('../../lib/secrets/vault')
  await mod.useSecrets.getState().load()
  return { ...mod, vault }
}

const key = (id: string, over: Partial<HeldKey> = {}): HeldKey => ({
  lookupId: id.repeat(32), keyHex: 'bb'.repeat(32), height: 8, base: { x: '256', y: '512', z: '768' }, plane: 0, source: 'scan', at: 1_800_000_000, ...over,
})
const bought = (id: string, over: Partial<HeldKey> = {}): HeldKey => key(id, { source: 'cloud', height: 20, ...over })

/** The thirteen keys a scan computes at a position, each named by its cube. */
function scanAt(p: { x: bigint; y: bigint; z: bigint }): ScanKey[] {
  return Array.from({ length: 13 }, (_, h) => {
    const b = (v: bigint): bigint => (v >> BigInt(h)) << BigInt(h)
    return { lookupId: `h${h}:${b(p.x)},${b(p.y)},${b(p.z)}`, keyHex: 'cc'.repeat(32), height: h }
  })
}
const spot = (i: number): { x: bigint; y: bigint; z: bigint } => ({ x: (1n << 40n) + BigInt(i), y: 1n << 40n, z: 1n << 40n })

/** What IndexedDB holds for a key, read straight from the database. */
async function onDisk(lookupId: string): Promise<HeldKey | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(SECRETS_DB)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  const row = await new Promise<HeldKey | undefined>((resolve) => {
    const q = db.transaction(KEYS_STORE).objectStore(KEYS_STORE).get(lookupId)
    q.onsuccess = () => resolve(q.result as HeldKey | undefined)
  })
  db.close()
  return row
}

const backstop = (): string[] => Object.keys(JSON.parse(mem.get(BOUGHT_KEY) ?? '{}'))
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30))

beforeEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  mem.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => { /* fallbacks and retries say so; the tests check what happened */ })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the first load copies localStorage in, once, and leaves it alone', () => {
  it('serves the copied keys from IndexedDB with the localStorage string unchanged', async () => {
    const raw = JSON.stringify({ ['aa'.repeat(32)]: key('aa'), ['cc'.repeat(32)]: key('cc') })
    mem.set(LEGACY_KEY, raw)
    const m = await boot()
    expect(m.useSecrets.getState().storage.mode).toBe('indexeddb')
    expect(Object.keys(m.useSecrets.getState().keys)).toHaveLength(2)
    expect(mem.get(LEGACY_KEY)).toBe(raw)

    // Writes go to IndexedDB, never back to localStorage.
    m.useSecrets.getState().hold([key('dd')])
    m.useSecrets.getState().forget('aa'.repeat(32))
    await settle()
    expect(mem.get(LEGACY_KEY)).toBe(raw)

    // A reload does not copy again: the forgotten key stays forgotten.
    const again = await boot()
    expect(Object.keys(again.useSecrets.getState().keys).sort()).toEqual(['cc'.repeat(32), 'dd'.repeat(32)])
    expect(mem.get(LEGACY_KEY)).toBe(raw)
  })
})

describe('held keys in IndexedDB', () => {
  it('a key held survives a reload, the first holding kept', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([key('aa')])
    m.useSecrets.getState().hold([key('aa', { at: 1_900_000_000 })])
    await settle()
    expect((await boot()).useSecrets.getState().keys['aa'.repeat(32)].at).toBe(1_800_000_000)
  })

  it('a key held before the load settles is kept and written', async () => {
    vi.resetModules()
    const m = await import('../useSecrets')
    m.useSecrets.getState().hold([key('ee')])
    await m.useSecrets.getState().load()
    await settle()
    expect((await boot()).useSecrets.getState().keys['ee'.repeat(32)]).toBeTruthy()
  })

  it('forgetting keys leaves the places, and the totals stay the database\'s own', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([key('aa'), key('bb')])
    await m.useSecrets.getState().recordPlace(spot(0), 0, scanAt(spot(0)))
    m.useSecrets.getState().forgetAll()
    await settle()
    const after = await boot()
    expect(after.useSecrets.getState().keys).toEqual({})
    expect(after.useSecrets.getState().storage).toMatchObject({ places: 1, placeKeys: 13 })
  })
})

describe('places, which are not held in memory', () => {
  it('the same spot is one row with its time moved; shared keys are one row each', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_800_000_000_000)
    const m = await boot()
    const s = m.useSecrets.getState
    await s().recordPlace(spot(0), 0, scanAt(spot(0)))
    vi.setSystemTime(1_800_000_100_000)
    await s().recordPlace(spot(1), 0, scanAt(spot(1)))
    vi.setSystemTime(1_800_000_200_000)
    await s().recordPlace(spot(0), 0, scanAt(spot(0)))
    expect(s().storage).toMatchObject({ places: 2, placeKeys: 14 })
    expect('places' in s()).toBe(false)

    const after = await boot()
    const rows = await after.vault.pagePlaces(null, 10)
    expect(rows.map((p) => [p.position.x, p.first, p.at])).toEqual([
      [String(spot(0).x), 1_800_000_000, 1_800_000_200],
      [String(spot(1).x), 1_800_000_100, 1_800_000_100],
    ])
  })

  it('a place recorded before the load settles is moved into IndexedDB', async () => {
    vi.resetModules()
    const m = await import('../useSecrets')
    await m.useSecrets.getState().recordPlace(spot(0), 0, scanAt(spot(0)))
    await m.useSecrets.getState().load()
    await settle()
    expect((await boot()).useSecrets.getState().storage).toMatchObject({ places: 1, placeKeys: 13 })
  })

  it('forgetting one place keeps the keys another uses; forgetting all leaves the held keys', async () => {
    const m = await boot()
    const s = m.useSecrets.getState
    s().hold([key('aa')])
    await s().recordPlace(spot(0), 0, scanAt(spot(0)))
    await s().recordPlace(spot(1), 0, scanAt(spot(1)))
    const [newest] = await m.vault.pagePlaces(null, 1)
    await s().forgetPlace(newest.id)
    expect(s().storage).toMatchObject({ places: 1, placeKeys: 13 })
    await s().forgetAllPlaces()
    expect(s().storage).toMatchObject({ places: 0, placeKeys: 0 })
    await settle()
    expect(Object.keys((await boot()).useSecrets.getState().keys)).toEqual(['aa'.repeat(32)])
  })
})

describe('the byte budget, through the store', () => {
  it('once over, evicts to 95% of it: oldest places first, then opened and crossed keys, never bought', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const m = await boot()
    const s = m.useSecrets.getState
    s().hold([bought('b0'), key('s1', { at: 2 }), key('h2', { source: 'hop', at: 3 })])
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(1_800_000_000_000 + i * 1000)
      await s().recordPlace(spot(i * 4), 0, scanAt(spot(i * 4)))
    }
    const full = s().storage.bytes

    // A budget just under what is kept: the oldest places go until the total
    // is at 95% of the budget, and every key stays.
    m.useSecrets.setState((st) => ({ storage: { ...st.storage, budget: full - 1 } }))
    s().hold([key('n3', { at: 4 })])
    await vi.waitFor(() => { expect(s().storage.bytes).toBeLessThanOrEqual(Math.floor((full - 1) * 0.95)) })
    const left = await m.vault.pagePlaces(null, 20)
    expect(left.length).toBeGreaterThan(0)
    expect(left.length).toBeLessThan(10)
    // Oldest gone first: what is left is the newest, without gaps.
    expect(left.map((p) => p.at)).toEqual(Array.from({ length: left.length }, (_, i) => 1_800_000_009 - i))
    expect(Object.keys(s().keys)).toHaveLength(4)

    // No room at all: every place, then the earned keys; the bought one stays.
    m.useSecrets.setState((st) => ({ storage: { ...st.storage, budget: 1 } }))
    s().hold([key('n4', { at: 5 })])
    await vi.waitFor(() => { expect(Object.keys(s().keys)).toEqual(['b0'.repeat(32)]) })
    expect(s().storage).toMatchObject({ places: 0, placeKeys: 0 })
    await settle()
    const after = await boot()
    expect(Object.keys(after.useSecrets.getState().keys)).toEqual(['b0'.repeat(32)])
  })
})

describe('finding 1: a key bought while IndexedDB was out is never stranded', () => {
  it('session 2 falls back and buys; session 3 on IndexedDB holds it', async () => {
    const real = new IDBFactory()
    ;(globalThis as { indexedDB?: unknown }).indexedDB = real
    mem.set(LEGACY_KEY, JSON.stringify({ [key('aa').lookupId]: key('aa') }))
    expect((await boot()).useSecrets.getState().storage.mode).toBe('indexeddb')

    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new Error('UnknownError') } }
    const second = await boot()
    expect(second.useSecrets.getState().storage.mode).toBe('local')
    second.useSecrets.getState().hold([bought('cc'), key('dd')])

    ;(globalThis as { indexedDB?: unknown }).indexedDB = real
    const third = await boot()
    expect(third.useSecrets.getState().storage.mode).toBe('indexeddb')
    // The bought key from the backstop, and the earned one from the record
    // the fallback session kept of what it held.
    expect(third.useSecrets.getState().keys[bought('cc').lookupId]).toBeTruthy()
    expect(third.useSecrets.getState().keys[key('dd').lookupId]).toBeTruthy()
    await settle()
    expect(await onDisk(bought('cc').lookupId)).toBeTruthy()
    expect(await onDisk(key('dd').lookupId)).toBeTruthy()
    // That record is done with; the backstop is never cleared.
    expect(mem.has(FALLBACK_KEY)).toBe(false)
    expect(backstop()).toEqual([bought('cc').lookupId])
  })

  it('every bought key goes to the backstop in IndexedDB mode too, and a lost row comes back from it', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([bought('cc'), key('dd')])
    expect(backstop()).toEqual([bought('cc').lookupId])
    // The database loses it (a clear by another build, a write that never landed).
    await settle()
    await new Promise<void>((resolve) => {
      const r = indexedDB.open(SECRETS_DB)
      r.onsuccess = () => {
        const tx = r.result.transaction(KEYS_STORE, 'readwrite')
        tx.objectStore(KEYS_STORE).delete(bought('cc').lookupId)
        tx.oncomplete = () => { r.result.close(); resolve() }
      }
    })
    expect((await boot()).useSecrets.getState().keys[bought('cc').lookupId]).toBeTruthy()
  })

  it('without a fallback write since, the localStorage list is not merged again', async () => {
    mem.set(LEGACY_KEY, JSON.stringify({ [key('aa').lookupId]: key('aa') }))
    const m = await boot()
    m.useSecrets.getState().forget(key('aa').lookupId)
    await settle()
    expect((await boot()).useSecrets.getState().keys).toEqual({})
  })

  it('a fallback session holds the bought keys from the backstop too', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([bought('cc')])
    ;(globalThis as { indexedDB?: unknown }).indexedDB = undefined
    const local = await boot()
    expect(local.useSecrets.getState().storage.mode).toBe('local')
    expect(local.useSecrets.getState().keys[bought('cc').lookupId]).toBeTruthy()
  })
})

describe('finding 2: forgetting all takes only what this tab holds', () => {
  it('keys another tab held after this one loaded survive FORGET ALL KEYS here', async () => {
    const tabB = await boot()
    const tabA = await boot()
    // A bought key, and an opened one, which has no backstop to fall back on.
    tabA.useSecrets.getState().hold([bought('dd'), key('ff')])
    await settle()
    tabB.useSecrets.getState().hold([key('ee')])
    tabB.useSecrets.getState().forgetAll()
    await settle()
    // On disk, not only after a reload, where the backstop would hide a wrong delete.
    expect(await onDisk(bought('dd').lookupId)).toBeTruthy()
    expect(await onDisk(key('ff').lookupId)).toBeTruthy()
    expect(await onDisk(key('ee').lookupId)).toBeUndefined()
    const reload = await boot()
    expect(reload.useSecrets.getState().keys[key('ff').lookupId]).toBeTruthy()
    expect(reload.useSecrets.getState().keys[bought('dd').lookupId]).toBeTruthy()
    expect(reload.useSecrets.getState().keys[key('ee').lookupId]).toBeUndefined()
    // And it is still in the backstop: tab B never had it to forget.
    expect(backstop()).toEqual([bought('dd').lookupId])
  })

  it('a bought key forgotten here, by its row or by FORGET ALL KEYS, leaves the backstop', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([bought('c1'), bought('c2'), key('ee')])
    m.useSecrets.getState().forget(bought('c1').lookupId)
    expect(backstop()).toEqual([bought('c2').lookupId])
    m.useSecrets.getState().forgetAll()
    expect(backstop()).toEqual([])
    await settle()
    expect((await boot()).useSecrets.getState().keys).toEqual({})
  })

  it('FORGET ALL PLACES leaves a place stood on after the moment it was confirmed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_800_000_000_000)
    const tabB = await boot()
    const tabA = await boot()
    await tabB.useSecrets.getState().recordPlace(spot(0), 0, scanAt(spot(0)))
    vi.setSystemTime(1_800_000_010_000)
    await tabB.useSecrets.getState().forgetAllPlaces()
    vi.setSystemTime(1_800_000_020_000)
    await tabA.useSecrets.getState().recordPlace(spot(9), 0, scanAt(spot(9)))
    const rows = await tabA.vault.pagePlaces(null, 10)
    expect(rows.map((p) => p.position.x)).toEqual([String(spot(9).x)])
  })
})

describe('finding 3: a failed write is tried again', () => {
  it('a connection that is gone is opened again and the write lands', async () => {
    const m = await boot()
    // The next transaction fails the way a dropped connection does.
    const real = IDBDatabase.prototype.transaction
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(function (this: IDBDatabase) {
      throw new DOMException('The database connection is closing.', 'InvalidStateError')
    }).mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) { return real.apply(this, args) })
    m.useSecrets.getState().hold([bought('ee')])
    await vi.waitFor(async () => { expect(await onDisk(bought('ee').lookupId)).toBeTruthy() })
    expect(m.useSecrets.getState().storage.error).toBeNull()
  })

  it('after another tab upgrades the database, the write fails visibly and the bought key survives in the backstop', async () => {
    const m = await boot()
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open(SECRETS_DB, DB_VERSION + 1)
      r.onsuccess = () => { r.result.close(); resolve() }
      r.onerror = () => reject(r.error)
    })
    m.useSecrets.getState().hold([bought('ee')])
    await vi.waitFor(() => { expect(m.useSecrets.getState().storage.error).toBeTruthy() })
    expect(backstop()).toContain(bought('ee').lookupId)
    // This build cannot open the newer database, falls back, and still holds it.
    const next = await boot()
    expect(next.useSecrets.getState().storage.mode).toBe('local')
    expect(next.useSecrets.getState().keys[bought('ee').lookupId]).toBeTruthy()
  })
})

/** A database as the first build of this one (3f153a1) left it: version 1, no indexes, no totals. */
async function firstBuildDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const r = indexedDB.open(SECRETS_DB, 1)
    r.onupgradeneeded = () => { for (const [s, k] of [['keys', 'lookupId'], ['places', 'id'], ['placeKeys', 'lookupId'], ['meta', 'key']]) r.result.createObjectStore(s, { keyPath: k }) }
    r.onsuccess = () => {
      const tx = r.result.transaction(['keys', 'places', 'placeKeys', 'meta'], 'readwrite')
      tx.objectStore('keys').put(key('q1'))
      tx.objectStore('keys').put(bought('q2'))
      tx.objectStore('places').put({ id: '0:x', position: { x: '1', y: '1', z: '1' }, plane: 0, keys: ['x'], first: 1, at: 1 })
      tx.objectStore('placeKeys').put({ lookupId: 'x', keyHex: 'cc'.repeat(32), height: 0, base: { x: '1', y: '1', z: '1' } })
      tx.objectStore('meta').put({ key: 'migratedFromLocalStorage', value: { at: 1, copied: 0 } })
      tx.oncomplete = () => { r.result.close(); resolve() }
    }
  })
}

/** Every row, measured, to hold the store's totals to. */
async function measuredOnDisk(): Promise<{ bytes: number; places: number; placeKeys: number; totals: unknown }> {
  const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open(SECRETS_DB); r.onsuccess = () => resolve(r.result) })
  const all = (store: string): Promise<unknown[]> => new Promise((resolve) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => resolve(q.result) })
  const [keys, places, placeKeys, meta] = await Promise.all(['keys', 'places', 'placeKeys', 'meta'].map(all))
  db.close()
  const bytes = [...keys, ...places, ...placeKeys].reduce((n: number, r) => n + JSON.stringify(r).length, 0)
  return { bytes, places: places.length, placeKeys: placeKeys.length, totals: (meta as Array<{ key: string; value: unknown }>).find((m) => m.key === TOTALS_META)?.value }
}

describe('S1: a tab still on the build before this database', () => {
  it('a key it buys after the migration is taken in at the next load, and copied to the backstop', async () => {
    mem.set(LEGACY_KEY, JSON.stringify({ [key('a1').lookupId]: key('a1') }))
    await boot()
    // The old tab buys a key: its save rewrites the whole list.
    const list = JSON.parse(mem.get(LEGACY_KEY)!) as Record<string, HeldKey>
    list[bought('b2').lookupId] = bought('b2')
    mem.set(LEGACY_KEY, JSON.stringify(list))
    const next = await boot()
    expect(next.useSecrets.getState().keys[bought('b2').lookupId]).toBeTruthy()
    expect(await onDisk(bought('b2').lookupId)).toBeTruthy()
    expect(backstop()).toContain(bought('b2').lookupId)
  })

  it('a key forgotten here that the old tab still lists is not brought back when that tab writes', async () => {
    mem.set(LEGACY_KEY, JSON.stringify({ [key('a1').lookupId]: key('a1') }))
    const m = await boot()
    m.useSecrets.getState().forget(key('a1').lookupId)
    await settle()
    // The old tab loaded a1 before the forget and writes it back with a new key.
    mem.set(LEGACY_KEY, JSON.stringify({ [key('a1').lookupId]: key('a1'), [key('c3').lookupId]: key('c3') }))
    const next = await boot()
    expect(next.useSecrets.getState().keys[key('c3').lookupId]).toBeTruthy()
    expect(next.useSecrets.getState().keys[key('a1').lookupId]).toBeUndefined()
  })

  it('an unchanged list is not merged again', async () => {
    mem.set(LEGACY_KEY, JSON.stringify({ [key('a1').lookupId]: key('a1') }))
    const m = await boot()
    m.useSecrets.getState().forget(key('a1').lookupId)
    await settle()
    expect((await boot()).useSecrets.getState().keys).toEqual({})
  })
})

describe('S2: a fallback session brings back nothing it did not hold', () => {
  it('a session without IndexedDB that does nothing writes nothing, and a key forgotten before it stays forgotten', async () => {
    const real = new IDBFactory()
    ;(globalThis as { indexedDB?: unknown }).indexedDB = real
    mem.set(LEGACY_KEY, JSON.stringify({ [key('o1').lookupId]: key('o1') }))
    const first = await boot()
    first.useSecrets.getState().hold([bought('c9')])
    first.useSecrets.getState().forget(key('o1').lookupId)
    await settle()
    const before = new Map(mem)

    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new Error('UnknownError') } }
    expect((await boot()).useSecrets.getState().storage.mode).toBe('local')
    // Not one localStorage write without anything held or forgotten.
    expect(new Map(mem)).toEqual(before)

    ;(globalThis as { indexedDB?: unknown }).indexedDB = real
    const third = await boot()
    expect(third.useSecrets.getState().keys[key('o1').lookupId]).toBeUndefined()
    expect(third.useSecrets.getState().keys[bought('c9').lookupId]).toBeTruthy()
  })

  it('a key a fallback session forgets is forgotten in IndexedDB at the next load', async () => {
    const real = new IDBFactory()
    ;(globalThis as { indexedDB?: unknown }).indexedDB = real
    const first = await boot()
    // Held well before the fallback session forgets f1.
    first.useSecrets.getState().hold([key('f1', { at: 1_700_000_000 }), key('f2', { at: 1_700_000_000 })])
    await settle()
    // The fallback session cannot see IndexedDB; the old list stands in, and has f1.
    mem.set(LEGACY_KEY, JSON.stringify({ [key('f1').lookupId]: key('f1', { at: 1_700_000_000 }) }))
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new Error('UnknownError') } }
    const fallback = await boot()
    fallback.useSecrets.getState().forget(key('f1').lookupId)
    ;(globalThis as { indexedDB?: unknown }).indexedDB = real
    const third = await boot()
    expect(third.useSecrets.getState().keys[key('f1').lookupId]).toBeUndefined()
    expect(third.useSecrets.getState().keys[key('f2').lookupId]).toBeTruthy()
    await settle()
    expect(await onDisk(key('f1').lookupId)).toBeUndefined()
    expect(mem.has(FALLBACK_KEY)).toBe(false)
  })
})

describe('N1: a database the first build of this left', () => {
  it('gains its indexes, is measured once, and works', async () => {
    await firstBuildDatabase()
    const m = await boot()
    const s = m.useSecrets.getState
    expect(s().storage.mode).toBe('indexeddb')
    expect(Object.keys(s().keys)).toHaveLength(2)
    expect(s().storage).toMatchObject({ places: 1, placeKeys: 1 })
    expect(await m.vault.pagePlaces(null, 10)).toHaveLength(1)
    await s().recordPlace(spot(1), 0, scanAt(spot(1)))
    await s().forgetPlace('0:x')
    expect(s().storage.error).toBeNull()
    const disk = await measuredOnDisk()
    expect(disk.totals).toEqual({ bytes: disk.bytes, places: disk.places, placeKeys: disk.placeKeys })
    expect(s().storage).toMatchObject({ bytes: disk.bytes, places: disk.places, placeKeys: disk.placeKeys })
  })
})

describe('N2: a key forgotten before the load settles', () => {
  it('stays forgotten, in memory and in IndexedDB', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([key('z1')])
    await settle()
    vi.resetModules()
    const next = await import('../useSecrets')
    const loading = next.useSecrets.getState().load()
    next.useSecrets.getState().forget(key('z1').lookupId)
    await loading
    await settle()
    expect(next.useSecrets.getState().keys[key('z1').lookupId]).toBeUndefined()
    expect(await onDisk(key('z1').lookupId)).toBeUndefined()
  })

  it('a key forgotten and then held again before the load is held', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([key('z2')])
    await settle()
    vi.resetModules()
    const next = await import('../useSecrets')
    next.useSecrets.getState().forget(key('z2').lookupId)
    next.useSecrets.getState().hold([key('z2')])
    await next.useSecrets.getState().load()
    expect(next.useSecrets.getState().keys[key('z2').lookupId]).toBeTruthy()
  })
})

describe('N3: a backstop write that fails is said', () => {
  it('shows in the storage status, and clears once a later copy lands with the missed key in it', async () => {
    const m = await boot()
    const setItem = globalThis.localStorage.setItem
    globalThis.localStorage.setItem = (k: string, v: string) => {
      if (k === BOUGHT_KEY) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      setItem(k, v)
    }
    m.useSecrets.getState().hold([bought('d1')])
    expect(m.useSecrets.getState().storage.backstopError).toBe('The quota has been exceeded.')
    globalThis.localStorage.setItem = setItem
    m.useSecrets.getState().hold([bought('d2')])
    expect(m.useSecrets.getState().storage.backstopError).toBeNull()
    expect(backstop().sort()).toEqual([bought('d1').lookupId, bought('d2').lookupId].sort())
  })
})

describe('N5: a load never replaces a row with an older copy', () => {
  it('the backstop, the old list and a fallback record only ever fill gaps', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([bought('k1', { at: 2_000_000_000, eventId: 'NEW' })])
    await settle()
    const old = bought('k1', { at: 1, eventId: 'OLD' })
    mem.set(BOUGHT_KEY, JSON.stringify({ [old.lookupId]: old }))
    mem.set(LEGACY_KEY, JSON.stringify({ [old.lookupId]: old }))
    mem.set(FALLBACK_KEY, JSON.stringify({ held: { [old.lookupId]: old }, forgotten: [] }))
    const next = await boot()
    await settle()
    expect(next.useSecrets.getState().keys[old.lookupId].eventId).toBe('NEW')
    expect((await onDisk(old.lookupId))?.eventId).toBe('NEW')
  })
})

const FAILING = { open: () => { throw new Error('UnknownError') } }

/** Make the load's own write of held keys fail (both tries), and nothing else. */
function failAdoptWrite(): { stop: () => void } {
  const real = IDBDatabase.prototype.transaction
  let on = true
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
    const stores = ([] as string[]).concat(args[0] as string | string[])
    if (on && args[1] === 'readwrite' && stores.includes(KEYS_STORE) && new Error().stack?.includes('writeKeys')) throw new DOMException('simulated', 'UnknownError')
    return real.apply(this, args)
  })
  return { stop: () => { on = false } }
}

describe('final review: a key held again after a fallback forget is kept', () => {
  it('Q2: a tab already holding a bought key buys it again after a fallback tab forgot it', async () => {
    const real = new IDBFactory()
    ;(globalThis as { indexedDB?: unknown }).indexedDB = real
    const tabB = await boot()
    tabB.useSecrets.getState().hold([bought('k2', { at: 1_700_000_000 })])
    await settle()
    ;(globalThis as { indexedDB?: unknown }).indexedDB = FAILING
    const tabA = await boot()
    tabA.useSecrets.getState().forget(bought('k2').lookupId)
    ;(globalThis as { indexedDB?: unknown }).indexedDB = real
    // Bought again in tab B, where it is still held: hold has nothing to add.
    tabB.useSecrets.getState().hold([bought('k2')])
    await settle()
    const tabC = await boot()
    await settle()
    expect(tabC.useSecrets.getState().keys[bought('k2').lookupId]).toBeTruthy()
    expect(await onDisk(bought('k2').lookupId)).toBeTruthy()
    expect(backstop()).toContain(bought('k2').lookupId)
  })

  it('a bought key in the backstop is not taken by a fallback forget: the forget emptied it, so it was bought again since', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([bought('k3', { at: 1_700_000_000 })])
    await settle()
    mem.set(FALLBACK_KEY, JSON.stringify({ held: {}, forgotten: [{ id: bought('k3').lookupId, at: 1_750_000_000 }] }))
    const next = await boot()
    expect(next.useSecrets.getState().keys[bought('k3').lookupId]).toBeTruthy()
    await settle()
    expect(mem.has(FALLBACK_KEY)).toBe(false)
  })

  it('holding a bought key already held offers it to the backstop again', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([bought('k4')])
    mem.set(BOUGHT_KEY, '{}')
    m.useSecrets.getState().hold([bought('k4')])
    expect(backstop()).toEqual([bought('k4').lookupId])
  })

  it('holding a key, held already or not, takes back a recorded fallback forget of it', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([key('e1')])
    mem.set(FALLBACK_KEY, JSON.stringify({ held: {}, forgotten: [{ id: key('e1').lookupId, at: 1 }, { id: key('e2').lookupId, at: 1 }] }))
    m.useSecrets.getState().hold([key('e1')])
    expect(JSON.parse(mem.get(FALLBACK_KEY)!).forgotten.map((f: { id: string }) => f.id)).toEqual([key('e2').lookupId])
  })

  it('a fallback forget older than the row here is not applied: the key was held again since', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([key('e3', { at: 1_760_000_000 })])
    await settle()
    mem.set(FALLBACK_KEY, JSON.stringify({ held: {}, forgotten: [{ id: key('e3').lookupId, at: 1_750_000_000 }] }))
    expect((await boot()).useSecrets.getState().keys[key('e3').lookupId]).toBeTruthy()
  })

  it('Q1: a forget whose load failed to write it does not take keys bought and crossed again since', async () => {
    const real = new IDBFactory()
    ;(globalThis as { indexedDB?: unknown }).indexedDB = real
    const first = await boot()
    first.useSecrets.getState().hold([bought('k1', { at: 1_700_000_000 }), key('h1', { source: 'hop', at: 1_700_000_000 })])
    await settle()
    // The fallback session sees h1 through the old list, and forgets both.
    mem.set(LEGACY_KEY, JSON.stringify({ [key('h1').lookupId]: key('h1', { source: 'hop', at: 1_700_000_000 }) }))
    ;(globalThis as { indexedDB?: unknown }).indexedDB = FAILING
    const fallback = await boot()
    fallback.useSecrets.getState().forget(bought('k1').lookupId)
    fallback.useSecrets.getState().forget(key('h1').lookupId)
    ;(globalThis as { indexedDB?: unknown }).indexedDB = real
    const failing = failAdoptWrite()
    const third = await boot()
    failing.stop()
    expect(third.useSecrets.getState().storage.error).toBe('simulated')
    expect(mem.has(FALLBACK_KEY)).toBe(true)
    // Bought and crossed again in that session.
    third.useSecrets.getState().hold([bought('k1'), key('h1', { source: 'hop', at: Math.floor(Date.now() / 1000) })])
    await settle()
    for (let load = 0; load < 2; load++) {
      const next = await boot()
      await settle()
      expect(next.useSecrets.getState().keys[bought('k1').lookupId]).toBeTruthy()
      expect(next.useSecrets.getState().keys[key('h1').lookupId]).toBeTruthy()
    }
  })
})

describe('final review: the rest', () => {
  it('Q4: a hold a fallback tab records while a load is writing survives that load', async () => {
    const real = new IDBFactory()
    ;(globalThis as { indexedDB?: unknown }).indexedDB = real
    await boot()
    ;(globalThis as { indexedDB?: unknown }).indexedDB = FAILING
    const tabA = await boot()
    tabA.useSecrets.getState().hold([key('f1', { source: 'hop' })])
    ;(globalThis as { indexedDB?: unknown }).indexedDB = real
    // While tab C's load writes f1 in, tab A (still without IndexedDB) holds f2.
    const realTx = IDBDatabase.prototype.transaction
    let injected = false
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
      if (!injected && new Error().stack?.includes('writeKeys')) { injected = true; tabA.useSecrets.getState().hold([key('f2', { source: 'hop' })]) }
      return realTx.apply(this, args)
    })
    await boot()
    expect(injected).toBe(true)
    vi.restoreAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ })
    const next = await boot()
    expect(next.useSecrets.getState().keys[key('f1').lookupId]).toBeTruthy()
    expect(next.useSecrets.getState().keys[key('f2').lookupId]).toBeTruthy()
  })

  it('Q3: an old list that cannot be read at one load is not recorded as empty, so the next load brings nothing back', async () => {
    mem.set(LEGACY_KEY, JSON.stringify({ [key('g1').lookupId]: key('g1'), [key('g2').lookupId]: key('g2') }))
    const m = await boot()
    m.useSecrets.getState().forget(key('g1').lookupId)
    await settle()
    const getItem = globalThis.localStorage.getItem
    globalThis.localStorage.getItem = (k: string) => { if (k === LEGACY_KEY) throw new DOMException('denied', 'SecurityError'); return getItem(k) }
    await boot()
    globalThis.localStorage.getItem = getItem
    mem.set(LEGACY_KEY, '{not json')
    await boot()
    mem.set(LEGACY_KEY, JSON.stringify({ [key('g1').lookupId]: key('g1'), [key('g2').lookupId]: key('g2') }))
    expect((await boot()).useSecrets.getState().keys[key('g1').lookupId]).toBeUndefined()
  })

  it('Q5: a database from f18c7f5 gains a record of the old list, so a key forgotten under it stays forgotten, and its totals are measured again', async () => {
    mem.set(LEGACY_KEY, JSON.stringify({ [key('L1').lookupId]: key('L1') }))
    await new Promise<void>((resolve) => {
      const r = indexedDB.open(SECRETS_DB, 1)
      r.onupgradeneeded = () => {
        const db = r.result
        db.createObjectStore('keys', { keyPath: 'lookupId' })
        const places = db.createObjectStore('places', { keyPath: 'id' })
        places.createIndex('byTime', ['at', 'id'])
        places.createIndex('byKey', 'keys', { multiEntry: true })
        db.createObjectStore('placeKeys', { keyPath: 'lookupId' })
        db.createObjectStore('meta', { keyPath: 'key' })
      }
      r.onsuccess = () => {
        const tx = r.result.transaction(['keys', 'meta'], 'readwrite')
        // L1 was copied in and then forgotten; another key is held. The totals are wrong.
        tx.objectStore('keys').put(key('m2'))
        tx.objectStore('meta').put({ key: 'migratedFromLocalStorage', value: { at: 1, copied: 1 } })
        tx.objectStore('meta').put({ key: TOTALS_META, value: { bytes: 0, places: 0, placeKeys: 0 } })
        tx.oncomplete = () => { r.result.close(); resolve() }
      }
    })
    const m = await boot()
    expect(m.useSecrets.getState().keys[key('L1').lookupId]).toBeUndefined()
    expect(m.useSecrets.getState().keys[key('m2').lookupId]).toBeTruthy()
    const disk = await measuredOnDisk()
    expect(disk.totals).toEqual({ bytes: disk.bytes, places: 0, placeKeys: 0 })
    expect(disk.bytes).toBeGreaterThan(0)
  })
})

describe('without IndexedDB', () => {
  it('falls back to localStorage: keys written to the fallback record, never the old list; places only in memory', async () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB
    const m = await boot()
    expect(m.useSecrets.getState().storage.mode).toBe('local')
    expect(m.useSecrets.getState().storage.reason).toMatch(/IndexedDB/)
    m.useSecrets.getState().hold([key('aa')])
    await m.useSecrets.getState().recordPlace(spot(0), 0, scanAt(spot(0)))
    expect(mem.has(LEGACY_KEY)).toBe(false)
    expect(Object.keys(JSON.parse(mem.get(FALLBACK_KEY) ?? '{}').held)).toEqual(['aa'.repeat(32)])
    expect((await m.vault.pagePlaces(null, 10))).toHaveLength(1)
    const again = await boot()
    expect(Object.keys(again.useSecrets.getState().keys)).toEqual(['aa'.repeat(32)])
    expect(again.useSecrets.getState().storage.places).toBe(0)
  })

  it('keeps SECRETS_MAX there, dropping opened and crossed keys and never a bought one', async () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB
    const m = await boot()
    const many = Array.from({ length: m.SECRETS_MAX + 20 }, (_, i) =>
      key('00', { lookupId: i.toString(16).padStart(64, '0'), at: 1_800_000_000 + i }))
    m.useSecrets.getState().hold([key('ff', { source: 'cloud', at: 0 }), ...many])
    const held = m.heldList(m.useSecrets.getState().keys)
    expect(held).toHaveLength(m.SECRETS_MAX)
    expect(held[0].at).toBe(1_800_000_000 + m.SECRETS_MAX + 19)
    expect(m.useSecrets.getState().keys['ff'.repeat(32)]).toBeTruthy()
  })

  it('falls back when IndexedDB refuses to open', async () => {
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new Error('InvalidStateError') } }
    const m = await boot()
    expect(m.useSecrets.getState().storage.mode).toBe('local')
    expect(m.useSecrets.getState().storage.reason).toMatch(/InvalidStateError/)
  })
})

describe('asking the browser to keep the storage', () => {
  it('asks at the first write, not at load, and once', async () => {
    const persist = vi.fn(async () => true)
    const persisted = vi.fn(async () => false)
    vi.stubGlobal('navigator', { storage: { persist, persisted } })
    const m = await boot()
    expect(persist).not.toHaveBeenCalled()
    expect(m.useSecrets.getState().storage.persisted).toBe('unasked')

    m.useSecrets.getState().hold([key('aa')])
    m.useSecrets.getState().hold([key('bb')])
    await vi.waitFor(() => { expect(m.useSecrets.getState().storage.persisted).toBe('granted') })
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('says when the browser will not', async () => {
    vi.stubGlobal('navigator', { storage: { persist: vi.fn(async () => false), persisted: vi.fn(async () => false) } })
    const m = await boot()
    m.useSecrets.getState().hold([key('aa')])
    await vi.waitFor(() => { expect(m.useSecrets.getState().storage.persisted).toBe('denied') })
  })

  it('says when there is no way to ask', async () => {
    vi.stubGlobal('navigator', {})
    const m = await boot()
    expect(m.useSecrets.getState().storage.persisted).toBe('unsupported')
  })
})
