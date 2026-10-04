/**
 * secretsStorage.test.ts: region keys and places kept in IndexedDB, through the store.
 *
 * A page load is a fresh copy of the store module over the same database and
 * the same localStorage: memory gone, both stores still there. Two tabs are
 * two copies loaded side by side.
 *
 * The regressions from the review of #219 (2026-10-04) are named for its
 * findings: 1, a key bought while IndexedDB was out was stranded once it came
 * back; 2, FORGET ALL in one tab wiped a key another tab had bought; 3, a
 * write that failed was never tried again.
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
import { BOUGHT_KEY, FALLBACK_MARKER } from '../../lib/secrets/backstop'
import { KEYS_STORE, LEGACY_KEY, SECRETS_DB } from '../../lib/secrets/db'

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
const bought = (id: string): HeldKey => key(id, { source: 'cloud', height: 20 })

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
    // The bought key from the backstop, and the earned one because the
    // fallback session marked that it wrote.
    expect(third.useSecrets.getState().keys[bought('cc').lookupId]).toBeTruthy()
    expect(third.useSecrets.getState().keys[key('dd').lookupId]).toBeTruthy()
    await settle()
    expect(await onDisk(bought('cc').lookupId)).toBeTruthy()
    expect(await onDisk(key('dd').lookupId)).toBeTruthy()
    // The marker is done with; the backstop is never cleared.
    expect(mem.has(FALLBACK_MARKER)).toBe(false)
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
      const r = indexedDB.open(SECRETS_DB, 2)
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

describe('without IndexedDB', () => {
  it('falls back to localStorage as before: keys written there, places only in memory', async () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB
    const m = await boot()
    expect(m.useSecrets.getState().storage.mode).toBe('local')
    expect(m.useSecrets.getState().storage.reason).toMatch(/IndexedDB/)
    m.useSecrets.getState().hold([key('aa')])
    await m.useSecrets.getState().recordPlace(spot(0), 0, scanAt(spot(0)))
    expect(Object.keys(JSON.parse(mem.get(LEGACY_KEY) ?? '{}'))).toEqual(['aa'.repeat(32)])
    expect(mem.has(FALLBACK_MARKER)).toBe(true)
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
